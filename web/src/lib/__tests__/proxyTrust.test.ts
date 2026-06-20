import { describe, it, expect } from "vitest";
import { computeClientIp, originMatchesHost, type ProxyTrustInputs } from "../proxyTrust";

const base: ProxyTrustInputs = {
  internalPeer: "127.0.0.1",
  origin: null,
  requestHost: "127.0.0.1:3100",
  secretHeader: null,
  forwardedFor: null,
  realIpHeader: null,
  configuredSecret: "",
};

describe("computeClientIp", () => {
  it("trusts a loopback peer with no Origin header", () => {
    expect(computeClientIp(base)).toBe("127.0.0.1");
  });

  it("trusts a loopback peer with a matching Origin", () => {
    expect(computeClientIp({ ...base, origin: "http://127.0.0.1:3100" })).toBe("127.0.0.1");
  });

  it("rejects a loopback peer with a mismatched Origin (malicious tab on the host's own machine)", () => {
    expect(computeClientIp({ ...base, origin: "https://evil.example.com" })).toBe("0.0.0.0");
  });

  it("rejects a non-loopback peer even with no Origin (LAN device hitting the port directly)", () => {
    expect(computeClientIp({ ...base, internalPeer: "192.168.1.50" })).toBe("0.0.0.0");
  });

  it("a correct secret overrides everything, even a non-loopback peer and mismatched Origin", () => {
    expect(computeClientIp({
      ...base,
      internalPeer: "192.168.1.50",
      origin: "https://evil.example.com",
      secretHeader: "s3cr3t",
      configuredSecret: "s3cr3t",
    })).toBe("127.0.0.1");
  });

  it("a wrong secret alone (non-loopback peer) does not grant trust", () => {
    expect(computeClientIp({
      ...base, internalPeer: "192.168.1.50", secretHeader: "wrong", configuredSecret: "s3cr3t",
    })).toBe("0.0.0.0");
  });

  it("an empty configured secret never matches an empty header", () => {
    expect(computeClientIp({ ...base, internalPeer: "192.168.1.50", secretHeader: "", configuredSecret: "" })).toBe("0.0.0.0");
  });

  it("relays a genuine forwarded guest IP for rate-limiting when untrusted", () => {
    expect(computeClientIp({ ...base, internalPeer: "192.168.1.50", forwardedFor: "203.0.113.7" })).toBe("203.0.113.7");
  });

  it("never lets a spoofed X-Forwarded-For: 127.0.0.1 grant host trust", () => {
    expect(computeClientIp({ ...base, internalPeer: "192.168.1.50", forwardedFor: "127.0.0.1" })).toBe("0.0.0.0");
  });

  it("never lets a spoofed X-Real-IP: ::1 grant host trust", () => {
    expect(computeClientIp({ ...base, internalPeer: "192.168.1.50", realIpHeader: "::1" })).toBe("0.0.0.0");
  });
});

describe("originMatchesHost", () => {
  it("treats an absent Origin as matching", () => {
    expect(originMatchesHost(null, "127.0.0.1:3100")).toBe(true);
  });

  it("matches when Origin's host:port equals the request Host", () => {
    expect(originMatchesHost("http://127.0.0.1:3100", "127.0.0.1:3100")).toBe(true);
  });

  it("rejects a different host", () => {
    expect(originMatchesHost("https://evil.example.com", "127.0.0.1:3100")).toBe(false);
  });

  it("rejects a different port on the same host", () => {
    expect(originMatchesHost("http://127.0.0.1:9999", "127.0.0.1:3100")).toBe(false);
  });

  it("treats a malformed Origin as non-matching", () => {
    expect(originMatchesHost("not-a-url", "127.0.0.1:3100")).toBe(false);
  });
});
