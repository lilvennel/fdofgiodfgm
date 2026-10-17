'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cfg = require('../lib/config');
const { route, bad, notFound, HttpError } = require('../lib/http');
const { db, get, all, run, getSetting, setSetting, audit } = require('../lib/db');
const hol = require('../lib/holidays');
const backup = require('../lib/backup');
const warnings = require('../lib/warnings');
const sec = require('../lib/security');
const dom = require('../lib/domain');
const { isoDate } = require('../lib/hours');
const { clean, emailOk, intIn, isoDateOk, decodeUpload } = require('./common');
const { sanitizeHtml } = require('../lib/sanitize');
const fc = require('../lib/fieldcrypto');

const S = { auth: 'superadmin' };

route('GET', '/api/admin/stats', S, () => {
  const p = dom.getPrices();
  const active = all("SELECT * FROM tenants WHERE status='active'");
  const mrr = active.filter((t) => t.plan === 'sub').reduce((a, t) => a + Math.round(p.sub * (1 - (t.discount_months > 0 ? t.discount_pct : 0) / 100)), 0);
  const d = new Date(); const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return {
    tenants_total: get('SELECT COUNT(*) n FROM tenants').n,
    tenants_active: active.length,
    past_due: get("SELECT COUNT(*) n FROM tenants WHERE status='past_due'").n,
    employees: get("SELECT COUNT(*) n FROM users WHERE role='employee' AND status='active'").n,
    mrr,
    collected_month: get("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status='approved' AND applied_at>=?", monthStart).n,
    modules: active.reduce((a, t) => a + t.mod_suc + t.mod_rec, 0),
    warnings: warnings.list(),
    backup_stale: backup.status().stale, backup_age_days: backup.status().age_days,
    feedback_new: get("SELECT COUNT(*) n FROM feedback WHERE status='new'").n,
  };
});

route('GET', '/api/admin/tenants', S, (ctx) => {
  const st = ctx.query.status;
  const rows = all(`SELECT t.id,t.slug,t.name,t.plan,t.status,t.created_at,t.paid_until,t.mod_suc,t.mod_rec,t.discount_pct,t.discount_months,t.coupon,
      (SELECT email FROM users WHERE tenant_id=t.id AND role='owner' LIMIT 1) owner_email,
      (SELECT COUNT(*) FROM users WHERE tenant_id=t.id AND role='employee' AND status='active') employees
    FROM tenants t ${['active', 'past_due', 'suspended', 'pending_payment'].includes(st) ? 'WHERE t.status=?' : 'WHERE ?=?'} ORDER BY t.id DESC LIMIT 500`,
    ...(['active', 'past_due', 'suspended', 'pending_payment'].includes(st) ? [st] : [1, 1]));
  return { tenants: rows };
});
const getTenant = (id) => { const t = get('SELECT * FROM tenants WHERE id=?', Number(id)); if (!t) throw notFound('Negocio no encontrado'); return t; };

route('POST', '/api/admin/tenants/:id/status', S, (ctx) => {
  const t = getTenant(ctx.params.id), st = ctx.body.status;
  if (!['active', 'suspended'].includes(st)) throw bad('Estado inválido');
  run('UPDATE tenants SET status=? WHERE id=?', st, t.id);
  audit(ctx.user.id, t.id, 'admin.tenant_status', { status: st });
  return { ok: true };
});
route('POST', '/api/admin/tenants/:id/discount', S, (ctx) => {
  const t = getTenant(ctx.params.id);
  const pct = intIn(ctx.body.pct, 0, 100, 'Porcentaje'), months = intIn(ctx.body.months, 0, 36, 'Meses');
  run('UPDATE tenants SET discount_pct=?, discount_months=? WHERE id=?', pct, months, t.id);
  audit(ctx.user.id, t.id, 'admin.discount', { pct, months });
  return { ok: true };
});
route('POST', '/api/admin/tenants/:id/reset-owner-password', S, async (ctx) => {
  const t = getTenant(ctx.params.id);
  const o = get("SELECT * FROM users WHERE tenant_id=? AND role='owner' LIMIT 1", t.id);
  if (!o) throw notFound();
  const tmp = crypto.randomBytes(6).toString('base64url');
  run('UPDATE users SET pass_hash=?, must_change_pw=1 WHERE id=?', await sec.hashPassword(tmp), o.id);
  sec.destroyUserSessions(o.id);
  audit(ctx.user.id, t.id, 'admin.owner_pw_reset');
  return { email: o.email, temp_password: tmp };
});

/** Exportación completa de un negocio (para responder a la AAIP u orden judicial) */
route('GET', '/api/admin/tenants/:id/export', S, (ctx) => {
  const t = getTenant(ctx.params.id);
  const EMP_COLS = 'id,name,email,cargo,branch_id,status,phone,address,birthday,hire_date,shift_start,emg_name,emg_rel,emg_phone,dni,personal_email,blood_type,obra_social,notes,must_change_pw,created_at,last_login';
  const emps = all(`SELECT ${EMP_COLS} FROM users WHERE tenant_id=? AND role='employee'`, t.id).map((row) => {
    const d = fc.decryptUserFields({ ...row });
    d.email = fc.decryptEmail(d.email) || d.email;
    delete d.pass_hash;
    return d;
  });
  const owners = all("SELECT id,name,email,created_at,last_login FROM users WHERE tenant_id=? AND role='owner'", t.id).map((o) => ({
    ...o, email: fc.decryptEmail(o.email) || o.email,
  }));
  const data = {
    exported_at: new Date().toISOString(),
    purpose: 'Exportación administrativa (Ley 25.326 / AAIP / orden judicial)',
    tenant: { id: t.id, name: t.name, slug: t.slug, plan: t.plan, status: t.status, created_at: t.created_at, paid_until: t.paid_until },
    owners,
    branches: all('SELECT id,name,lat,lng,radius,address,created_at FROM branches WHERE tenant_id=?', t.id),
    employees: emps,
    marks: all('SELECT id,user_id,branch_id,kind,ts,lat,lng,accuracy,dist,auto,source,note FROM marks WHERE tenant_id=? ORDER BY ts', t.id),
    permits: all('SELECT * FROM permits WHERE tenant_id=?', t.id),
    docs: all('SELECT id,user_id,kind,title,period,cert_type,filename,created_at,sign_status,sign_note,signed_at FROM docs WHERE tenant_id=?', t.id),
    payments: all('SELECT id,kind,qty,amount,status,ext_ref,mp_payment_id,created_at,applied_at FROM payments WHERE tenant_id=?', t.id),
  };
  audit(ctx.user.id, t.id, 'admin.tenant_export', { employees: emps.length });
  return {
    __file: {
      buf: Buffer.from(JSON.stringify(data, null, 2)),
      filename: `asistok-aaip-${t.slug}-${new Date().toISOString().slice(0, 10)}.json`,
      mime: 'application/json',
    },
  };
});


// ---------- Contenido del inicio / contacto / legales ----------
const url = (s) => { const v = clean(s, 200); return /^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(v) ? v : ''; };
const heroView = () => { const h = getSetting('hero', dom.DEFAULTS.hero); return { ...h, slides: (h.slides || []).map((x) => ({ id: x.id })) }; };
route('GET', '/api/admin/site', S, () => ({
  hero: heroView(), contact: getSetting('contact', dom.DEFAULTS.contact), legal: getSetting('legal', dom.DEFAULTS.legal),
}));
route('PUT', '/api/admin/site', S, (ctx) => {
  const { hero: h, contact: c, legal: l } = ctx.body;
  if (h) {
    if (!/^#[0-9a-fA-F]{6}$/.test(h.overlay_color || '')) throw bad('Color del overlay inválido');
    setSetting('hero', { slides: getSetting('hero', dom.DEFAULTS.hero).slides || [], h1: clean(h.h1, 90), sub: clean(h.sub, 160), box_title: clean(h.box_title, 40), box_sub: clean(h.box_sub, 90), overlay_color: h.overlay_color, overlay_op: intIn(h.overlay_op, 20, 80, 'Opacidad') });
  }
  if (c) {
    if (c.email && !emailOk(c.email)) throw bad('Email de contacto inválido');
    setSetting('contact', { email: clean(c.email), wa_link: url(c.wa_link), wa_label: clean(c.wa_label, 40), copy: clean(c.copy, 120), tagline: clean(c.tagline, 120) });
  }
  if (l) setSetting('legal', { privacy: String(l.privacy ?? '').slice(0, 50000), terms: String(l.terms ?? '').slice(0, 50000) });
  audit(ctx.user.id, null, 'admin.site_updated');
  return { ok: true };
});

route('POST', '/api/admin/legal/preview', S, (ctx) => ({ html: sanitizeHtml(ctx.body.text) }));
route('GET', '/api/admin/legal/defaults', S, () => dom.DEFAULTS.legal);

// ---------- Carrusel del inicio ----------
const SITE_DIR = path.join(cfg.DATA_DIR, 'uploads', 'site');
route('POST', '/api/admin/hero/slides', { auth: 'superadmin', limit: 8 * 1024 * 1024 }, (ctx) => {
  const hero = getSetting('hero', dom.DEFAULTS.hero), slides = hero.slides || [];
  if (slides.length >= 6) throw bad('Máximo 6 imágenes. Eliminá alguna para subir otra.');
  const up = decodeUpload(ctx.body.data, ctx.body.filename, { imagesOnly: true });
  if (up.buf.length > cfg.MAX_UPLOAD_BYTES) throw new HttpError(413, 'TOO_LARGE', 'La imagen supera los 5 MB. Probá con una más liviana.');
  fs.mkdirSync(SITE_DIR, { recursive: true });
  const id = crypto.randomBytes(6).toString('hex'), file = `${id}.${up.ext}`;
  fs.writeFileSync(path.join(SITE_DIR, file), up.buf, { mode: 0o640 });
  setSetting('hero', { ...hero, slides: [...slides, { id, file, mime: up.mime }] });
  audit(ctx.user.id, null, 'admin.hero_slide_added', { id });
  return { id };
});
route('DELETE', '/api/admin/hero/slides/:id', S, (ctx) => {
  const hero = getSetting('hero', dom.DEFAULTS.hero), sl = (hero.slides || []).find((x) => x.id === ctx.params.id);
  if (!sl) throw notFound();
  fs.rmSync(path.join(SITE_DIR, sl.file), { force: true });
  setSetting('hero', { ...hero, slides: hero.slides.filter((x) => x.id !== sl.id) });
  return { ok: true };
});

// ---------- Precios ----------
route('GET', '/api/admin/prices', S, () => ({
  prices: dom.getPrices(), free_employees: getSetting('free_employees', 40),
  schedule: getSetting('price_schedule', null), history: getSetting('price_history', []),
}));
const money = (v, name) => intIn(v, 0, 100_000_000, name);
route('PUT', '/api/admin/prices', S, (ctx) => {
  const b = ctx.body;
  const prices = {
    sub: money(b.esencial_m ?? b.sub, 'Esencial mensual'),
    once: money(b.esencial_y ?? b.once, 'Esencial pago único'),
    esencial_m: money(b.esencial_m ?? b.sub, 'Esencial mensual'),
    esencial_y: money(b.esencial_y ?? b.once, 'Esencial pago único'),
    pro_m: money(b.pro_m, 'Pro mensual'),
    pro_y: money(b.pro_y, 'Pro pago único'),
    completo_m: money(b.completo_m, 'Completo mensual'),
    completo_y: money(b.completo_y, 'Completo pago único'),
    extra: money(b.extra, 'Empleado extra'),
    mod_suc: money(b.mod_suc, 'Multi-sucursal'),
    mod_rec: money(b.mod_rec, 'Recibos'),
  };
  setSetting('prices', prices);
  if (b.free_employees !== undefined) setSetting('free_employees', intIn(b.free_employees, 1, 10000, 'Empleados incluidos'));
  audit(ctx.user.id, null, 'admin.prices', prices);
  return { ok: true };
});
route('POST', '/api/admin/prices/schedule', S, (ctx) => {
  const b = ctx.body;
  if (!isoDateOk(b.date) || b.date <= isoDate(Date.now())) throw bad('La fecha de vigencia tiene que ser futura');
  const sch = {
    sub: money(b.esencial_m ?? b.sub, 'Esencial mensual'),
    once: money(b.esencial_y ?? b.once, 'Esencial pago único'),
    esencial_m: money(b.esencial_m ?? b.sub, 'Esencial mensual'),
    esencial_y: money(b.esencial_y ?? b.once, 'Esencial pago único'),
    pro_m: money(b.pro_m, 'Pro mensual'),
    pro_y: money(b.pro_y, 'Pro pago único'),
    completo_m: money(b.completo_m, 'Completo mensual'),
    completo_y: money(b.completo_y, 'Completo pago único'),
    extra: money(b.extra, 'Empleado extra'),
    mod_suc: b.mod_suc !== undefined && b.mod_suc !== '' ? money(b.mod_suc, 'Multi-sucursal') : undefined,
    mod_rec: b.mod_rec !== undefined && b.mod_rec !== '' ? money(b.mod_rec, 'Recibos') : undefined,
    date: b.date, notify_days: [7, 15, 30].includes(Number(b.notify_days)) ? Number(b.notify_days) : 15,
    legacy: ['renewal', 'newonly', 'all'].includes(b.legacy) ? b.legacy : 'renewal',
    text: clean(b.text, 400) || 'A partir del {fecha} los planes se actualizan.',
  };
  setSetting('price_schedule', sch);
  audit(ctx.user.id, null, 'admin.price_schedule', sch);
  return { ok: true };
});
route('DELETE', '/api/admin/prices/schedule', S, (ctx) => { setSetting('price_schedule', null); audit(ctx.user.id, null, 'admin.price_schedule_cancel'); return { ok: true }; });

// ---------- Cupones ----------
route('GET', '/api/admin/coupons', S, () => ({ coupons: all('SELECT * FROM coupons ORDER BY code') }));
route('POST', '/api/admin/coupons', S, (ctx) => {
  const code = clean(ctx.body.code, 24).toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw bad('El código debe tener 3 a 24 letras o números');
  const pct = intIn(ctx.body.pct, 1, 100, 'Porcentaje');
  const duration_n = intIn(ctx.body.duration_n ?? ctx.body.months ?? 1, 1, 3650, 'Duración');
  let duration_unit = String(ctx.body.duration_unit || 'months').toLowerCase();
  if (!['days', 'months', 'years'].includes(duration_unit)) duration_unit = 'months';
  const months = duration_unit === 'months' ? duration_n : duration_unit === 'years' ? duration_n * 12 : Math.max(1, Math.ceil(duration_n / 30));
  const scope = ctx.body.scope === 'all' ? 'all' : 'new';
  let applies_to = String(ctx.body.applies_to || 'both');
  if (!['sub', 'once', 'both'].includes(applies_to)) applies_to = 'both';
  let max_uses = ctx.body.max_uses;
  if (max_uses === '' || max_uses === 'infinite' || max_uses == null) max_uses = null;
  else max_uses = intIn(max_uses, 1, 100000, 'Usos máximos');
  const per_email_once = ctx.body.per_email_once === false || ctx.body.per_email_once === '0' || ctx.body.per_email_once === 0 ? 0 : 1;
  let starts_at = null, expires_at = null;
  if (ctx.body.starts_at) {
    const d = Date.parse(ctx.body.starts_at);
    if (!Number.isFinite(d)) throw bad('Fecha de inicio inválida');
    starts_at = d;
  }
  if (ctx.body.expires_at) {
    const d = Date.parse(ctx.body.expires_at);
    if (!Number.isFinite(d)) throw bad('Fecha de vencimiento inválida');
    expires_at = d;
  }
  if (starts_at && expires_at && expires_at <= starts_at) throw bad('El vencimiento debe ser posterior al inicio');
  const note = clean(ctx.body.note || '', 200) || null;
  let plan_tiers = clean(ctx.body.plan_tiers || '', 80) || null;
  if (plan_tiers === 'all' || plan_tiers === '') plan_tiers = null;
  const active = ctx.body.active === false || ctx.body.active === '0' ? 0 : 1;
  run(`INSERT INTO coupons(code,pct,months,scope,active,max_uses,uses_count,expires_at,duration_n,duration_unit,starts_at,note,applies_to,per_email_once,plan_tiers)
    VALUES(?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)
    ON CONFLICT(code) DO UPDATE SET
      pct=excluded.pct, months=excluded.months, scope=excluded.scope, active=excluded.active,
      max_uses=excluded.max_uses, expires_at=excluded.expires_at,
      duration_n=excluded.duration_n, duration_unit=excluded.duration_unit, starts_at=excluded.starts_at,
      note=excluded.note, applies_to=excluded.applies_to, per_email_once=excluded.per_email_once, plan_tiers=excluded.plan_tiers`,
    code, pct, months, scope, active, max_uses, expires_at, duration_n, duration_unit, starts_at, note, applies_to, per_email_once, plan_tiers);
  audit(ctx.user.id, null, 'admin.coupon_upsert', { code, pct, duration_n, duration_unit });
  return { ok: true };
});
route('POST', '/api/admin/coupons/:code/toggle', S, (ctx) => {
  const code = String(ctx.params.code || '').toUpperCase();
  const c = get('SELECT * FROM coupons WHERE code=?', code);
  if (!c) throw notFound('Cupón no encontrado');
  run('UPDATE coupons SET active=? WHERE code=?', c.active ? 0 : 1, code);
  return { ok: true, active: !c.active };
});
route('GET', '/api/admin/reviews', S, () => ({
  reviews: all(`SELECT r.*, t.name as tenant_name FROM reviews r LEFT JOIN tenants t ON t.id=r.tenant_id ORDER BY r.created_at DESC LIMIT 100`)
}));
route('POST', '/api/admin/reviews/:id/approve', S, (ctx) => {
  run('UPDATE reviews SET approved=1 WHERE id=?', Number(ctx.params.id));
  return { ok: true };
});
route('POST', '/api/admin/reviews/:id/reject', S, (ctx) => {
  run('DELETE FROM reviews WHERE id=?', Number(ctx.params.id));
  return { ok: true };
});
route('GET', '/api/admin/payments-config', S, () => ({
  config: {
    provider: 'mercadopago',
    mp_enabled: require('../lib/mp').enabled(),
    note: 'Solo Mercado Pago está activo. Más adelante se puede sumar otro proveedor.',
  },
}));
route('PUT', '/api/admin/payments-config', S, (ctx) => {
  // Reservado para futuros proveedores. Hoy solo MP (credenciales en .env).
  audit(ctx.user.id, null, 'admin.payments_config', { provider: 'mercadopago' });
  return { ok: true, provider: 'mercadopago' };
});
route('DELETE', '/api/admin/coupons/:code', S, (ctx) => { run('DELETE FROM coupons WHERE code=?', ctx.params.code.toUpperCase()); return { ok: true }; });

// ---------- Feriados ----------
const yearOf = (v) => intIn(v ?? new Date().getFullYear(), 2020, 2100, 'Año');
route('GET', '/api/admin/holidays', S, (ctx) => {
  const y = yearOf(ctx.query.year); hol.ensureYear(y);
  return {
    year: y, holidays: all('SELECT date,name,kind,source FROM holidays WHERE substr(date,1,4)=? ORDER BY date', String(y)),
    sync: getSetting('hol_last_sync', null), auto_sync: getSetting('hol_auto_sync', true) !== false, source_url: cfg.HOLIDAYS_API_URL,
  };
});
route('POST', '/api/admin/holidays', S, (ctx) => {
  if (!isoDateOk(ctx.body.date)) throw bad('Fecha inválida');
  const name = clean(ctx.body.name, 80); if (!name) throw bad('Ingresá el nombre');
  const kind = ctx.body.kind === 'no_laborable' ? 'no_laborable' : 'feriado';
  run("INSERT INTO holidays(date,name,kind,source) VALUES(?,?,?,'manual') ON CONFLICT(date) DO UPDATE SET name=excluded.name, kind=excluded.kind, source='manual'", ctx.body.date, name, kind);
  hol.unmarkRemoved(ctx.body.date);
  audit(ctx.user.id, null, 'admin.holiday_saved', { date: ctx.body.date, kind });
  return { ok: true };
});
route('DELETE', '/api/admin/holidays/:date', S, (ctx) => { run('DELETE FROM holidays WHERE date=?', ctx.params.date); hol.markRemoved(ctx.params.date); return { ok: true }; });
route('POST', '/api/admin/holidays/generate', S, (ctx) => {
  const y = yearOf(ctx.body.year), n = hol.regenerate(y);
  audit(ctx.user.id, null, 'admin.holidays_generated', { year: y, count: n });
  return { ok: true, count: n };
});
route('POST', '/api/admin/holidays/sync', S, async (ctx) => {
  const y = yearOf(ctx.body.year);
  try { const n = await hol.syncFromApi(y); audit(ctx.user.id, null, 'admin.holidays_synced', { year: y, count: n }); return { ok: true, count: n }; }
  catch (e) {
    setSetting('hol_last_sync', { at: Date.now(), year: y, ok: false, error: e.message });
    throw new HttpError(502, 'SYNC_FAILED', `No pudimos consultar la fuente online (${e.message}). Los feriados calculados por ley siguen vigentes.`);
  }
});
route('PUT', '/api/admin/holidays/settings', S, (ctx) => { setSetting('hol_auto_sync', ctx.body.auto_sync !== false); return { ok: true }; });

// ---------- Backup de la base (copia consistente) y auditoría ----------
route('GET', '/api/admin/backup', S, (ctx) => {
  const tmp = path.join(cfg.DATA_DIR, `backup-${Date.now()}.db`);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(tmp);
    backup.noteDownload();
    audit(ctx.user.id, null, 'admin.backup');
    return { __file: { buf, filename: `asistok-${isoDate(Date.now())}.db`, mime: 'application/octet-stream' } };
  } finally { fs.rmSync(tmp, { force: true }); }
});
route('GET', '/api/admin/backup/status', S, () => backup.status());
route('POST', '/api/admin/backup/run', S, (ctx) => { const r = backup.runBackup('manual'); audit(ctx.user.id, null, 'admin.backup_run', r); return r; });
route('PUT', '/api/admin/backup/settings', S, (ctx) => {
  setSetting('backup_auto', ctx.body.auto !== false);
  setSetting('backup_keep', intIn(ctx.body.keep, 1, 60, 'Cantidad de copias'));
  setSetting('backup_warn_days', intIn(ctx.body.warn_days, 1, 90, 'Días de aviso'));
  return { ok: true };
});
route('GET', '/api/admin/backup/file/:name', S, (ctx) => {
  if (!/^asistok-[\d-]+\.db$/.test(ctx.params.name)) throw bad('Nombre inválido');
  const f = path.join(cfg.DATA_DIR, 'backups', ctx.params.name);
  if (!fs.existsSync(f)) throw notFound('Esa copia ya no existe');
  backup.noteDownload();
  return { __file: { buf: fs.readFileSync(f), filename: ctx.params.name, mime: 'application/octet-stream' } };
});
route('GET', '/api/admin/audit', S, () => ({ audit: all('SELECT a.*, t.name tenant FROM audit a LEFT JOIN tenants t ON t.id=a.tenant_id ORDER BY a.id DESC LIMIT 200') }));
