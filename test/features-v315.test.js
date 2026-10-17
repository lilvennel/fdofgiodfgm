
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-f-'));
const getPort = () => new Promise((r) => { const s = require('node:net').createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
let PORT, BASE, child;

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
    return { status: res.status, data };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b || {}); }
  patch(u, b) { return this.req('PATCH', u, b || {}); }
}

before(async () => {
  PORT = await getPort(); BASE = `http://localhost:${PORT}`;
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, DATA_DIR, PORT: String(PORT), APP_URL: BASE,
      ADMIN_EMAIL: 'root@test.com', ADMIN_PASSWORD: 'SuperClave-12345',
      ALLOW_DEMO_PAYMENTS: '1', NODE_ENV: 'development', REQUIRE_EMAIL_VERIFICATION: '0',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('servidor no arrancó');
});
after(() => { child?.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

async function registerActive(email) {
  const c = new Client();
  let r = await c.post('/api/auth/register', {
    business: 'Negocio ' + email.split('@')[0],
    email, password: 'Clave-segura-1', plan: 'sub', plan_tier: 'pro',
    accept_terms: true, accept_privacy: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await c.post('/api/pay/checkout', { kind: 'plan' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.demo);
  const ref = new URL(r.data.url).searchParams.get('demo_pay');
  r = await c.post('/api/pay/demo-confirm', { ref });
  assert.equal(r.status, 200);
  return c;
}

test('health API ok', async () => {
  const r = await fetch(BASE + '/api/health');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.db, 'up');
});

test('plantilla comercio aplica horarios', async () => {
  const c = await registerActive('tpl@test.com');
  let r = await c.get('/api/owner/industry-templates');
  assert.equal(r.status, 200);
  assert.ok(r.data.templates.comercio);
  r = await c.post('/api/owner/industry-template', { template: 'comercio' });
  assert.equal(r.status, 200);
  r = await c.get('/api/owner/settings');
  assert.equal(r.data.hpd, 8);
  assert.equal(r.data.schedule_start, '09:00');
  assert.equal(r.data.late_tolerance_min, 10);
});

test('export contable', async () => {
  const c = await registerActive('cont@test.com');
  const r = await c.get('/api/owner/reports?type=contable&period=2026-10');
  assert.equal(r.status, 200);
  assert.ok((r.data.columns || []).includes('Empleado'));
  assert.ok((r.data.columns || []).some((x) => /extra|Hs/i.test(x)));
});

test('dashboard rrhh', async () => {
  const c = await registerActive('rrhh2@test.com');
  const r = await c.get('/api/owner/dashboard?period=2026-10');
  assert.equal(r.status, 200);
  assert.ok(r.data.rrhh);
  assert.equal(typeof r.data.rrhh.late_total, 'number');
});

test('promover a encargado', async () => {
  const c = await registerActive('mgr@test.com');
  // branch + employee
  let r = await c.get('/api/owner/branches');
  assert.equal(r.status, 200);
  const branchId = r.data.branches[0]?.id;
  r = await c.post('/api/owner/employees', {
    name: 'Ana Encargada', email: 'ana-mgr@test.com', branch_id: branchId, cargo: 'Encargada',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const empId = r.data.id;
  r = await c.post('/api/owner/employees/' + empId + '/role', { role: 'manager' });
  assert.equal(r.status, 200);
  assert.equal(r.data.role, 'manager');
});

test('manager dashboard filtra equipo y no ve onboarding', async () => {
  const c = await registerActive('mgr2@test.com');
  let r = await c.get('/api/owner/branches');
  const branchId = r.data.branches[0]?.id;
  r = await c.post('/api/owner/employees', {
    name: 'Pedro Team', email: 'pedro-team@test.com', branch_id: branchId, cargo: 'Mozo',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const empId = r.data.id;
  r = await c.post('/api/owner/employees/' + empId + '/role', { role: 'manager' });
  assert.equal(r.status, 200);

  // login as manager
  const m = new Client();
  // need temp password from create - employee was created with temp; role is manager
  // owner resets password
  r = await c.post('/api/owner/employees/' + empId + '/reset-password', {});
  assert.equal(r.status, 200);
  const tmp = r.data.temp_password;
  r = await m.post('/api/auth/login', { email: 'pedro-team@test.com', password: tmp });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // must change password
  r = await m.post('/api/auth/password', { current: tmp, password: 'Mi-clave-nueva-9', accept_terms: true, accept_privacy: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // dashboard
  r = await m.get('/api/owner/dashboard?period=2026-10');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.is_manager, true);
  assert.equal(r.data.onboarding, null);
  assert.ok(r.data.manager_branch);
  assert.ok(Array.isArray(r.data.employees));
  // manager cannot erase
  r = await m.post('/api/owner/employees/' + empId + '/erase', { reason: 'test' });
  assert.ok(r.status === 403 || r.status === 400 || r.status === 404, 'erase blocked: ' + r.status);
  // manager cannot change settings
  r = await m.patch('/api/owner/settings', { theme: '#000000' });
  assert.equal(r.status, 403);
});
