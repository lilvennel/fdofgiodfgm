'use strict';
const { HttpError, bad } = require('../lib/http');
const { getSetting } = require('../lib/db');
const { employeeLimit, employeeCount, planFeatures } = require('../lib/domain');
const { currentPeriod, periodRange } = require('../lib/hours');

const clean = (s, max = 120) => String(s ?? '').trim().slice(0, max);
const emailOk = (e) => typeof e === 'string' && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const intIn = (v, min, max, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} inválido`);
  return n;
};
// Valida que la fecha exista de verdad (31/02 no pasa)
const isoDateOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const hhmmOk = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const periodOf = (q) => {
  const p = q || currentPeriod();
  if (!periodRange(p)) throw bad('Período inválido (usá AAAA-MM)');
  return p;
};

function tenantView(t, role = 'owner') {
  if (!t) return null;
  const feats = planFeatures(t);
  const base = {
    id: t.id, slug: t.slug, name: t.name, status: t.status, theme: t.theme,
    mod_suc: feats.multi_suc, mod_rec: feats.recibos, allow_extra: !!t.allow_extra,
    plan_tier: feats.tier, features: feats, mark_qr: t.mark_qr !== 0, mark_gps: t.mark_gps !== 0, logo_url: t.logo_path ? '/api/tenant/logo' : null, has_sign: !!t.sign_path,
  };
  // Trial: activo y todavía no venció paid_until del periodo de prueba (con o sin MP ya vinculado)
  const isTrial = t.status === 'active' && !!t.paid_until && t.paid_until > Date.now()
    && (Date.now() - (t.created_at || 0)) < 40 * 864e5;
  base.trial = isTrial;
  base.trial_until = isTrial ? t.paid_until : null;
  base.trial_days = require('../lib/config').TRIAL_DAYS || 0;
  if (role !== 'owner') return base;
  return {
    ...base, plan: t.plan, plan_tier: t.plan_tier || 'esencial', paid_until: t.paid_until, extra_slots: t.extra_slots,
    employee_limit: employeeLimit(t), employee_count: employeeCount(t.id),
    free_employees: getSetting('free_employees', 40),
    auto_close_hour: t.auto_close_hour, late_tolerance_min: t.late_tolerance_min,
    hpd: t.hpd, dpw: t.dpw, sat_h: t.sat_h,
    discount_pct: t.discount_pct, discount_months: t.discount_months,
    cancel_at: t.cancel_at || null,
    sub_state: t.plan !== 'sub' ? null : t.cancel_at ? 'cancelled' : t.status === 'past_due' ? 'past_due' : 'active',
    sub_linked: !!t.mp_preapproval_id,
  };
}

// Archivos subidos: validación por extensión + firma real del archivo
function decodeUpload(data, filename, { pdfOnly = false, imagesOnly = false } = {}) {
  if (typeof data !== 'string' || !data) throw bad('Falta el archivo');
  const buf = Buffer.from(data.replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw bad('Archivo vacío');
  const isPdf = buf.subarray(0, 4).toString('latin1') === '%PDF';
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (!imagesOnly && (pdfOnly ? !isPdf : !(isPdf || isJpg || isPng))) throw bad(pdfOnly ? 'El recibo debe ser un PDF' : 'Solo se aceptan PDF, JPG o PNG');
  const isWebp = buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
  if (imagesOnly) {
    if (!(isJpg || isPng || isWebp)) throw bad('Solo se aceptan imágenes JPG, PNG o WebP');
    const e = isJpg ? 'jpg' : isPng ? 'png' : 'webp';
    return { buf, ext: e, mime: isJpg ? 'image/jpeg' : isPng ? 'image/png' : 'image/webp', filename: clean(filename || 'imagen', 80) };
  }
  const ext = isPdf ? 'pdf' : isJpg ? 'jpg' : 'png';
  const mime = isPdf ? 'application/pdf' : isJpg ? 'image/jpeg' : 'image/png';
  const safeName = clean(filename || 'archivo', 80).replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_');
  return { buf, ext, mime, filename: safeName.toLowerCase().endsWith('.' + ext) ? safeName : `${safeName}.${ext}` };
}

module.exports = { clean, emailOk, intIn, isoDateOk, hhmmOk, periodOf, tenantView, decodeUpload, HttpError };
