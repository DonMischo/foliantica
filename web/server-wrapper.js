"use strict";

/**
 * Wraps the Next.js standalone server.js (regenerated on every build, so it
 * can't be hand-edited directly) with two things route.ts needs and Next's
 * Route Handlers can't provide on their own:
 *
 *   1. The real TCP peer address of each request, exposed via an internal
 *      header. Route Handlers only see HTTP headers, not the underlying
 *      socket — without this, the only way to tell "is this request from
 *      our own loopback proxy hop" apart from "a remote device spoofing the
 *      Host header" is the (forgeable) Host header itself.
 *   2. A raw-socket proxy for the collab WebSocket upgrade
 *      (/api/collab/ws/collab) to FastAPI over loopback, so guests connect
 *      through this same port — including through the Cloudflare tunnel,
 *      which only ever carries this one port — instead of needing FastAPI's
 *      port reachable directly.
 *
 * See COWORKING_NETWORK_SECURITY_SUMMARY.md for the full threat model this
 * supports (combined with route.ts's Origin check and the secret header
 * injected by Electron).
 */

const http = require("http");
const net = require("net");
const path = require("path");

const INTERNAL_PEER_HEADER = "x-internal-real-peer";
const WS_PROXY_PATH = "/api/collab/ws/collab";

function normalizeLoopback(addr) {
  return addr && addr.startsWith("::ffff:") ? addr.slice(7) : addr;
}

/** Raw-socket proxy: re-emit the original upgrade request verbatim to the
 * backend, then pipe the two sockets together. This avoids needing any
 * dependency beyond Node's own `net`/`http` — a real npm dependency placed
 * outside the traced app code wouldn't make it into the standalone build's
 * automatically-pruned node_modules anyway. */
function proxyWsUpgrade(req, socket, head) {
  const apiPort = parseInt(process.env.LW_API_PORT, 10) || 8765;
  const upstream = net.connect(apiPort, "127.0.0.1");

  upstream.on("connect", () => {
    const realPeer = normalizeLoopback(req.socket && req.socket.remoteAddress);

    let requestLines = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    // Forward all headers, stripping any client-supplied INTERNAL_PEER_HEADER
    // so it cannot be forged, then re-inject from the verified socket address.
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (req.rawHeaders[i].toLowerCase() !== INTERNAL_PEER_HEADER.toLowerCase()) {
        requestLines += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      }
    }
    if (realPeer) requestLines += `${INTERNAL_PEER_HEADER}: ${realPeer}\r\n`;
    requestLines += "\r\n";
    upstream.write(requestLines);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

const originalCreateServer = http.createServer.bind(http);

http.createServer = function patchedCreateServer(...args) {
  // http.createServer(requestListener) or http.createServer(options, requestListener)
  const requestListener = typeof args[0] === "function" ? args[0] : args[1];
  const listenerIndex = typeof args[0] === "function" ? 0 : 1;

  if (typeof requestListener === "function") {
    args[listenerIndex] = function wrappedRequestListener(req, res) {
      // Strip any client-supplied value first so it can never be spoofed by
      // the original request, then set it from the verified socket itself.
      delete req.headers[INTERNAL_PEER_HEADER];
      const peer = req.socket && req.socket.remoteAddress;
      if (peer) req.headers[INTERNAL_PEER_HEADER] = normalizeLoopback(peer);
      return requestListener(req, res);
    };
  }

  const server = originalCreateServer(...args);

  // Override emit (not .on) for 'upgrade' so we get a first look at every
  // upgrade request regardless of when Next's own internal listener (set up
  // later, inside start-server.js) gets attached, and can fully short-circuit
  // matching requests without ever invoking Next's listener for them —
  // adding a second .on('upgrade', ...) listener instead would let BOTH
  // listeners run for the same socket, and Next's listener would then try
  // to act on (and likely destroy) a socket we already handed off upstream.
  const originalEmit = server.emit.bind(server);
  server.emit = function patchedEmit(event, ...emitArgs) {
    if (event === "upgrade") {
      const [req, socket, head] = emitArgs;
      if (req.url && req.url.split("?")[0] === WS_PROXY_PATH) {
        proxyWsUpgrade(req, socket, head);
        return true;
      }
    }
    return originalEmit(event, ...emitArgs);
  };

  return server;
};

require(path.join(__dirname, "server.js"));
