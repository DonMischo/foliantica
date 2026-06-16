# Foliantica Co-Work — Network & Security Summary

## Network paths

- **LAN**: Guest browser → Next.js (`web`, port 3000) for REST, **and directly to FastAPI (`api`, port 8765)** for the WebSocket — [collab.py](api/routers/collab.py#L18-L25) docstring: *"The Next.js proxy cannot tunnel WebSocket upgrades, so the client connects directly to FastAPI."*
- **Internet via Cloudflare quick tunnel**: `cloudflared tunnel --url http://localhost:3000` ([collab.py](api/routers/collab.py#L36-L44)) — only the **web port** is tunneled. REST works for these guests; WS does not (the tunnel doesn't carry port 8765). Anonymous, URL rotates every restart.
- **UPnP — removed.** Previously auto-forwarded both ports to the open internet with no TLS; cut because it compounded the auth-bypass below into an internet-wide exposure. Manual port-forward is now the only raw-public-IP option (documented in [FeatureIdeas.yaml](FeatureIdeas.yaml)).
- **Bind address**: [electron/main.js](electron/main.js#L547) — when co-work is enabled, both servers bind `0.0.0.0` instead of `127.0.0.1`. This is what makes the LAN WS path possible, and is the precondition for the bypass below.

## Auth methods

1. **Invitation**: 256-bit token (`secrets.token_hex(32)`) + optional PIN, PIN bcrypt-hashed ([collab.py](api/routers/collab.py#L1055)). Token stored plaintext in local `~/.foliantica/config.json` (acceptable — host-only file).
2. **Join → JWT**: validates token + PIN, issues HS256 JWT, 8h expiry, secret regenerated per process start (in-memory only — guests re-join after a restart).
3. **Rate limiting**: 1 failed join attempt → 300s ban, keyed by client IP. No cap on distinct IPs, no escalation.
4. **HTTP host-trust**: `CoworkAuthMiddleware` ([main.py](api/main.py#L154-L197)) trusts the `X-Client-IP` header (or, failing that, `request.client.host`) if it's `127.0.0.1`/`::1`.
5. **WS host-trust**: an independent mechanism — checks the actual **socket peer address** `ws.client.host` ([collab.py](api/routers/collab.py#L686-L687)), not any header. **Confirmed**: LAN guests are *not* auto-trusted here — their real LAN IP isn't `127.0.0.1`, so they go through the same JWT requirement as internet guests. The loopback shortcut realistically only matches the host's own machine (TCP handshake completion + OS-level martian-packet filtering make spoofing `127.0.0.1` from another LAN device impractical).
6. **Next.js proxy**: [route.ts](web/src/app/api/[...path]/route.ts#L9-L30) computes `X-Client-IP` server-side from `X-Forwarded-For`/`X-Real-IP`, defaulting to `127.0.0.1` only when `Host` itself is `127.0.0.1`/`localhost` (the Electron window). Strips any client-supplied `X-Client-IP` before forwarding.

## ⚠️ Standing finding — HTTP auth bypass when port 8765 is reachable directly

Unchanged by the UPnP removal: `CoworkAuthMiddleware` trusts the **client-supplied** `X-Client-IP` header with no proof it came through the Next.js proxy. Since FastAPI binds `0.0.0.0` whenever co-work is on, **any device on the LAN** can do:

```
curl http://<lan-ip>:8765/api/collab/invitations -H "X-Client-IP: 127.0.0.1"
```

and be treated as the trusted host — full read/write access to all projects/settings, invitation management, session kicks, no join token needed.

Cutting UPnP removed the *internet-wide* version of this (no more automatic port-forward of 8765). **The LAN-local version is still live** and is the one item worth a fix or an explicit accepted-risk decision.

- Note this is **HTTP-only** — the WS endpoint uses the real socket address (point 5 above), not the spoofable header, so it is not affected by this particular bypass.

## Pending idea (not yet built)

- **WS over Cloudflare** ([FeatureIdeas.yaml](FeatureIdeas.yaml), Phase 5, `status: idea`): proxy the WS upgrade through Next.js's standalone `server.js` so Cloudflare guests get live collab too. Explicitly flagged as needing a WS-auth rework first — proxying would make every guest's `ws.client.host` appear as `127.0.0.1` to FastAPI, turning point 5's protection into a bypass for *all* guests, not just LAN ones. Not started.

## Secondary points

- No TLS on LAN/manual-port-forward paths — JWTs, PINs, and content travel in cleartext there. Only the Cloudflare path is HTTPS (terminated at Cloudflare's edge; `cloudflared → localhost` is plaintext again).
- JWT is sent in the WS query string (`?token=...`) — unavoidable per browser WS API limits, but it lands in logs.
- IP-based banning is trivially bypassed by switching network/IP.
- `openrouter_api_key` / `ai_providers_cfg` are encrypted at rest and excluded from sync dumps — not directly exposed by co-work, but reachable via the API once the standing bypass above grants host-level access.
