'use strict';
const mailer = require('./mailer');
const { all, get, run, tx, hardenPermissions } = require('./db');
const H = require('./hours');
const dom = require('./domain');
const mp = require('./mp');
const backup = require('./backup');
const hol = require('./holidays');
const alerts = require('./alerts');
const { getSetting: gs } = require('./db');

// Cierra jornadas abiertas a la hora configurada por cada negocio
function autoClose(now = Date.now()) {
  const open = all(`SELECT m.*, t.auto_close_hour, u.name FROM
    (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.user_id ORDER BY x.ts DESC, x.id DESC) rn FROM marks x) m
    JOIN tenants t ON t.id=m.tenant_id JOIN users u ON u.id=m.user_id
    WHERE m.rn=1 AND m.kind IN ('in','xin') AND t.status='active'`);
  for (const m of open) {
    const closeAt = H.nextHourAfter(m.ts, m.auto_close_hour);
    if (closeAt > now) continue;
    tx(() => {
      run("INSERT INTO marks(tenant_id,user_id,branch_id,kind,ts,auto,source) VALUES(?,?,?,?,?,1,'auto')", m.tenant_id, m.user_id, m.branch_id, m.kind === 'xin' ? 'xout' : 'out', closeAt);
      run("INSERT INTO notifs(tenant_id,type,user_id,text,detail,created_at) VALUES(?,?,?,?,?,?)", m.tenant_id, 'no_exit', m.user_id, `No marcó salida — ${m.name}`, 'Cierre automático', now);
      alerts.notifyOwner(m.tenant_id, { title: `No marcó salida — ${m.name}`, detail: 'Cierre automático de jornada' });
    });
  }
  return open.length;
}

/**
 * Aviso "No llegó": si el empleado tiene turno configurado, pasó la hora + tolerancia + 30 min
 * y no hay entrada del día ni permiso aprobado que cubra hoy.
 */
function absentCheck(now = Date.now()) {
  const p = H.arParts(now);
  const today = `${p.y}-${H.pad(p.m)}-${H.pad(p.d)}`;
  const dayStart = H.arToTs(p.y, p.m, p.d);
  // no avisar en domingo (0) si el negocio es lun-vie; se filtra por turno más abajo
  const emps = all(`SELECT u.id,u.name,u.tenant_id,u.shift_start,t.schedule_start,t.late_tolerance_min,t.dpw,t.status
    FROM users u JOIN tenants t ON t.id=u.tenant_id
    WHERE u.role='employee' AND u.status='active' AND t.status='active'`);
  let n = 0;
  for (const e of emps) {
    const shift = e.shift_start || e.schedule_start;
    if (!shift || !/^\d{1,2}:\d{2}$/.test(shift)) continue;
    // Día laboral aproximado: lun-vie (1-5) o lun-sáb (1-6) según dpw
    const dow = new Date(now + H.AR_OFFSET).getUTCDay(); // 0=dom en UTC ajustado… usar partes AR
    const jsDow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 domingo
    const maxDow = (e.dpw === 6) ? 6 : 5; // 5=vie, 6=sáb
    if (jsDow === 0 || jsDow > maxDow) continue;

    const [sh, sm] = shift.split(':').map(Number);
    const tol = Number(e.late_tolerance_min) || 0;
    const threshold = H.arToTs(p.y, p.m, p.d, sh, sm) + (tol + 30) * 60_000;
    if (now < threshold) continue;

    // Ya hay entrada hoy?
    if (get("SELECT 1 FROM marks WHERE user_id=? AND kind IN ('in','xin') AND ts>=? LIMIT 1", e.id, dayStart)) continue;
    // Permiso aprobado que cubre hoy
    if (get("SELECT 1 FROM permits WHERE user_id=? AND status='approved' AND from_date<=? AND to_date>=? LIMIT 1", e.id, today, today)) continue;
    // Ya avisamos hoy
    if (get("SELECT 1 FROM notifs WHERE user_id=? AND type='absent' AND created_at>=? LIMIT 1", e.id, dayStart)) continue;

    const absDetail = `Sin entrada a las ${H.pad(p.hh)}:${H.pad(p.mm)} · turno ${shift}`;
    run("INSERT INTO notifs(tenant_id,type,user_id,text,detail,created_at) VALUES(?,?,?,?,?,?)",
      e.tenant_id, 'absent', e.id, `No llegó — ${e.name}`, absDetail, now);
    alerts.notifyOwner(e.tenant_id, { title: `No llegó — ${e.name}`, detail: absDetail });
    n++;
  }
  return n;
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
  const tick = safe('tick', () => { autoClose(); absentCheck(); });
  const hourly = safe('hourly', async () => {
    dom.getPrices(); expireSubscriptions(); await syncPrices(); backup.ensureDaily();
    try { mailer.processQueue(); } catch (e) { console.error('[mail:queue]', e.message); }
    hardenPermissions();
    const last = gs('hol_last_sync', null);
    if (!last || Date.now() - last.at > 24 * 3600e3) await hol.autoSync();
  });
  setInterval(tick, 60_000).unref();
  setInterval(hourly, 3600_000).unref();
  tick(); hourly();
}
module.exports = { start, autoClose, absentCheck, expireSubscriptions };
