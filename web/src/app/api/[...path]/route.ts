import { NextRequest } from "next/server";
import { computeClientIp } from "@/lib/proxyTrust";

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const apiPort = process.env.LW_API_PORT ?? "8765";
  const { search } = req.nextUrl;
  const target = `http://127.0.0.1:${apiPort}/api/${path.join("/")}${search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");
  // Internal-only signal set by server-wrapper.js from the verified TCP
  // peer — never forwarded past this layer (FastAPI never sees it).
  const internalPeer = headers.get("x-internal-real-peer");
  headers.delete("x-internal-real-peer");

  // Forward the real client IP so the FastAPI co-work auth middleware can
  // distinguish host (127.0.0.1) from remote guest requests. Three signals,
  // checked in order of trustworthiness (see proxyTrust.ts and
  // COWORKING_NETWORK_SECURITY_SUMMARY.md):
  //
  // 1. X-Foliantica-Host-Secret — injected by Electron's webRequest hook into
  //    every request from its own window, never visible to page JS or any
  //    other process. Strongest signal; if present and correct, trust
  //    immediately regardless of the checks below.
  // 2. Verified TCP peer (X-Internal-Real-Peer, from server-wrapper.js) being
  //    loopback. Unlike the Host header, this can't be spoofed by a raw
  //    client (curl etc.) connecting from a different machine — it's the
  //    actual socket address, not a request header.
  // 3. Origin check: even a genuinely-loopback request might be a malicious
  //    browser tab on the SAME machine doing fetch()/WebSocket() straight to
  //    this port — browsers can't lie about Origin (unlike Host), so reject
  //    host-trust whenever Origin is present and doesn't match this
  //    request's own Host.
  //
  // A LAN guest hitting the LAN IP directly has none of these — real peer is
  // their own LAN IP, no secret, and if their browser sent Origin it'd be
  // their own page's origin (not this server's) — so they correctly fall
  // through to JWT-only access.
  const realIp = computeClientIp({
    internalPeer,
    origin: req.headers.get("origin"),
    requestHost: req.headers.get("host") ?? "",
    secretHeader: req.headers.get("x-foliantica-host-secret"),
    forwardedFor: req.headers.get("x-forwarded-for"),
    realIpHeader: req.headers.get("x-real-ip"),
    configuredSecret: process.env.FOLIANTICA_HOST_SECRET ?? "",
  });
  headers.set("X-Client-IP", realIp);

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const contentType = req.headers.get("content-type") ?? "";
    init.body = contentType.includes("multipart/form-data")
      ? await req.formData()
      : req.body;
    (init as RequestInit & { duplex?: string }).duplex = "half";
  }

  try {
    return fetch(target, init);
  } catch {
    return new Response("Backend unavailable", { status: 503 });
  }
}

export const GET     = handler;
export const POST    = handler;
export const PUT     = handler;
export const PATCH   = handler;
export const DELETE  = handler;
export const HEAD    = handler;
export const OPTIONS = handler;
