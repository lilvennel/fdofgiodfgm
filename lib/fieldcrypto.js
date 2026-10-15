'use strict';
const crypto = require('node:crypto');
const cfg = require('./config');

/** AES-256-GCM field encryption for sensitive PII at rest. Uses SECRET. */
function key() {
  const s = String(cfg.SECRET || 'asistok-dev-secret-change-me');
  return crypto.createHash('sha256').update(s).digest();
}
function encrypt(plain) {
  if (plain == null || plain === '') return null;
  // Never double-encrypt
  if (typeof plain === 'string' && plain.startsWith('enc:')) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return 'enc:' + Buffer.concat([iv, tag, enc]).toString('base64url');
}
function decrypt(val) {
  if (val == null || val === '') return val;
  if (typeof val !== 'string') return val;
  if (!val.startsWith('enc:')) return val; // plaintext legacy
  try {
    const buf = Buffer.from(val.slice(4), 'base64url');
    if (buf.length < 28) return '';
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch {
    // SECRET cambió o dato corrupto: no devolver el ciphertext al cliente
    return '';
  }
}
const SENSITIVE_USER = ['phone', 'address', 'dni', 'personal_email', 'emg_name', 'emg_phone', 'notes'];
function encryptUserFields(obj) {
  if (!obj) return obj;
  const o = { ...obj };
  for (const k of SENSITIVE_USER) if (o[k] != null && o[k] !== '') o[k] = encrypt(o[k]);
  return o;
}
function decryptUserFields(obj) {
  if (!obj) return obj;
  const o = { ...obj };
  for (const k of SENSITIVE_USER) {
    if (o[k] != null) {
      const d = decrypt(o[k]);
      o[k] = (typeof d === 'string' && d.startsWith('enc:')) ? '' : d;
    }
  }
  return o;
}
/** HMAC del email normalizado: sirve para buscar sin guardar el email en claro en índices auxiliares */
function emailHash(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  return crypto.createHmac('sha256', key()).update('email|' + e).digest('hex');
}
function encryptEmail(plain) {
  if (plain == null || plain === '') return null;
  if (String(plain).startsWith('enc:')) return plain;
  return encrypt(String(plain).trim().toLowerCase());
}
function decryptEmail(val) {
  if (val == null || val === '') return val;
  const d = decrypt(val);
  return d || '';
}
module.exports = { encrypt, decrypt, encryptUserFields, decryptUserFields, SENSITIVE_USER, emailHash, encryptEmail, decryptEmail };

