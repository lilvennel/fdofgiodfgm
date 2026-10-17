'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

// Migrar nombre de base: asistenciapro.db → asistok.db (una sola vez)
(function ensureDbName() {
  const neu = path.join(cfg.DATA_DIR, 'asistok.db');
  const old = path.join(cfg.DATA_DIR, 'asistenciapro.db');
  if (!fs.existsSync(neu) && fs.existsSync(old)) {
    try {
      fs.renameSync(old, neu);
      for (const s of ['-wal', '-shm', '-journal']) {
        if (fs.existsSync(old + s) && !fs.existsSync(neu + s)) fs.renameSync(old + s, neu + s);
      }
      console.log('[db] Renombrada asistenciapro.db → asistok.db');
    } catch (e) { console.error('[db] No se pudo renombrar la base:', e.message); }
  }
})();
const db = new DatabaseSync(path.join(cfg.DATA_DIR, 'asistok.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const cache = new Map();
const stmt = (sql) => {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
};
const get = (sql, ...p) => stmt(sql).get(...p);
const all = (sql, ...p) => stmt(sql).all(...p);
const run = (sql, ...p) => stmt(sql).run(...p);
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

const MIGRATIONS = [
`
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE tenants (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'sub',               -- sub | once
  status TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment | active | past_due | suspended
  created_at INTEGER NOT NULL,
  paid_until INTEGER,
  mp_preapproval_id TEXT,
  mod_suc INTEGER NOT NULL DEFAULT 0,
  mod_rec INTEGER NOT NULL DEFAULT 0,
  extra_slots INTEGER NOT NULL DEFAULT 0,
  extra_until INTEGER,
  discount_pct INTEGER NOT NULL DEFAULT 0,
  discount_months INTEGER NOT NULL DEFAULT 0,
  coupon TEXT,
  theme TEXT NOT NULL DEFAULT '#0f766e',
  auto_close_hour INTEGER NOT NULL DEFAULT 23,
  late_tolerance_min INTEGER NOT NULL DEFAULT 10,
  allow_extra INTEGER NOT NULL DEFAULT 1,
  hpd INTEGER NOT NULL DEFAULT 8,
  dpw INTEGER NOT NULL DEFAULT 5,
  sat_h INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  email_hash TEXT,

  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL,                            -- superadmin | owner | employee
  status TEXT NOT NULL DEFAULT 'active',         -- active | pending | rejected | disabled
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  cargo TEXT, branch_id INTEGER, phone TEXT, address TEXT, birthday TEXT, hire_date TEXT,
  shift_start TEXT, emg_name TEXT, emg_rel TEXT, emg_phone TEXT,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE INDEX idx_users_tenant ON users(tenant_id, role, status);

CREATE TABLE branches (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, address TEXT,
  lat REAL, lng REAL, radius INTEGER NOT NULL DEFAULT 50
);
CREATE INDEX idx_branches_tenant ON branches(tenant_id);

CREATE TABLE marks (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id INTEGER,
  kind TEXT NOT NULL,                            -- in | out | xin | xout
  ts INTEGER NOT NULL,
  lat REAL, lng REAL, accuracy REAL, dist REAL,
  auto INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_marks_user_ts ON marks(user_id, ts);
CREATE INDEX idx_marks_tenant_ts ON marks(tenant_id, ts);

CREATE TABLE notifs (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                            -- late | no_exit | geo_out | permit | auth
  user_id INTEGER, ref_id INTEGER,
  text TEXT NOT NULL, detail TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX idx_notifs_tenant ON notifs(tenant_id, resolved_at);

CREATE TABLE permits (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, from_date TEXT NOT NULL, to_date TEXT NOT NULL, note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | approved | rejected
  created_at INTEGER NOT NULL, decided_at INTEGER
);
CREATE INDEX idx_permits_user ON permits(user_id);

CREATE TABLE docs (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                            -- cert | recibo
  title TEXT NOT NULL, period TEXT, cert_type TEXT,
  filename TEXT NOT NULL, mime TEXT NOT NULL, path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sign_status TEXT,                              -- recibos: pending | conforme | desconforme
  sign_note TEXT, signed_at INTEGER
);
CREATE INDEX idx_docs_user ON docs(user_id, kind);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                            -- plan | extra | mod_suc | mod_rec
  qty INTEGER NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | approved | rejected | refunded
  ext_ref TEXT NOT NULL UNIQUE,
  mp_pref_id TEXT, mp_payment_id TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL, applied_at INTEGER
);
CREATE INDEX idx_payments_tenant ON payments(tenant_id);

CREATE TABLE coupons (
  code TEXT PRIMARY KEY, pct INTEGER NOT NULL, months INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT 'new', active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE holidays (
  date TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'feriado'
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE resets (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, user_id INTEGER, tenant_id INTEGER,
  action TEXT NOT NULL, detail TEXT
);
`,
`ALTER TABLE holidays ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';`,
`
ALTER TABLE tenants ADD COLUMN onboarding TEXT NOT NULL DEFAULT '{}';
ALTER TABLE notifs ADD COLUMN read_at INTEGER;

CREATE TABLE security_events (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER, kind TEXT NOT NULL,           -- geo_out | qr_invalid | geo_missing
  detail TEXT, ts INTEGER NOT NULL
);
CREATE INDEX idx_sec_tenant ON security_events(tenant_id, ts);

CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  role TEXT NOT NULL, kind TEXT NOT NULL,        -- problem | idea
  subject TEXT NOT NULL, body TEXT NOT NULL, page_context TEXT,
  status TEXT NOT NULL DEFAULT 'new',            -- new | in_progress | done | dismissed
  admin_note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER
);
CREATE INDEX idx_feedback_status ON feedback(status, created_at);

CREATE TABLE changelog (
  id INTEGER PRIMARY KEY, version TEXT NOT NULL, date TEXT NOT NULL,
  added TEXT, changed TEXT, removed TEXT, created_at INTEGER NOT NULL
);
`,
`
CREATE TABLE display_links (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                       -- fixed (pantalla del local) | shift (encargado, un solo uso)
  label TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  duration_ms INTEGER,                      -- shift: cuánto dura desde que se abre
  claim_by INTEGER NOT NULL,                -- si nadie lo abre antes de esta fecha, vence
  require_gps INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER, created_at INTEGER NOT NULL,
  claimed_at INTEGER, expires_at INTEGER,   -- expires_at: fin de la jornada (shift) o NULL (fixed)
  device_hash TEXT,                         -- hash del secreto guardado en el primer dispositivo que lo abrió
  last_seen_at INTEGER, last_dist REAL,
  revoked_at INTEGER
);
CREATE INDEX idx_display_tenant ON display_links(tenant_id, revoked_at);
`,
`ALTER TABLE marks ADD COLUMN source TEXT NOT NULL DEFAULT 'qr';   -- qr | panel | manual | auto
ALTER TABLE marks ADD COLUMN note TEXT;
ALTER TABLE marks ADD COLUMN created_by INTEGER;
`,
`ALTER TABLE users ADD COLUMN dni TEXT;
ALTER TABLE users ADD COLUMN personal_email TEXT;
ALTER TABLE users ADD COLUMN blood_type TEXT;
ALTER TABLE users ADD COLUMN obra_social TEXT;
ALTER TABLE users ADD COLUMN notes TEXT;
ALTER TABLE tenants ADD COLUMN cancel_at INTEGER;
`,
`ALTER TABLE tenants ADD COLUMN plan_tier TEXT NOT NULL DEFAULT 'esencial';
`,
`ALTER TABLE tenants ADD COLUMN schedule_start TEXT;
ALTER TABLE tenants ADD COLUMN schedule_end TEXT;
`,
`ALTER TABLE tenants ADD COLUMN logo_path TEXT;
ALTER TABLE tenants ADD COLUMN sign_path TEXT;
ALTER TABLE docs ADD COLUMN signed_name TEXT;
`,
// H1: eventos de Mercado Pago ya procesados (idempotencia de cobros recurrentes)
`CREATE TABLE mp_events (
  ext_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_mp_events_tenant ON mp_events(tenant_id);
`,
// H2: confirmación de email (token de un solo uso, guardado hasheado)
`ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
CREATE TABLE email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_email_verifications_user ON email_verifications(user_id);
UPDATE users SET email_verified_at = created_at WHERE role = 'superadmin';
`,
`ALTER TABLE coupons ADD COLUMN max_uses INTEGER;
ALTER TABLE coupons ADD COLUMN uses_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coupons ADD COLUMN expires_at INTEGER;
ALTER TABLE tenants ADD COLUMN mark_qr INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN mark_gps INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL,
  text TEXT NOT NULL,
  author_name TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  email TEXT NOT NULL,
  tenant_id INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(code, email)
);
`,
`CREATE TABLE IF NOT EXISTS emp_requests (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reply TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
`ALTER TABLE users ADD COLUMN email_hash TEXT;`,

  `ALTER TABLE users ADD COLUMN legal_accepted_at INTEGER;`,

  `ALTER TABLE coupons ADD COLUMN duration_n INTEGER;`,
  `ALTER TABLE coupons ADD COLUMN duration_unit TEXT;`,
  `ALTER TABLE coupons ADD COLUMN starts_at INTEGER;`,
  `ALTER TABLE coupons ADD COLUMN note TEXT;`,
  `ALTER TABLE coupons ADD COLUMN applies_to TEXT;`,
  `ALTER TABLE coupons ADD COLUMN per_email_once INTEGER NOT NULL DEFAULT 1;`,
  `ALTER TABLE tenants ADD COLUMN discount_until INTEGER;`,

  `ALTER TABLE coupons ADD COLUMN plan_tiers TEXT;`,

];

function columnExists(table, col) {
  try {
    return all(`PRAGMA table_info(${table})`).some((r) => r.name === col);
  } catch { return false; }
}

/** Ejecuta SQL de migración tolerando columnas/tablas ya existentes (reintentos / esquemas mixtos). */
function execMigrationSql(sql) {
  // Parte por ; al final de línea para no romper triggers complejos (no los usamos)
  const parts = String(sql).split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
  for (let stmt of parts) {
    if (!stmt.endsWith(';')) stmt += ';';
    try {
      db.exec(stmt);
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/duplicate column name/i.test(msg)) continue;
      if (/already exists/i.test(msg)) continue;
      throw e;
    }
  }
}

function migrate() {
  let v = get('PRAGMA user_version').user_version;
  while (v < MIGRATIONS.length) {
    tx(() => {
      execMigrationSql(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
    v++;
  }
}
migrate();

// H8: la base y sus archivos auxiliares (-wal/-shm), las carpetas de datos y los archivos subidos solo los lee el usuario de la app
function hardenPermissions({ deep = false } = {}) {
  const chmod = (p, mode) => { try { fs.chmodSync(p, mode); } catch { /* volumen ajeno o Windows: se sigue */ } };
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { chmod(p, 0o700); walk(p); } else if (e.isFile()) chmod(p, 0o600);
    }
  };
  chmod(cfg.DATA_DIR, 0o700);
  const base = path.join(cfg.DATA_DIR, 'asistok.db');
  for (const s of ['', '-wal', '-shm', '-journal']) if (fs.existsSync(base + s)) chmod(base + s, 0o600);
  if (fs.existsSync(path.join(cfg.DATA_DIR, '.secret'))) chmod(path.join(cfg.DATA_DIR, '.secret'), 0o600);
  if (deep) for (const d of ['uploads', 'backups']) { const p = path.join(cfg.DATA_DIR, d); if (fs.existsSync(p)) { chmod(p, 0o700); try { walk(p); } catch { /* */ } } }
}
hardenPermissions({ deep: true });

const getSetting = (key, def) => {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  if (!r) return def;
  try { return JSON.parse(r.value); } catch { return def; }
};
const setSetting = (key, value) =>
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));

const audit = (userId, tenantId, action, detail) =>
  run('INSERT INTO audit(ts,user_id,tenant_id,action,detail) VALUES(?,?,?,?,?)',
    Date.now(), userId || null, tenantId || null, action, detail ? JSON.stringify(detail) : null);

module.exports = { db, get, all, run, tx, getSetting, setSetting, audit, hardenPermissions };

// Backfill email_hash + cifrar emails en claro (una vez)
(function backfillEmailPrivacy() {
  try {
    const fc = require('./fieldcrypto');
    const rows = all('SELECT id, email, email_hash FROM users');
    for (const r of rows) {
      if (!r.email) continue;
      const plain = String(r.email).startsWith('enc:') ? fc.decryptEmail(r.email) : String(r.email).trim().toLowerCase();
      if (!plain) continue;
      const h = fc.emailHash(plain);
      const enc = plain.startsWith('enc:') ? r.email : fc.encryptEmail(plain);
      if (r.email_hash !== h || r.email !== enc) {
        run('UPDATE users SET email_hash=?, email=? WHERE id=?', h, enc, r.id);
      }
    }
    // índice único de email_hash (ignorar si ya existe)
    try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash)'); } catch {}
  } catch (e) {
    console.error('[db] backfill email privacy:', e.message);
  }
})();

(function backfillCouponDuration() {
  try {
    const rows = all('SELECT code, months, duration_n, duration_unit FROM coupons');
    for (const r of rows) {
      if (r.duration_n == null && r.months != null) {
        run("UPDATE coupons SET duration_n=?, duration_unit=COALESCE(duration_unit,'months'), applies_to=COALESCE(applies_to,'both') WHERE code=?", r.months, r.code);
      }
    }
  } catch (e) { console.error('[db] coupon backfill:', e.message); }
})();
