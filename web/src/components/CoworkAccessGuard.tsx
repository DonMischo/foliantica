"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getCoworkJwt } from "@/lib/api";

type Status = "checking" | "allowed" | "denied";

// Guests sometimes land on a bare URL (LAN IP, Cloudflare domain) instead of
// the invitation link from /join — e.g. a stale bookmark, or someone retyping
// the address by hand. The host is always trusted (via the loopback/secret/
// Origin checks in CoworkAuthMiddleware) and needs no JWT, so this probe
// (any auth-gated endpoint) only returns a rejection for an untrusted
// caller. Two distinct rejections to watch for: 401 means co-work is on but
// no/invalid JWT was presented (the normal "never joined" case); 403 means
// co-work is OFF and the caller isn't trusted either — e.g. someone on the
// LAN still reaching this page after the host disabled co-work, since the
// server's bind address only changes on app restart. For the genuine
// single-user case (host's own loopback/secret-trusted traffic) neither
// ever fires, so this stays a no-op there.
export function CoworkAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const skip = pathname === "/join";
  const [status, setStatus] = useState<Status>(skip ? "allowed" : "checking");

  useEffect(() => {
    if (skip) { setStatus("allowed"); return; }
    let cancelled = false;
    setStatus("checking");
    const jwtToken = getCoworkJwt();
    fetch("/api/projects", {
      headers: jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {},
    })
      .then(res => { if (!cancelled) setStatus(res.status === 401 || res.status === 403 ? "denied" : "allowed"); })
      .catch(() => { if (!cancelled) setStatus("allowed"); });
    return () => { cancelled = true; };
  }, [skip]);

  if (status === "checking") return null;

  if (status === "denied") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-sm w-full mx-4 p-8 rounded-xl border border-border bg-card shadow-lg text-center">
          <p className="text-xs text-muted-foreground/70 mb-3">
            Co-Work is disabled or your invitation has expired.
          </p>
          <h1 className="text-xl font-semibold mb-2">Invitation required</h1>
          <p className="text-sm text-muted-foreground">
            This workspace is shared. Ask your host to activate Co-Work mode and send you an invitation link.
          </p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
