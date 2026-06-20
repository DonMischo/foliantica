"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface InvitationInfo {
  name: string;
  role: string;
  has_pin: boolean;
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinPageInner />
    </Suspense>
  );
}

function JoinPageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get("token") ?? "";

  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [notFound,   setNotFound]   = useState(false);
  const [name,       setName]       = useState("");
  const [pin,        setPin]        = useState("");
  const [error,      setError]      = useState("");
  const [busy,       setBusy]       = useState(false);
  const [banned,     setBanned]     = useState(0); // seconds remaining

  // Look up invitation details from the server
  useEffect(() => {
    if (!token) { setNotFound(true); return; }
    fetch(`/api/collab/info?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        if (d.invitation) {
          setInvitation(d.invitation);
          setName(d.invitation.name);   // pre-fill with invitation name
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true));
  }, [token]);

  // Countdown timer for ban state
  useEffect(() => {
    if (banned <= 0) return;
    const t = setTimeout(() => setBanned(b => Math.max(0, b - 1)), 1000);
    return () => clearTimeout(t);
  }, [banned]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Please enter your name."); return; }
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/collab/join", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token, display_name: name.trim(), pin: pin || null }),
      });

      if (res.ok) {
        const data = await res.json();
        // Store JWT for all subsequent API calls
        localStorage.setItem("cowork_jwt",      data.jwt);
        localStorage.setItem("cowork_role",     data.role);
        localStorage.setItem("cowork_name",     data.display_name);
        localStorage.setItem("cowork_session",  data.session_id);
        router.push("/");
      } else {
        const data = await res.json().catch(() => ({}));
        const detail: string = data.detail ?? "Authentication failed.";
        if (res.status === 429) {
          // Extract seconds from message, e.g. "Try again in 247 seconds."
          const m = detail.match(/(\d+) seconds/);
          setBanned(m ? parseInt(m[1]) : 300);
          setError(detail);
        } else {
          setError(detail);
        }
      }
    } catch {
      setError("Could not reach the server. Is the host online?");
    } finally {
      setBusy(false);
    }
  }

  if (!token || notFound) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-sm w-full mx-4 p-8 rounded-xl border border-border bg-card shadow-lg text-center">
          <h1 className="text-xl font-semibold mb-2">Invalid invitation</h1>
          <p className="text-sm text-muted-foreground">
            This link has expired or was already revoked. Ask your host for a new one.
          </p>
        </div>
      </main>
    );
  }

  if (!invitation) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Checking invitation…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-sm w-full mx-4 p-8 rounded-xl border border-border bg-card shadow-lg">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold tracking-tight mb-1">Foliantica</div>
          <p className="text-sm text-muted-foreground">
            You&apos;ve been invited to collaborate
          </p>
          <div className="mt-3 inline-block px-3 py-1 rounded-full bg-muted text-xs font-medium">
            {invitation.role === "student" ? "Student" : "Co-Author"} · {invitation.name}
          </div>
        </div>

        <form onSubmit={handleJoin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Your name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="How should others see you?"
              maxLength={40}
              disabled={busy || banned > 0}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm
                         placeholder:text-muted-foreground focus:outline-none focus:ring-2
                         focus:ring-ring disabled:opacity-50"
            />
          </div>

          {invitation.has_pin && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                PIN
              </label>
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value)}
                placeholder="Enter the PIN from your host"
                disabled={busy || banned > 0}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm
                           placeholder:text-muted-foreground focus:outline-none focus:ring-2
                           focus:ring-ring disabled:opacity-50"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2">
              {error}
            </p>
          )}

          {banned > 0 && (
            <p className="text-xs text-amber-600 text-center">
              Try again in {banned}s
            </p>
          )}

          <button
            type="submit"
            disabled={busy || banned > 0}
            className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm
                       font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {busy ? "Joining…" : "Join session"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Your session expires after 8 hours.
        </p>
      </div>
    </main>
  );
}
