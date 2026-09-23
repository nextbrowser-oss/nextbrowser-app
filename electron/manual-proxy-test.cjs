const net = require("node:net");
const tls = require("node:tls");

// A stable, always-on endpoint that returns the caller's IP as plain text.
// Used only to prove the proxy actually forwards traffic, not to profile it.
const PROBE_HOST = "api.ipify.org";
const PROBE_PORT = 443;
const DEFAULT_TIMEOUT_MS = 10_000;

function withTimeout(socket, timeoutMs, message) {
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error(message)));
}

function connectViaHttpProxy(proxy, probe, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    withTimeout(socket, timeoutMs, "Timed out connecting to the proxy.");
    socket.once("error", reject);
    socket.once("connect", () => {
      const auth = proxy.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password || ""}`).toString("base64")}\r\n`
        : "";
      socket.write(
        `CONNECT ${probe.host}:${probe.port} HTTP/1.1\r\nHost: ${probe.host}:${probe.port}\r\n${auth}Connection: close\r\n\r\n`,
      );
      let buffer = Buffer.alloc(0);
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        socket.removeListener("data", onData);
        socket.removeListener("error", reject);
        socket.setTimeout(0);
        const statusLine = buffer.subarray(0, buffer.indexOf("\r\n")).toString("latin1");
        const status = Number(statusLine.split(" ")[1]);
        if (status !== 200) {
          socket.destroy();
          reject(new Error(`The proxy refused the connection (HTTP ${status || statusLine.trim()}).`));
          return;
        }
        resolve(socket);
      };
      socket.on("data", onData);
    });
  });
}

function connectViaSocks5Proxy(proxy, probe, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    withTimeout(socket, timeoutMs, "Timed out connecting to the proxy.");
    socket.once("error", reject);
    const fail = (message) => {
      socket.destroy();
      reject(new Error(message));
    };
    socket.once("connect", () => {
      const wantsAuth = !!proxy.username;
      socket.write(Buffer.from(wantsAuth ? [0x05, 0x01, 0x02] : [0x05, 0x01, 0x00]));
      socket.once("data", (greeting) => {
        if (greeting.length < 2 || greeting[0] !== 0x05) return fail("The proxy did not speak SOCKS5.");
        if (greeting[1] === 0xff) return fail("The proxy rejected every authentication method offered.");
        const proceedToConnect = () => {
          const hostBuf = Buffer.from(probe.host, "ascii");
          const request = Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
            hostBuf,
            Buffer.from([probe.port >> 8, probe.port & 0xff]),
          ]);
          socket.write(request);
          socket.once("data", (reply) => {
            socket.setTimeout(0);
            if (reply.length < 2 || reply[0] !== 0x05) return fail("The proxy sent an invalid SOCKS5 reply.");
            if (reply[1] !== 0x00) return fail(`The proxy could not reach the internet (SOCKS5 error ${reply[1]}).`);
            resolve(socket);
          });
        };
        if (greeting[1] === 0x00) return proceedToConnect();
        // Username/password subnegotiation (RFC 1929).
        const userBuf = Buffer.from(proxy.username || "", "utf8");
        const passBuf = Buffer.from(proxy.password || "", "utf8");
        socket.write(Buffer.concat([
          Buffer.from([0x01, userBuf.length]),
          userBuf,
          Buffer.from([passBuf.length]),
          passBuf,
        ]));
        socket.once("data", (authReply) => {
          if (authReply.length < 2 || authReply[1] !== 0x00) return fail("The proxy rejected the username or password.");
          proceedToConnect();
        });
      });
    });
  });
}

function probeOverTLS(socket, probe, timeoutMs) {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({
      socket,
      servername: probe.host,
      timeout: timeoutMs,
      rejectUnauthorized: probe.rejectUnauthorized !== false,
      ca: probe.ca,
    });
    tlsSocket.once("error", reject);
    tlsSocket.once("timeout", () => tlsSocket.destroy(new Error("Timed out waiting for the proxied connection.")));
    tlsSocket.once("secureConnect", () => {
      tlsSocket.write(`GET / HTTP/1.1\r\nHost: ${probe.host}\r\nConnection: close\r\n\r\n`);
      let raw = "";
      tlsSocket.on("data", (chunk) => { raw += chunk.toString("utf8"); });
      tlsSocket.once("end", () => {
        const body = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n").trim();
        resolve(net.isIP(body) ? body : undefined);
      });
    });
  });
}

/**
 * Dials the given manual proxy and confirms it forwards real traffic, returning
 * the exit IP it sees. `probe` defaults to a real public IP-echo service and is
 * only overridden by tests, to point at a local stand-in instead of the internet.
 */
async function testManualProxy(proxy, { timeoutMs = DEFAULT_TIMEOUT_MS, probe = {} } = {}) {
  const scheme = String(proxy?.scheme || "").toLowerCase();
  if (!["http", "socks5"].includes(scheme)) throw new Error(`Unsupported proxy scheme "${proxy?.scheme}".`);
  if (!proxy?.host || !proxy?.port) throw new Error("The proxy is missing a host or port.");
  const target = { host: PROBE_HOST, port: PROBE_PORT, ...probe };
  const startedAt = Date.now();
  const socket = scheme === "http"
    ? await connectViaHttpProxy(proxy, target, timeoutMs)
    : await connectViaSocks5Proxy(proxy, target, timeoutMs);
  try {
    const ip = await probeOverTLS(socket, target, timeoutMs);
    return { ok: true, ip, latencyMs: Date.now() - startedAt };
  } finally {
    socket.destroy();
  }
}

module.exports = { testManualProxy, PROBE_HOST, PROBE_PORT };
