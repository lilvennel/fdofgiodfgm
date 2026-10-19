'use strict';
// v3.1.13: backup sin SECRET al lado, escucha solo en local por defecto.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-h3113-'));
process.env.DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'development';
let child;
after(() => { child?.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

test('backup: no deja una copia del SECRET junto a las bases y borra la de versiones anteriores', () => {
  fs.writeFileSync(path.join(DATA_DIR, '.secret'), 'x'.repeat(96));
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'asistok.secret.bak'), 'copia vieja');
  const backup = require('../lib/backup');
  const r = backup.runBackup('manual');
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(path.join(dir, 'asistok.secret.bak')), false);
  assert.match(fs.readFileSync(path.join(dir, 'SECRET-README.txt'), 'utf8'), /NO incluye el SECRET/);
  assert.ok(fs.readdirSync(dir).every((f) => !f.includes('secret.bak')));
});

test('HOST: por defecto escucha en 127.0.0.1 y responde /healthz', async () => {
  const cfg = require('../lib/config');
  assert.equal(cfg.HOST, '127.0.0.1');
  const port = await new Promise((r) => { const s = require('node:net').createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-h3113b-'));
  const env = { ...process.env, DATA_DIR: dir2, PORT: String(port), APP_URL: `http://localhost:${port}`, ADMIN_EMAIL: 'root@test.com', ADMIN_PASSWORD: 'SuperClave-12345', REQUIRE_EMAIL_VERIFICATION: '0' };
  delete env.HOST;
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: 'ignore' });
  let ok = false;
  for (let i = 0; i < 50 && !ok; i++) { try { ok = (await fetch(`http://127.0.0.1:${port}/healthz`)).ok; } catch {} if (!ok) await new Promise((r) => setTimeout(r, 150)); }
  fs.rmSync(dir2, { recursive: true, force: true });
  assert.ok(ok, 'el servidor no respondió en 127.0.0.1');
});
