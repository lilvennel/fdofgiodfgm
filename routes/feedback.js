'use strict';
// E1 Novedades (changelog) y E2 Sugerencias / reportes
const cfg = require('../lib/config');
const { route, bad, notFound, forbidden, rateLimit } = require('../lib/http');
const { get, all, run, audit } = require('../lib/db');
const { sendMail, esc } = require('../lib/mailer');
const { clean, isoDateOk, intIn } = require('./common');

// ---------- Novedades ----------
const COLS = 'id,version,date,added,changed,removed,created_at';
route('GET', '/api/owner/changelog', { auth: 'owner', anyStatus: true }, () => ({ entries: all(`SELECT ${COLS} FROM changelog ORDER BY date DESC, id DESC LIMIT 5`) }));
route('GET', '/api/admin/changelog', { auth: 'superadmin' }, () => ({ entries: all(`SELECT ${COLS} FROM changelog ORDER BY date DESC, id DESC`) }));
function entryFields(b) {
  const version = clean(b.version, 20);
  if (!version) throw bad('Ingresá la versión (por ejemplo 3.2.0)');
  if (!isoDateOk(b.date)) throw bad('Fecha inválida');
  const f = { version, date: b.date, added: clean(b.added, 3000), changed: clean(b.changed, 3000), removed: clean(b.removed, 3000) };
  if (!f.added && !f.changed && !f.removed) throw bad('Completá al menos uno de los tres campos: agregado, cambiado o quitado');
  return f;
}
route('POST', '/api/admin/changelog', { auth: 'superadmin' }, (ctx) => {
  const f = entryFields(ctx.body);
  const r = run('INSERT INTO changelog(version,date,added,changed,removed,created_at) VALUES(?,?,?,?,?,?)', f.version, f.date, f.added, f.changed, f.removed, Date.now());
  audit(ctx.user.id, null, 'changelog.created', { version: f.version });
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/admin/changelog/:id', { auth: 'superadmin' }, (ctx) => {
  if (!get('SELECT 1 FROM changelog WHERE id=?', Number(ctx.params.id))) throw notFound();
  const f = entryFields(ctx.body);
  run('UPDATE changelog SET version=?,date=?,added=?,changed=?,removed=? WHERE id=?', f.version, f.date, f.added, f.changed, f.removed, Number(ctx.params.id));
  return { ok: true };
});
route('DELETE', '/api/admin/changelog/:id', { auth: 'superadmin' }, (ctx) => { run('DELETE FROM changelog WHERE id=?', Number(ctx.params.id)); return { ok: true }; });

// ---------- Feedback ----------
route('POST', '/api/feedback', { auth: 'user', anyStatus: true }, async (ctx) => {
  if (ctx.user.role === 'superadmin') throw forbidden('El Super Admin no envía sugerencias');
  rateLimit('fb:' + ctx.user.id, 10, 3600e3);
  const kind = ctx.body.kind;
  if (!['problem', 'idea'].includes(kind)) throw bad('Elegí si es un problema o una idea');
  const subject = clean(ctx.body.subject, 120), body = clean(ctx.body.body, 2000);
  if (subject.length < 3) throw bad('Escribí un título corto (mínimo 3 letras)');
  if (body.length < 10) throw bad('Contanos un poco más (mínimo 10 letras)');
  const pageCtx = clean(ctx.body.page_context, 80);
  const r = run(`INSERT INTO feedback(tenant_id,user_id,role,kind,subject,body,page_context,status,created_at) VALUES(?,?,?,?,?,?,?,'new',?)`,
    ctx.user.tenant_id, ctx.user.id, ctx.user.role, kind, subject, body, pageCtx || null, Date.now());
  if (cfg.RESEND_API_KEY && cfg.ADMIN_EMAIL) {
    sendMail(cfg.ADMIN_EMAIL, `[Asist OK] ${kind === 'problem' ? 'Problema' : 'Idea'}: ${subject}`,
      `<p><strong>${esc(ctx.user.name)}</strong> (${esc(ctx.user.role)} · ${esc(ctx.tenant?.name || '')})</p><p>${esc(body).replace(/\n/g, '<br>')}</p><p>Pantalla: ${esc(pageCtx)}</p>`).catch((e) => console.error('[mail]', e.message));
  }
  return { id: Number(r.lastInsertRowid) };
});
route('GET', '/api/me/feedback', { auth: 'user', anyStatus: true }, (ctx) => ({
  items: all('SELECT id,kind,subject,status,admin_note,created_at FROM feedback WHERE user_id=? ORDER BY id DESC LIMIT 20', ctx.user.id),
}));

const SA = { auth: 'superadmin' };
route('GET', '/api/admin/feedback', SA, (ctx) => {
  const st = ['new', 'in_progress', 'done', 'dismissed'].includes(ctx.query.status) ? ctx.query.status : null;
  const kd = ['problem', 'idea'].includes(ctx.query.kind) ? ctx.query.kind : null;
  const items = all(`SELECT f.*, t.name tenant, u.name author, u.email FROM feedback f LEFT JOIN tenants t ON t.id=f.tenant_id LEFT JOIN users u ON u.id=f.user_id
     WHERE (?1 IS NULL OR f.status=?1) AND (?2 IS NULL OR f.kind=?2) ORDER BY (f.status='new') DESC, f.id DESC LIMIT 300`, st, kd);
  const fc = require('../lib/fieldcrypto');
  for (const i of items) i.email = fc.decryptEmail(i.email) || i.email;
  return { items, new_count: get("SELECT COUNT(*) n FROM feedback WHERE status='new'").n };
});
route('PATCH', '/api/admin/feedback/:id', SA, (ctx) => {
  const f = get('SELECT * FROM feedback WHERE id=?', Number(ctx.params.id));
  if (!f) throw notFound();
  const status = ctx.body.status !== undefined ? ctx.body.status : f.status;
  if (!['new', 'in_progress', 'done', 'dismissed'].includes(status)) throw bad('Estado inválido');
  const note = ctx.body.admin_note !== undefined ? clean(ctx.body.admin_note, 1000) : f.admin_note;
  run('UPDATE feedback SET status=?, admin_note=?, updated_at=? WHERE id=?', status, note || null, Date.now(), f.id);
  return { ok: true };
});
