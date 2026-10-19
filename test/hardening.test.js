'use strict';
// Regresiones de la auditoría v3.1.11: lista de empleados, cifrado en reposo, upgrade pagado, reseñas moderadas, admin.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-hard-'));
const getPort = () => new Promise((r) => { const s = require('node:net').createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
let BASE, child;
const ENV = { ASISTOK_SKIP_DOTENV: '1', NODE_ENV: 'development', REQUIRE_EMAIL_VERIFICATION: '0', ALLOW_DEMO_PAYMENTS: '1', ADMIN_EMAIL: 'root@test.com', ADMIN_PASSWORD: 'SuperClave-12345' };

class Client {
  constructor() { this.jar = {}; }
  async req(method, url, body) {
    const res = await fetch(BASE + url, { method, redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  get(u) { return this.req('GET', u); } post(u, b) { return this.req('POST', u, b || {}); } patch(u, b) { return this.req('PATCH', u, b || {}); }
}
before(async () => {
  const port = await getPort(); BASE = `http://localhost:${port}`;
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, ...ENV, DATA_DIR, PORT: String(port), APP_URL: BASE }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('El servidor no arrancó');
});
after(() => { child?.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

async function activeOwner(email, tier = 'esencial') {
  const c = new Client();
  let r = await c.post('/api/auth/register', { business: 'Neg ' + email.split('@')[0], email, password: 'Clave-segura-1', plan: 'sub', plan_tier: tier, accept_terms: true, accept_privacy: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await c.post('/api/pay/checkout', { kind: 'plan' });
  await c.post('/api/pay/demo-confirm', { ref: new URL(r.data.url).searchParams.get('demo_pay') });
  return c;
}
const rawUser = (email) => {
  const db = new DatabaseSync(path.join(DATA_DIR, 'asistok.db'), { readOnly: true });
  try { return db.prepare("SELECT * FROM users WHERE name=?").get(email); } finally { db.close(); }
};

test('la lista de empleados del dueño funciona y los datos sensibles quedan CIFRADOS en la base (alta y edición)', async () => {
  const o = await activeOwner('cifra@test.com');
  let r = await o.post('/api/owner/employees', { name: 'Ana Cifrada', email: 'ana@test.com', phone: '1122334455', dni: '30111222', blood_type: 'A+', obra_social: 'OSDE', notes: 'alergia penicilina' });
  assert.equal(r.status, 200);
  const id = r.data.id;
  let list = (await o.get('/api/owner/employees')).data.employees;
  assert.equal(list.length, 1);
  assert.equal(list[0].phone, '1122334455'); assert.equal(list[0].blood_type, 'A+'); assert.equal(list[0].email, 'ana@test.com');
  // edición por el dueño (antes se guardaba en claro)
  assert.equal((await o.patch(`/api/owner/employees/${id}`, { phone: '9988776655', address: 'Calle 123', dni: '40555666', blood_type: 'O-', obra_social: 'Swiss', notes: 'nota nueva', emg_name: 'Madre', emg_phone: '111' })).status, 200);
  const u = rawUser('Ana Cifrada');
  for (const k of ['phone', 'address', 'dni', 'blood_type', 'obra_social', 'notes', 'emg_name', 'emg_phone', 'email']) {
    assert.ok(String(u[k]).startsWith('enc:'), `${k} debería estar cifrado y es: ${u[k]}`);
  }
  list = (await o.get('/api/owner/employees')).data.employees;
  assert.equal(list[0].phone, '9988776655'); assert.equal(list[0].blood_type, 'O-'); assert.equal(list[0].address, 'Calle 123');
  // el empleado edita su perfil: también cifrado
  const t = (await o.post(`/api/owner/employees/${id}/reset-password`)).data.temp_password;
  const e = new Client();
  await e.post('/api/auth/login', { email: 'ana@test.com', password: t });
  await e.post('/api/auth/password', { current: t, password: 'Clave-nueva-123', accept_terms: true, accept_privacy: true });
  assert.equal((await e.patch('/api/me/profile', { blood_type: 'B+', obra_social: 'Galeno', phone: '555' })).status, 200);
  const u2 = rawUser('Ana Cifrada');
  assert.ok(u2.blood_type.startsWith('enc:') && u2.obra_social.startsWith('enc:') && u2.phone.startsWith('enc:'));
  assert.equal((await e.get('/api/auth/me')).data.user.blood_type, 'B+');
});

test('cambiar de plan NO es gratis: exige pagar la diferencia y recién ahí se activa', async () => {
  const o = await activeOwner('upg@test.com', 'esencial');
  let r = await o.post('/api/owner/plan/upgrade', { plan_tier: 'completo' });
  assert.equal(r.status, 402);
  assert.equal((await o.get('/api/auth/me')).data.tenant.plan_tier, 'esencial');
  r = await o.post('/api/pay/checkout', { kind: 'plan_upgrade', tier: 'completo' });
  assert.equal(r.status, 200);
  assert.equal(r.data.amount, 99999 - 39999); // diferencia Completo − Esencial (precios x999) // diferencia Completo − Esencial (mensual)
  assert.equal((await o.get('/api/auth/me')).data.tenant.plan_tier, 'esencial'); // todavía no pagó
  await o.post('/api/pay/demo-confirm', { ref: new URL(r.data.url).searchParams.get('demo_pay') });
  const me = (await o.get('/api/auth/me')).data.tenant;
  assert.equal(me.plan_tier, 'completo'); assert.equal(me.mod_suc, true); assert.equal(me.mod_rec, true);
  assert.equal((await o.post('/api/pay/checkout', { kind: 'plan_upgrade', tier: 'completo' })).status, 400); // ya lo tiene
});

test('las reseñas quedan pendientes de moderación y el admin ve emails descifrados', async () => {
  const o = await activeOwner('rev@test.com');
  assert.equal((await o.post('/api/owner/review', { stars: 5, text: 'Excelente servicio, muy práctico', author_name: 'Yo' })).status, 200);
  assert.equal((await new Client().get('/api/public/reviews')).data.reviews.length, 0);
  const admin = new Client();
  await admin.post('/api/auth/login', { email: 'root@test.com', password: 'SuperClave-12345' });
  const rv = (await admin.get('/api/admin/reviews')).data.reviews;
  assert.equal((await admin.post(`/api/admin/reviews/${rv[0].id}/approve`)).status, 200);
  assert.equal((await new Client().get('/api/public/reviews')).data.reviews.length, 1);
  const tenants = (await admin.get('/api/admin/tenants')).data.tenants;
  assert.ok(tenants.every((t) => !String(t.owner_email).startsWith('enc:')));
  assert.ok(tenants.some((t) => t.owner_email === 'rev@test.com'));
});

test('un encargado no puede tomar la cuenta de otro encargado ni editar otra sucursal', async () => {
  const o = await activeOwner('mgr@test.com', 'completo');
  const mk = async (name, email) => (await o.post('/api/owner/employees', { name, email })).data;
  const a = await mk('Enc A', 'a@mgr.com'), b = await mk('Enc B', 'b@mgr.com');
  for (const x of [a, b]) assert.equal((await o.post(`/api/owner/employees/${x.id}/role`, { role: 'manager' })).status, 200);
  const m = new Client();
  await m.post('/api/auth/login', { email: 'a@mgr.com', password: a.temp_password });
  await m.post('/api/auth/password', { current: a.temp_password, password: 'Clave-enc-123', accept_terms: true, accept_privacy: true });
  assert.equal((await m.post(`/api/owner/employees/${b.id}/reset-password`)).status, 403);
  const br = await o.post('/api/owner/branches', { name: 'Otra sucursal' });
  assert.equal((await m.patch(`/api/owner/branches/${br.data.id}`, { radius: 300 })).status, 403);
});

test('script de recuperación del Super Admin funciona con emails cifrados', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'reset-admin-password.js'), 'root@test.com'], { env: { ...process.env, ...ENV, DATA_DIR, ADMIN_PASSWORD: 'Otra-Clave-Larga-987' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Listo/);
});
