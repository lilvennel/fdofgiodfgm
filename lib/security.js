'use strict';
const fc = require('./fieldcrypto');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const cfg = require('./config');
const { get, run, all } = require('./db');

const scrypt = promisify(crypto.scrypt);

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const h = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}
// Para igualar tiempos cuando el usuario no existe
const DUMMY = 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64);

function passwordProblem(pw, email) {
  if (typeof pw !== 'string' || pw.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (pw.length > 200) return 'La contraseña es demasiado larga';
  if (email && pw.toLowerCase() === String(email).toLowerCase()) return 'La contraseña no puede ser igual al email';
  if (/^(12345678|password|contraseña|qwertyui)/i.test(pw)) return 'Elegí una contraseña menos obvia';
  return null;
}

// H10: contraseñas de ejemplo / débiles que no pueden quedar como Super Admin en producción
const KNOWN_WEAK_ADMIN = ['cambiaestaclaveya-2026', 'cambiaestaclaveya', 'cambiaestaclave', 'admin', 'admin123', 'administrador', 'password', 'contraseña', 'contrasena', 'superclave-12345', '12345678', '123456789012', 'qwertyuiop12'];
function adminPasswordProblem(pw) {
  const p = String(pw || ''), low = p.toLowerCase();
  if (p.length < 12) return 'tiene menos de 12 caracteres';
  if (low.includes('cambiaestaclave') || KNOWN_WEAK_ADMIN.includes(low)) return 'es una contraseña de ejemplo o muy común';
  if (new Set(p).size < 6) return 'tiene muy pocos caracteres distintos';
  return null;
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

function createSession(userId) {
  const token = randomToken(32);
  const now = Date.now();
  run('INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)', sha(token), userId, now, now + cfg.SESSION_DAYS * 864e5);
  return token;
}
function userFromSession(token) {
  if (!token) return null;
  const s = get('SELECT * FROM sessions WHERE id = ?', sha(token));
  if (!s) return null;
  if (s.expires_at < Date.now()) { run('DELETE FROM sessions WHERE id = ?', s.id); return null; }
  return get('SELECT * FROM users WHERE id = ?', s.user_id) || null;
}
const destroySession = (token) => token && run('DELETE FROM sessions WHERE id = ?', sha(token));
const destroyUserSessions = (userId) => run('DELETE FROM sessions WHERE user_id = ?', userId);
setInterval(() => run('DELETE FROM sessions WHERE expires_at < ?', Date.now()), 60 * 60 * 1000).unref();

// ---- QR dinámico: token HMAC que cambia cada 60 s ----
const QR_WINDOW_MS = 60_000;
function qrToken(branchId, tenantId, at = Date.now()) {
  const w = Math.floor(at / QR_WINDOW_MS);
  return crypto.createHmac('sha256', cfg.SECRET).update(`qr|${tenantId}|${branchId}|${w}`).digest('base64url').slice(0, 16);
}
function qrValid(branchId, tenantId, token) {
  if (typeof token !== 'string') return false;
  const now = Date.now();
  // acepta la ventana actual y las 2 anteriores (el empleado necesita unos segundos para abrir el link)
  return [0, 1, 2].some((i) => {
    const exp = Buffer.from(qrToken(branchId, tenantId, now - i * QR_WINDOW_MS));
    const got = Buffer.from(token);
    return exp.length === got.length && crypto.timingSafeEqual(exp, got);
  });
}

const packEmail = (plain) => {
  const e = String(plain || '').trim().toLowerCase();
  return { email: fc.encryptEmail(e), email_hash: fc.emailHash(e), plain: e };
};
const findUserByEmail = (email) => {
  const h = fc.emailHash(email);
  if (!h) return null;
  // Preferir email_hash; fallback a email en claro (bases viejas sin migrar)
  return get('SELECT * FROM users WHERE email_hash=?', h)
    || get('SELECT * FROM users WHERE email=?', String(email).trim().toLowerCase())
    || null;
};
const publicUser = (u) => {
  if (!u) return null;
  const d = fc.decryptUserFields(u);
  const emailPlain = fc.decryptEmail(d.email) || d.email;
  return {
    id: d.id, email: emailPlain, name: d.name, role: d.role, status: d.status, tenant_id: d.tenant_id,
    must_change_pw: !!d.must_change_pw, cargo: d.cargo, branch_id: d.branch_id, phone: d.phone,
    address: d.address, birthday: d.birthday, hire_date: d.hire_date, shift_start: d.shift_start,
    emg_name: d.emg_name, emg_rel: d.emg_rel, emg_phone: d.emg_phone,
    email_verified: !!d.email_verified_at,
    legal_accepted: !!d.legal_accepted_at,
    dni: d.dni, personal_email: d.personal_email, blood_type: d.blood_type, obra_social: d.obra_social, notes: d.notes,
  };
};

module.exports = {
  hashPassword, verifyPassword, DUMMY, passwordProblem, adminPasswordProblem, KNOWN_WEAK_ADMIN, sha, randomToken,
  createSession, userFromSession, destroySession, destroyUserSessions,
  qrToken, qrValid, QR_WINDOW_MS, publicUser, findUserByEmail, packEmail,
};
