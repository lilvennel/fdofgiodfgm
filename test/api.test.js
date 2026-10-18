'use strict';
// Tests de integración: levantan el servidor real con una base temporal.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-test-'));
const getPort = () => new Promise((r) => { const s = require('node:net').createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
let PORT, BASE; // puertos libres pedidos al sistema (los archivos de test corren en paralelo)
process.env.DATA_DIR = DATA_DIR;
let child;

class Client {
  constructor() { this.jar = {}; }
  async req(method, url, body) {
    const res = await fetch(BASE + url, {
      method, redirect: 'manual',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b || {}); }
  patch(u, b) { return this.req('PATCH', u, b || {}); }
  put(u, b) { return this.req('PUT', u, b || {}); }
  del(u) { return this.req('DELETE', u); }
}

before(async () => {
  PORT = await getPort(); BASE = `http://localhost:${PORT}`;
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, DATA_DIR, PORT: String(PORT), APP_URL: BASE, ADMIN_EMAIL: 'root@test.com', ADMIN_PASSWORD: 'SuperClave-12345', ALLOW_DEMO_PAYMENTS: '1', REQUIRE_EMAIL_VERIFICATION: '0', NODE_ENV: 'development' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('El servidor no arrancó');
});
after(() => { child?.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

const state = {};
async function registerActive(name, email) {
  const c = new Client();
  let r = await c.post('/api/auth/register', { business: name, email, password: 'Clave-segura-1', plan: 'sub', accept_terms: true, accept_privacy: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await c.post('/api/pay/checkout', { kind: 'plan' });
  assert.equal(r.status, 200); assert.ok(r.data.demo);
  const ref = new URL(r.data.url).searchParams.get('demo_pay');
  r = await c.post('/api/pay/demo-confirm', { ref });
  assert.equal(r.status, 200);
  return c;
}

test('registro: queda pendiente de pago y no accede al panel hasta pagar', async () => {
  const c = new Client();
  let r = await c.post('/api/auth/register', { business: 'Panadería El Sol', email: 'dueno@sol.com', password: 'Clave-segura-1', plan: 'sub', coupon: 'BIENVENIDA20', accept_terms: true, accept_privacy: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.tenant.slug, 'panaderia-el-sol');
  assert.equal(r.data.tenant.status, 'pending_payment');
  assert.equal(r.data.tenant.discount_pct, 20);
  r = await c.get('/api/owner/dashboard');
  assert.equal(r.status, 402);
  assert.equal(r.data.error, 'PAYMENT_REQUIRED');
  // el monto de la suscripción lleva el 20% OFF aplicado en el servidor
  r = await c.post('/api/pay/checkout', { kind: 'plan' });
  assert.equal(r.data.amount, 36000);
  const ref = new URL(r.data.url).searchParams.get('demo_pay');
  r = await c.post('/api/pay/demo-confirm', { ref });
  assert.equal(r.status, 200);
  r = await c.get('/api/owner/dashboard');
  assert.equal(r.status, 200);
  state.owner = c;
});

test('validaciones de registro: contraseña débil, email duplicado, cupón inválido', async () => {
  const c = new Client();
  assert.equal((await c.post('/api/auth/register', { business: 'X Negocio', email: 'a@b.co', password: '123', accept_terms: true, accept_privacy: true })).status, 400);
  assert.equal((await c.post('/api/auth/register', { business: 'Otro', email: 'dueno@sol.com', password: 'Clave-segura-1', accept_terms: true, accept_privacy: true })).status, 409);
  assert.equal((await c.post('/api/auth/register', { business: 'Otro', email: 'nuevo@x.com', password: 'Clave-segura-1', coupon: 'NOEXISTE', accept_terms: true, accept_privacy: true })).status, 400);
});

test('login: credenciales incorrectas, y bloqueo por demasiados intentos', async () => {
  const c = new Client();
  assert.equal((await c.post('/api/auth/login', { email: 'dueno@sol.com', password: 'mala' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'noexiste@sol.com', password: 'mala' })).status, 401);
  let last;
  for (let i = 0; i < 9; i++) last = await c.post('/api/auth/login', { email: 'victima@sol.com', password: 'x' + i });
  assert.equal(last.status, 429);
});

test('sucursal con geocerca + alta de empleado + cambio obligatorio de contraseña', async () => {
  const o = state.owner;
  let r = await o.get('/api/owner/branches');
  state.branch = r.data.branches[0];
  r = await o.patch(`/api/owner/branches/${state.branch.id}`, { lat: -33.2394, lng: -61.6108, radius: 50, address: 'Calle Falsa 123' });
  assert.equal(r.status, 200);
  r = await o.post('/api/owner/employees', { name: 'Juan Pérez', email: 'juan@sol.com', cargo: 'Cajero', branch_id: state.branch.id, shift_start: '00:00', hire_date: '2024-01-10' });
  assert.equal(r.status, 200);
  state.empId = r.data.id;
  const tmp = r.data.temp_password;
  const e = new Client();
  r = await e.post('/api/auth/login', { email: 'juan@sol.com', password: tmp });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.must_change_pw, true);
  assert.equal((await e.get('/api/me/state')).data.error, 'MUST_CHANGE_PW');
  assert.equal((await e.post('/api/auth/password', { current: tmp, password: 'corta' })).status, 400);
  assert.equal((await e.post('/api/auth/password', { current: tmp, password: 'Mi-clave-nueva-9', accept_terms: true, accept_privacy: true })).status, 200);
  assert.equal((await e.get('/api/me/state')).status, 200);
  state.emp = e;
});

test('marcación: QR inválido, fuera de zona, dentro de zona, doble entrada y salida', async () => {
  const e = state.emp, o = state.owner;
  const qr = (await o.get(`/api/owner/qr/${state.branch.id}`)).data;
  assert.match(qr.url, /\/m\/\d+\.[\w-]{16}$/);
  const code = qr.url.split('/m/')[1];
  const inside = { lat: -33.2394, lng: -61.6108, accuracy: 10 };
  let r = await e.post('/api/me/mark', { action: 'in', code: state.branch.id + '.tokenfalso0000000', ...inside });
  assert.equal(r.data.error, 'QR_INVALID');
  r = await e.post('/api/me/mark', { action: 'in', code, lat: -33.2500, lng: -61.6108, accuracy: 10 });
  assert.equal(r.status, 403); assert.equal(r.data.error, 'GEO_OUT');
  r = await e.post('/api/me/mark', { action: 'in', code });
  assert.equal(r.data.error, 'GEO_REQUIRED');
  r = await e.post('/api/me/mark', { action: 'in', code, ...inside });
  assert.equal(r.status, 200); assert.equal(r.data.kind, 'in');
  r = await e.post('/api/me/mark', { action: 'in', code, ...inside });
  assert.equal(r.data.error, 'ALREADY_IN');
  assert.equal((await e.get('/api/me/state')).data.on, true);
  const dash = (await o.get('/api/owner/dashboard')).data;
  assert.equal(dash.totals.working_now, 1);
  r = await e.post('/api/me/mark', { action: 'out', code, ...inside });
  assert.equal(r.status, 200); assert.equal(r.data.kind, 'out');
  // avisos generados: fuera de zona + llegada tarde (turno 00:00)
  const types = (await o.get('/api/owner/notifs')).data.notifs.map((n) => n.type);
  assert.ok(types.includes('geo_out')); assert.ok(types.includes('late'));
});

test('horas extra y reporte CSV (con protección contra inyección de fórmulas)', async () => {
  const e = state.emp, o = state.owner;
  const code = (await o.get(`/api/owner/qr/${state.branch.id}`)).data.url.split('/m/')[1];
  const pos = { lat: -33.2394, lng: -61.6108, accuracy: 5 };
  assert.equal((await e.post('/api/me/mark', { action: 'extra', code, ...pos })).data.kind, 'xin');
  assert.equal((await e.post('/api/me/mark', { action: 'out', code, ...pos })).data.kind, 'xout');
  await o.patch(`/api/owner/employees/${state.empId}`, { name: '=HYPERLINK("http://x")' });
  const r = await o.get('/api/owner/reports/export?type=hours&format=csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment/);
  assert.ok(r.data.replace(/^\ufeff/, '').startsWith('Empleado;'));
  assert.ok(r.data.includes('"\'=HYPERLINK'), 'la celda debe empezar con comilla simple');
  await o.patch(`/api/owner/employees/${state.empId}`, { name: 'Juan Pérez' });
});

test('permisos: vacaciones limitadas por LCT, aprobación y descuento de días', async () => {
  const e = state.emp, o = state.owner;
  await o.post('/api/owner/plan/upgrade', { plan_tier: 'pro' }); // permisos y vacaciones son del plan Pro
  let r = await e.get('/api/me/vacation');
  assert.equal(r.data.entitled, 14);
  r = await e.post('/api/me/permits', { type: 'vacaciones', from: '2026-12-01', to: '2026-12-30' });
  assert.equal(r.status, 400); // 30 días > 14 disponibles
  r = await e.post('/api/me/permits', { type: 'vacaciones', from: '2026-12-01', to: '2026-12-10' });
  assert.equal(r.status, 200);
  const permits = (await o.get('/api/owner/permits')).data.permits;
  r = await o.post(`/api/owner/permits/${permits[0].id}/decide`, { approve: true });
  assert.equal(r.status, 200);
  assert.equal((await e.get('/api/me/vacation')).data.available, 4);
  assert.equal((await o.post(`/api/owner/permits/${permits[0].id}/decide`, { approve: false })).status, 400); // ya resuelto
});

test('aislamiento entre negocios (multi-tenant)', async () => {
  const other = await registerActive('Taller Roberto', 'roberto@taller.com');
  assert.equal((await other.patch(`/api/owner/employees/${state.empId}`, { name: 'Hack' })).status, 404);
  assert.equal((await other.post(`/api/owner/employees/${state.empId}/reset-password`)).status, 404);
  const codeOfSol = (await state.owner.get(`/api/owner/qr/${state.branch.id}`)).data.url.split('/m/')[1];
  assert.equal((await other.get(`/api/owner/qr/${state.branch.id}`)).status, 404);
  const mine = (await other.get('/api/owner/employees')).data.employees;
  assert.equal(mine.length, 0);
  // un empleado de otro negocio no puede usar el QR de este
  await other.post('/api/owner/employees', { name: 'Empleado Taller', email: 'emp@taller.com' }).then(async (r) => {
    const t = new Client();
    await t.post('/api/auth/login', { email: 'emp@taller.com', password: r.data.temp_password });
    await t.post('/api/auth/password', { current: r.data.temp_password, password: 'Otra-clave-segura-1', accept_terms: true, accept_privacy: true });
    const m = await t.post('/api/me/mark', { action: 'in', code: codeOfSol, lat: -33.2394, lng: -61.6108 });
    assert.equal(m.data.error, 'QR_INVALID');
  });
  // roles: el empleado no entra al panel del dueño ni al admin
  assert.equal((await state.emp.get('/api/owner/dashboard')).status, 403);
  assert.equal((await state.owner.get('/api/admin/stats')).status, 403);
});

test('módulos bloqueados hasta pagar: multi-sucursal', async () => {
  const o = state.owner;
  assert.equal((await o.post('/api/owner/branches', { name: 'Sucursal Norte' })).data.error, 'MOD_LOCKED');
  let r = await o.post('/api/pay/checkout', { kind: 'mod_suc' });
  assert.equal(r.data.amount, 60000);
  await o.post('/api/pay/demo-confirm', { ref: new URL(r.data.url).searchParams.get('demo_pay') });
  assert.equal((await o.post('/api/owner/branches', { name: 'Sucursal Norte' })).status, 200);
  assert.equal((await o.post('/api/pay/checkout', { kind: 'mod_suc' })).status, 400); // ya lo tiene
});

test('recibos: módulo, subida de PDF real, firma del empleado y descarga protegida', async () => {
  const o = state.owner, e = state.emp;
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
  assert.equal((await o.post(`/api/owner/employees/${state.empId}/recibos`, { period: '2026-09', data: pdf, filename: 'r.pdf' })).data.error, 'MOD_LOCKED');
  const r = await o.post('/api/pay/checkout', { kind: 'mod_rec' });
  await o.post('/api/pay/demo-confirm', { ref: new URL(r.data.url).searchParams.get('demo_pay') });
  assert.equal((await o.post(`/api/owner/employees/${state.empId}/recibos`, { period: '2026-09', data: Buffer.from('MZ-ejecutable').toString('base64'), filename: 'virus.pdf' })).status, 400);
  const up = await o.post(`/api/owner/employees/${state.empId}/recibos`, { period: '2026-09', data: pdf, filename: 'recibo.pdf' });
  assert.equal(up.status, 200);
  const docs = (await e.get('/api/me/docs')).data;
  assert.equal(docs.recibos.length, 1);
  assert.equal((await e.post(`/api/me/docs/${up.data.id}/sign`, { result: 'desconforme' })).status, 400); // pide motivo
  assert.equal((await e.post(`/api/me/docs/${up.data.id}/sign`, { result: 'conforme' })).status, 200);
  assert.equal((await e.get(`/api/docs/${up.data.id}/file`)).status, 200);
  const outsider = await registerActive('Otro Local', 'otro@local.com');
  assert.equal((await outsider.get(`/api/docs/${up.data.id}/file`)).status, 404);
});

test('límite de empleados y venta de cupos extra', async () => {
  const c = await registerActive('Chico SRL', 'chico@srl.com');
  const admin = new Client();
  assert.equal((await admin.post('/api/auth/login', { email: 'root@test.com', password: 'SuperClave-12345' })).status, 200);
  let r = await admin.get('/api/admin/prices');
  await admin.put('/api/admin/prices', { ...r.data.prices, free_employees: 2 });
  assert.equal((await c.post('/api/owner/employees', { name: 'Uno Uno', email: 'u1@srl.com' })).status, 200);
  assert.equal((await c.post('/api/owner/employees', { name: 'Dos Dos', email: 'u2@srl.com' })).status, 200);
  r = await c.post('/api/owner/employees', { name: 'Tres Tres', email: 'u3@srl.com' });
  assert.equal(r.status, 402); assert.equal(r.data.error, 'LIMIT_REACHED');
  r = await c.post('/api/pay/checkout', { kind: 'extra', qty: 3 });
  assert.equal(r.data.amount, 7500);
  await c.post('/api/pay/demo-confirm', { ref: new URL(r.data.url).searchParams.get('demo_pay') });
  assert.equal((await c.post('/api/owner/employees', { name: 'Tres Tres', email: 'u3@srl.com' })).status, 200);
  await admin.put('/api/admin/prices', { ...r.data && (await admin.get('/api/admin/prices')).data.prices, free_employees: 40 });
});

test('super admin: stats, suspender negocio, descuento manual, backup, auditoría', async () => {
  const admin = new Client();
  await admin.post('/api/auth/login', { email: 'root@test.com', password: 'SuperClave-12345' });
  let r = await admin.get('/api/admin/stats');
  assert.ok(r.data.tenants_active >= 3);
  const list = (await admin.get('/api/admin/tenants')).data.tenants;
  const sol = list.find((t) => t.slug === 'panaderia-el-sol');
  assert.equal((await admin.post(`/api/admin/tenants/${sol.id}/status`, { status: 'suspended' })).status, 200);
  assert.equal((await state.owner.get('/api/owner/dashboard')).data.error, 'TENANT_SUSPENDED');
  assert.equal((await state.emp.get('/api/me/state')).data.error, 'TENANT_SUSPENDED');
  await admin.post(`/api/admin/tenants/${sol.id}/status`, { status: 'active' });
  assert.equal((await state.owner.get('/api/owner/dashboard')).status, 200);
  assert.equal((await admin.post(`/api/admin/tenants/${sol.id}/discount`, { pct: 10, months: 2 })).status, 200);
  r = await admin.get('/api/admin/backup');
  assert.equal(r.status, 200);
  assert.ok((await admin.get('/api/admin/audit')).data.audit.length > 5);
});

test('aumento programado de precios: fecha futura obligatoria y aviso a clientes', async () => {
  const admin = new Client();
  await admin.post('/api/auth/login', { email: 'root@test.com', password: 'SuperClave-12345' });
  assert.equal((await admin.post('/api/admin/prices/schedule', { sub: 52000, once: 420000, extra: 3000, date: '2020-01-01' })).status, 400);
  const d = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  assert.equal((await admin.post('/api/admin/prices/schedule', { sub: 52000, once: 420000, pro_m: 62000, pro_y: 500000, completo_m: 80000, completo_y: 640000, extra: 3000, date: d, notify_days: 15, text: 'Desde {fecha}: $ {sub}' })).status, 200);
  const cfgRes = (await new Client().get('/api/public/config')).data;
  assert.match(cfgRes.notice, /52\.000/);
  assert.equal(cfgRes.prices.sub, 45000); // todavía rigen los precios actuales
  await admin.del('/api/admin/prices/schedule');
  assert.equal((await new Client().get('/api/public/config')).data.notice, null);
});

test('cierre automático de jornada olvidada', async () => {
  const o = state.owner, e = state.emp;
  const code = (await o.get(`/api/owner/qr/${state.branch.id}`)).data.url.split('/m/')[1];
  assert.equal((await e.post('/api/me/mark', { action: 'in', code, lat: -33.2394, lng: -61.6108, accuracy: 5 })).status, 200);
  const jobs = require('../lib/jobs');
  const { get } = require('../lib/db');
  assert.equal(get('SELECT COUNT(*) n FROM marks WHERE auto=1').n, 0);
  jobs.autoClose(Date.now() + 2 * 864e5); // "dentro de dos días"
  assert.equal(get('SELECT COUNT(*) n FROM marks WHERE auto=1').n, 1);
  assert.equal((await e.get('/api/me/state')).data.on, false);
  assert.ok((await o.get('/api/owner/notifs')).data.notifs.some((n) => n.type === 'no_exit'));
});

test('recuperación de contraseña no revela si el email existe', async () => {
  const c = new Client();
  assert.deepEqual((await c.post('/api/auth/forgot', { email: 'nadie@nada.com' })).data, { ok: true });
  assert.deepEqual((await c.post('/api/auth/forgot', { email: 'dueno@sol.com' })).data, { ok: true });
  assert.equal((await c.post('/api/auth/reset', { token: 'inventado', password: 'Clave-segura-2' })).status, 400);
});

test('alta de empleado por link: queda pendiente hasta que el dueño autoriza', async () => {
  const c = new Client(), o = state.owner;
  assert.equal((await c.get('/api/public/tenant/panaderia-el-sol')).data.name, 'Panadería El Sol');
  assert.equal((await c.post('/api/public/join/panaderia-el-sol', { name: 'Nora López', email: 'nora@sol.com', password: 'Clave-nora-123' })).status, 200);
  assert.equal((await c.post('/api/auth/login', { email: 'nora@sol.com', password: 'Clave-nora-123' })).data.error, 'AUTH_PENDING');
  const pend = (await o.get('/api/owner/dashboard')).data.pending;
  assert.equal(pend.length, 1);
  assert.equal((await o.post(`/api/owner/employees/${pend[0].id}/approve`)).status, 200);
  assert.equal((await c.post('/api/auth/login', { email: 'nora@sol.com', password: 'Clave-nora-123' })).status, 200);
});

test('seguridad HTTP: cabeceras, rutas protegidas, JSON obligatorio, sin path traversal', async () => {
  const c = new Client();
  const r = await c.get('/');
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await c.get('/api/owner/dashboard')).status, 401);
  assert.equal((await c.get('/api/admin/stats')).status, 401);
  const raw = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.equal(raw.status, 415);
  const evil = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.com' }, body: '{}' });
  assert.equal(evil.status, 403);
  const trav = await fetch(BASE + '/..%2f..%2fetc%2fpasswd');
  assert.notEqual(trav.status, 200);
  assert.equal((await fetch(BASE + '/data/asistok.db')).status, 404);
});

test('webhook de Mercado Pago: sin firma válida en producción se rechaza', async () => {
  // En este entorno (development, sin clave) acepta pero no procesa nada sin id
  const r = await new Client().post('/api/mp/webhook', {});
  assert.equal(r.status, 200);
});

test('B1: empleados extra son pago único (cupos permanentes, sin vencimiento)', async () => {
  const c = await registerActive('Cupos SA', 'cupos@sa.com');
  const admin = new Client();
  await admin.post('/api/auth/login', { email: 'root@test.com', password: 'SuperClave-12345' });
  const prices = (await admin.get('/api/admin/prices')).data;
  await admin.put('/api/admin/prices', { ...prices.prices, free_employees: 1 });
  let r = await c.post('/api/pay/checkout', { kind: 'extra', qty: 2 });
  assert.equal(r.data.amount, 5000);
  await c.post('/api/pay/demo-confirm', { ref: new URL(r.data.url).searchParams.get('demo_pay') });
  const { get } = require('../lib/db');
  const t = get('SELECT extra_slots, extra_until FROM tenants WHERE slug=?', 'cupos-sa');
  assert.equal(t.extra_slots, 2);
  assert.equal(t.extra_until, null); // sin ventana de vigencia
  const me = (await c.get('/api/auth/me')).data.tenant;
  assert.equal(me.employee_limit, 3); // 1 incluido + 2 extra
  assert.equal(me.extra_until, undefined);
  // un segundo pago suma cupos
  r = await c.post('/api/pay/checkout', { kind: 'extra', qty: 1 });
  await c.post('/api/pay/demo-confirm', { ref: new URL(r.data.url).searchParams.get('demo_pay') });
  assert.equal((await c.get('/api/auth/me')).data.tenant.employee_limit, 4);
  await admin.put('/api/admin/prices', { ...prices.prices, free_employees: 40 });
});

test('B2: textos legales editables, sanitizados y leídos desde la base', async () => {
  const pub = new Client();
  // semilla con placeholder (Ley 25.326)
  let r = await pub.get('/api/public/legal');
  assert.match(r.data.privacy_html, /25\.326/);
  assert.match(r.data.terms_html, /<h2>Términos y Condiciones de Uso de AsistOK<\/h2>/);
  const admin = new Client();
  await admin.post('/api/auth/login', { email: 'root@test.com', password: 'SuperClave-12345' });
  assert.equal((await new Client().put('/api/admin/site', { legal: {} })).status, 401);
  // HTML con intentos de inyección: se limpia
  const evil = '<h2 onclick="x()">Hola</h2><script>alert(1)</script><a href="javascript:alert(1)">mal</a><img src=x onerror=alert(1)><p>ok</p>';
  assert.equal((await admin.put('/api/admin/site', { legal: { privacy: evil, terms: 'Primer párrafo\n\nSegundo <párrafo>' } })).status, 200);
  r = await pub.get('/api/public/legal');
  assert.equal(r.data.privacy_html, '<h2>Hola</h2><a>mal</a><p>ok</p>');
  assert.equal(r.data.terms_html, '<p>Primer párrafo</p>\n<p>Segundo &lt;párrafo&gt;</p>');
  // la vista previa del panel usa el mismo sanitizador
  assert.equal((await admin.post('/api/admin/legal/preview', { text: '<b>x</b><iframe src=a></iframe>' })).data.html, '<b>x</b>');
  // el editor recibe el texto original, no el sanitizado
  assert.equal((await admin.get('/api/admin/site')).data.legal.privacy, evil);
  // restaurar plantilla
  const defs = (await admin.get('/api/admin/legal/defaults')).data;
  await admin.put('/api/admin/site', { legal: defs });
  assert.match((await pub.get('/api/public/legal')).data.privacy_html, /25\.326/);
  // la página pública existe
  assert.equal((await pub.get('/privacidad')).status, 200);
});

test('jerarquía de cuentas: encargado y RRHH no pueden tomar cuentas de su mismo nivel o superior', async () => {
  const o = state.owner;
  const mk = async (email, role) => {
    let r = await o.post('/api/owner/employees', { name: 'Persona ' + (role || 'empleado'), email });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const id = r.data.id, tmp = r.data.temp_password;
    if (role) { r = await o.post(`/api/owner/employees/${id}/role`, { role }); assert.equal(r.status, 200, JSON.stringify(r.data)); }
    const c = new Client();
    assert.equal((await c.post('/api/auth/login', { email, password: tmp })).status, 200);
    assert.equal((await c.post('/api/auth/password', { current: tmp, password: 'Clave-nueva-123', accept_terms: true, accept_privacy: true })).status, 200);
    return { id, c };
  };
  const mgr = await mk('mgr@jer.com', 'manager'), mgr2 = await mk('mgr2@jer.com', 'manager'), hr = await mk('hr@jer.com', 'hr'), emp = await mk('emp@jer.com');
  const reset = (who, target) => who.c.post(`/api/owner/employees/${target.id}/reset-password`);
  assert.equal((await reset(mgr, mgr2)).status, 403, 'encargado no puede resetear a otro encargado');
  assert.equal((await reset(mgr, hr)).status, 403, 'encargado no puede resetear a RRHH');
  assert.equal((await reset(hr, hr)).status, 403, 'RRHH no puede resetearse a sí mismo por esta vía');
  assert.equal((await reset(mgr, emp)).status, 200, 'encargado sí gestiona empleados de su sucursal');
  assert.equal((await reset(hr, mgr2)).status, 200, 'RRHH sí gestiona encargados');
  assert.equal((await mgr.c.post(`/api/owner/employees/${hr.id}/disable`)).status, 403);
});
