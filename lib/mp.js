'use strict';
const crypto = require('node:crypto');
const cfg = require('./config');

const API = cfg.MP_API_URL;
const enabled = () => !!cfg.MP_ACCESS_TOKEN;

async function mp(path, { method = 'GET', body, idem } = {}) {
  const res = await fetch(API + path, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${cfg.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(idem ? { 'X-Idempotency-Key': idem } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Mercado Pago ${res.status}: ${data.message || data.error || text.slice(0, 200)}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

// Pago único (módulos, empleados extra, plan "pago único") -> Checkout Pro
const createPreference = ({ title, amount, extRef, email }) => mp('/checkout/preferences', {
  method: 'POST', idem: extRef,
  body: {
    items: [{ title, quantity: 1, unit_price: amount, currency_id: 'ARS' }],
    external_reference: extRef,
    payer: email ? { email } : undefined,
    notification_url: `${cfg.APP_URL}/api/mp/webhook`,
    back_urls: { success: `${cfg.APP_URL}/?pay=ok`, failure: `${cfg.APP_URL}/?pay=fail`, pending: `${cfg.APP_URL}/?pay=pending` },
    auto_return: 'approved',
    statement_descriptor: 'ASISTOK',
  },
});

// Suscripción mensual -> Preapproval
const createPreapproval = ({ reason, amount, extRef, email }) => mp('/preapproval', {
  method: 'POST', idem: extRef,
  body: {
    reason, external_reference: extRef, payer_email: email, status: 'pending',
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: amount, currency_id: 'ARS' },
    back_url: `${cfg.APP_URL}/?pay=ok`,
    notification_url: `${cfg.APP_URL}/api/mp/webhook`,
  },
});
const updatePreapprovalAmount = (id, amount) => mp(`/preapproval/${id}`, {
  method: 'PUT', body: { auto_recurring: { transaction_amount: amount, currency_id: 'ARS' } },
});
const cancelPreapproval = (id) => mp(`/preapproval/${id}`, { method: 'PUT', body: { status: 'cancelled' } });
const getPayment = (id) => mp(`/v1/payments/${encodeURIComponent(id)}`);
const getPreapproval = (id) => mp(`/preapproval/${encodeURIComponent(id)}`);
const getAuthorizedPayment = (id) => mp(`/authorized_payments/${encodeURIComponent(id)}`);

// Valida la firma x-signature de las notificaciones (si hay clave configurada)
function verifySignature(req, dataId) {
  if (!cfg.MP_WEBHOOK_SECRET) return !cfg.IS_PROD; // en producción exigimos la clave
  const sig = String(req.headers['x-signature'] || '');
  const reqId = String(req.headers['x-request-id'] || '');
  const parts = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=')));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId);
  const manifest = `id:${id};request-id:${reqId};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', cfg.MP_WEBHOOK_SECRET).update(manifest).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { enabled, createPreference, createPreapproval, updatePreapprovalAmount, cancelPreapproval, getPayment, getPreapproval, getAuthorizedPayment, verifySignature };
