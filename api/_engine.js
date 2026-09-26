/**
 * The one way to reach the document engine, which draws forms and reads
 * donations. Both share one connection to a fixed host so the certificate is
 * pinned in one place and checked before a byte of paperwork is written.
 * The browser never holds the key; it is added here.
 */
import https from "node:https";

const WHERE = () => new URL(process.env.DOCX_UPSTREAM || "https://203.0.113.10:9443/docx/");
const pinnedPrint = () => String(process.env.DOCX_FINGERPRINT || "").replace(/[^A-F0-9]/gi, "").toUpperCase();

/**
 * Send bytes to the engine and wait for its answer.
 * `where` is "" to draw a document, or "read" to have one read.
 */
export function ask(bytes, { where = "", headers = {}, timeout = 60_000 } = {}) {
  const url = WHERE();
  const pinned = pinnedPrint();
  const options = {
    method: "POST",
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + where,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": bytes.length,
      "x-docx-key": process.env.DOCX_KEY,
      ...headers,
    },
    /* A fixed host of ours, serving a certificate it signed itself, which no
       public authority will vouch for. Rather than trusting whatever answers,
       the certificate itself is pinned. */
    rejectUnauthorized: false,
    servername: url.hostname,
    timeout,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const parts = [];
      res.on("data", (c) => parts.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: Buffer.concat(parts), type: res.headers["content-type"] }));
    });
    const check = (socket) => {
      if (!pinned) {
        req.destroy(new Error("no certificate is pinned for the document engine"));
        return;
      }
      const seen = String(socket.getPeerCertificate?.()?.fingerprint256 || "")
        .replace(/[^A-F0-9]/gi, "")
        .toUpperCase();
      /* On a resumed session the server does not send its certificate again,
         so there is nothing to compare — the session it is resuming was
         checked when it was made. A fresh handshake that shows no certificate
         at all is another matter, and is cut. */
      if (seen) {
        if (seen !== pinned) req.destroy(new Error("the document engine presented a different certificate"));
      } else if (!socket.isSessionReused?.()) {
        req.destroy(new Error("the document engine showed no certificate"));
      }
    };
    /* A kept-alive connection was checked when it was made and never shows its
       certificate again; waiting for a handshake on it would leak a listener per
       call. So a live connection is checked where it stands. */
    req.on("socket", (socket) => {
      if (socket.encrypted && !socket.connecting) check(socket);
      else socket.once("secureConnect", () => check(socket));
    });
    req.on("timeout", () => req.destroy(new Error("the engine took too long")));
    req.on("error", reject);
    req.end(bytes);
  });
}

/** Whether the site can reach the engine at all. */
export const engineReady = () => Boolean(process.env.DOCX_KEY && pinnedPrint());
