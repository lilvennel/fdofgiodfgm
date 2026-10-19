'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asistok-bill-'));
process.env.ASISTOK_SKIP_DOTENV = '1';
process.env.DATA_DIR = dataDir;
process.env.SECRET = 'test-secret-32-chars-minimum-ok!!';
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_PAYMENTS = '1';
process.env.REQUIRE_EMAIL_VERIFICATION = '0';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'Clave-super-segura-99';

const { get, all, run } = require('../lib/db');
const dom = require('../lib/domain');
const billing = require('../lib/billing');
const sec = require('../lib/security');

before(() => {
  // seed already runs on domain require via seed in server - call seed
  dom.seed();
});

after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('cupón válido aplica; inválido/vencido/agotado no', () => {
  run(`INSERT OR REPLACE INTO coupons(code,pct,months,scope,active,max_uses,uses_count,expires_at) VALUES('TESTOK',20,1,'new',1,10,0,NULL)`);
  run(`INSERT OR REPLACE INTO coupons(code,pct,months,scope,active,max_uses,uses_count,expires_at) VALUES('VENCIDO',10,1,'new',1,10,0,?)`, Date.now() - 1000);
  run(`INSERT OR REPLACE INTO coupons(code,pct,months,scope,active,max_uses,uses_count,expires_at) VALUES('AGOTADO',10,1,'new',1,1,1,NULL)`);
  run(`INSERT OR REPLACE INTO coupons(code,pct,months,scope,active,max_uses,uses_count) VALUES('OFF',10,1,'new',0,10,0)`);

  assert.ok(dom.findCoupon('TESTOK', 'new', 'a@b.com', 'sub', 'esencial'));
  assert.equal(dom.findCoupon('VENCIDO', 'new'), null);
  assert.equal(dom.findCoupon('AGOTADO', 'new'), null);
  assert.equal(dom.findCoupon('OFF', 'new'), null);
  assert.equal(dom.findCoupon('NOEXISTE', 'new'), null);
});

test('consumeCoupon incrementa usos y registra redemption', () => {
  run(`INSERT OR REPLACE INTO coupons(code,pct,months,scope,active,max_uses,uses_count) VALUES('USEME',15,1,'new',1,5,0)`);
  dom.consumeCoupon('USEME', 'user@example.com', 1, { context: 'register', discount_cents: 150000 });
  const c = get('SELECT uses_count, total_discount_cents FROM coupons WHERE code=?', 'USEME');
  assert.equal(c.uses_count, 1);
  assert.ok((c.total_discount_cents || 0) >= 150000);
  const r = get('SELECT * FROM coupon_redemptions WHERE code=?', 'USEME');
  assert.ok(r);
});

test('feature flag bloquea auto-factura; force la crea', () => {
  billing.flagSet(billing.BILLING_FLAG, false);
  const t = run(`INSERT INTO tenants(slug,name,plan,status,created_at) VALUES('t-bill','Bill Co','sub','active',?)`, Date.now());
  const tid = Number(t.lastInsertRowid);
  const pay = run(`INSERT INTO payments(tenant_id,kind,amount,status,ext_ref,created_at) VALUES(?,?,?,?,?,?)`,
    tid, 'plan_sub', 39999, 'approved', 'ext-1', Date.now());
  const payment = get('SELECT * FROM payments WHERE id=?', Number(pay.lastInsertRowid));

  const blocked = billing.createInvoiceFromPayment({ tenantId: tid, payment, source: 'auto' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'BILLING_DISABLED');

  const forced = billing.createInvoiceFromPayment({ tenantId: tid, payment, source: 'manual', force: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.status, 'issued');
});

test('factura pending_data si faltan datos fiscales', () => {
  billing.flagSet(billing.BILLING_FLAG, true);
  billing.flagSet(billing.AUTO_ISSUE_FLAG, true);
  const t = run(`INSERT INTO tenants(slug,name,plan,status,created_at) VALUES('t-pend','Pend Co','sub','active',?)`, Date.now());
  const tid = Number(t.lastInsertRowid);
  const pay = run(`INSERT INTO payments(tenant_id,kind,amount,status,ext_ref,created_at) VALUES(?,?,?,?,?,?)`,
    tid, 'plan_sub', 10000, 'approved', 'ext-2', Date.now());
  const payment = get('SELECT * FROM payments WHERE id=?', Number(pay.lastInsertRowid));

  const r = billing.createInvoiceFromPayment({ tenantId: tid, payment, source: 'auto' });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'pending_data');
});

test('factura issued si profile completo y flag on', () => {
  billing.flagSet(billing.BILLING_FLAG, true);
  const t = run(`INSERT INTO tenants(slug,name,plan,status,created_at) VALUES('t-ok','Ok Co','sub','active',?)`, Date.now());
  const tid = Number(t.lastInsertRowid);
  billing.upsertProfile(tid, {
    legal_name: 'Ok Co SA', tax_id: '30-12345678-9', address: 'Calle 1', zip: '1000',
    email: 'fact@ok.com', person_type: 'juridica', tax_condition: 'RI', doc_type: 'recibo', city: 'CABA',
  });
  assert.ok(billing.billingStatus(tid).profile_complete);
  const pay = run(`INSERT INTO payments(tenant_id,kind,amount,status,ext_ref,created_at) VALUES(?,?,?,?,?,?)`,
    tid, 'extra', 2499, 'approved', 'ext-3', Date.now());
  const payment = get('SELECT * FROM payments WHERE id=?', Number(pay.lastInsertRowid));
  const r = billing.createInvoiceFromPayment({ tenantId: tid, payment, source: 'client_request' });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'issued');
  const d = billing.invoiceDetail(r.id);
  assert.ok(d.items.length >= 1);
  const html = billing.renderInvoiceHtml(d);
  assert.match(html, /AsistOK/);
});

test('listCouponsAdmin expone métricas', () => {
  const list = billing.listCouponsAdmin({});
  assert.ok(Array.isArray(list));
  const one = list.find((c) => c.code === 'USEME');
  assert.ok(one);
  assert.ok('unique_tenants' in one);
  assert.ok('total_discount_cents' in one);
  assert.ok('state' in one);
});

test('precios default terminan en 999 y extra 2499', () => {
  const p = dom.getPrices();
  assert.equal(p.extra, 2499);
  assert.equal(p.esencial_m % 1000, 999);
  assert.equal(dom.employeeLimit({ extra_slots: 0 }), 40);
});


test('idempotencia: mismo payment_id no duplica factura', () => {
  billing.flagSet(billing.BILLING_FLAG, true);
  const t = run(`INSERT INTO tenants(slug,name,plan,status,created_at) VALUES('t-idemp','Idemp','sub','active',?)`, Date.now());
  const tid = Number(t.lastInsertRowid);
  billing.upsertProfile(tid, {
    legal_name: 'Idemp SA', tax_id: '30-11111111-1', address: 'Calle 2', zip: '2000',
    email: 'i@x.com', person_type: 'juridica', tax_condition: 'RI', doc_type: 'recibo',
  });
  const pay = run(`INSERT INTO payments(tenant_id,kind,amount,status,ext_ref,created_at) VALUES(?,?,?,?,?,?)`,
    tid, 'plan_sub', 1000, 'approved', 'ext-idemp', Date.now());
  const payment = get('SELECT * FROM payments WHERE id=?', Number(pay.lastInsertRowid));
  const a = billing.createInvoiceFromPayment({ tenantId: tid, payment, source: 'auto' });
  const b = billing.createInvoiceFromPayment({ tenantId: tid, payment, source: 'auto' });
  assert.equal(a.id, b.id);
  assert.equal(b.existing, true);
  assert.equal(get('SELECT COUNT(*) n FROM invoices WHERE payment_id=?', payment.id).n, 1);
});
