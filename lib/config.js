'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// H8: todo lo que cree la app (base, uploads, backups) queda legible solo por su dueño (archivos 600, carpetas 700)
try { process.umask(0o077); } catch { /* Windows */ }

// Carga mínima de .env (sin dependencias)
(function loadEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (process.env.ASISTOK_SKIP_DOTENV === '1' || !fs.existsSync(file)) return; // los tests no leen el .env real
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    let v = m[2];
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
})();

const env = process.env;
const PORT = parseInt(env.PORT || '3000', 10);
// Interfaz de red donde escucha. Por defecto solo local (detrás de nginx). En Docker se define HOST=0.0.0.0 (el Dockerfile ya lo hace).
const HOST = (env.HOST || '127.0.0.1').trim();
const DATA_DIR = path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data'));
const IS_PROD = (env.NODE_ENV || '') === 'production';
const APP_URL = (env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const STRICT = IS_PROD || APP_URL.startsWith('https://'); // producción (o parece producción): se aplican todos los controles
// H11: TRUST_PROXY=N = cantidad de proxies de confianza delante de la app (1 = nginx). 0 = no se confía en X-Forwarded-For.
const TRUST_HOPS = (() => { const n = parseInt(env.TRUST_PROXY || '0', 10); return Number.isFinite(n) && n > 0 ? Math.min(n, 5) : 0; })();
function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if (err && err.code === 'EEXIST') return;
    // Railway volume a veces monta /data sin permiso de crear subcarpetas (EACCES).
    // No tumbar el proceso: la DB puede vivir en DATA_DIR aunque uploads falle.
    if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
      console.warn('[config] sin permiso para crear', dir, '(' + err.code + '). Revisá el volume / DATA_DIR en Railway.');
      return;
    }
    throw err;
  }
}
ensureDir(DATA_DIR);
ensureDir(path.join(DATA_DIR, 'uploads'));
try {
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
  console.log('[config] DATA_DIR escribible:', DATA_DIR);
} catch (e) {
  console.error('[config] DATA_DIR NO escribible:', DATA_DIR, e && e.message);
}

let SECRET_SOURCE = 'env';
function getSecret() {
  // En producción/STRICT: SECRET debe venir del entorno, mínimo 32 caracteres (no se auto-genera silencioso)
  if (STRICT) {
    if (!env.SECRET || env.SECRET.length < 32) {
      console.error('[!!] SECRET obligatorio en producción: definí SECRET en .env con 32+ caracteres aleatorios (openssl rand -hex 32).');
      process.exit(1);
    }
    SECRET_SOURCE = 'env';
    return env.SECRET;
  }
  if (env.SECRET && env.SECRET.length >= 32) { SECRET_SOURCE = 'env'; return env.SECRET; }
  if (env.SECRET && env.SECRET.length >= 24) { SECRET_SOURCE = 'env'; return env.SECRET; }
  const f = path.join(DATA_DIR, '.secret');
  SECRET_SOURCE = 'file';
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  console.warn('[i] SECRET generado en DATA_DIR/.secret — respaldalo. En producción usá SECRET en .env.');
  return s;
}

module.exports = {
  PORT,
  HOST,
  DATA_DIR,
  NODE_ENV: env.NODE_ENV || 'development',
  IS_PROD,
  STRICT,
  APP_URL,
  TRUST_PROXY: TRUST_HOPS > 0,
  TRUST_PROXY_HOPS: TRUST_HOPS,
  // H2: en producción siempre se exige confirmar el email; en desarrollo se activa con REQUIRE_EMAIL_VERIFICATION=1
  REQUIRE_EMAIL_VERIFICATION: env.REQUIRE_EMAIL_VERIFICATION === '0' ? false : true, // por defecto siempre; desactivar solo con =0
  SECRET: getSecret(),
  get SECRET_SOURCE() { return SECRET_SOURCE; },
  SECRET_ENV_LEN: (env.SECRET || '').length,
  ADMIN_EMAIL: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',
  MP_ACCESS_TOKEN: env.MP_ACCESS_TOKEN || env.MERCADOPAGO_ACCESS_TOKEN || '',
  MP_WEBHOOK_SECRET: env.MP_WEBHOOK_SECRET || '',
  MP_API_URL: (env.MP_API_URL || 'https://api.mercadopago.com').replace(/\/+$/, ''), // solo se cambia en tests
  ALLOW_DEMO_PAYMENTS: env.ALLOW_DEMO_PAYMENTS === '1',
  /** Días de prueba gratis en suscripción Mercado Pago (0 = sin trial) */
  TRIAL_DAYS: (() => { const n = parseInt(env.TRIAL_DAYS || '30', 10); return Number.isFinite(n) && n >= 0 ? Math.min(n, 90) : 30; })(),
  RESEND_API_KEY: env.RESEND_API_KEY || '',
  MAIL_CONFIGURED: !!(env.RESEND_API_KEY && String(env.RESEND_API_KEY).length > 10),
  MAIL_FROM: env.MAIL_FROM || 'Asist OK <no-reply@localhost>',
  HOLIDAYS_API_URL: (env.HOLIDAYS_API_URL || 'https://api.argentinadatos.com/v1/feriados').replace(/\/+$/, ''),
  SESSION_DAYS: 14,
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  // Cloudflare Turnstile (CAPTCHA opcional en login/registro)
  TURNSTILE_SITE_KEY: env.TURNSTILE_SITE_KEY || '',
  TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY || '',
  TURNSTILE_ENABLED: !!(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY),
  // WhatsApp (CallMeBot o similar: link personalizado)
  ALERT_WHATSAPP_URL: env.ALERT_WHATSAPP_URL || '', // plantilla con {text} opcional
};
