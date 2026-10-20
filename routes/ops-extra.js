'use strict';
/**
 * Rutas operativas (purga marcas, baja de cuenta, backups).
 * Archivo chico para desplegar sin depender de un owner.js/admin.js completo desactualizado.
 */
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('../lib/config');
const { route, bad, notFound } = require('../lib/http');
const { get, run, audit, getSetting } = require('../lib/db');
const backup = require('../lib/backup');

const A_OWNER = { auth: 'owner' };
const S = { auth: 'superadmin' };

function intIn(v, min, max, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} inválido`);
  return n;
}

// ---------- Dueño: purga de marcas ----------
route('POST', '/api/owner/marks/purge', A_OWNER, (ctx) => {
  const months = intIn(ctx.body.months ?? 18, 12, 60, 'Meses');
  if (String(ctx.body.confirm || '') !== 'BORRAR') throw bad('Para confirmar escribí BORRAR');
  const cutoff = Date.now() - months * 30.44 * 864e5;
  const n = get('SELECT COUNT(*) n FROM marks WHERE tenant_id=? AND ts<?', ctx.tenant.id, cutoff).n;
  run('DELETE FROM marks WHERE tenant_id=? AND ts<?', ctx.tenant.id, cutoff);
  audit(ctx.user.id, ctx.tenant.id, 'marks.purged', { months, deleted: n });
  return { ok: true, deleted: n, months, message: `Se borraron ${n} marcaciones anteriores a ~${months} meses.` };
});

route('GET', '/api/owner/marks/stats', { auth: ['owner', 'manager', 'hr'] }, (ctx) => {
  const tid = ctx.tenant.id;
  const total = get('SELECT COUNT(*) n FROM marks WHERE tenant_id=?', tid).n;
  const oldest = get('SELECT MIN(ts) ts FROM marks WHERE tenant_id=?', tid);
  return {
    total,
    oldest_ts: oldest?.ts || null,
    purgeable_18m: get('SELECT COUNT(*) n FROM marks WHERE tenant_id=? AND ts<?', tid, Date.now() - 18 * 30.44 * 864e5).n,
    purgeable_24m: get('SELECT COUNT(*) n FROM marks WHERE tenant_id=? AND ts<?', tid, Date.now() - 24 * 30.44 * 864e5).n,
  };
});

// ---------- Dueño: solicitar baja ----------
route('POST', '/api/owner/account/delete-request', A_OWNER, (ctx) => {
  const note = String(ctx.body.note || '').trim().slice(0, 400);
  try {
    if (ctx.tenant.deletion_requested_at) {
      return { ok: true, already: true, at: ctx.tenant.deletion_requested_at };
    }
    run('UPDATE tenants SET deletion_requested_at=?, deletion_note=? WHERE id=?', Date.now(), note || null, ctx.tenant.id);
  } catch (e) {
    console.error('[delete-request]', e.message);
    throw bad('No se pudo registrar la baja. Reiniciá el servidor (falta migración deletion_requested_at en lib/db.js).');
  }
  audit(ctx.user.id, ctx.tenant.id, 'account.deletion_requested', { note: note || null });
  return { ok: true, message: 'Solicitud enviada. AsistOK la revisará y eliminará la cuenta (o te contactará).' };
});

route('POST', '/api/owner/account/delete-request/cancel', A_OWNER, (ctx) => {
  try {
    run('UPDATE tenants SET deletion_requested_at=NULL, deletion_note=NULL WHERE id=?', ctx.tenant.id);
  } catch (e) {
    throw bad('No se pudo cancelar el pedido.');
  }
  audit(ctx.user.id, ctx.tenant.id, 'account.deletion_cancelled');
  return { ok: true };
});

// ---------- Super Admin: backups ----------
function deleteBackupFile(name, userId) {
  name = String(name || '');
  if (!/^asistok-.*\.db$/i.test(name) || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw bad('Nombre inválido');
  }
  const f = path.join(cfg.DATA_DIR, 'backups', name);
  if (!fs.existsSync(f)) throw notFound('Backup no encontrado');
  fs.rmSync(f, { force: true });
  audit(userId, null, 'admin.backup_delete', { file: name });
  return { ok: true, file: name };
}

route('POST', '/api/admin/backup/delete', S, (ctx) =>
  deleteBackupFile((ctx.body && (ctx.body.file || ctx.body.name)) || '', ctx.user.id));

route('DELETE', '/api/admin/backup/file/:name', S, (ctx) =>
  deleteBackupFile(ctx.params.name, ctx.user.id));

route('POST', '/api/admin/backup/prune', S, (ctx) => {
  const keep = ctx.body.keep != null ? intIn(ctx.body.keep, 1, 60, 'Cantidad') : getSetting('backup_keep', 7);
  const list = backup.status().files || [];
  const toDel = list.slice(Math.max(0, Number(keep)));
  let removed = 0;
  let bytes = 0;
  for (const f of toDel) {
    const p = path.join(cfg.DATA_DIR, 'backups', f.file);
    try {
      const st = fs.statSync(p);
      bytes += st.size;
      fs.rmSync(p, { force: true });
      removed++;
    } catch (e) {
      console.error('[backup.prune]', f.file, e.message);
    }
  }
  audit(ctx.user.id, null, 'admin.backup_prune', { keep, removed, bytes });
  return { ok: true, removed, bytes, keep };
});

module.exports = {};
