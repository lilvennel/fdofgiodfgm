'use strict';
// Copias de la base: manual (descarga) y automática diaria en DATA_DIR/backups con rotación.
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');
const mailer = require('./mailer');
const { db, getSetting, setSetting, audit } = require('./db');
const { isoDate, arParts, pad } = require('./hours');

const dir = path.join(cfg.DATA_DIR, 'backups');
const PREFIX = 'asistok-';
const settings = () => ({ auto: getSetting('backup_auto', true) !== false, keep: getSetting('backup_keep', 7), warn_days: getSetting('backup_warn_days', 7) });

function files() {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.startsWith(PREFIX) && f.endsWith('.db')).map((f) => {
    const st = fs.statSync(path.join(dir, f)); return { file: f, size: st.size, at: st.mtimeMs };
  }).sort((a, b) => b.at - a.at);
}
function runBackup(kind = 'auto') {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = arParts(Date.now());
  const name = kind === 'auto' ? `${PREFIX}${isoDate(Date.now())}.db` : `${PREFIX}${isoDate(Date.now())}-${pad(p.hh)}${pad(p.mm)}${pad(new Date().getSeconds())}.db`;
  const target = path.join(dir, name);
  if (fs.existsSync(target)) fs.rmSync(target);
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    fs.chmodSync(target, 0o600);
    const st = fs.statSync(target);
    setSetting('last_backup', { at: Date.now(), file: name, size: st.size, kind, ok: true });
    const full = path.join(dir, name);
    setImmediate(() => uploadOffsite(full));
    // Copia de seguridad del SECRET (mismo directorio de backups, permisos 600)
    try {
      const secretSrc = path.join(cfg.DATA_DIR, '.secret');
      const secretEnvNote = path.join(dir, 'SECRET-README.txt');
      if (fs.existsSync(secretSrc)) {
        fs.copyFileSync(secretSrc, path.join(dir, 'asistok.secret.bak'));
        fs.chmodSync(path.join(dir, 'asistok.secret.bak'), 0o600);
      }
      if (!fs.existsSync(secretEnvNote)) {
        fs.writeFileSync(secretEnvNote, 'Si SECRET está en .env, respaldá ese valor aparte (gestor de contraseñas). Si está en DATA_DIR/.secret, hay copia asistok.secret.bak aquí.\nSin este valor no se descifran DNI, teléfonos ni emails.\n', { mode: 0o600 });
      }
    } catch (e) { console.error('[backup] secret copy:', e.message); }
    // rotación: se queda con las últimas N
    for (const f of files().slice(Math.max(1, settings().keep))) fs.rmSync(path.join(dir, f.file), { force: true });
    return { ok: true, file: name, size: st.size };
  } catch (e) {
    setSetting('last_backup', { at: Date.now(), kind, ok: false, error: e.message });
    try {
      const admin = (cfg.ADMIN_EMAIL || '').trim();
      if (admin && cfg.MAIL_CONFIGURED) {
        mailer.sendMail(admin, '[AsistOK] Falló el backup', `<p>El backup automático falló.</p><p><code>${String(e.message || '').replace(/[<>]/g,'')}</code></p>`);
      }
    } catch {}
    audit(null, null, 'backup.failed', { error: e.message });
    throw e;
  }
}
// Corre una vez por día (lo llama el job horario)
function ensureDaily() {
  if (!settings().auto) return null;
  const today = `${PREFIX}${isoDate(Date.now())}.db`;
  if (files().some((f) => f.file === today)) return null;
  return runBackup('auto');
}
function noteDownload() { setSetting('last_download_backup', { at: Date.now() }); }

function status() {
  const s = settings(), last = getSetting('last_backup', null), dl = getSetting('last_download_backup', null);
  const lastOk = Math.max(last?.ok ? last.at : 0, dl?.at || 0);
  const ageDays = lastOk ? (Date.now() - lastOk) / 864e5 : null;
  return {
    ...s, last_auto: last, last_download: dl, files: files(),
    age_days: ageDays === null ? null : Math.round(ageDays * 10) / 10,
    stale: ageDays === null || ageDays > s.warn_days,
  };
}
module.exports = { uploadOffsite,  runBackup, ensureDaily, noteDownload, status, files, settings };

async function uploadOffsite(filePath) {
  const url = process.env.BACKUP_UPLOAD_URL || '';
  if (!url || !filePath) return false;
  try {
    const buf = fs.readFileSync(filePath);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-AsistOK-Backup': path.basename(filePath),
        ...(process.env.BACKUP_UPLOAD_TOKEN ? { Authorization: 'Bearer ' + process.env.BACKUP_UPLOAD_TOKEN } : {}),
      },
      body: buf,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    console.log('[backup] off-site OK →', path.basename(filePath));
    return true;
  } catch (e) {
    console.error('[backup] off-site falló:', e.message);
    return false;
  }
}
