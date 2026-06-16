/**
 * Pure trust-decision logic for the API proxy (route.ts), extracted so it
 * can be unit-tested directly without a running Next.js server. See
 * COWORKING_NETWORK_SECURITY_SUMMARY.md for the full rationale behind each
 * signal.
 */

export interface ProxyTrustInputs {
  /** Verified TCP peer of the request reaching Next.js, set by
   *  server-wrapper.js from the actual socket — not a client-suppliable
   *  header. Null if absent (e.g. running plain `next dev`, no wrapper). */
  internalPeer: string | null;
  /** The browser's Origin header, if any. Browsers cannot lie about this. */
  origin: string | null;
  /** This request's own Host header (e.g. "127.0.0.1:3000"). */
  requestHost: string;
  /** X-Foliantica-Host-Secret header value, if any. */
  secretHeader: string | null;
  /** X-Forwarded-For header value (first hop), if any. */
  forwardedFor: string | null;
  /** X-Real-IP header value, if any. */
  realIpHeader: string | null;
  /** This process's own copy of FOLIANTICA_HOST_SECRET (env var). Empty
   *  string means no secret is configured (e.g. non-Electron launch path). */
  configuredSecret: string;
}

function isLoopback(addr: string | null): boolean {
  return addr === "127.0.0.1" || addr === "::1";
}

export function originMatchesHost(origin: string | null, requestHost: string): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

/** Returns the X-Client-IP value to forward to FastAPI. "127.0.0.1" means
 * "trust this as the host"; anything else is treated as an untrusted/guest
 * IP requiring a valid JWT. */
export function computeClientIp(inputs: ProxyTrustInputs): string {
  const hasValidSecret =
    !!inputs.configuredSecret && inputs.secretHeader === inputs.configuredSecret;

  const peerIsLoopback = isLoopback(inputs.internalPeer);

  const isTrustedHost =
    hasValidSecret || (peerIsLoopback && originMatchesHost(inputs.origin, inputs.requestHost));

  if (isTrustedHost) return "127.0.0.1";

  // A genuine reverse proxy (cloudflared) never reports the visitor's IP as
  // loopback — only a spoofing attempt would. Never let an untrusted client
  // claim host-equivalent trust this way, the same mistake X-Client-IP
  // itself used to make.
  const forwardedIp = inputs.forwardedFor?.split(",")[0].trim() || inputs.realIpHeader || null;
  if (forwardedIp && !isLoopback(forwardedIp)) return forwardedIp;

  return "0.0.0.0";
}
