'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cfg = require('../lib/config');
const { route, bad, notFound, HttpError, forbidden } = require('../lib/http');
const { get, all, run, tx, audit, getSetting } = require('../lib/db');
const sec = require('../lib/security');
const dom = require('../lib/domain');
const H = require('../lib/hours');
const fc = require('../lib/fieldcrypto');
const { clean, emailOk, intIn, isoDateOk, hhmmOk, periodOf, decodeUpload } = require('./common');

const A = { auth: ['owner', 'manager', 'hr'] }; // dueño, encargado o RRHH
const A_OWNER = { auth: 'owner' }; // solo dueño (pagos, borrar datos, config sensible)
const requireOwner = (ctx) => {
  if (ctx.user.role !== 'owner') throw forbidden('Solo el dueño del negocio puede hacer esto');
};
/** Encargado solo ve su sucursal */
const managerBranch = (ctx) => (ctx.user.role === 'manager' ? ctx.user.branch_id : null);
/** RRHH ve todo el negocio (como dueño en operación) pero sin pagos/config sensible */
const isStaffAdmin = (ctx) => ctx.user.role === 'owner' || ctx.user.role === 'hr';

/** Quién puede autorizar pedidos del solicitante según rol:
 *  empleado → encargado (su sucursal) / RRHH / dueño
 *  encargado → RRHH / dueño
 *  RRHH → solo dueño
 */
function canDecideFor(decider, requester) {
  if (!requester) return false;
  if (decider.role === 'owner') return true;
  if (decider.id === requester.id) return false; // nadie se aprueba a sí mismo
  if (requester.role === 'hr') return false; // solo dueño
  if (requester.role === 'manager') return decider.role === 'hr';
  // empleado común
  if (decider.role === 'hr') return true;
  if (decider.role === 'manager') return requester.branch_id === decider.branch_id;
  return false;
}


const EMP_COLS = 'id,name,email,role,cargo,branch_id,status,phone,address,birthday,hire_date,shift_start,emg_name,emg_rel,emg_phone,dni,personal_email,blood_type,obra_social,notes,must_change_pw,created_at,last_login';

function getEmp(ctx, id) {
  const e = get("SELECT * FROM users WHERE id=? AND tenant_id=? AND role IN ('employee','manager','hr')", Number(id), ctx.tenant.id);
  if (!e) throw notFound('Empleado no encontrado');
  const mb = managerBranch(ctx);
  if (mb && e.branch_id !== mb) throw forbidden('Ese empleado no es de tu sucursal');
  return e;
}
/** Jerarquía de cuentas: el dueño gestiona a todos; RRHH a empleados y encargados; el encargado solo a empleados de su sucursal. */
function getManagedEmp(ctx, id) {
  const e = getEmp(ctx, id), r = ctx.user.role;
  const ok = r === 'owner' || (r === 'hr' && (e.role === 'employee' || e.role === 'manager')) || (r === 'manager' && e.role === 'employee');
  if (!ok) throw forbidden('No tenés permiso para gestionar la cuenta de esa persona');
  return e;
}
const checkBranch = (ctx, id) => {
  if (id == null || id === '') return null;
  const b = get('SELECT id FROM branches WHERE id=? AND tenant_id=?', Number(id), ctx.tenant.id);
  if (!b) throw bad('Sucursal inválida');
  return b.id;
};
function ensureRoom(ctx, extra = 1) {
  const t = get('SELECT * FROM tenants WHERE id=?', ctx.tenant.id);
  const limit = dom.employeeLimit(t), count = dom.employeeCount(t.id);
  if (count + extra > limit) {
    throw new HttpError(402, 'LIMIT_REACHED', `Llegaste al límite de ${limit} empleados. Sumá empleados extra para continuar.`, { limit, count, price_extra: dom.getPrices().extra });
  }
}
const tempPassword = () => crypto.randomBytes(6).toString('base64url');
/** Descifra PII solo para el dueño autenticado de ese tenant */
function empPublic(row) {
  // role incluido si viene en el SELECT
  if (!row) return row;
  const d = fc.decryptUserFields({ ...row });
  d.email = fc.decryptEmail(d.email) || d.email;
  return d;
}


const lastMarks = (tid) => new Map(all(
  `SELECT user_id,kind,ts,branch_id FROM (SELECT m.*, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ts DESC, id DESC) rn FROM marks m WHERE tenant_id=?) WHERE rn=1`, tid).map((r) => [r.user_id, r]));
const stateOf = (m) => (!m ? 'fuera' : m.kind === 'in' ? 'jornada' : m.kind === 'xin' ? 'extra' : 'fuera');

function hoursByUser(tid, period) {
  const r = H.periodRange(period), now = Date.now();
  const rows = all('SELECT user_id,kind,ts FROM marks WHERE tenant_id=? AND ts>=? AND ts<? ORDER BY ts, id', tid, r.from - 3 * 864e5, r.to);
  const by = new Map();
  for (const m of rows) { if (!by.has(m.user_id)) by.set(m.user_id, []); by.get(m.user_id).push(m); }
  const res = new Map();
  for (const [uid, ms] of by) res.set(uid, H.summarize(ms, r.from, r.to, now));
  return res;
}


function rrhhStats(t, period, branchId = null) {
  const r = H.periodRange(period);
  const emps = branchId
    ? all("SELECT id,name FROM users WHERE tenant_id=? AND role IN ('employee','manager','hr') AND status='active' AND branch_id=?", t.id, branchId)
    : all("SELECT id,name FROM users WHERE tenant_id=? AND role IN ('employee','manager','hr') AND status='active'", t.id);
  const lateMap = new Map(all("SELECT user_id, COUNT(*) n FROM notifs WHERE tenant_id=? AND type='late' AND created_at>=? AND created_at<? GROUP BY user_id", t.id, r.from, r.to).map((x) => [x.user_id, x.n]));
  const absMap = new Map(all("SELECT user_id, COUNT(*) n FROM notifs WHERE tenant_id=? AND type='absent' AND created_at>=? AND created_at<? GROUP BY user_id", t.id, r.from, r.to).map((x) => [x.user_id, x.n]));
  const hrs = hoursByUser(t.id, period);
  const exp = H.expectedHours(period, t, dom.holidaySet(period));
  let presentDays = 0, totalPossible = emps.length * Math.max(1, H.workingDays(period, dom.holidaySet(period)).weekdays || 1);
  const ranking = emps.map((e) => {
    const h = hrs.get(e.id) || { normal_h: 0, extra_h: 0 };
    const tot = H.round2((h.normal_h || 0) + (h.extra_h || 0));
    return {
      id: e.id, name: e.name,
      late: lateMap.get(e.id) || 0,
      absent: absMap.get(e.id) || 0,
      hours: tot,
      expected: exp,
      pct: exp > 0 ? Math.round((tot / exp) * 100) : 0,
    };
  }).sort((a, b) => b.late - a.late || b.absent - a.absent);
  const lateTotal = ranking.reduce((a, x) => a + x.late, 0);
  const absTotal = ranking.reduce((a, x) => a + x.absent, 0);
  return {
    employees: emps.length,
    late_total: lateTotal,
    absent_total: absTotal,
    top_late: ranking.filter((x) => x.late > 0).slice(0, 5),
    top_absent: ranking.filter((x) => x.absent > 0).slice(0, 5),
    low_attendance: ranking.filter((x) => x.pct < 80).slice(0, 5),
  };
}

// ---------------- Dashboard ----------------
route('GET', '/api/owner/dashboard', A, (ctx) => {
  const t = ctx.tenant, period = periodOf(ctx.query.period);
  const mb = managerBranch(ctx);
  const empSql = mb
    ? `SELECT ${EMP_COLS} FROM users WHERE tenant_id=? AND role IN ('employee','manager','hr') AND status='active' AND branch_id=? ORDER BY name`
    : `SELECT ${EMP_COLS} FROM users WHERE tenant_id=? AND role IN ('employee','manager','hr') AND status='active' ORDER BY name`;
  const emps = mb ? all(empSql, t.id, mb) : all(empSql, t.id);
  const live = lastMarks(t.id), hrs = hoursByUser(t.id, period);
  const hs = dom.holidaySet(period);
  const expected = H.expectedHours(period, t, hs);
  const wd = H.workingDays(period, hs);
  const holRows = all("SELECT date,name,kind FROM holidays WHERE substr(date,1,7)=? ORDER BY date", period);
  const r = H.periodRange(period);
  const lateMap = new Map(all("SELECT user_id, COUNT(*) n FROM notifs WHERE tenant_id=? AND type='late' AND created_at>=? AND created_at<? GROUP BY user_id", t.id, r.from, r.to).map((x) => [x.user_id, x.n]));
  let normal = 0, extra = 0;
  const list = emps.map((e) => {
    const h = hrs.get(e.id) || { normal_h: 0, extra_h: 0 };
    normal += h.normal_h; extra += h.extra_h;
    const m = live.get(e.id);
    const st = stateOf(m);
    return {
      id: e.id, name: e.name, cargo: e.cargo, branch_id: e.branch_id, role: e.role || 'employee',
      state: st,
      since: m && st !== 'fuera' ? m.ts : null,
      last_mark_at: m ? m.ts : null,
      last_mark_kind: m ? m.kind : null,
      late_count: lateMap.get(e.id) || 0,
      normal_h: h.normal_h, extra_h: h.extra_h,
    };
  });
  const total = H.round2(normal + extra), expTotal = expected * Math.max(emps.length, 1);
  const pendingSql = mb
    ? `SELECT id,name,email,created_at FROM users WHERE tenant_id=? AND role='employee' AND status='pending' AND (branch_id=? OR branch_id IS NULL) ORDER BY id`
    : `SELECT id,name,email,created_at FROM users WHERE tenant_id=? AND role='employee' AND status='pending' ORDER BY id`;
  const pending = (mb ? all(pendingSql, t.id, mb) : all(pendingSql, t.id)).map(empPublic);
  let notifCount;
  if (mb) {
    const ids = emps.map((e) => e.id);
    if (ids.length) {
      notifCount = get(`SELECT COUNT(*) n FROM notifs WHERE tenant_id=? AND resolved_at IS NULL AND read_at IS NULL AND user_id IN (${ids.map(() => '?').join(',')})`, t.id, ...ids).n;
    } else notifCount = 0;
  } else {
    notifCount = get('SELECT COUNT(*) n FROM notifs WHERE tenant_id=? AND resolved_at IS NULL AND read_at IS NULL', t.id).n
      + get("SELECT COUNT(*) n FROM emp_requests WHERE tenant_id=? AND status='pending'", t.id).n;
  }
  const branch = mb ? get('SELECT id,name FROM branches WHERE id=? AND tenant_id=?', mb, t.id) : null;
  return {
    period, expected_per_emp: expected, employees: list,
    is_manager: ctx.user.role === 'manager',
    is_hr: ctx.user.role === 'hr',
    manager_branch: branch,
    workdays: { weekdays: wd.weekdays, saturdays: t.dpw === 6 ? wd.saturdays : 0, hpd: t.hpd, sat_h: t.sat_h, dpw: t.dpw },
    holidays: holRows,
    totals: {
      normal_h: H.round2(normal), extra_h: H.round2(extra), total_h: total, expected_h: expTotal,
      pct: expTotal ? Math.round((total / expTotal) * 100) : 0,
      working_now: list.filter((e) => e.state !== 'fuera').length,
    },
    pending,
    notif_count: notifCount,
    onboarding: (ctx.user.role === 'manager' || ctx.user.role === 'hr') ? null : onboardingState(t),
    rrhh: rrhhStats(t, period, mb),
  };
});


// ---------------- Empleados ----------------
route('GET', '/api/owner/employees', A, (ctx) => {
  const live = lastMarks(ctx.tenant.id);
  const mb = managerBranch(ctx);
  const rows = mb
    ? all(`SELECT ${EMP_COLS} FROM users WHERE tenant_id=? AND role IN ('employee','manager','hr') AND (branch_id=? OR branch_id IS NULL) ORDER BY (status='pending') DESC, name`, ctx.tenant.id, mb)
    : all(`SELECT ${EMP_COLS} FROM users WHERE tenant_id=? AND role IN ('employee','manager','hr') ORDER BY (status='pending') DESC, name`, ctx.tenant.id);
  return { employees: rows.map((e) => ({ ...empPublic(e), role: e.role || 'employee', state: e.status === 'active' ? stateOf(live.get(e.id)) : null })) };
});

route('POST', '/api/owner/employees', A, async (ctx) => {
  const b = ctx.body, name = clean(b.name, 80), email = clean(b.email).toLowerCase();
  if (name.length < 2) throw bad('Ingresá el nombre');
  if (!emailOk(email)) throw bad('Email inválido');
  if (require('../lib/security').findUserByEmail(email)) throw new HttpError(409, 'EMAIL_TAKEN', 'Ese email ya está registrado');
  ensureRoom(ctx);
  const mb = managerBranch(ctx);
  if (mb) b.branch_id = mb; // encargado solo da de alta en su sucursal
  const branch = checkBranch(ctx, b.branch_id) ?? get('SELECT id FROM branches WHERE tenant_id=? ORDER BY id LIMIT 1', ctx.tenant.id)?.id;
  if (b.shift_start && !hhmmOk(b.shift_start)) throw bad('Horario de entrada inválido (HH:MM)');
  if (b.hire_date && !isoDateOk(b.hire_date)) throw bad('Fecha de ingreso inválida');
  const personalEmail = clean(b.personal_email, 120);
  if (personalEmail && !emailOk(personalEmail.toLowerCase())) throw bad('El email personal no es válido');
  const tmp = tempPassword();
  const packed = sec.packEmail(email);
  const sens = fc.encryptUserFields({
    phone: clean(b.phone, 40) || null, dni: clean(b.dni, 20) || null, personal_email: personalEmail || null, notes: clean(b.notes, 400) || null,
  });
  const r = run(`INSERT INTO users(tenant_id,email,email_hash,name,pass_hash,role,status,must_change_pw,cargo,branch_id,phone,shift_start,hire_date,
                   dni,personal_email,blood_type,obra_social,notes,created_at)
                 VALUES(?,?,?,?,?,'employee','active',1,?,?,?,?,?,?,?,?,?,?,?)`,
    ctx.tenant.id, packed.email, packed.email_hash, name, await sec.hashPassword(tmp), clean(b.cargo, 60) || null, branch, sens.phone,
    b.shift_start || null, b.hire_date || new Date().toISOString().slice(0, 10),
    sens.dni, sens.personal_email, clean(b.blood_type, 8) || null, clean(b.obra_social, 80) || null, sens.notes, Date.now());
  audit(ctx.user.id, ctx.tenant.id, 'employee.created', { id: Number(r.lastInsertRowid) });
  return { id: Number(r.lastInsertRowid), temp_password: tmp };
});

route('PATCH', '/api/owner/employees/:id', A, (ctx) => {
  const e = getManagedEmp(ctx, ctx.params.id), b = ctx.body;
  const v = {
    name: b.name !== undefined ? clean(b.name, 80) : e.name,
    cargo: b.cargo !== undefined ? clean(b.cargo, 60) : e.cargo,
    branch_id: b.branch_id !== undefined ? checkBranch(ctx, b.branch_id) : e.branch_id,
    phone: b.phone !== undefined ? clean(b.phone, 40) : e.phone,
    address: b.address !== undefined ? clean(b.address, 120) : e.address,
    birthday: b.birthday !== undefined ? (b.birthday || null) : e.birthday,
    hire_date: b.hire_date !== undefined ? (b.hire_date || null) : e.hire_date,
    shift_start: b.shift_start !== undefined ? (b.shift_start || null) : e.shift_start,
    dni: b.dni !== undefined ? clean(b.dni, 20) : e.dni,
    personal_email: b.personal_email !== undefined ? clean(b.personal_email, 120) : e.personal_email,
    blood_type: b.blood_type !== undefined ? clean(b.blood_type, 8) : e.blood_type,
    obra_social: b.obra_social !== undefined ? clean(b.obra_social, 80) : e.obra_social,
    notes: b.notes !== undefined ? clean(b.notes, 400) : e.notes,
    emg_name: b.emg_name !== undefined ? clean(b.emg_name, 80) : e.emg_name,
    emg_rel: b.emg_rel !== undefined ? clean(b.emg_rel, 40) : e.emg_rel,
    emg_phone: b.emg_phone !== undefined ? clean(b.emg_phone, 40) : e.emg_phone,
  };
  if (managerBranch(ctx) && v.branch_id !== managerBranch(ctx)) throw forbidden('Un encargado no puede mover empleados a otra sucursal');
  if (v.name.length < 2) throw bad('Nombre inválido');
  if (v.birthday && !isoDateOk(v.birthday)) throw bad('Fecha de cumpleaños inválida');
  if (v.hire_date && !isoDateOk(v.hire_date)) throw bad('Fecha de ingreso inválida');
  if (v.shift_start && !hhmmOk(v.shift_start)) throw bad('Horario inválido (HH:MM)');
  if (v.personal_email && !emailOk(String(v.personal_email).toLowerCase())) throw bad('El email personal no es válido');
  const sens = fc.encryptUserFields({
    phone: v.phone, address: v.address, dni: v.dni, personal_email: v.personal_email,
    notes: v.notes, emg_name: v.emg_name, emg_phone: v.emg_phone,
  });
  run(`UPDATE users SET name=?,cargo=?,branch_id=?,phone=?,address=?,birthday=?,hire_date=?,shift_start=?,
    dni=?,personal_email=?,blood_type=?,obra_social=?,notes=?,emg_name=?,emg_rel=?,emg_phone=? WHERE id=?`,
    v.name, v.cargo, v.branch_id, sens.phone, sens.address, v.birthday, v.hire_date, v.shift_start,
    sens.dni, sens.personal_email, v.blood_type, v.obra_social, sens.notes, sens.emg_name, v.emg_rel, sens.emg_phone, e.id);
  return { ok: true };
});

route('POST', '/api/owner/employees/:id/approve', A, (ctx) => {
  const e = getEmp(ctx, ctx.params.id);
  if (e.status !== 'pending') throw bad('Este empleado no está pendiente');
  // H2: si se anotó por link y todavía no confirmó su email, no se lo puede autorizar
  if (cfg.REQUIRE_EMAIL_VERIFICATION && !e.email_verified_at && get('SELECT 1 FROM email_verifications WHERE user_id=?', e.id)) {
    throw new HttpError(409, 'EMAIL_UNVERIFIED', 'Esta persona todavía no confirmó su email. Pedile que abra el link que le enviamos (si venció, se reenvía solo cuando intenta ingresar).');
  }
  ensureRoom(ctx);
  run("UPDATE users SET status='active' WHERE id=?", e.id);
  run("UPDATE notifs SET resolved_at=? WHERE tenant_id=? AND type='auth' AND ref_id=? AND resolved_at IS NULL", Date.now(), ctx.tenant.id, e.id);
  audit(ctx.user.id, ctx.tenant.id, 'employee.approved', { id: e.id });
  return { ok: true };
});
route('POST', '/api/owner/employees/:id/reject', A, (ctx) => {
  const e = getEmp(ctx, ctx.params.id);
  run("UPDATE users SET status='rejected' WHERE id=? AND status='pending'", e.id);
  run("UPDATE notifs SET resolved_at=? WHERE tenant_id=? AND type='auth' AND ref_id=? AND resolved_at IS NULL", Date.now(), ctx.tenant.id, e.id);
  return { ok: true };
});
route('POST', '/api/owner/employees/:id/disable', A, (ctx) => {
  const e = getManagedEmp(ctx, ctx.params.id);
  run("UPDATE users SET status='disabled' WHERE id=?", e.id);
  sec.destroyUserSessions(e.id);
  audit(ctx.user.id, ctx.tenant.id, 'employee.disabled', { id: e.id });
  return { ok: true };
});
route('POST', '/api/owner/employees/:id/enable', A, (ctx) => {
  const e = getManagedEmp(ctx, ctx.params.id);
  if (e.status === 'active') return { ok: true };
  ensureRoom(ctx);
  run("UPDATE users SET status='active' WHERE id=?", e.id);
  return { ok: true };
});
route('POST', '/api/owner/employees/:id/delete', A_OWNER, (ctx) => {
  const e = getEmp(ctx, ctx.params.id);
  if (e.status === 'active') throw bad('Deshabilitalo antes de eliminarlo, o confirmá borrado forzado');
  // soft-check: allow delete of disabled/rejected/pending
  run('DELETE FROM sessions WHERE user_id=?', e.id);
  run("DELETE FROM users WHERE id=? AND tenant_id=? AND role IN ('employee','manager','hr')", e.id, ctx.tenant.id);
  audit(ctx.user.id, ctx.tenant.id, 'employee.deleted', { id: e.id, name: e.name });
  return { ok: true };
});
route('POST', '/api/owner/employees/:id/delete-force', A_OWNER, (ctx) => {
  const e = getEmp(ctx, ctx.params.id);
  run('DELETE FROM sessions WHERE user_id=?', e.id);
  run("DELETE FROM users WHERE id=? AND tenant_id=? AND role IN ('employee','manager','hr')", e.id, ctx.tenant.id);
  audit(ctx.user.id, ctx.tenant.id, 'employee.deleted', { id: e.id, name: e.name, force: true });
  return { ok: true };
});


route('POST', '/api/owner/employees/:id/role', A_OWNER, (ctx) => {
  const e = getEmp(ctx, ctx.params.id);
  if (e.id === ctx.user.id) throw bad('No podés cambiarte el rol a vos mismo');
  const role = ['manager', 'hr', 'employee'].includes(ctx.body.role) ? ctx.body.role : 'employee';
  if (role === 'manager' && !e.branch_id) throw bad('Asigná una sucursal al empleado antes de hacerlo encargado');
  run('UPDATE users SET role=? WHERE id=? AND tenant_id=?', role, e.id, ctx.tenant.id);
  // Cerrar sesiones del usuario: si era encargado/RRHH y vuelve a empleado (o al revés),
  // debe volver a ingresar y ver el panel correcto (evita errores y pantallas colgadas).
  sec.destroyUserSessions(e.id);
  audit(ctx.user.id, ctx.tenant.id, 'employee.role', { id: e.id, role, from: e.role });
  return { ok: true, role };
});

route('POST', '/api/owner/employees/:id/reset-password', A, async (ctx) => {
  const e = getManagedEmp(ctx, ctx.params.id), tmp = tempPassword();
  run('UPDATE users SET pass_hash=?, must_change_pw=1 WHERE id=?', await sec.hashPassword(tmp), e.id);
  sec.destroyUserSessions(e.id);
  audit(ctx.user.id, ctx.tenant.id, 'employee.pw_reset', { id: e.id });
  return { temp_password: tmp };
});

// ---------------- Notificaciones y permisos ----------------
route('GET', '/api/owner/notifs', A, (ctx) => {
  const cols = 'id,type,user_id,ref_id,text,detail,created_at,read_at,resolved_at';
  const mb = managerBranch(ctx);
  let notifs, history, orphan;
  if (mb) {
    const team = all("SELECT id FROM users WHERE tenant_id=? AND branch_id=? AND role IN ('employee','manager','hr')", ctx.tenant.id, mb).map((u) => u.id);
    if (!team.length) {
      notifs = []; history = ctx.query.history ? [] : undefined; orphan = [];
    } else {
      const ph = team.map(() => '?').join(',');
      notifs = all(`SELECT ${cols} FROM notifs WHERE tenant_id=? AND resolved_at IS NULL AND user_id IN (${ph}) ORDER BY id DESC LIMIT 100`, ctx.tenant.id, ...team);
      history = ctx.query.history
        ? all(`SELECT ${cols} FROM notifs WHERE tenant_id=? AND resolved_at IS NOT NULL AND user_id IN (${ph}) ORDER BY resolved_at DESC LIMIT 30`, ctx.tenant.id, ...team)
        : undefined;
      orphan = all(`SELECT p.id,p.type,p.from_date,p.to_date,u.name employee FROM permits p JOIN users u ON u.id=p.user_id
        WHERE p.tenant_id=? AND p.status='pending' AND u.branch_id=? AND NOT EXISTS (SELECT 1 FROM notifs n WHERE n.tenant_id=p.tenant_id AND n.type='permit' AND n.ref_id=p.id AND n.resolved_at IS NULL) ORDER BY p.id DESC`, ctx.tenant.id, mb);
    }
  } else {
    notifs = all(`SELECT ${cols} FROM notifs WHERE tenant_id=? AND resolved_at IS NULL ORDER BY id DESC LIMIT 100`, ctx.tenant.id);
    history = ctx.query.history ? all(`SELECT ${cols} FROM notifs WHERE tenant_id=? AND resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 30`, ctx.tenant.id) : undefined;
    orphan = all(`SELECT p.id,p.type,p.from_date,p.to_date,u.name employee FROM permits p JOIN users u ON u.id=p.user_id
      WHERE p.tenant_id=? AND p.status='pending' AND NOT EXISTS (SELECT 1 FROM notifs n WHERE n.tenant_id=p.tenant_id AND n.type='permit' AND n.ref_id=p.id AND n.resolved_at IS NULL) ORDER BY p.id DESC`, ctx.tenant.id);
  }
  return {
    notifs, unread: notifs.filter((n) => !n.read_at).length,
    history,
    orphan_permits: orphan,
  };
});
route('DELETE', '/api/owner/notifs/:id', A, (ctx) => {
  const n = get('SELECT id,tenant_id FROM notifs WHERE id=?', Number(ctx.params.id));
  if (!n) throw notFound('Esa notificación ya no existe');
  if (n.tenant_id !== ctx.tenant.id) throw forbidden('Esa notificación no es de tu negocio');
  run('DELETE FROM notifs WHERE id=?', n.id);
  return { ok: true, deleted: 1 };
});
// Sin "ids" borra todas las del negocio (leídas o no, viejas o recientes)
route('POST', '/api/owner/notifs/clear', A, (ctx) => {
  const ids = ctx.body.ids;
  if (ids === undefined) return { ok: true, deleted: run('DELETE FROM notifs WHERE tenant_id=?', ctx.tenant.id).changes };
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((i) => Number.isInteger(i))) throw bad('Lista de notificaciones inválida');
  const rows = ids.map((i) => get('SELECT id,tenant_id FROM notifs WHERE id=?', i)).filter(Boolean);
  if (rows.some((r) => r.tenant_id !== ctx.tenant.id)) throw forbidden('Alguna de esas notificaciones no es de tu negocio');
  return { ok: true, deleted: tx(() => rows.reduce((a, r) => a + run('DELETE FROM notifs WHERE id=?', r.id).changes, 0)) };
});
route('POST', '/api/owner/notifs/read-all', A, (ctx) => {
  run('UPDATE notifs SET read_at=? WHERE tenant_id=? AND read_at IS NULL', Date.now(), ctx.tenant.id);
  return { ok: true };
});
route('POST', '/api/owner/notifs/:id/resolve', A, (ctx) => {
  const n = get('SELECT * FROM notifs WHERE id=? AND tenant_id=?', Number(ctx.params.id), ctx.tenant.id);
  if (!n) throw notFound();
  if (n.type === 'permit' || n.type === 'auth') throw bad('Este aviso se resuelve aprobando o rechazando');
  run('UPDATE notifs SET resolved_at=? WHERE id=?', Date.now(), n.id);
  return { ok: true };
});
route('GET', '/api/owner/permits', A, (ctx) => {
  const mb = managerBranch(ctx);
  let permits = mb
    ? all(`SELECT p.*, u.name employee, u.role user_role, u.branch_id user_branch FROM permits p JOIN users u ON u.id=p.user_id WHERE p.tenant_id=? AND u.branch_id=? ORDER BY (p.status='pending') DESC, p.id DESC LIMIT 100`, ctx.tenant.id, mb)
    : all(`SELECT p.*, u.name employee, u.role user_role, u.branch_id user_branch FROM permits p JOIN users u ON u.id=p.user_id WHERE p.tenant_id=? ORDER BY (p.status='pending') DESC, p.id DESC LIMIT 100`, ctx.tenant.id);
  permits = permits.filter((p) => canDecideFor(ctx.user, { id: p.user_id, role: p.user_role, branch_id: p.user_branch }));
  return { permits };
});
route('POST', '/api/owner/permits/:id/decide', A, (ctx) => {
  const p = get('SELECT * FROM permits WHERE id=? AND tenant_id=?', Number(ctx.params.id), ctx.tenant.id);
  if (!p) throw notFound();
  if (p.status !== 'pending') throw bad('Esta solicitud ya fue resuelta');
  const requester = get('SELECT id,role,branch_id,name FROM users WHERE id=?', p.user_id);
  if (!canDecideFor(ctx.user, requester)) {
    if (requester?.role === 'hr') throw forbidden('Los pedidos de RRHH solo los autoriza el dueño');
    if (requester?.role === 'manager') throw forbidden('Los pedidos del encargado solo los autoriza RRHH o el dueño');
    throw forbidden('No podés autorizar este pedido');
  }
  const mb = managerBranch(ctx);
  if (mb) {
    if (!requester || requester.branch_id !== mb) throw forbidden('Ese permiso no es de tu sucursal');
  }
  const ok = ctx.body.approve === true;
  tx(() => {
    run('UPDATE permits SET status=?, decided_at=? WHERE id=?', ok ? 'approved' : 'rejected', Date.now(), p.id);
    run("UPDATE notifs SET resolved_at=? WHERE tenant_id=? AND type='permit' AND ref_id=? AND resolved_at IS NULL", Date.now(), ctx.tenant.id, p.id);
  });
  audit(ctx.user.id, ctx.tenant.id, ok ? 'permit.approved' : 'permit.rejected', { id: p.id });
  return { ok: true };
});

// ---------------- Sucursales y QR ----------------
route('GET', '/api/owner/branches', A, (ctx) => ({ branches: all('SELECT * FROM branches WHERE tenant_id=? ORDER BY id', ctx.tenant.id) }));

function branchFields(b, cur = {}) {
  const num = (v, min, max, name) => { if (v === null || v === '' || v === undefined) return null; const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw bad(name + ' inválida'); return n; };
  const name = b.name !== undefined ? clean(b.name, 60) : cur.name;
  if (!name || name.length < 2) throw bad('Ingresá el nombre de la sucursal');
  return {
    name, address: b.address !== undefined ? clean(b.address, 120) : cur.address ?? null,
    lat: b.lat !== undefined ? num(b.lat, -90, 90, 'Latitud') : cur.lat ?? null,
    lng: b.lng !== undefined ? num(b.lng, -180, 180, 'Longitud') : cur.lng ?? null,
    radius: b.radius !== undefined ? intIn(b.radius, 20, 300, 'Radio') : cur.radius ?? 50,
  };
}
route('POST', '/api/owner/branches', A_OWNER, (ctx) => {
  const n = get('SELECT COUNT(*) n FROM branches WHERE tenant_id=?', ctx.tenant.id).n;
  if (n >= 1 && !dom.planFeatures(ctx.tenant).multi_suc) throw new HttpError(402, 'MOD_LOCKED', 'Activá el módulo Multi-sucursal para agregar más locales.');
  if (n >= 100) throw bad('Límite de sucursales alcanzado');
  const f = branchFields(ctx.body);
  const r = run('INSERT INTO branches(tenant_id,name,address,lat,lng,radius) VALUES(?,?,?,?,?,?)', ctx.tenant.id, f.name, f.address, f.lat, f.lng, f.radius);
  return { id: Number(r.lastInsertRowid) };
});
route('PATCH', '/api/owner/branches/:id', A, (ctx) => {
  const cur = get('SELECT * FROM branches WHERE id=? AND tenant_id=?', Number(ctx.params.id), ctx.tenant.id);
  if (!cur) throw notFound();
  const f = branchFields(ctx.body, cur);
  run('UPDATE branches SET name=?,address=?,lat=?,lng=?,radius=? WHERE id=?', f.name, f.address, f.lat, f.lng, f.radius, cur.id);
  return { ok: true };
});
route('DELETE', '/api/owner/branches/:id', A_OWNER, (ctx) => {
  const all_ = all('SELECT id FROM branches WHERE tenant_id=? ORDER BY id', ctx.tenant.id);
  const id = Number(ctx.params.id);
  if (!all_.some((b) => b.id === id)) throw notFound();
  if (all_.length <= 1) throw bad('Tiene que quedar al menos una sucursal');
  const fallback = all_.find((b) => b.id !== id).id;
  tx(() => {
    run('UPDATE users SET branch_id=? WHERE tenant_id=? AND branch_id=?', fallback, ctx.tenant.id, id);
    run('DELETE FROM branches WHERE id=? AND tenant_id=?', id, ctx.tenant.id);
  });
  return { ok: true };
});
route('GET', '/api/owner/qr/:branchId', A, (ctx) => {
  const b = get('SELECT * FROM branches WHERE id=? AND tenant_id=?', Number(ctx.params.branchId), ctx.tenant.id);
  if (!b) throw notFound();
  return {
    url: `${cfg.APP_URL}/m/${b.id}.${sec.qrToken(b.id, ctx.tenant.id)}`,
    refresh_in: sec.QR_WINDOW_MS - (Date.now() % sec.QR_WINDOW_MS),
    geofence: b.lat != null && b.lng != null, radius: b.radius,
  };
});

// ---------------- Configuración ----------------

route('GET', '/api/owner/industry-templates', A, () => ({ templates: dom.INDUSTRY_TEMPLATES }));
route('POST', '/api/owner/industry-template', A_OWNER, (ctx) => {
  const key = String(ctx.body.template || '');
  const tpl = dom.INDUSTRY_TEMPLATES[key];
  if (!tpl) throw bad('Plantilla inválida');
  run('UPDATE tenants SET hpd=?,dpw=?,sat_h=?,schedule_start=?,schedule_end=?,late_tolerance_min=?,allow_extra=? WHERE id=?',
    tpl.hpd, tpl.dpw, tpl.sat_h, tpl.schedule_start, tpl.schedule_end, tpl.late_tolerance_min, tpl.allow_extra, ctx.tenant.id);
  // radio en sucursales
  if (tpl.radius) run('UPDATE branches SET radius=? WHERE tenant_id=?', tpl.radius, ctx.tenant.id);
  audit(ctx.user.id, ctx.tenant.id, 'settings.industry_template', { template: key });
  return { ok: true, template: key, applied: tpl };
});

route('GET', '/api/owner/settings', A, (ctx) => {
  const t = ctx.tenant;
  return {
    theme: t.theme, auto_close_hour: t.auto_close_hour, late_tolerance_min: t.late_tolerance_min,
    allow_extra: !!t.allow_extra, hpd: t.hpd, dpw: t.dpw, sat_h: t.sat_h,
    schedule_start: t.schedule_start || '', schedule_end: t.schedule_end || '',
    mark_qr: t.mark_qr !== 0 && t.mark_qr !== false, mark_gps: t.mark_gps !== 0 && t.mark_gps !== false,
  };
});
route('PATCH', '/api/owner/settings', A_OWNER, (ctx) => {
  const b = ctx.body, t = ctx.tenant;
  const theme = b.theme !== undefined ? String(b.theme) : t.theme;
  if (!/^#[0-9a-fA-F]{6}$/.test(theme)) throw bad('Color inválido');
  const hhmm = (x, name) => {
    if (x === undefined || x === null || x === '') return null;
    const s = String(x).trim();
    if (!/^\d{1,2}:\d{2}$/.test(s)) throw bad(name + ' inválida (usá HH:MM)');
    const [h, m] = s.split(':').map(Number);
    if (h > 23 || m > 59) throw bad(name + ' inválida');
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  };
  const v = {
    auto_close_hour: b.auto_close_hour !== undefined ? intIn(b.auto_close_hour, 0, 23, 'Hora de cierre') : t.auto_close_hour,
    late_tolerance_min: b.late_tolerance_min !== undefined ? intIn(b.late_tolerance_min, 0, 120, 'Tolerancia') : t.late_tolerance_min,
    allow_extra: b.allow_extra !== undefined ? (b.allow_extra ? 1 : 0) : t.allow_extra,
    hpd: b.hpd !== undefined ? intIn(b.hpd, 1, 12, 'Horas por día') : t.hpd,
    dpw: b.dpw !== undefined ? intIn(b.dpw, 5, 6, 'Días por semana') : t.dpw,
    sat_h: b.sat_h !== undefined ? intIn(b.sat_h, 0, 12, 'Horas de sábado') : t.sat_h,
    schedule_start: b.schedule_start !== undefined ? hhmm(b.schedule_start, 'Entrada del turno') : t.schedule_start,
    schedule_end: b.schedule_end !== undefined ? hhmm(b.schedule_end, 'Salida del turno') : t.schedule_end,
    mark_qr: b.mark_qr !== undefined ? (b.mark_qr === true || b.mark_qr === 1 || b.mark_qr === '1' || b.mark_qr === 'on' ? 1 : 0) : (t.mark_qr !== 0 ? 1 : 0),
    mark_gps: b.mark_gps !== undefined ? (b.mark_gps === true || b.mark_gps === 1 || b.mark_gps === '1' || b.mark_gps === 'on' ? 1 : 0) : (t.mark_gps !== 0 ? 1 : 0),
  };
  if (!v.mark_qr && !v.mark_gps) throw bad('Tenés que dejar al menos un método de marcación (QR o GPS)');
  run('UPDATE tenants SET theme=?,auto_close_hour=?,late_tolerance_min=?,allow_extra=?,hpd=?,dpw=?,sat_h=?,schedule_start=?,schedule_end=?,mark_qr=?,mark_gps=? WHERE id=?',
    theme, v.auto_close_hour, v.late_tolerance_min, v.allow_extra, v.hpd, v.dpw, v.sat_h, v.schedule_start, v.schedule_end, v.mark_qr, v.mark_gps, t.id);
  return { ok: true, mark_qr: !!v.mark_qr, mark_gps: !!v.mark_gps };
});


// ---------------- Valoración pública ----------------

// ---------------- Solicitudes de empleados (RH / horas / fichaje) ----------------
route('GET', '/api/owner/emp-requests', A, (ctx) => {
  const status = String(ctx.query.status || 'pending');
  let rows;
  if (status === 'all') {
    rows = all(`SELECT r.id,r.kind,r.subject,r.body,r.status,r.reply,r.created_at,r.updated_at,
      u.name AS employee, u.id AS user_id, u.role AS user_role, u.branch_id
      FROM emp_requests r JOIN users u ON u.id=r.user_id
      WHERE r.tenant_id=? ORDER BY r.id DESC LIMIT 100`, ctx.tenant.id);
  } else {
    rows = all(`SELECT r.id,r.kind,r.subject,r.body,r.status,r.reply,r.created_at,r.updated_at,
      u.name AS employee, u.id AS user_id, u.role AS user_role, u.branch_id
      FROM emp_requests r JOIN users u ON u.id=r.user_id
      WHERE r.tenant_id=? AND r.status=? ORDER BY r.id DESC LIMIT 100`, ctx.tenant.id, status);
  }
  // Cadena de autorización: encargado no ve pedidos de encargado/RRHH; RRHH no ve de RRHH
  rows = rows.filter((r) => canDecideFor(ctx.user, { id: r.user_id, role: r.user_role, branch_id: r.branch_id }));
  return { requests: rows };
});
route('PATCH', '/api/owner/emp-requests/:id', A, (ctx) => {
  const id = Number(ctx.params.id);
  const r = get('SELECT * FROM emp_requests WHERE id=? AND tenant_id=?', id, ctx.tenant.id);
  if (!r) throw notFound();
  const requester = get('SELECT id,role,branch_id FROM users WHERE id=?', r.user_id);
  if (!canDecideFor(ctx.user, requester)) {
    if (requester?.role === 'hr') throw forbidden('Las solicitudes de RRHH solo las responde el dueño');
    if (requester?.role === 'manager') throw forbidden('Las solicitudes del encargado solo las responde RRHH o el dueño');
    throw forbidden('No podés responder esta solicitud');
  }
  if (r.status !== 'pending' && ctx.body.status && ctx.body.status !== r.status) {
    // permitir re-editar respuesta, pero no volver a pending
  }
  const status = ['pending','answered','closed','rejected'].includes(ctx.body.status) ? ctx.body.status : r.status;
  const reply = ctx.body.reply !== undefined ? clean(ctx.body.reply, 2000) : r.reply;
  const now = Date.now();
  run('UPDATE emp_requests SET status=?, reply=?, updated_at=? WHERE id=?', status, reply || null, now, id);
  audit(ctx.user.id, ctx.tenant.id, 'emp_request.' + status, { id });
  if (status !== 'pending') {
    run("UPDATE notifs SET resolved_at=?, read_at=COALESCE(read_at,?) WHERE tenant_id=? AND type='emp_request' AND ref_id=? AND resolved_at IS NULL",
      now, now, ctx.tenant.id, id);
  }
  if (status === 'answered' || status === 'rejected') {
    try {
      run("INSERT INTO notifs(tenant_id,type,user_id,ref_id,text,detail,created_at) VALUES(?,?,?,?,?,?,?)",
        ctx.tenant.id, 'emp_request_reply', r.user_id, id,
        status === 'rejected' ? 'Tu solicitud fue rechazada' : 'Respondieron tu solicitud',
        String(reply || status).slice(0, 200), now);
    } catch (_) {}
  }
  return { ok: true };
});

route('POST', '/api/owner/plan/upgrade', A_OWNER, (ctx) => {
  // Sin cobro diferencial implementado, el cambio de plan NO puede ser gratis: solo en modo demo/desarrollo.
  if (!cfg.ALLOW_DEMO_PAYMENTS) throw new HttpError(402, 'PAYMENT_REQUIRED', 'El cambio de plan se gestiona con soporte: escribinos y lo activamos.');
  const tier = String(ctx.body.plan_tier || '');
  if (!['esencial', 'pro', 'completo'].includes(tier)) throw bad('Plan inválido');
  const order = { esencial: 0, pro: 1, completo: 2 };
  const cur = ctx.tenant.plan_tier || 'esencial';
  if ((order[tier] || 0) <= (order[cur] || 0)) throw bad('Ya tenés ese plan o uno superior');
  // Actualización inmediata de tier (el cobro diferencial puede hacerse luego vía checkout)
  const mods = tier === 'completo' ? { mod_suc: 1, mod_rec: 1 } : {};
  run('UPDATE tenants SET plan_tier=?, mod_suc=CASE WHEN ? THEN 1 ELSE mod_suc END, mod_rec=CASE WHEN ? THEN 1 ELSE mod_rec END WHERE id=?',
    tier, tier === 'completo' ? 1 : 0, tier === 'completo' ? 1 : 0, ctx.tenant.id);
  audit(ctx.user.id, ctx.tenant.id, 'plan.upgraded', { from: cur, to: tier });
  return { ok: true, plan_tier: tier };
});
route('POST', '/api/owner/review', A, (ctx) => {
  const stars = intIn(ctx.body.stars, 1, 5, 'Estrellas');
  const text = clean(ctx.body.text, 280);
  if (text.length < 8) throw bad('Escribí al menos una frase corta (8 caracteres)');
  const name = clean(ctx.body.author_name, 60) || ctx.user.name || ctx.tenant.name;
  // one pending/approved per tenant - replace pending
  run('DELETE FROM reviews WHERE tenant_id=?', ctx.tenant.id);
  run('INSERT INTO reviews(tenant_id,stars,text,author_name,approved,created_at) VALUES(?,?,?,?,1,?)',
    ctx.tenant.id, stars, text, name, Date.now());
  return { ok: true };
});
route('GET', '/api/owner/review', A, (ctx) => {
  const r = get('SELECT id,stars,text,author_name,approved,created_at FROM reviews WHERE tenant_id=? ORDER BY id DESC LIMIT 1', ctx.tenant.id);
  return { review: r || null };
});

// ---------------- Logo y firma del negocio ----------------
route('POST', '/api/owner/branding/logo', { auth: 'owner', limit: 4 * 1024 * 1024 }, (ctx) => {
  const up = decodeUpload(ctx.body.data, ctx.body.filename || 'logo.png', { imagesOnly: true });
  if (up.buf.length > 2 * 1024 * 1024) throw bad('La imagen supera 2 MB');
  const dir = path.join(cfg.DATA_DIR, 'uploads', String(ctx.tenant.id));
  fs.mkdirSync(dir, { recursive: true });
  const ext = (up.mime || '').includes('png') ? 'png' : (up.mime || '').includes('webp') ? 'webp' : 'jpg';
  const rel = String(ctx.tenant.id) + '/logo.' + ext;
  for (const e of ['jpg', 'png', 'webp']) { try { fs.unlinkSync(path.join(dir, 'logo.' + e)); } catch (_) {} }
  fs.writeFileSync(path.join(cfg.DATA_DIR, 'uploads', rel), up.buf, { mode: 0o640 });
  run('UPDATE tenants SET logo_path=? WHERE id=?', rel, ctx.tenant.id);
  return { ok: true, logo_url: '/api/tenant/logo?t=' + Date.now() };
});
route('DELETE', '/api/owner/branding/logo', A_OWNER, (ctx) => {
  const cur = get('SELECT logo_path FROM tenants WHERE id=?', ctx.tenant.id);
  if (cur?.logo_path) { try { fs.unlinkSync(path.join(cfg.DATA_DIR, 'uploads', cur.logo_path)); } catch (_) {} }
  run('UPDATE tenants SET logo_path=NULL WHERE id=?', ctx.tenant.id);
  return { ok: true };
});
route('POST', '/api/owner/branding/sign', { auth: 'owner', limit: 4 * 1024 * 1024 }, (ctx) => {
  const up = decodeUpload(ctx.body.data, ctx.body.filename || 'firma.png', { imagesOnly: true });
  if (up.buf.length > 2 * 1024 * 1024) throw bad('La imagen supera 2 MB');
  const dir = path.join(cfg.DATA_DIR, 'uploads', String(ctx.tenant.id));
  fs.mkdirSync(dir, { recursive: true });
  const ext = (up.mime || '').includes('png') ? 'png' : (up.mime || '').includes('webp') ? 'webp' : 'jpg';
  const rel = String(ctx.tenant.id) + '/sign.' + ext;
  for (const e of ['jpg', 'png', 'webp']) { try { fs.unlinkSync(path.join(dir, 'sign.' + e)); } catch (_) {} }
  fs.writeFileSync(path.join(cfg.DATA_DIR, 'uploads', rel), up.buf, { mode: 0o640 });
  run('UPDATE tenants SET sign_path=? WHERE id=?', rel, ctx.tenant.id);
  return { ok: true };
});
route('DELETE', '/api/owner/branding/sign', A_OWNER, (ctx) => {
  const cur = get('SELECT sign_path FROM tenants WHERE id=?', ctx.tenant.id);
  if (cur?.sign_path) { try { fs.unlinkSync(path.join(cfg.DATA_DIR, 'uploads', cur.sign_path)); } catch (_) {} }
  run('UPDATE tenants SET sign_path=NULL WHERE id=?', ctx.tenant.id);
  return { ok: true };
});

route('GET', '/api/tenant/logo', { auth: 'user' }, (ctx) => {
  const row = get('SELECT logo_path FROM tenants WHERE id=?', ctx.user.tenant_id);
  if (!row || !row.logo_path) throw notFound();
  const file = path.join(cfg.DATA_DIR, 'uploads', row.logo_path);
  if (!fs.existsSync(file)) throw notFound();
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { __file: { buf: fs.readFileSync(file), filename: 'logo' + ext, mime, inline: true, cache: 'private, max-age=60' } };
});
route('GET', '/api/tenant/sign', { auth: 'owner' }, (ctx) => {
  const row = get('SELECT sign_path FROM tenants WHERE id=?', ctx.tenant.id);
  if (!row || !row.sign_path) throw notFound();
  const file = path.join(cfg.DATA_DIR, 'uploads', row.sign_path);
  if (!fs.existsSync(file)) throw notFound();
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { __file: { buf: fs.readFileSync(file), filename: 'sign' + ext, mime, inline: true, cache: 'private, max-age=60' } };
});

// ---------------- Reportes ----------------
const fmtTime = (ts) => { const p = H.arParts(ts); return `${H.pad(p.hh)}:${H.pad(p.mm)}`; };
const fmtDate = (ts) => { const p = H.arParts(ts); return `${H.pad(p.d)}/${H.pad(p.m)}/${p.y}`; };

function buildReport(ctx, type, period, branchId) {
  const t = ctx.tenant, r = H.periodRange(period), now = Date.now();
  const mb = managerBranch(ctx);
  if (mb) branchId = mb;
  const empSql = branchId
    ? `SELECT id,name,cargo FROM users WHERE tenant_id=? AND role='employee' AND status IN ('active','disabled') AND branch_id=? ORDER BY name`
    : `SELECT id,name,cargo FROM users WHERE tenant_id=? AND role='employee' AND status IN ('active','disabled') ORDER BY name`;
  const emps = branchId ? all(empSql, t.id, branchId) : all(empSql, t.id);
  if (type === 'hours') {
    const hrs = hoursByUser(t.id, period), exp = H.expectedHours(period, t, dom.holidaySet(period));
    const lates = new Map(all("SELECT user_id, COUNT(*) n FROM notifs WHERE tenant_id=? AND type='late' AND created_at>=? AND created_at<? GROUP BY user_id", t.id, r.from, r.to).map((x) => [x.user_id, x.n]));
    const rows = emps.map((e) => { const h = hrs.get(e.id) || { normal_h: 0, extra_h: 0 }; const tot = H.round2(h.normal_h + h.extra_h); return [e.name, e.cargo || '', h.normal_h, h.extra_h, tot, exp, H.round2(tot - exp), lates.get(e.id) || 0]; });
    const sumN = H.round2(rows.reduce((a, r) => a + Number(r[2] || 0), 0));
    const sumE = H.round2(rows.reduce((a, r) => a + Number(r[3] || 0), 0));
    const sumT = H.round2(rows.reduce((a, r) => a + Number(r[4] || 0), 0));
    const sumLate = rows.reduce((a, r) => a + Number(r[7] || 0), 0);
    const neg = rows.filter((r) => Number(r[6]) < 0).length;
    return {
      title: 'Horas + extras', columns: ['Empleado', 'Cargo', 'Horas normales', 'Horas extra', 'Total', 'Esperadas', 'Diferencia', 'Tardanzas'],
      rows,
      summary: {
        'Horas normales': sumN + ' h',
        'Horas extra': sumE + ' h',
        'Total': sumT + ' h',
        'Tardanzas': sumLate,
        'Con diferencia negativa': neg,
      },
    };
  }
  if (type === 'daily') {
    const rows = [];
    const marks = all('SELECT user_id,kind,ts,auto,source FROM marks WHERE tenant_id=? AND ts>=? AND ts<? ORDER BY ts,id', t.id, r.from - 3 * 864e5, r.to);
    for (const e of emps) {
      const ms = marks.filter((m) => m.user_id === e.id);
      const autoTs = new Set(ms.filter((m) => m.auto).map((m) => m.ts)), manualTs = new Set(ms.filter((m) => m.source === 'manual').map((m) => m.ts));
      const days = new Map();
      for (const iv of H.intervals(ms, now)) {
        if (iv.start < r.from || iv.start >= r.to) continue;
        const key = H.isoDate(iv.start);
        const d = days.get(key) || { first: iv.start, last: iv.end, open: false, normal: 0, extra: 0, auto: false, manual: false };
        d.last = Math.max(d.last, iv.end); d.open ||= !!iv.open; d.auto ||= autoTs.has(iv.end); d.manual ||= manualTs.has(iv.start) || manualTs.has(iv.end);
        (iv.extra ? (d.extra += iv.end - iv.start) : (d.normal += iv.end - iv.start));
        days.set(key, d);
      }
      for (const [k, d] of [...days].sort()) rows.push([fmtDate(d.first), e.name, fmtTime(d.first), d.open ? 'en curso' : fmtTime(d.last), H.round2(d.normal / 3.6e6), H.round2(d.extra / 3.6e6), d.auto ? 'Sí' : '', d.manual ? 'Sí' : '']);
    }
    return { title: 'Asistencia diaria', columns: ['Fecha', 'Empleado', 'Entrada', 'Salida', 'Horas normales', 'Horas extra', 'Salida automática', 'Marca manual'], rows };
  }
  if (type === 'contable') {
    const hrs = hoursByUser(t.id, period), exp = H.expectedHours(period, t, dom.holidaySet(period));
    const lates = new Map(all("SELECT user_id, COUNT(*) n FROM notifs WHERE tenant_id=? AND type='late' AND created_at>=? AND created_at<? GROUP BY user_id", t.id, r.from, r.to).map((x) => [x.user_id, x.n]));
    const absents = new Map(all("SELECT user_id, COUNT(*) n FROM notifs WHERE tenant_id=? AND type='absent' AND created_at>=? AND created_at<? GROUP BY user_id", t.id, r.from, r.to).map((x) => [x.user_id, x.n]));
    const rows = emps.map((e) => {
      const h = hrs.get(e.id) || { normal_h: 0, extra_h: 0 };
      const tot = H.round2(h.normal_h + h.extra_h);
      return [
        e.name,
        e.cargo || '',
        period,
        h.normal_h,
        h.extra_h,
        tot,
        exp,
        H.round2(tot - exp),
        lates.get(e.id) || 0,
        absents.get(e.id) || 0,
        t.hpd,
        t.dpw,
      ];
    });
    return {
      title: 'Export contable / liquidación',
      columns: ['Empleado', 'Cargo', 'Período', 'Hs normales', 'Hs extra', 'Hs total', 'Hs esperadas', 'Diferencia', 'Tardanzas', 'Ausencias (sin marca)', 'Hs/día ref.', 'Días/sem ref.'],
      rows,
      summary: {
        'Período': period,
        'Empleados': rows.length,
        'Total hs normales': H.round2(rows.reduce((a, r) => a + Number(r[3]), 0)),
        'Total hs extra': H.round2(rows.reduce((a, r) => a + Number(r[4]), 0)),
      },
      note: 'Archivo orientado a liquidación. Las horas son las registradas en AsistOK; el empleador es responsable del cálculo final de sueldos.',
    };
  }
  if (type === 'late') {
    const rows = all("SELECT n.created_at, u.name, n.detail FROM notifs n LEFT JOIN users u ON u.id=n.user_id WHERE n.tenant_id=? AND n.type='late' AND n.created_at>=? AND n.created_at<? ORDER BY n.created_at", t.id, r.from, r.to)
      .map((x) => [fmtDate(x.created_at), x.name || '', x.detail || '']);
    return { title: 'Tardanzas', columns: ['Fecha', 'Empleado', 'Detalle'], rows };
  }
  if (type === 'auto') {
    const rows = all("SELECT m.ts, u.name FROM marks m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.auto=1 AND m.ts>=? AND m.ts<? ORDER BY m.ts", t.id, r.from, r.to)
      .map((x) => [fmtDate(x.ts), x.name, fmtTime(x.ts)]);
    return { title: 'Salidas automáticas', columns: ['Fecha', 'Empleado', 'Hora de cierre'], rows };
  }
  throw bad('Tipo de reporte inválido');
}
route('GET', '/api/owner/reports', A, (ctx) => {
  if (!dom.planFeatures(ctx.tenant).reports) throw new HttpError(402, 'PLAN_LOCKED', 'Los reportes están en el plan Pro o Completo.');
  const period = periodOf(ctx.query.period);
  const branchId = ctx.query.branch_id ? Number(ctx.query.branch_id) : null;
  return { period, ...buildReport(ctx, ctx.query.type || 'hours', period, branchId) };
});

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita inyección de fórmulas al abrir en Excel
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
route('GET', '/api/owner/reports/export', A, (ctx) => {
  const period = periodOf(ctx.query.period), type = ctx.query.type || 'hours';
  const branchId = ctx.query.branch_id ? Number(ctx.query.branch_id) : null;
  const rep = buildReport(ctx, type, period, branchId);
  const base = `${ctx.tenant.slug}-${type}-${period}`;
  if (ctx.query.format === 'json') return { __file: { buf: Buffer.from(JSON.stringify(rep, null, 2)), filename: base + '.json', mime: 'application/json' } };
  const csv = '\ufeff' + [rep.columns, ...rep.rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
  return { __file: { buf: Buffer.from(csv), filename: base + '.csv', mime: 'text/csv; charset=utf-8' } };
});

/** Paquete completo del negocio (JSON legible, PII descifrada) — útil para backup y para responder a la AAIP */
route('GET', '/api/owner/export/all', A_OWNER, (ctx) => {
  const tid = ctx.tenant.id;
  // Consultas defensivas: no depender de columnas de migraciones opcionales (evita INTERNAL en export).
  const safeAll = (sql, ...params) => {
    try { return all(sql, ...params); } catch (e) {
      console.error('[export/all]', sql.slice(0, 80), e.message);
      return null;
    }
  };
  const emps = (safeAll(`SELECT ${EMP_COLS} FROM users WHERE tenant_id=? AND role IN ('employee','manager','hr')`, tid) || [])
    .map((e) => {
      const d = empPublic(e);
      delete d.pass_hash;
      delete d.email_hash;
      return d;
    });
  let marks = safeAll('SELECT id,user_id,branch_id,kind,ts,lat,lng,accuracy,dist,auto,source,note,created_by FROM marks WHERE tenant_id=? ORDER BY ts', tid);
  if (!marks) marks = safeAll('SELECT id,user_id,branch_id,kind,ts,lat,lng,accuracy,dist,auto FROM marks WHERE tenant_id=? ORDER BY ts', tid) || [];
  let docs = safeAll('SELECT id,user_id,kind,title,period,cert_type,filename,mime,created_at,sign_status,sign_note,signed_at,signed_name FROM docs WHERE tenant_id=? ORDER BY id', tid);
  if (!docs) docs = safeAll('SELECT id,user_id,kind,title,period,cert_type,filename,mime,created_at,sign_status,sign_note,signed_at FROM docs WHERE tenant_id=? ORDER BY id', tid) || [];
  let payments = safeAll('SELECT id,kind,qty,amount,status,ext_ref,mp_payment_id,created_at,applied_at FROM payments WHERE tenant_id=? ORDER BY id', tid);
  if (!payments) payments = safeAll('SELECT id,kind,qty,amount,status,ext_ref,mp_payment_id,created_at FROM payments WHERE tenant_id=? ORDER BY id', tid) || [];
  let requests = safeAll('SELECT id,user_id,kind,subject,body,status,reply,created_at,updated_at FROM emp_requests WHERE tenant_id=? ORDER BY id', tid) || [];
  const data = {
    exported_at: new Date().toISOString(),
    purpose: 'Exportación de datos del negocio (Ley 25.326 / backup)',
    tenant: {
      id: tid, name: ctx.tenant.name, slug: ctx.tenant.slug, plan: ctx.tenant.plan,
      plan_tier: ctx.tenant.plan_tier, status: ctx.tenant.status,
      created_at: ctx.tenant.created_at, paid_until: ctx.tenant.paid_until,
    },
    branches: safeAll('SELECT id,name,lat,lng,radius,address,created_at FROM branches WHERE tenant_id=?', tid) || [],
    employees: emps,
    marks,
    permits: safeAll('SELECT id,user_id,type,from_date,to_date,note,status,created_at,decided_at FROM permits WHERE tenant_id=?', tid) || [],
    docs,
    payments,
    emp_requests: requests,
  };
  const body = JSON.stringify(data, null, 2);
  return {
    __file: {
      buf: Buffer.from(body, 'utf8'),
      filename: `asistok-export-${ctx.tenant.slug || 'negocio'}-${new Date().toISOString().slice(0, 10)}.json`,
      mime: 'application/json; charset=utf-8',
    },
  };
});

/** Exportación de un solo empleado (paquete ARCO / respuesta a AAIP o al titular) */
route('GET', '/api/owner/employees/:id/export', A, (ctx) => {
  const e = getEmp(ctx, ctx.params.id);
  const d = empPublic(e);
  delete d.pass_hash;
  delete d.email_hash;
  const tid = ctx.tenant.id;
  const q = (sql, ...params) => { try { return all(sql, ...params); } catch { return null; } };
  let marks = q('SELECT id,branch_id,kind,ts,lat,lng,accuracy,dist,auto,source,note FROM marks WHERE user_id=? AND tenant_id=? ORDER BY ts', e.id, tid);
  if (!marks) marks = q('SELECT id,branch_id,kind,ts,lat,lng,accuracy,dist,auto FROM marks WHERE user_id=? AND tenant_id=? ORDER BY ts', e.id, tid) || [];
  let docs = q('SELECT id,kind,title,period,cert_type,filename,created_at,sign_status,sign_note,signed_at,signed_name FROM docs WHERE user_id=? AND tenant_id=? ORDER BY id', e.id, tid);
  if (!docs) docs = q('SELECT id,kind,title,period,cert_type,filename,created_at,sign_status,sign_note,signed_at FROM docs WHERE user_id=? AND tenant_id=? ORDER BY id', e.id, tid) || [];
  const data = {
    exported_at: new Date().toISOString(),
    purpose: 'Exportación de datos personales del empleado (Ley 25.326 — derechos de acceso)',
    business: { name: ctx.tenant.name, slug: ctx.tenant.slug },
    employee: d,
    marks,
    permits: q('SELECT id,type,from_date,to_date,note,status,created_at,decided_at FROM permits WHERE user_id=? AND tenant_id=?', e.id, tid) || [],
    docs,
  };
  const safeName = String(d.name || e.id).replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').slice(0, 40).trim().replace(/\s+/g, '-') || 'empleado';
  audit(ctx.user.id, tid, 'employee.data_export', { id: e.id, name: d.name });
  return {
    __file: {
      buf: Buffer.from(JSON.stringify(data, null, 2)),
      filename: `asistok-datos-${safeName}-${new Date().toISOString().slice(0, 10)}.json`,
      mime: 'application/json',
    },
  };
});

/**
 * Eliminación de datos personales de un empleado (derecho de supresión / requerimiento AAIP).
 * Borra sesiones, marcas, permisos, documentos (y archivos), notificaciones y el usuario.
 * Queda registro de auditoría (sin el contenido de los datos) para demostrar el cumplimiento.
 */
route('POST', '/api/owner/employees/:id/erase', A_OWNER, (ctx) => {
  const e = getEmp(ctx, ctx.params.id);
  const reason = clean(ctx.body.reason, 200) || 'solicitud_titular_o_aaip';
  const nameSnap = e.name;
  const tid = ctx.tenant.id;
  const docPaths = all('SELECT path FROM docs WHERE user_id=? AND tenant_id=?', e.id, tid).map((r) => r.path).filter(Boolean);
  tx(() => {
    run('DELETE FROM sessions WHERE user_id=?', e.id);
    run('DELETE FROM marks WHERE user_id=? AND tenant_id=?', e.id, tid);
    run('DELETE FROM permits WHERE user_id=? AND tenant_id=?', e.id, tid);
    run('DELETE FROM docs WHERE user_id=? AND tenant_id=?', e.id, tid);
    run('DELETE FROM notifs WHERE user_id=? AND tenant_id=?', e.id, tid);
    try { run('DELETE FROM emp_requests WHERE user_id=? AND tenant_id=?', e.id, tid); } catch { /* tabla opcional */ }
    run('DELETE FROM users WHERE id=? AND tenant_id=? AND role=?', e.id, tid, 'employee');
  });
  for (const rel of docPaths) {
    try {
      const full = path.join(cfg.DATA_DIR, 'uploads', rel);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch { /* ignore */ }
  }
  audit(ctx.user.id, tid, 'employee.data_erased', { id: e.id, name: nameSnap, reason });
  return { ok: true, erased_user_id: e.id, message: 'Datos personales del empleado eliminados. Quedó registro de auditoría sin el detalle de los datos borrados.' };
});


// ---------------- Documentos (certificados / recibos) ----------------
route('GET', '/api/owner/employees/:id/docs', A, (ctx) => {
  const e = getEmp(ctx, ctx.params.id);
  return { docs: all('SELECT id,kind,title,period,cert_type,filename,created_at,sign_status,sign_note,signed_at,signed_name FROM docs WHERE user_id=? AND tenant_id=? ORDER BY id DESC', e.id, ctx.tenant.id) };
});

function saveFile(tenantId, up) {
  const dir = path.join(cfg.DATA_DIR, 'uploads', String(tenantId));
  fs.mkdirSync(dir, { recursive: true });
  const rel = path.join(String(tenantId), crypto.randomBytes(16).toString('hex') + '.' + up.ext);
  fs.writeFileSync(path.join(cfg.DATA_DIR, 'uploads', rel), up.buf, { mode: 0o640 });
  return rel;
}
route('POST', '/api/owner/employees/:id/recibos', { auth: 'owner', limit: 8 * 1024 * 1024 }, (ctx) => {
  if (!dom.planFeatures(ctx.tenant).recibos) throw new HttpError(402, 'MOD_LOCKED', 'Activá el módulo Recibos o el plan Completo.');
  const e = getEmp(ctx, ctx.params.id);
  const period = clean(ctx.body.period, 7);
  if (!H.periodRange(period)) throw bad('Período inválido (AAAA-MM)');
  const up = decodeUpload(ctx.body.data, ctx.body.filename, { pdfOnly: true });
  if (up.buf.length > cfg.MAX_UPLOAD_BYTES) throw new HttpError(413, 'TOO_LARGE', 'El PDF supera los 5 MB');
  const rel = saveFile(ctx.tenant.id, up);
  const r = run(`INSERT INTO docs(tenant_id,user_id,kind,title,period,filename,mime,path,created_at,sign_status) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ctx.tenant.id, e.id, 'recibo', clean(ctx.body.title, 80) || `Recibo ${period}`, period, up.filename, up.mime, rel, Date.now(), 'pending');
  return { id: Number(r.lastInsertRowid) };
});

// ---------------- Onboarding (primera vez) ----------------
const parseOb = (t) => { try { return JSON.parse(t.onboarding || '{}'); } catch { return {}; } };
function setOnboarding(t, fn) {
  const ob = parseOb(t), before = JSON.stringify(ob);
  fn(ob);
  if (JSON.stringify(ob) !== before) run('UPDATE tenants SET onboarding=? WHERE id=?', JSON.stringify(ob), t.id);
}
function onboardingState(t) {
  const ob = parseOb(t), manual = new Set(ob.done || []);
  const hasGeo = all('SELECT lat,lng FROM branches WHERE tenant_id=?', t.id).some((b) => b.lat != null && b.lng != null);
  const branchCount = get('SELECT COUNT(*) n FROM branches WHERE tenant_id=?', t.id).n;
  const emps = get("SELECT COUNT(*) n FROM users WHERE tenant_id=? AND role='employee' AND status='active'", t.id).n;
  const pending = get("SELECT COUNT(*) n FROM users WHERE tenant_id=? AND role='employee' AND status='pending'", t.id).n;
  const marked = !!get('SELECT 1 FROM marks WHERE tenant_id=? LIMIT 1', t.id);
  const hasHours = (t.hpd > 0 && t.dpw > 0);
  const hasLogo = !!(t.logo_path);
  const hasDisplay = !!get('SELECT 1 FROM display_links WHERE tenant_id=? AND revoked_at IS NULL LIMIT 1', t.id);
  const markOk = (t.mark_qr !== 0 || t.mark_gps !== 0);
  const themeCustom = (t.theme && t.theme !== '#0f766e');
  const steps = [
    {
      key: 'business',
      title: '1 · Nombre del negocio',
      done: (t.name || '').length >= 2,
      auto: true,
      hint: 'Tu negocio ya figura como “' + (t.name || 'sin nombre') + '”. Si querés cambiarlo, escribí a soporte o pedí al Super Admin. El nombre aparece en el panel, reportes y recibos.',
      go: 'inicio',
    },
    {
      key: 'theme',
      title: '2 · Color del panel',
      done: themeCustom || manual.has('theme'),
      auto: themeCustom,
      hint: 'En Config → Color del panel elegí el color de tu marca (se aplica al instante). Queda guardado al tocar Guardar. Así el equipo reconoce tu negocio al entrar.',
      go: 'config',
    },
    {
      key: 'location',
      title: '3 · Ubicación del local (obligatorio)',
      done: hasGeo || manual.has('location'),
      auto: hasGeo,
      hint: 'Andá a la pestaña Local. Parate físicamente en el local y tocá “Usar mi ubicación actual”, o pegá el link de Google Maps (maps.app.goo.gl o maps.google.com). Configurá el radio (recomendado 50–80 m). Sin esto, el GPS no puede validar las marcaciones y el panel del empleado no deja marcar.',
      go: 'qr',
    },
    {
      key: 'markmode',
      title: '4 · Cómo van a marcar (QR y/o GPS)',
      done: markOk || manual.has('markmode'),
      auto: markOk,
      hint: 'En Config → Métodos de marcación activá uno o los dos: “GPS / geocerca” (marcan desde el celular dentro del radio, sin escanear) y/o “QR dinámico” (pantalla o tablet en el local). Tenés que dejar al menos uno activo. Si desactivás GPS, no se pide ubicación al empleado.',
      go: 'config',
    },
    {
      key: 'hours',
      title: '5 · Horarios, extras y tolerancia',
      done: hasHours || manual.has('hours'),
      auto: hasHours,
      hint: 'En Config configurá: (1) Horario del local / turno fijo y tolerancia de llegada tarde (minutos) para el aviso “Llegó tarde”; (2) Horas por día y días por semana (y sábados si aplica); (3) Cierre automático de jornada si olvidan marcar salida; (4) Permitir o no el botón Extra. Los feriados argentinos se calculan solos.',
      go: 'config',
    },
    {
      key: 'employees',
      title: '6 · Cargar el equipo',
      done: emps > 0 || manual.has('employees'),
      auto: emps > 0,
      hint: pending
        ? `Tenés ${pending} solicitud(es) pendiente(s) en Empleados: abrí cada una y autorizá o rechazá.`
        : 'En Empleados podés: (1) “+ Agregar” uno por uno (anotá la contraseña temporal, se muestra una sola vez); (2) “Importar CSV” con la plantilla; (3) “QR de alta” o copiar el link para que se registren solos y queden pendientes hasta que los autorices. Asigná sucursal y cargo si corresponde.',
      go: 'empleados',
    },
    {
      key: 'mark',
      title: '7 · Primera marcación de prueba',
      done: marked || manual.has('mark'),
      auto: marked,
      hint: 'Pedile a un empleado que: entre a la misma web → email + contraseña temporal → cambie la clave → acepte Términos y Privacidad → active el GPS del celular → toque “Entrada”. No hace falta escanear QR si el GPS está habilitado. En tu Inicio debería aparecer “En jornada”. Probá también marcar lejos del local: el sistema tiene que rechazar.',
      go: 'empleados',
    },
    {
      key: 'logo',
      title: '8 · Logo (opcional)',
      done: hasLogo || manual.has('logo'),
      auto: hasLogo,
      hint: 'En Config → Logo del negocio subí JPG, PNG o WebP (máx. 2 MB). Se ve en la barra del dueño y del empleado. Si tenés el módulo Recibos, también podés subir la firma del empleador para que aparezca en los recibos.',
      go: 'config',
    },
    {
      key: 'screen',
      title: '9 · Pantalla / QR del local (opcional)',
      done: hasDisplay || manual.has('screen'),
      auto: hasDisplay,
      hint: 'En Local podés crear una “pantalla fija” (TV/tablet en el local) o un “link para encargado” (un solo dispositivo, ideal por WhatsApp). El QR es dinámico y rota. Es opcional: el equipo puede marcar solo desde su panel con GPS. Si tenés Multi-sucursal, cada local tiene su propia geocerca y QR.',
      go: 'qr',
    },
    {
      key: 'reports',
      title: '10 · Reportes y backup de datos',
      done: manual.has('reports'),
      auto: false,
      hint: 'En Reportes exportá horas del mes en Excel/CSV o PDF. Con “Exportar todos los datos” bajás un JSON completo del negocio (empleados, marcas, permisos, docs) útil como backup o para responder a la AAIP. Desde la ficha de cada empleado también podés exportar o eliminar sus datos personales.',
      go: 'reportes',
    },
  ];
  const completed = steps.filter((s) => s.done).length;
  return {
    dismissed: !!ob.dismissed,
    steps,
    completed,
    total: steps.length,
    all_done: completed === steps.length,
    branch_count: branchCount,
    employee_count: emps,
  };
}
route('GET', '/api/owner/onboarding', A, (ctx) => onboardingState(ctx.tenant));
route('POST', '/api/owner/onboarding', A_OWNER, (ctx) => {
  const { action, step } = ctx.body;
  if (!['dismiss', 'reopen', 'done', 'undo'].includes(action)) throw bad('Acción inválida');
  if ((action === 'done' || action === 'undo') && !['theme', 'location', 'markmode', 'hours', 'employees', 'mark', 'logo', 'screen', 'reports'].includes(step)) throw bad('Paso inválido');
  setOnboarding(ctx.tenant, (ob) => {
    if (action === 'dismiss') ob.dismissed = true;
    if (action === 'reopen') ob.dismissed = false;
    if (action === 'done') ob.done = [...new Set([...(ob.done || []), step])];
    if (action === 'undo') ob.done = (ob.done || []).filter((k) => k !== step);
  });
  return onboardingState(get('SELECT * FROM tenants WHERE id=?', ctx.tenant.id));
});

// ---------------- Carga / corrección manual de marcas ----------------
// Para cuando el GPS no anduvo o alguien se olvidó de marcar. Queda registrada con quién la cargó y por qué.
const KIND_LBL = { in: 'Entrada', out: 'Salida', xin: 'Entrada extra', xout: 'Salida extra' };
const isOnKind = (m) => !!m && (m.kind === 'in' || m.kind === 'xin');
function parseWhen(v) {
  if (v === undefined || v === null || v === '') return Date.now();
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(s); // sin zona horaria = hora de Argentina
  if (m) return H.arToTs(+m[1], +m[2], +m[3], +m[4], +m[5]);
  if (/^\d{10,13}$/.test(s)) return Number(s);
  return Date.parse(s);
}
function empOfTenant(ctx, id) {
  const e = get("SELECT * FROM users WHERE id=? AND role='employee'", Number(id));
  if (!e) throw notFound('Empleado no encontrado');
  if (e.tenant_id !== ctx.tenant.id) throw forbidden('Ese empleado no es de tu negocio');
  const mb = managerBranch(ctx);
  if (mb && e.branch_id !== mb) throw forbidden('Ese empleado no es de tu sucursal');
  return e;
}
route('POST', '/api/owner/marks/manual', A, (ctx) => {
  const b = ctx.body;
  if (!['in', 'out', 'extra'].includes(b.action)) throw bad('Elegí si es una entrada, una salida o una entrada extra');
  const emp = empOfTenant(ctx, b.user_id);
  if (emp.status !== 'active') throw bad('Solo se pueden cargar marcas a empleados activos. Habilitalo primero.');
  const ts = parseWhen(b.ts), now = Date.now();
  if (!Number.isFinite(ts)) throw bad('La fecha y hora no son válidas');
  if (ts > now + 5 * 60e3) throw bad('No se puede cargar una marca en el futuro');
  if (ts < now - 90 * 864e5) throw bad('Solo se pueden cargar marcas de los últimos 90 días');
  const note = clean(b.note, 200);
  let branchId = null;
  if (b.branch_id != null && b.branch_id !== '') branchId = checkBranch(ctx, b.branch_id);
  branchId ??= emp.branch_id || get('SELECT id FROM branches WHERE tenant_id=? ORDER BY id LIMIT 1', ctx.tenant.id)?.id || null;
  const prior = get('SELECT * FROM marks WHERE user_id=? AND ts<=? ORDER BY ts DESC, id DESC LIMIT 1', emp.id, ts);
  const next = get('SELECT * FROM marks WHERE user_id=? AND ts>? ORDER BY ts, id LIMIT 1', emp.id, ts);
  const on = isOnKind(prior);
  // Jornada completa: una entrada con su salida en un solo paso (el caso típico de "ayer me olvidé de marcar")
  const pair = b.out_ts !== undefined && b.out_ts !== null && b.out_ts !== '';
  if (pair && b.action === 'out') throw bad('La hora de salida solo se usa al cargar una entrada.');
  const outTs = pair ? parseWhen(b.out_ts) : null;
  if (pair && (!Number.isFinite(outTs) || outTs <= ts)) throw bad('La hora de salida tiene que ser posterior a la de entrada');
  if (pair && outTs > now + 5 * 60e3) throw bad('No se puede cargar una marca en el futuro');
  const kind = b.action === 'in' ? 'in' : b.action === 'extra' ? 'xin' : prior?.kind === 'xin' ? 'xout' : 'out';
  let conflict = null;
  if (b.action === 'out') {
    if (!on) conflict = 'A esa hora no tenía una entrada abierta.';
    else if (next && !isOnKind(next)) conflict = 'Después de esa hora ya hay una salida cargada.';
  } else if (on) conflict = 'A esa hora ya tenía una entrada abierta (falta cargar su salida).';
  else if (pair) {
    const between = get('SELECT 1 FROM marks WHERE user_id=? AND ts>? AND ts<=?', emp.id, ts, outTs);
    const after = get('SELECT * FROM marks WHERE user_id=? AND ts>? ORDER BY ts, id LIMIT 1', emp.id, outTs);
    if (between) conflict = 'Entre la entrada y la salida ya hay otras marcas cargadas.';
    else if (after && !isOnKind(after)) conflict = 'Después de la hora de salida ya hay una salida cargada.';
  } else if (next && isOnKind(next)) conflict = 'Después de esa hora hay otra entrada sin salida en el medio. Si lo que falta es la jornada completa, cargá también la hora de salida.';
  if (conflict && b.force !== true) throw new HttpError(409, 'SEQUENCE_CONFLICT', `${conflict} Si igual querés cargarla, tildá “Forzar” y escribí el motivo.`);
  if (conflict && note.length < 3) throw bad('Para forzar una marca tenés que escribir el motivo.');
  const ins = (k, t) => Number(run("INSERT INTO marks(tenant_id,user_id,branch_id,kind,ts,source,note,created_by) VALUES(?,?,?,?,?,'manual',?,?)",
    ctx.tenant.id, emp.id, branchId, k, t, note || 'Cargada por el dueño', ctx.user.id).lastInsertRowid);
  const ids = tx(() => (pair ? [ins(kind, ts), ins(kind === 'xin' ? 'xout' : 'out', outTs)] : [ins(kind, ts)]));
  audit(ctx.user.id, ctx.tenant.id, 'mark.manual', { user: emp.id, kind, ts, out_ts: outTs, forced: !!conflict });
  return { ok: true, id: ids[0], ids, kind, ts, out_ts: outTs, forced: !!conflict };
});
route('GET', '/api/owner/marks', A, (ctx) => {
  const emp = empOfTenant(ctx, ctx.query.user_id);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ctx.query.date || H.isoDate(Date.now()));
  if (!m) throw bad('Fecha inválida (AAAA-MM-DD)');
  const from = H.arToTs(+m[1], +m[2], +m[3]);
  return { employee: emp.name, marks: all(`SELECT k.id,k.kind,k.ts,k.source,k.note,k.auto,k.dist,b.name branch,u.name created_by FROM marks k
    LEFT JOIN branches b ON b.id=k.branch_id LEFT JOIN users u ON u.id=k.created_by WHERE k.user_id=? AND k.ts>=? AND k.ts<? ORDER BY k.ts, k.id`, emp.id, from, from + 864e5) };
});
route('DELETE', '/api/owner/marks/:id', A, (ctx) => {
  const k = get('SELECT * FROM marks WHERE id=?', Number(ctx.params.id));
  if (!k) throw notFound('Esa marca ya no existe');
  if (k.tenant_id !== ctx.tenant.id) throw forbidden('Esa marca no es de tu negocio');
  if (managerBranch(ctx)) {
    const ku = get('SELECT branch_id FROM users WHERE id=?', k.user_id);
    if (!ku || ku.branch_id !== managerBranch(ctx)) throw forbidden('Esa marca no es de tu sucursal');
  }
  if (k.source !== 'manual') throw bad('Solo se pueden borrar las marcas cargadas a mano. Las del empleado se corrigen cargando la que falta.');
  run('DELETE FROM marks WHERE id=?', k.id);
  audit(ctx.user.id, ctx.tenant.id, 'mark.manual_deleted', { id: k.id, user: k.user_id, kind: k.kind, ts: k.ts });
  return { ok: true };
});

// ---------------- Seguridad visible ----------------
route('GET', '/api/owner/security', A, (ctx) => ({
  events: all(`SELECT e.id,e.kind,e.detail,e.ts,u.name employee FROM security_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.tenant_id=? ORDER BY e.id DESC LIMIT 50`, ctx.tenant.id),
}));
route('DELETE', '/api/owner/security/:id', A, (ctx) => {
  const id = Number(ctx.params.id);
  const row = get('SELECT id FROM security_events WHERE id=? AND tenant_id=?', id, ctx.tenant.id);
  if (!row) throw bad('Evento no encontrado');
  run('DELETE FROM security_events WHERE id=?', id);
  return { ok: true };
});
route('POST', '/api/owner/security/clear', A, (ctx) => {
  const n = get('SELECT COUNT(*) n FROM security_events WHERE tenant_id=?', ctx.tenant.id)?.n || 0;
  run('DELETE FROM security_events WHERE tenant_id=?', ctx.tenant.id);
  return { ok: true, deleted: n };
});

// ---------------- Cancelar suscripción ----------------
route('POST', '/api/owner/plan/cancel', A_OWNER, async (ctx) => {
  const t = ctx.tenant;
  if (t.plan !== 'sub') throw bad('Solo las suscripciones mensuales se pueden cancelar.');
  if (t.cancel_at) return { ok: true, already: true, paid_until: t.paid_until };
  const mp = require('../lib/mp');
  if (mp.enabled()) {
    // H3: la cancelación se registra SOLO si Mercado Pago confirma la baja. Si no, el plan queda exactamente como estaba.
    if (!t.mp_preapproval_id) throw new HttpError(409, 'SUB_NOT_LINKED', 'Todavía estamos confirmando tu suscripción con Mercado Pago. Probá de nuevo en unos minutos o escribinos.');
    let cancelled = false;
    try { cancelled = (await mp.cancelPreapproval(t.mp_preapproval_id))?.status === 'cancelled'; }
    catch (e) {
      console.error('[mp] cancel preapproval', e.status || '', e.message);
      try { cancelled = (await mp.getPreapproval(t.mp_preapproval_id))?.status === 'cancelled'; } catch { /* sin confirmación */ }
    }
    if (!cancelled) {
      audit(ctx.user.id, t.id, 'plan.cancel_failed');
      throw new HttpError(502, 'MP_CANCEL_FAILED', 'No pudimos confirmar la baja con Mercado Pago, así que tu suscripción NO se canceló y sigue activa. Probá de nuevo en unos minutos. Si el problema sigue, escribinos.');
    }
  }
  run('UPDATE tenants SET cancel_at=? WHERE id=?', Date.now(), t.id);
  audit(ctx.user.id, t.id, 'plan.cancelled', { paid_until: t.paid_until });
  return { ok: true, paid_until: t.paid_until };
});

module.exports = { saveFile };
