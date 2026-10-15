'use strict';
const mailer = require('./mailer');
const { all, get, run, tx, hardenPermissions } = require('./db');
const { nextHourAfter } = require('./hours');
const dom = require('./domain');
const mp = require('./mp');
const backup = require('./backup');
const hol = require('./holidays');
const { getSetting: gs } = require('./db');

// Cierra jornadas abiertas a la hora configurada por cada negocio
function autoClose(now = Date.now()) {
  const open = all(`SELECT m.*, t.auto_close_hour, u.name FROM
    (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.user_id ORDER BY x.ts DESC, x.id DESC) rn FROM marks x) m
    JOIN tenants t ON t.id=m.tenant_id JOIN users u ON u.id=m.user_id
    WHERE m.rn=1 AND m.kind IN ('in','xin') AND t.status='active'`);
  for (const m of open) {
    const closeAt = nextHourAfter(m.ts, m.auto_close_hour);
    if (closeAt > now) continue;
    tx(() => {
      run("INSERT INTO marks(tenant_id,user_id,branch_id,kind,ts,auto,source) VALUES(?,?,?,?,?,1,'auto')", m.tenant_id, m.user_id, m.branch_id, m.kind === 'xin' ? 'xout' : 'out', closeAt);
      run("INSERT INTO notifs(tenant_id,type,user_id,text,detail,created_at) VALUES(?,?,?,?,?,?)", m.tenant_id, 'no_exit', m.user_id, `No marcó salida — ${m.name}`, 'Cierre automático', now);
    });
  }
  return open.length;
}

function expireSubscriptions(now = Date.now()) {
  return run("UPDATE tenants SET status='past_due' WHERE status='active' AND plan='sub' AND paid_until IS NOT NULL AND paid_until < ?", now - 3 * 864e5).changes;
}

async function syncPrices() {
  const { getSetting, setSetting } = require('./db');
  const pend = getSetting('price_pending_sync', null);
  if (!pend || !mp.enabled()) return;
  let failed = 0;
  for (const t of all("SELECT * FROM tenants WHERE status='active' AND plan='sub' AND mp_preapproval_id IS NOT NULL AND discount_months=0")) {
    try { await mp.updatePreapprovalAmount(t.mp_preapproval_id, pend.sub); } catch (e) { failed++; console.error('[jobs] precio', t.slug, e.message); }
  }
  if (!failed) setSetting('price_pending_sync', null);
}

function start() {
  const safe = (name, fn) => async () => { try { await fn(); } catch (e) { console.error(`[jobs] ${name}:`, e); } };
  const tick = safe('autoClose', () => autoClose());
  const hourly = safe('hourly', async () => {
    dom.getPrices(); expireSubscriptions(); await syncPrices(); backup.ensureDaily();
    try { mailer.processQueue(); } catch (e) { console.error('[mail:queue]', e.message); }; hardenPermissions();
    const last = gs('hol_last_sync', null);
    if (!last || Date.now() - last.at > 24 * 3600e3) await hol.autoSync(); // solo como caché: las horas usan la tabla local
  });
  setInterval(tick, 60_000).unref();
  setInterval(hourly, 3600_000).unref();
  tick(); hourly();
}
module.exports = { start, autoClose, expireSubscriptions };
