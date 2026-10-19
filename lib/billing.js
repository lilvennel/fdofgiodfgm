'use strict';
/**
 * Facturación comercial (comprobante de servicio SaaS) + feature flag.
 * NO es factura electrónica AFIP/ARCA: es recibo informativo del servicio AsistOK.
 */
const { get, all, run, tx, getSetting, setSetting, audit } = require('./db');
const fc = require('./fieldcrypto');
const cfg = require('./config');

const BILLING_FLAG = 'billing.enabled';
const AUTO_ISSUE_FLAG = 'billing.auto_issue';

function flagGet(key, def = false) {
  try {
    const v = getSetting(key, def);
    if (typeof v === 'boolean') return v;
    if (v === '1' || v === 1 || v === 'true') return true;
    if (v === '0' || v === 0 || v === 'false') return false;
    return !!v;
  } catch { return def; }
}
function flagSet(key, value) {
  setSetting(key, !!value);
}

function issuerSettings() {
  return getSetting('billing_issuer', {
    legal_name: '',
    tax_id: '',
    address: '',
    email: '',
    series: 'R',
    next_number: 1,
    disclaimer: 'Documento informativo del servicio AsistOK. No constituye comprobante fiscal AFIP/ARCA.',
  });
}

function profileOf(tenantId) {
  return get('SELECT * FROM customer_billing_profiles WHERE tenant_id=?', tenantId) || null;
}

function missingProfileFields(p) {
  const need = ['legal_name', 'tax_id', 'address', 'zip', 'email', 'person_type', 'tax_condition', 'doc_type'];
  if (!p) return need;
  return need.filter((k) => !String(p[k] || '').trim());
}

function isProfileComplete(p) {
  return missingProfileFields(p).length === 0;
}

function billingStatus(tenantId) {
  const enabled = flagGet(BILLING_FLAG, false);
  const auto = flagGet(AUTO_ISSUE_FLAG, false);
  const profile = profileOf(tenantId);
  const complete = isProfileComplete(profile);
  const missing = missingProfileFields(profile);
  return {
    module_enabled: enabled,
    auto_issue: auto && enabled,
    profile_complete: complete,
    can_auto_issue: enabled && auto && complete,
    can_request: enabled,
    missing,
    profile: profile ? {
      legal_name: profile.legal_name,
      tax_id: profile.tax_id,
      address: profile.address,
      city: profile.city,
      zip: profile.zip,
      email: profile.email,
      person_type: profile.person_type,
      tax_condition: profile.tax_condition,
      doc_type: profile.doc_type,
      complete: !!profile.complete,
      updated_at: profile.updated_at,
    } : null,
    disclaimer: issuerSettings().disclaimer,
  };
}

function upsertProfile(tenantId, body) {
  const fields = {
    legal_name: String(body.legal_name || '').trim().slice(0, 200),
    tax_id: String(body.tax_id || '').replace(/[^\d-]/g, '').slice(0, 20),
    address: String(body.address || '').trim().slice(0, 300),
    city: String(body.city || '').trim().slice(0, 120),
    zip: String(body.zip || '').trim().slice(0, 20),
    email: String(body.email || '').trim().toLowerCase().slice(0, 200),
    person_type: String(body.person_type || '').trim().slice(0, 40),
    tax_condition: String(body.tax_condition || '').trim().slice(0, 60),
    doc_type: String(body.doc_type || '').trim().slice(0, 40),
  };
  const complete = isProfileComplete(fields) ? 1 : 0;
  const now = Date.now();
  run(`INSERT INTO customer_billing_profiles(tenant_id,legal_name,tax_id,address,city,zip,email,person_type,tax_condition,doc_type,complete,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(tenant_id) DO UPDATE SET
         legal_name=excluded.legal_name, tax_id=excluded.tax_id, address=excluded.address,
         city=excluded.city, zip=excluded.zip, email=excluded.email,
         person_type=excluded.person_type, tax_condition=excluded.tax_condition,
         doc_type=excluded.doc_type, complete=excluded.complete, updated_at=excluded.updated_at`,
    tenantId, fields.legal_name, fields.tax_id, fields.address, fields.city, fields.zip,
    fields.email, fields.person_type, fields.tax_condition, fields.doc_type, complete, now);
  return billingStatus(tenantId);
}

function nextInvoiceNumber() {
  const iss = issuerSettings();
  const n = Number(iss.next_number) || 1;
  iss.next_number = n + 1;
  setSetting('billing_issuer', iss);
  return { series: iss.series || 'R', number: String(n).padStart(8, '0') };
}

function paymentLabel(p) {
  const map = {
    plan_sub: 'Suscripción mensual AsistOK',
    plan_once: 'Licencia pago único AsistOK',
    plan_upgrade: 'Cambio de plan AsistOK',
    extra: 'Empleados extra',
    mod_suc: 'Módulo Multi-sucursal',
    mod_rec: 'Módulo Recibos',
  };
  return map[p.kind] || p.kind || 'Servicio AsistOK';
}

/**
 * Crea factura asociada a un pago.
 * @param {object} opts
 * @param {number} opts.tenantId
 * @param {object} [opts.payment] fila payments
 * @param {'manual'|'auto'|'client_request'} opts.source
 * @param {number} [opts.createdBy]
 * @param {boolean} [opts.force] Super Admin fuerza emisión aunque falten datos
 * @param {string} [opts.notes]
 */
function createInvoiceFromPayment({ tenantId, payment, source, createdBy, force = false, notes = '' }) {
  const enabled = flagGet(BILLING_FLAG, false);
  if (!enabled && !force) {
    return { ok: false, reason: 'BILLING_DISABLED', message: 'Facturación deshabilitada (feature flag)' };
  }
  // Idempotencia: un pago no genera dos facturas activas (webhook MP duplicado)
  if (payment && payment.id) {
    const existing = get("SELECT id, status, number, series FROM invoices WHERE payment_id=? AND tenant_id=? AND status!='void'", payment.id, tenantId);
    if (existing) {
      return { ok: true, id: existing.id, status: existing.status, number: existing.number ? `${existing.series}-${existing.number}` : null, existing: true };
    }
  }
  const profile = profileOf(tenantId);
  const complete = isProfileComplete(profile);
  let status = 'draft';
  if (!complete && !force) status = 'pending_data';
  else status = 'issued';

  const amount = payment ? Math.round(Number(payment.amount) || 0) : 0;
  // amount en pesos enteros en AsistOK; guardamos en "cents" como pesos*100 para precisión
  const totalCents = amount * 100;
  const coupon = payment?.meta ? (() => { try { return JSON.parse(payment.meta).coupon; } catch { return null; } })() : null;
  const discountCents = 0;

  return tx(() => {
    const { series, number } = status === 'issued' ? nextInvoiceNumber() : { series: issuerSettings().series || 'R', number: null };
    const now = Date.now();
    const inv = run(
      `INSERT INTO invoices(number,series,tenant_id,payment_id,source,status,subtotal_cents,discount_cents,tax_cents,total_cents,currency,coupon_code,issued_at,notes,created_by,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      number, series, tenantId, payment?.id || null, source, status,
      totalCents, discountCents, 0, totalCents, 'ARS',
      coupon || null, status === 'issued' ? now : null, notes || null, createdBy || null, now
    );
    const invId = Number(inv.lastInsertRowid);
    const desc = payment ? paymentLabel(payment) : 'Servicio AsistOK';
    run(`INSERT INTO invoice_items(invoice_id,kind,description,qty,unit_cents,total_cents) VALUES(?,?,?,?,?,?)`,
      invId, payment?.kind || 'service', desc, 1, totalCents, totalCents);
    audit(createdBy || null, tenantId, 'invoice.created', { id: invId, status, source, payment_id: payment?.id });
    return { ok: true, id: invId, status, number: number ? `${series}-${number}` : null };
  });
}

function issueInvoice(id, { force = false, userId = null } = {}) {
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  if (!inv) return null;
  if (inv.status === 'void') throw Object.assign(new Error('Factura anulada'), { code: 'VOID' });
  if (inv.status === 'issued' || inv.status === 'sent') return inv;
  const profile = profileOf(inv.tenant_id);
  if (!isProfileComplete(profile) && !force) {
    run("UPDATE invoices SET status='pending_data' WHERE id=?", id);
    return get('SELECT * FROM invoices WHERE id=?', id);
  }
  const { series, number } = nextInvoiceNumber();
  run(`UPDATE invoices SET status='issued', series=?, number=?, issued_at=? WHERE id=?`, series, number, Date.now(), id);
  audit(userId, inv.tenant_id, 'invoice.issued', { id });
  return get('SELECT * FROM invoices WHERE id=?', id);
}

function markSent(id, userId) {
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  if (!inv || inv.status === 'void') return null;
  if (inv.status === 'pending_data' || inv.status === 'draft') {
    issueInvoice(id, { force: true, userId });
  }
  run("UPDATE invoices SET status='sent', sent_at=? WHERE id=?", Date.now(), id);
  audit(userId, inv.tenant_id, 'invoice.sent', { id });
  return get('SELECT * FROM invoices WHERE id=?', id);
}

function voidInvoice(id, userId) {
  run("UPDATE invoices SET status='void' WHERE id=?", id);
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  if (inv) audit(userId, inv.tenant_id, 'invoice.void', { id });
  return inv;
}

function invoiceDetail(id) {
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  if (!inv) return null;
  const items = all('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id', id);
  const tenant = get('SELECT id, name, slug FROM tenants WHERE id=?', inv.tenant_id);
  const profile = profileOf(inv.tenant_id);
  const payment = inv.payment_id ? get('SELECT id, kind, amount, status, applied_at, created_at FROM payments WHERE id=?', inv.payment_id) : null;
  return { invoice: inv, items, tenant, profile, payment, issuer: issuerSettings() };
}

function renderInvoiceHtml(detail) {
  const { invoice: inv, items, tenant, profile, issuer } = detail;
  const money = (c) => '$ ' + (Number(c || 0) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fecha = inv.issued_at ? new Date(inv.issued_at).toLocaleDateString('es-AR') : '—';
  const num = inv.number ? `${inv.series}-${inv.number}` : 'Sin número';
  const rows = items.map((it) =>
    `<tr><td>${esc(it.description)}</td><td style="text-align:center">${it.qty}</td><td style="text-align:right">${money(it.unit_cents)}</td><td style="text-align:right">${money(it.total_cents)}</td></tr>`
  ).join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Comprobante ${esc(num)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f1f5f9;color:#0f172a;margin:0;padding:24px}
  .sheet{max-width:720px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(15,23,42,.08);overflow:hidden;border:1px solid #e2e8f0}
  .head{background:linear-gradient(135deg,#0f766e,#0d9488);color:#fff;padding:28px 32px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .head h1{margin:0;font-size:1.35rem;font-weight:700}
  .head .muted{opacity:.9;font-size:.9rem}
  .body{padding:28px 32px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
  .card{background:#f8fafc;border-radius:12px;padding:14px 16px;border:1px solid #e2e8f0}
  .card h3{margin:0 0 8px;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:#64748b}
  .card p{margin:2px 0;font-size:.95rem}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th{text-align:left;font-size:.75rem;text-transform:uppercase;color:#64748b;padding:8px;border-bottom:2px solid #e2e8f0}
  td{padding:10px 8px;border-bottom:1px solid #f1f5f9;font-size:.95rem}
  .tot{text-align:right;margin-top:12px}
  .tot strong{font-size:1.25rem;color:#0f766e}
  .foot{padding:16px 32px 24px;font-size:.8rem;color:#64748b;border-top:1px solid #e2e8f0}
  .badge{display:inline-block;padding:4px 10px;border-radius:999px;background:#ccfbf1;color:#115e59;font-size:.8rem;font-weight:600}
  @media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border:none}}
</style></head><body><div class="sheet">
  <div class="head">
    <div><h1>AsistOK</h1><div class="muted">${esc(issuer.legal_name || 'Servicio de control de asistencia')}</div></div>
    <div style="text-align:right"><div class="badge">${esc(inv.status)}</div>
      <div style="margin-top:8px;font-size:1.1rem;font-weight:700">${esc(num)}</div>
      <div class="muted">${esc(fecha)}</div></div>
  </div>
  <div class="body">
    <div class="grid">
      <div class="card"><h3>Emisor</h3>
        <p><strong>${esc(issuer.legal_name || 'AsistOK')}</strong></p>
        <p>${esc(issuer.tax_id || '')}</p>
        <p>${esc(issuer.address || '')}</p>
        <p>${esc(issuer.email || '')}</p>
      </div>
      <div class="card"><h3>Cliente</h3>
        <p><strong>${esc(profile?.legal_name || tenant?.name || '')}</strong></p>
        <p>${esc(profile?.tax_id || '')}</p>
        <p>${esc(profile?.address || '')} ${esc(profile?.zip || '')}</p>
        <p>${esc(profile?.email || '')}</p>
      </div>
    </div>
    <table><thead><tr><th>Detalle</th><th style="text-align:center">Cant.</th><th style="text-align:right">Unitario</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${inv.coupon_code ? `<p style="color:#64748b;font-size:.9rem">Cupón aplicado: <strong>${esc(inv.coupon_code)}</strong></p>` : ''}
    <div class="tot">
      ${inv.discount_cents ? `<div>Descuento: −${money(inv.discount_cents)}</div>` : ''}
      <div>Total: <strong>${money(inv.total_cents)}</strong></div>
    </div>
    ${inv.notes ? `<p style="margin-top:16px;color:#475569">${esc(inv.notes)}</p>` : ''}
  </div>
  <div class="foot">${esc(issuer.disclaimer || '')}</div>
</div></body></html>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Tras pago aprobado: auto-emite solo si flag + profile completo */
function onPaymentApproved(payment, userId = null) {
  if (!payment || !payment.tenant_id) return null;
  const st = billingStatus(payment.tenant_id);
  if (!st.module_enabled) return null;
  if (st.can_auto_issue) {
    return createInvoiceFromPayment({
      tenantId: payment.tenant_id,
      payment,
      source: 'auto',
      createdBy: userId,
    });
  }
  // Si el módulo está on pero faltan datos, deja pending_data para que el cliente complete y solicite
  if (st.module_enabled && !st.profile_complete) {
    return createInvoiceFromPayment({
      tenantId: payment.tenant_id,
      payment,
      source: 'auto',
      createdBy: userId,
      force: false,
    });
  }
  return null;
}

function couponStats(code) {
  const c = get('SELECT * FROM coupons WHERE code=?', code);
  if (!c) return null;
  const uses = all(
    `SELECT r.*, t.name tenant_name, t.slug tenant_slug
     FROM coupon_redemptions r
     LEFT JOIN tenants t ON t.id = r.tenant_id
     WHERE r.code=? ORDER BY r.created_at DESC LIMIT 500`, code
  );
  const unique = get('SELECT COUNT(DISTINCT tenant_id) n FROM coupon_redemptions WHERE code=? AND tenant_id IS NOT NULL', code)?.n || 0;
  const totalDisc = get('SELECT COALESCE(SUM(discount_cents),0) n FROM coupon_redemptions WHERE code=?', code)?.n || 0;
  const now = Date.now();
  let state = 'active';
  if (!c.active) state = 'paused';
  else if (c.expires_at && c.expires_at < now) state = 'expired';
  else if (c.max_uses != null && c.uses_count >= c.max_uses) state = 'exhausted';
  else if (c.starts_at && c.starts_at > now) state = 'scheduled';
  return {
    coupon: c,
    state,
    uses_count: c.uses_count || 0,
    unique_tenants: unique,
    total_discount_cents: totalDisc || c.total_discount_cents || 0,
    uses,
  };
}

function listCouponsAdmin(query = {}) {
  const rows = all('SELECT * FROM coupons ORDER BY code');
  const now = Date.now();
  return rows.map((c) => {
    const unique = get('SELECT COUNT(DISTINCT tenant_id) n FROM coupon_redemptions WHERE code=? AND tenant_id IS NOT NULL', c.code)?.n || 0;
    const totalDisc = get('SELECT COALESCE(SUM(discount_cents),0) n FROM coupon_redemptions WHERE code=?', c.code)?.n || 0;
    let state = 'active';
    if (!c.active) state = 'paused';
    else if (c.expires_at && c.expires_at < now) state = 'expired';
    else if (c.max_uses != null && (c.uses_count || 0) >= c.max_uses) state = 'exhausted';
    else if (c.starts_at && c.starts_at > now) state = 'scheduled';
    if (query.status && query.status !== 'all' && state !== query.status) return null;
    return {
      ...c,
      state,
      unique_tenants: unique,
      total_discount_cents: totalDisc || c.total_discount_cents || 0,
    };
  }).filter(Boolean);
}

module.exports = {
  BILLING_FLAG, AUTO_ISSUE_FLAG,
  flagGet, flagSet, issuerSettings,
  profileOf, missingProfileFields, isProfileComplete, billingStatus, upsertProfile,
  createInvoiceFromPayment, issueInvoice, markSent, voidInvoice, invoiceDetail, renderInvoiceHtml,
  onPaymentApproved, couponStats, listCouponsAdmin, nextInvoiceNumber,
};
