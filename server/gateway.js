// Production entry (Docker / cloud): one port that serves the built UI (dist/) and proxies /api to the API (:4100) and
// the chat worker (:4101), same split as vite.config.js. Behind Cloudflare Tunnel + Access: when CF_ACCESS_TEAM and
// CF_ACCESS_AUD are set, every request must carry a valid Cloudflare Access JWT (defence in depth if the tunnel
// hostname is ever exposed without the Access policy).
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { proxy } from 'hono/proxy';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const API = `http://127.0.0.1:${process.env.CRM_API_PORT || 4100}`;
const CHAT = `http://127.0.0.1:${process.env.CRM_CHAT_PORT || 4101}`;
const CHAT_RE = /^\/api\/(chat|chats|chat-messages|demos|suggestions|integrations|scheduler)([/?]|$)/;

// ---- Cloudflare Access JWT (RS256, keys from https://<team>.cloudflareaccess.com/cdn-cgi/access/certs) ----
const TEAM = process.env.CF_ACCESS_TEAM?.replace(/^https?:\/\//, '').replace(/\.cloudflareaccess\.com.*$/, '');
const AUD = process.env.CF_ACCESS_AUD;
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
  const aud = [].concat(claims.aud);
  if (claims.iss !== ISSUER || !aud.includes(AUD) || claims.exp < now || (claims.nbf && claims.nbf > now + 60)) return null;
  return claims;
}

const app = new Hono();

app.get('/healthz', c => c.text('ok'));

if (TEAM && AUD) {
  app.use('*', async (c, next) => {
    const token = c.req.header('cf-access-jwt-assertion') || c.req.header('cookie')?.match(/CF_Authorization=([^;]+)/)?.[1];
    const claims = await verifyAccess(token).catch(e => (console.error('[gateway] access', e.message), null));
    if (!claims) return c.text('Unauthorized', 401);
    await next();
  });
  console.log(`[gateway] Cloudflare Access required (team ${TEAM})`);
} else if (process.env.CRM_HOSTED === '1') {
  console.warn('[gateway] WARNING: CF_ACCESS_TEAM / CF_ACCESS_AUD not set — the CRM has no login of its own');
}

app.all('/api/*', c => {
  const url = new URL(c.req.url);
  const target = (CHAT_RE.test(url.pathname) ? CHAT : API) + url.pathname + url.search;
  const headers = new Headers(c.req.raw.headers);
  headers.delete('x-actor'); // only Claude's MCP (inside the container) may act as 'claude'
  return proxy(target, { method: c.req.method, headers, body: c.req.raw.body, duplex: 'half' });
});

app.use('*', serveStatic({ root: path.relative(process.cwd(), DIST) }));
// SPA fallback: client-side routes get index.html.
const index = () => fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
app.get('*', c => c.html(index()));

const port = Number(process.env.PORT || 8080);
serve({ fetch: app.fetch, port, hostname: process.env.HOST || '0.0.0.0' }, () => console.log(`[gateway] http://0.0.0.0:${port}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
