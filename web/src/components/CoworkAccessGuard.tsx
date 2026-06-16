"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getCoworkJwt } from "@/lib/api";

type Status = "checking" | "allowed" | "denied";

// Guests sometimes land on a bare URL (LAN IP, Cloudflare domain) instead of
// the invitation link from /join — e.g. a stale bookmark, or someone retyping
// the address by hand. The host is always trusted by IP and needs no JWT, so
// this probe (any auth-gated endpoint) only ever returns 401 for guests who
// never completed the join flow. When co-work is disabled, the backend
// doesn't enforce auth at all, so this is a no-op for the normal single-user
// case.
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
      .then(res => { if (!cancelled) setStatus(res.status === 401 ? "denied" : "allowed"); })
      .catch(() => { if (!cancelled) setStatus("allowed"); });
    return () => { cancelled = true; };
  }, [skip]);

  if (status === "checking") return null;

  if (status === "denied") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-sm w-full mx-4 p-8 rounded-xl border border-border bg-card shadow-lg text-center">
          <h1 className="text-xl font-semibold mb-2">Invitation required</h1>
          <p className="text-sm text-muted-foreground">
            This workspace is shared. Ask your host for an invitation link to join.
          </p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
