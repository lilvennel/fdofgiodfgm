'use strict';
const cfg = require('./config');

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status; this.code = code; this.extra = extra;
  }
}
const bad = (msg, code = 'BAD_REQUEST') => new HttpError(400, code, msg);
const notFound = (msg = 'No encontrado') => new HttpError(404, 'NOT_FOUND', msg);
const forbidden = (msg = 'Acceso denegado', code = 'FORBIDDEN') => new HttpError(403, code, msg);

const routes = [];
function route(method, pattern, opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, opts, handler });
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookie(name, value, { maxAge, httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (httpOnly) c += '; HttpOnly';
  if (cfg.IS_PROD || cfg.APP_URL.startsWith('https://')) c += '; Secure';
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

// IP del cliente. Con TRUST_PROXY=N se toma la entrada N desde la DERECHA de X-Forwarded-For: es la que agregó
// nuestro proxy de confianza. Lo que el cliente escriba a la izquierda no cuenta (no se puede falsificar).
function clientIp(req) {
  const hops = cfg.TRUST_PROXY_HOPS;
  if (hops > 0) {
    const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[Math.max(0, parts.length - hops)];
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'TOO_LARGE', 'El archivo o los datos son demasiado grandes')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

// Rate limit en memoria (suficiente para una sola instancia)
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || rec.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return; }
  rec.n++;
  if (rec.n > max) {
    throw new HttpError(429, 'RATE_LIMIT', 'Demasiados intentos. Probá de nuevo en unos minutos.');
  }
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, 5 * 60 * 1000).unref();

// ---- Límite de FALLOS con espera progresiva (H5) ----
// Solo cuenta los intentos fallidos. Tras `free` fallos seguidos bloquea la clave 1×, 2×, 4×… `baseLockMs` (tope `maxLockMs`).
// Un acierto la limpia. Se usa con claves "email+IP" y "IP": quien ataca solo se bloquea a sí mismo.
const fails = new Map();
const FAIL_MAX_KEYS = 100000;
function pruneFails(now = Date.now()) { for (const [k, v] of fails) if (v.reset < now && v.lockUntil < now) fails.delete(k); }
function failCheck(key) {
  const r = fails.get(key), now = Date.now();
  if (r && r.lockUntil > now) {
    const secs = Math.ceil((r.lockUntil - now) / 1000);
    throw new HttpError(429, 'RATE_LIMIT', `Demasiados intentos fallidos. Probá de nuevo en ${secs > 90 ? Math.ceil(secs / 60) + ' minutos' : secs + ' segundos'}.`, { retry_after: secs });
  }
}
function failRecord(key, { free, windowMs, baseLockMs, maxLockMs }) {
  const now = Date.now();
  let r = fails.get(key);
  if (!r || (r.reset < now && r.lockUntil < now)) {
    if (!r && fails.size >= FAIL_MAX_KEYS) { pruneFails(now); if (fails.size >= FAIL_MAX_KEYS) fails.delete(fails.keys().next().value); }
    r = { n: 0, lockUntil: 0, reset: 0 };
  }
  r.n++;
  if (r.n > free) r.lockUntil = now + Math.min(maxLockMs, baseLockMs * 2 ** Math.min(r.n - free - 1, 20));
  r.reset = Math.max(now + windowMs, r.lockUntil);
  fails.set(key, r);
}
const failClear = (key) => { fails.delete(key); };
setInterval(() => pruneFails(), 5 * 60 * 1000).unref();

module.exports = { HttpError, bad, notFound, forbidden, route, routes, parseCookies, cookie, clientIp, readBody, send, rateLimit, failCheck, failRecord, failClear };
