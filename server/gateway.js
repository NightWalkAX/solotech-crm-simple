// Production entry (Docker / cloud): one port (:8080) in front of the API (:4100), the chat worker (:4101) and the UI.
// UI = Vite dev server (:4000, HMR over the proxied websocket) when CRM_UI=vite, so Build mode's code edits show up live
// like on the owner's local CRM; otherwise the built dist/. Behind Cloudflare Tunnel + Access: with CF_ACCESS_TEAM and
// CF_ACCESS_AUD set, every request and websocket must carry a valid Cloudflare Access JWT.
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const API_PORT = Number(process.env.CRM_API_PORT || 4100);
const CHAT_PORT = Number(process.env.CRM_CHAT_PORT || 4101);
const VITE_PORT = Number(process.env.CRM_WEB_PORT || 4000);
const UI_VITE = process.env.CRM_UI === 'vite';
const CHAT_RE = /^\/api\/(chat|chats|chat-messages|demos|suggestions|integrations|scheduler)([/?]|$)/;

// ---- Cloudflare Access JWT (RS256, keys from https://<team>.cloudflareaccess.com/cdn-cgi/access/certs) ----
const TEAM = process.env.CF_ACCESS_TEAM?.trim().replace(/^https?:\/\//, '').replace(/\.cloudflareaccess\.com.*$/, '');
const AUD = process.env.CF_ACCESS_AUD?.trim();
const ISSUER = TEAM && `https://${TEAM}.cloudflareaccess.com`;
let keys = new Map();
let keysAt = 0;

async function loadKeys(force = false) {
  if (!force && keys.size && Date.now() - keysAt < 3600_000) return;
  const res = await fetch(`${ISSUER}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs ${res.status}`);
  const { keys: jwks } = await res.json();
  keys = new Map(jwks.map(k => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })]));
  keysAt = Date.now();
}

const b64json = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

async function verifyAccess(token) {
  const [h, p, s] = String(token || '').split('.');
  if (!s) return null;
  const header = b64json(h);
  if (header.alg !== 'RS256') return null;
  await loadKeys();
  if (!keys.has(header.kid)) await loadKeys(true);
  const key = keys.get(header.kid);
  if (!key || !crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) return null;
  const claims = b64json(p);
  const now = Date.now() / 1000;
  if (claims.iss !== ISSUER || ![].concat(claims.aud).includes(AUD) || claims.exp < now || (claims.nbf && claims.nbf > now + 60)) return null;
  return claims;
}

const ACCESS = !!(TEAM && AUD);
async function allowed(req) {
  if (!ACCESS) return true;
  const token = req.headers['cf-access-jwt-assertion'] || req.headers.cookie?.match(/CF_Authorization=([^;]+)/)?.[1];
  return !!(await verifyAccess(token).catch(e => (console.error('[gateway] access', e.message), null)));
}

const target = url => (url.startsWith('/api/') || url === '/api' ? (CHAT_RE.test(url) ? CHAT_PORT : API_PORT) : UI_VITE ? VITE_PORT : null);

function proxyHttp(req, res, port) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  delete headers['x-actor']; // only Claude's MCP (inside the container) may act as 'claude'
  const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, r => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', e => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end(`Upstream ${port}: ${e.message}`); });
  req.pipe(up);
  res.on('close', () => up.destroy());
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.txt': 'text/plain' };

function serveDist(req, res) {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(DIST, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html'); // SPA fallback
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz') return res.end('ok');
  if (!(await allowed(req))) { res.writeHead(401, { 'content-type': 'text/plain' }); return res.end('Unauthorized'); }
  const port = target(req.url);
  return port ? proxyHttp(req, res, port) : serveDist(req, res);
});

// Websockets (Vite HMR): raw TCP pipe after the Access check.
server.on('upgrade', async (req, socket, head) => {
  const port = target(req.url);
  if (!port || !(await allowed(req))) return socket.destroy();
  const up = net.connect(port, '127.0.0.1', () => {
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if (head?.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

if (ACCESS) console.log(`[gateway] Cloudflare Access required (team ${TEAM})`);
else if (process.env.CRM_HOSTED === '1') console.warn('[gateway] WARNING: CF_ACCESS_TEAM / CF_ACCESS_AUD not set — the CRM has no login of its own');

const port = Number(process.env.PORT || 8080);
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`[gateway] http://0.0.0.0:${port} (UI: ${UI_VITE ? `vite :${VITE_PORT}` : 'dist'})`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
