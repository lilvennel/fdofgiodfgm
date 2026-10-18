'use strict';
const cfg = require('../lib/config');
const { route, bad, HttpError, forbidden } = require('../lib/http');
const { get, all, run, getSetting, audit } = require('../lib/db');
const { randomToken } = require('../lib/security');
const dom = require('../lib/domain');
const mp = require('../lib/mp');
const { intIn } = require('./common');

const TITLES = {
  plan_sub: 'Asist OK · Suscripción mensual', plan_once: 'Asist OK · Licencia pago único',
  extra: 'Asist OK · Empleados extra (pago único)', mod_suc: 'Asist OK · Módulo Multi-sucursal', mod_rec: 'Asist OK · Módulo Recibos de sueldo',
};

route('POST', '/api/pay/checkout', { auth: 'owner', anyStatus: true }, async (ctx) => {
  const t = ctx.tenant, kind = ctx.body.kind;
  if (!['plan', 'extra', 'mod_suc', 'mod_rec'].includes(kind)) throw bad('Producto inválido');
  if (t.status === 'suspended') throw forbidden('Tu cuenta está suspendida. Contactá a soporte.', 'TENANT_SUSPENDED');
  if (kind === 'plan' && t.status === 'active') throw bad('Tu plan ya está activo');
  if (kind !== 'plan' && t.status !== 'active') throw new HttpError(402, 'PAYMENT_REQUIRED', 'Primero tenés que activar tu plan');
  if (kind === 'mod_suc' && t.mod_suc) throw bad('Ya tenés este módulo');
  if (kind === 'mod_rec' && t.mod_rec) throw bad('Ya tenés este módulo');
  // H2: no se cobra ni se activa un negocio cuyo dueño no confirmó su email
  if (cfg.REQUIRE_EMAIL_VERIFICATION && !ctx.user.email_verified_at) throw new HttpError(403, 'EMAIL_UNVERIFIED', 'Primero confirmá tu email: te enviamos un link. Si no te llegó, pedí otro con el botón “Reenviar email”.');
  const qty = kind === 'extra' ? intIn(ctx.body.qty, 1, 500, 'Cantidad') : 1;
  if (!mp.enabled() && !cfg.ALLOW_DEMO_PAYMENTS) throw new HttpError(503, 'PAYMENTS_OFF', 'Los pagos todavía no están configurados. Escribinos y lo activamos.');

  const { amount } = dom.chargeFor(t, kind, qty);
  const extRef = `ap-${t.id}-${kind}-${randomToken(8)}`;
  const title = kind === 'plan' ? TITLES['plan_' + t.plan] : TITLES[kind];
  run('INSERT INTO payments(tenant_id,kind,qty,amount,status,ext_ref,created_at) VALUES(?,?,?,?,?,?,?)', t.id, kind, qty, amount, 'pending', extRef, Date.now());

  // Solo Mercado Pago por ahora. Arquitectura lista para sumar otro proveedor después.
  if (!mp.enabled()) return { url: `${cfg.APP_URL}/?demo_pay=${extRef}`, demo: true, amount, provider: 'mercadopago' };
  try {
    if (kind === 'plan' && t.plan === 'sub') {
      // Trial MP solo en plan Esencial (Pro/Completo pagan desde el día 1)
      const trialDays = (t.plan_tier || 'esencial') === 'esencial' ? cfg.TRIAL_DAYS : 0;
      const pa = await mp.createPreapproval({ reason: title, amount, extRef, email: ctx.user.email, trialDays });
      run('UPDATE payments SET mp_pref_id=? WHERE ext_ref=?', pa.id, extRef);
      return { url: pa.init_point, amount };
    }
    const pref = await mp.createPreference({ title: qty > 1 ? `${title} x${qty}` : title, amount, extRef, email: ctx.user.email });
    run('UPDATE payments SET mp_pref_id=? WHERE ext_ref=?', pref.id, extRef);
    return { url: pref.init_point, amount };
  } catch (e) {
    console.error('[mp] checkout error', { status: e.status || 0, message: String(e.message || 'error').slice(0, 240), code: e.data?.error || '' });
    throw new HttpError(502, 'MP_ERROR', 'No pudimos iniciar el pago con Mercado Pago. Probá de nuevo en unos minutos.');
  }
});

route('GET', '/api/pay/history', { auth: 'owner', anyStatus: true }, (ctx) =>
  ({ payments: all('SELECT id,kind,qty,amount,status,created_at,applied_at FROM payments WHERE tenant_id=? ORDER BY id DESC LIMIT 50', ctx.tenant.id) }));

// Pago simulado: SOLO si no hay Mercado Pago configurado y ALLOW_DEMO_PAYMENTS=1
route('POST', '/api/pay/demo-confirm', { auth: 'owner', anyStatus: true }, (ctx) => {
  if (mp.enabled() || !cfg.ALLOW_DEMO_PAYMENTS) throw forbidden('Pagos de prueba deshabilitados');
  const p = get('SELECT * FROM payments WHERE ext_ref=? AND tenant_id=?', String(ctx.body.ref || ''), ctx.tenant.id);
  if (!p) throw bad('Pago no encontrado');
  dom.applyApprovedPayment(p.id, 'DEMO');
  return { ok: true };
});

// ---------- Webhook de Mercado Pago ----------
async function processMp(topic, id) {
  if (/^payment/.test(topic)) {
    const pay = await mp.getPayment(id);
    const p = pay.external_reference && get('SELECT * FROM payments WHERE ext_ref=?', pay.external_reference);
    if (!p) return;
    if (pay.status === 'approved') {
      if (Math.round(pay.transaction_amount) < p.amount - 1) { console.error('[mp] monto menor al esperado', id); return; }
      dom.applyApprovedPayment(p.id, String(id));
    } else if (['rejected', 'cancelled'].includes(pay.status) && !p.applied_at) {
      run("UPDATE payments SET status='rejected', mp_payment_id=? WHERE id=?", String(id), p.id);
    } else if (pay.status === 'refunded' || pay.status === 'charged_back') {
      run("UPDATE payments SET status='refunded' WHERE id=?", p.id);
      audit(null, p.tenant_id, 'payment.refunded', { ext: p.ext_ref });
    }
    return;
  }
  if (/preapproval$/.test(topic) || topic === 'subscription_preapproval') {
    const pa = await mp.getPreapproval(id);
    const p = pa.external_reference && get('SELECT * FROM payments WHERE ext_ref=?', pa.external_reference);
    if (!p) return;
    run('UPDATE tenants SET mp_preapproval_id=? WHERE id=?', String(pa.id), p.tenant_id);
    if (pa.status === 'authorized') dom.applyApprovedPayment(p.id, null);
    else if (pa.status === 'paused') run("UPDATE tenants SET status='past_due' WHERE id=? AND status='active'", p.tenant_id);
    return;
  }
  if (/authorized_payment/.test(topic)) {
    const ap = await mp.getAuthorizedPayment(id);
    const t = ap.preapproval_id && get('SELECT * FROM tenants WHERE mp_preapproval_id=?', String(ap.preapproval_id));
    if (!t) return;
    const st = ap.payment?.status || ap.status;
    if (st === 'approved' || st === 'processed') {
      // Idempotente (H1): si MP repite la notificación, el cobro ya registrado no vuelve a sumar días
      const r = dom.applyRecurringCharge(t.id, String(ap.id ?? id));
      if (r.applied && r.resetPrice) {
        try { const fresh = get('SELECT * FROM tenants WHERE id=?', t.id); await mp.updatePreapprovalAmount(t.mp_preapproval_id, dom.chargeFor(fresh, 'plan').amount); } catch (e) { console.error('[mp] precio', e.message); }
      }
    } else if (st === 'rejected' || st === 'cancelled') {
      run("UPDATE tenants SET status='past_due' WHERE id=? AND status='active'", t.id);
    }
  }
}

route('POST', '/api/mp/webhook', async (ctx) => {
  const q = ctx.query, b = ctx.body || {};
  const topic = String(q.topic || q.type || b.type || b.topic || '');
  const id = q['data.id'] || b?.data?.id || q.id || b.id;
  if (!id) return { ok: true };
  if (!mp.verifySignature(ctx.req, id)) throw new HttpError(401, 'BAD_SIGNATURE', 'Firma inválida');
  try { await processMp(topic, String(id)); }
  catch (e) { console.error('[mp] webhook', topic, id, e.message); throw new HttpError(500, 'WEBHOOK_FAILED', 'reintentar'); }
  return { ok: true };
});
