'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./lib/config');
const { get, run, audit } = require('./lib/db');
const { HttpError, routes, parseCookies, clientIp, readBody, send } = require('./lib/http');
const sec = require('./lib/security');
const dom = require('./lib/domain');
const jobs = require('./lib/jobs');
const warnings = require('./lib/warnings');

dom.seed();
for (const f of ['auth', 'pay', 'owner', 'display', 'import', 'employee', 'feedback', 'admin']) require(`./routes/${f}`);

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
const SPA_PATHS = /^\/(alta\/[^/]+|m\/[^/]+|pantalla\/[^/]+|terminos|privacidad|estado)\/?$/;

// Cloudflare Turnstile (captcha opcional) necesita cargar su script y su iframe: solo se habilita si está configurado.
const TS = cfg.TURNSTILE_ENABLED ? ' https://challenges.cloudflare.com' : '';
const SECURITY_HEADERS = {
  'Content-Security-Policy': `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'${TS}; connect-src 'self'${TS}; frame-src 'self' blob:${TS}; object-src blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  ...(cfg.IS_PROD || cfg.APP_URL.startsWith('https://') ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

async function ensureAdmin() {
  if (get("SELECT 1 FROM users WHERE role='superadmin'")) return;
  if (!cfg.ADMIN_EMAIL || cfg.ADMIN_PASSWORD.length < 10) {
    console.warn('[!] No hay Super Admin. Definí ADMIN_EMAIL y ADMIN_PASSWORD (10+ caracteres) en .env y reiniciá.');
    return;
  }
  // H10: en producción no se crea un Super Admin con una contraseña de ejemplo o débil
  const weak = sec.adminPasswordProblem(cfg.ADMIN_PASSWORD);
  if (weak && cfg.STRICT) {
    console.error(`[!!] ADMIN_PASSWORD ${weak}. No se creó el Super Admin. Elegí otra (12+ caracteres, única, no de ejemplo) en el .env y reiniciá.`);
    process.exit(1);
  }
  if (weak) console.warn(`[!] ADMIN_PASSWORD ${weak}. En producción se rechaza: usá una de 12+ caracteres.`);
  const packed = sec.packEmail(cfg.ADMIN_EMAIL);
  run("INSERT INTO users(email,email_hash,name,pass_hash,role,status,created_at,email_verified_at) VALUES(?,?,?,?,'superadmin','active',?,?)",
    packed.email, packed.email_hash, 'Super Admin', await sec.hashPassword(cfg.ADMIN_PASSWORD), Date.now(), Date.now());
  audit(null, null, 'superadmin.created');
  try {
    const fs = require('node:fs'); const path = require('node:path');
    fs.writeFileSync(path.join(cfg.DATA_DIR, '.admin_bootstrapped'), new Date().toISOString(), { mode: 0o600 });
  } catch {}
  console.log(`[ok] Super Admin creado: ${cfg.ADMIN_EMAIL}`);
  console.log('[!] Borrá ADMIN_PASSWORD del archivo .env y reiniciá. La cuenta ya quedó en la base de datos.');
}

function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const h = new URL(origin).host;
    const hosts = [req.headers.host, new URL(cfg.APP_URL).host];
    if (cfg.TRUST_PROXY && req.headers['x-forwarded-host']) hosts.push(String(req.headers['x-forwarded-host']).split(',')[0].trim());
    return hosts.includes(h);
  } catch { return false; }
}

async function handleApi(req, res, url) {
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  let found = null, params = {};
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(url.pathname);
    if (m) { found = r; r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { throw new HttpError(400, 'BAD_URL', 'URL inválida'); } }); break; }
  }
  if (!found) throw new HttpError(404, 'NOT_FOUND', 'Ruta no encontrada');
  const opts = found.opts;
  const setCookies = [];
  const ctx = { req, res, url, params, query: Object.fromEntries(url.searchParams), ip: clientIp(req), cookies: parseCookies(req.headers.cookie), body: {}, user: null, tenant: null, setCookie: (c) => setCookies.push(c) };

  if (method !== 'GET' && !originOk(req)) throw new HttpError(403, 'BAD_ORIGIN', 'Origen no permitido');

  if (opts.auth) {
    const user = sec.userFromSession(ctx.cookies.sid);
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Tenés que iniciar sesión');
    if (user.status !== 'active') throw new HttpError(403, 'ACCOUNT_DISABLED', 'Tu cuenta no está habilitada');
    const allowed = opts.auth === 'user' ? null : (Array.isArray(opts.auth) ? opts.auth : [opts.auth]);
    if (allowed && !allowed.includes(user.role)) throw new HttpError(403, 'FORBIDDEN', 'No tenés permiso para esto');
    ctx.user = user;
    if (user.role !== 'superadmin') {
      ctx.tenant = get('SELECT * FROM tenants WHERE id=?', user.tenant_id);
      if (!ctx.tenant) throw new HttpError(403, 'FORBIDDEN', 'Negocio no encontrado');
      if (!opts.anyStatus) {
        if (ctx.tenant.status === 'suspended') throw new HttpError(403, 'TENANT_SUSPENDED', 'La cuenta del negocio está suspendida');
        if (ctx.tenant.status !== 'active') {
          const isOwner = user.role === 'owner';
          throw new HttpError(isOwner ? 402 : 403, isOwner ? 'PAYMENT_REQUIRED' : 'TENANT_INACTIVE', isOwner ? 'Tu plan no está activo' : 'El negocio todavía no está activo');
        }
        if (user.must_change_pw) throw new HttpError(403, 'MUST_CHANGE_PW', 'Tenés que cambiar tu contraseña para continuar');
      }
    }
  }

  if (method !== 'GET') {
    const raw = await readBody(req, opts.limit || 64 * 1024);
    if (raw.length) {
      if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'UNSUPPORTED', 'Content-Type debe ser application/json');
      try { ctx.body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'BAD_JSON', 'JSON inválido'); }
      if (ctx.body === null || typeof ctx.body !== 'object') ctx.body = {};
    }
  }

  const result = await found.handler(ctx);
  const extra = setCookies.length ? { 'Set-Cookie': setCookies } : {};
  if (result && result.__redirect) return send(res, 302, '', { ...extra, Location: result.__redirect });
  if (result && result.__file) {
    const f = result.__file;
    const safe = f.filename.replace(/[^\w.\-]/g, '_');
    return send(res, 200, f.buf, { ...extra, ...(f.cache ? { 'Cache-Control': f.cache } : {}), 'Content-Type': f.mime, 'Content-Disposition': `${f.inline ? 'inline' : 'attachment'}; filename="${safe}"` });
  }
  return send(res, 200, result ?? { ok: true }, extra);
}

function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'URL inválida'); }
  if (rel.includes('\0')) return send(res, 400, 'URL inválida');
  if (rel === '/' || SPA_PATHS.test(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Prohibido');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'No encontrado');
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.css' || path.basename(file) === 'sw.js') ? 'no-cache' : 'public, max-age=300',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
    return serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message, ...(e.extra || {}) });
    console.error('[error]', req.method, req.url, e);
    return send(res, 500, { error: 'INTERNAL', message: 'Ocurrió un error inesperado. Probá de nuevo.' });
  }
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 65_000; // mayor que el de nginx/Railway (60 s) para evitar 502 intermitentes

async function bootstrap() {
  try {
    cfg.assertProductionSafe();
    await ensureAdmin();
    await warnings.checkAdmin();
    warnings.printBoot();
    jobs.start();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(cfg.PORT, cfg.HOST, () => {
        console.log(`AsistOK escuchando en ${cfg.APP_URL} (${cfg.HOST}:${cfg.PORT}, ${cfg.NODE_ENV})`);
        resolve();
      });
    });
  } catch (e) {
    console.error('[boot] falló el arranque:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
}
bootstrap();

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { server.close(() => process.exit(code)); } catch { process.exit(code); }
  setTimeout(() => process.exit(code), 5000).unref();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('Cerrando…'); shutdown(0); });
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  shutdown(1);
});
module.exports = { server };
