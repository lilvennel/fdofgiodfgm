'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('../lib/config');
const { route, bad, notFound, HttpError, forbidden, rateLimit } = require('../lib/http');
const { get, all, run, tx } = require('../lib/db');
const sec = require('../lib/security');
const dom = require('../lib/domain');
const H = require('../lib/hours');
const alerts = require('../lib/alerts');
const { clean, isoDateOk, periodOf, decodeUpload } = require('./common');
const fc = require('../lib/fieldcrypto');
const { saveFile } = require('./owner');

const { haversine } = require('../lib/geo');

const E = { auth: ['employee', 'manager', 'hr'] }; // también encargado y RRHH marcan y piden permisos

function logSec(ctx, kind, detail) {
  run('INSERT INTO security_events(tenant_id,user_id,kind,detail,ts) VALUES(?,?,?,?,?)', ctx.tenant.id, ctx.user.id, kind, detail || null, Date.now());
}
// La última marca se toma por fecha (no por orden de carga): así una marca retroactiva del dueño no rompe el estado.
const lastMark = (uid) => get('SELECT * FROM marks WHERE user_id=? ORDER BY ts DESC, id DESC LIMIT 1', uid);
const isOn = (m) => !!m && (m.kind === 'in' || m.kind === 'xin');

route('GET', '/api/me/inbox', E, (ctx) => {
  const uid = ctx.user.id, tid = ctx.tenant.id;
  const notifs = [];
  // recibos pendientes de firmar
  const recibos = all("SELECT id,period,title,created_at FROM docs WHERE user_id=? AND kind='recibo' AND (sign_status IS NULL OR sign_status='pending') ORDER BY id DESC LIMIT 5", uid);
  for (const r of recibos) notifs.push({ type: 'recibo', priority: 'high', title: 'Recibo de sueldo disponible', detail: r.period || r.title || '', at: r.created_at, href: 'docs' });
  // permisos decididos recientes
  const perms = all("SELECT id,type,status,from_date,to_date,decided_at FROM permits WHERE user_id=? AND status IN ('approved','rejected') AND decided_at > ? ORDER BY decided_at DESC LIMIT 5", uid, Date.now() - 30*864e5);
  for (const p of perms) notifs.push({ type: 'permit', priority: 'high', title: p.status === 'approved' ? 'Solicitud aprobada' : 'Solicitud rechazada', detail: (p.type || '') + ' · ' + (p.from_date || ''), at: p.decided_at, href: 'permisos' });
  // certificados
  const certs = all("SELECT id,title,created_at FROM docs WHERE user_id=? AND kind='cert' ORDER BY id DESC LIMIT 3", uid);
  for (const c of certs) notifs.push({ type: 'cert', priority: 'normal', title: 'Certificado cargado', detail: c.title || '', at: c.created_at, href: 'certs' });
  // jornada abierta sin salida (ayer)
  const open = get("SELECT ts FROM marks WHERE user_id=? AND kind='in' ORDER BY ts DESC LIMIT 1", uid);
  const lastOut = get("SELECT ts FROM marks WHERE user_id=? AND kind IN ('out','extra') ORDER BY ts DESC LIMIT 1", uid);
  if (open && (!lastOut || lastOut.ts < open.ts) && open.ts < Date.now() - 12*3600e3) {
    notifs.push({ type: 'fichaje', priority: 'high', title: 'Recordatorio de fichaje', detail: 'Tenés una entrada sin salida registrada', at: open.ts, href: 'marcar' });
  }
  notifs.sort((a,b) => (b.at||0)-(a.at||0));
  return { items: notifs.slice(0, 20) };
});
route('GET', '/api/me/calendar', E, (ctx) => {
  const uid = ctx.user.id;
  const today = H.isoDate(Date.now()), in60 = H.isoDate(Date.now() + 60 * 864e5); // hora de Argentina, no la del servidor
  const upcoming = all("SELECT date,name,kind FROM holidays WHERE date >= ? AND date <= ? ORDER BY date LIMIT 15", today, in60);
  const vac = all("SELECT type,from_date,to_date,status FROM permits WHERE user_id=? AND status='approved' AND to_date >= ? ORDER BY from_date LIMIT 10", uid, today);
  const shift = ctx.user.shift_start || ctx.tenant.schedule_start || null;
  const shiftEnd = ctx.tenant.schedule_end || null;
  return { holidays: upcoming, vacations: vac, shift_start: shift, shift_end: shiftEnd, hire_date: ctx.user.hire_date || null };
});
route('GET', '/api/me/payroll-summary', E, (ctx) => {
  const uid = ctx.user.id;
  const period = H.currentPeriod();
  const hours = (() => {
    try {
      const r = H.periodRange(period);
      const n = get("SELECT COUNT(*) n FROM marks WHERE user_id=? AND ts >= ? AND ts < ?", uid, r.from, r.to).n;
      return { marks: n, period };
    } catch { return { marks: 0, period }; }
  })();
  const recibos = all("SELECT id,period,title,sign_status,created_at FROM docs WHERE user_id=? AND kind='recibo' ORDER BY period DESC LIMIT 12", uid);
  return { period: hours.period, recibos, marks_this_month: hours.marks };
});
route('GET', '/api/me/requests', E, (ctx) => {
  const rows = all("SELECT id,kind,subject,body,status,reply,created_at,updated_at FROM emp_requests WHERE user_id=? ORDER BY id DESC LIMIT 50", ctx.user.id);
  return { requests: rows };
});
route('POST', '/api/me/requests', E, (ctx) => {
  const kind = ['rh', 'horas', 'fichaje', 'turno', 'otro'].includes(ctx.body.kind) ? ctx.body.kind : 'otro';
  const subject = clean(ctx.body.subject, 120);
  const body = clean(ctx.body.body, 2000);
  if (subject.length < 3) throw bad('Asunto muy corto');
  if (body.length < 5) throw bad('Describí el pedido');
  const r = run('INSERT INTO emp_requests(tenant_id,user_id,kind,subject,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    ctx.tenant.id, ctx.user.id, kind, subject, body, 'pending', Date.now(), Date.now());
  const rid = Number(r.lastInsertRowid);
  const labels = { rh: 'RRHH', horas: 'Horas', fichaje: 'Fichaje', turno: 'Turno', otro: 'Otro' };
  try {
    run("INSERT INTO notifs(tenant_id,type,user_id,ref_id,text,detail,created_at) VALUES(?,?,?,?,?,?,?)",
      ctx.tenant.id, 'emp_request', ctx.user.id, rid,
      'Nueva solicitud · ' + (labels[kind] || kind),
      (ctx.user.name || 'Empleado') + ': ' + subject, Date.now());
  } catch (_) {}
  return { ok: true, id: rid };
});
route('GET', '/api/me/holidays', E, (ctx) => {
  const prefix = H.currentPeriod();
  const rows = all("SELECT date,name,kind FROM holidays WHERE substr(date,1,7)=? ORDER BY date", prefix);
  // próximos 45 días (hora de Argentina)
  const upcoming = all("SELECT date,name,kind FROM holidays WHERE date >= ? AND date <= ? ORDER BY date LIMIT 8", H.isoDate(Date.now()), H.isoDate(Date.now() + 45 * 864e5));
  return { month: rows, upcoming };
});
route('GET', '/api/me/state', E, (ctx) => {
  const m = lastMark(ctx.user.id);
  const p = H.arParts(Date.now());
  const dayStart = H.arToTs(p.y, p.m, p.d);
  return {
    on: isOn(m), extra: m?.kind === 'xin', since: isOn(m) ? m.ts : null,
    today: all('SELECT kind,ts,auto FROM marks WHERE user_id=? AND ts>=? ORDER BY ts', ctx.user.id, dayStart),
    shift_start: ctx.user.shift_start,
  };
});

route('POST', '/api/me/mark', E, (ctx) => {
  rateLimit('mark:' + ctx.user.id, 12, 60e3);
  const { action, code, lat, lng, accuracy } = ctx.body;
  if (!['in', 'out', 'extra'].includes(action)) throw bad('Acción inválida');
  const allowQr = ctx.tenant.mark_qr !== 0;
  const allowGps = ctx.tenant.mark_gps !== 0;
  const viaQr = typeof code === 'string' && code.trim() !== '';
  if (viaQr && !allowQr) throw bad('Tu empleador no habilita marcación por QR');
  if (!viaQr && !allowGps) throw bad('Tu empleador no habilita marcación por GPS desde el celular');
  let branch;
  if (viaQr) { // QR opcional: si viene un código, se valida como siempre
    const [bid, token] = code.split('.');
    branch = bid && get('SELECT * FROM branches WHERE id=? AND tenant_id=?', Number(bid), ctx.tenant.id);
    if (!branch || !sec.qrValid(branch.id, ctx.tenant.id, token)) {
      logSec(ctx, 'qr_invalid', branch ? `QR vencido en ${branch.name}` : 'QR de otro negocio o inexistente');
      throw new HttpError(400, 'QR_INVALID', 'El QR venció o no es de tu negocio. Volvé a escanear el código de la pantalla del local, o marcá desde tu panel sin QR.');
    }
  } else { // método principal: desde el panel, con la ubicación validada en el servidor
    const asked = ctx.body.branch_id != null && ctx.body.branch_id !== '' ? Number(ctx.body.branch_id) : null;
    if (asked !== null) {
      branch = get('SELECT * FROM branches WHERE id=? AND tenant_id=?', asked, ctx.tenant.id);
      if (!branch) throw bad('Esa sucursal no es de tu negocio. Elegí una de la lista.', 'BAD_BRANCH');
    } else {
      branch = (ctx.user.branch_id && get('SELECT * FROM branches WHERE id=? AND tenant_id=?', ctx.user.branch_id, ctx.tenant.id))
        || get('SELECT * FROM branches WHERE tenant_id=? ORDER BY id LIMIT 1', ctx.tenant.id);
    }
    if (!branch) {
      throw new HttpError(409, 'NO_LOCATION_CONFIG', 'No hay sucursal configurada. Avisale al dueño.');
    }
    if (allowGps && (branch.lat == null || branch.lng == null)) {
      throw new HttpError(409, 'NO_LOCATION_CONFIG', 'El dueño todavía no cargó la ubicación del local, así que no se puede marcar con GPS. Avisale para que la configure (Panel → Local → Ubicación).');
    }
  }

  // Geocerca: solo si GPS está habilitado. Si solo hay QR, no se exige ubicación.
  let dist = null;
  if (allowGps && branch.lat != null && branch.lng != null) {
    const la = Number(lat), ln = Number(lng), acc = Number(accuracy) || 0;
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
      logSec(ctx, 'geo_missing', 'Sin ubicación');
      throw new HttpError(400, 'GEO_REQUIRED', 'No recibimos tu ubicación. Activá el GPS, permití la ubicación para este sitio en el navegador y probá de nuevo.');
    }
    dist = Math.round(haversine(la, ln, branch.lat, branch.lng));
    const allowed = branch.radius + Math.min(acc, 25);
    if (dist > allowed) {
      logSec(ctx, 'geo_out', `${dist} m de ${branch.name}`);
      const recentGeo = !!get("SELECT 1 FROM notifs WHERE user_id=? AND type='geo_out' AND created_at>=?", ctx.user.id, Date.now() - 30 * 60e3); // un aviso cada 30 min
      const geoDetail = `${dist} m de ${branch.name} · rechazado`;
      if (!recentGeo) run("INSERT INTO notifs(tenant_id,type,user_id,text,detail,created_at) VALUES(?,?,?,?,?,?)",
        ctx.tenant.id, 'geo_out', ctx.user.id, `Fuera de zona — ${ctx.user.name}`, geoDetail, Date.now());
      if (!recentGeo) alerts.notifyOwner(ctx.tenant.id, { title: `Fuera de zona — ${ctx.user.name}`, detail: geoDetail });
      throw new HttpError(403, 'GEO_OUT', `Estás a ${dist} m de ${branch.name} y el máximo permitido es ${branch.radius} m. Acercate al local y probá de nuevo; si ya estás adentro, esperá unos segundos a que el GPS mejore.`, { dist });
    }
  } else if (!allowGps && viaQr) {
    // Solo QR: no se valida GPS
    dist = null;
  } else if (!allowGps && !viaQr) {
    throw bad('Tu empleador deshabilitó el GPS. Escaneá el QR del local para marcar.');
  }

  const now = Date.now();
  let kind;
  tx(() => {
    const m = lastMark(ctx.user.id), on = isOn(m); // dentro de la transacción: evita doble entrada por doble toque
  if (action === 'in') { if (on) throw new HttpError(409, 'ALREADY_IN', 'Ya tenés una entrada abierta. Si terminaste tu jornada, marcá Salida.'); kind = 'in'; }
  else if (action === 'extra') {
    if (!ctx.tenant.allow_extra) throw forbidden('Tu empleador no habilitó las horas extra. Consultalo con él si las necesitás.', 'EXTRA_OFF');
    if (on) throw new HttpError(409, 'ALREADY_IN', 'Todavía tenés una entrada abierta. Marcá Salida antes de empezar horas extra.'); kind = 'xin';
  } else { if (!on) throw new HttpError(409, 'NOT_IN', 'No tenés una entrada abierta. Marcá Entrada primero.'); kind = m.kind === 'xin' ? 'xout' : 'out'; }

    run('INSERT INTO marks(tenant_id,user_id,branch_id,kind,ts,lat,lng,accuracy,dist,source) VALUES(?,?,?,?,?,?,?,?,?,?)',
      ctx.tenant.id, ctx.user.id, branch.id, kind, now, Number.isFinite(Number(lat)) ? Number(lat) : null, Number.isFinite(Number(lng)) ? Number(lng) : null, Number(accuracy) || null, dist, viaQr ? 'qr' : 'panel');
    if (kind === 'in') {
      const shift = ctx.user.shift_start || ctx.tenant.schedule_start;
      if (shift) {
        const p = H.arParts(now), [sh, sm] = shift.split(':').map(Number);
        const late = p.hh * 60 + p.mm - (sh * 60 + sm);
        const dayStart = H.arToTs(p.y, p.m, p.d);
        const tol = Number(ctx.tenant.late_tolerance_min) || 0;
        if (late > tol && !get("SELECT 1 FROM notifs WHERE user_id=? AND type='late' AND created_at>=?", ctx.user.id, dayStart)) {
          const lateDetail = `${H.pad(p.hh)}:${H.pad(p.mm)} · turno ${shift} (tol. ${tol} min)`;
          run("INSERT INTO notifs(tenant_id,type,user_id,text,detail,created_at) VALUES(?,?,?,?,?,?)",
            ctx.tenant.id, 'late', ctx.user.id, `Llegó tarde — ${ctx.user.name}`, lateDetail, now);
          alerts.notifyOwner(ctx.tenant.id, { title: `Llegó tarde — ${ctx.user.name}`, detail: lateDetail });
        }
      }
    }
  });
  return { ok: true, kind, ts: now, branch: branch.name, dist, source: viaQr ? 'qr' : 'panel' };
});

// Sucursales del negocio (para elegir dónde marco cuando hay más de una)
route('GET', '/api/me/branches', E, (ctx) => {
  const allB = all('SELECT id,name,lat IS NOT NULL AS located FROM branches WHERE tenant_id=? ORDER BY id', ctx.tenant.id)
    .map((b) => ({ id: b.id, name: b.name, located: !!b.located }));
  const mine = ctx.user.branch_id;
  // El empleado solo ve/usa la sucursal que le asignó el empleador
  const branches = mine ? allB.filter((b) => b.id === mine) : allB.slice(0, 1);
  return { branches: branches.length ? branches : allB.slice(0, 1), mine: mine || (branches[0] && branches[0].id) || null };
});

route('GET', '/api/me/hours', E, (ctx) => {
  const period = periodOf(ctx.query.period), r = H.periodRange(period), now = Date.now();
  const ms = all('SELECT kind,ts FROM marks WHERE user_id=? AND ts>=? AND ts<? ORDER BY ts,id', ctx.user.id, r.from - 3 * 864e5, r.to);
  const s = H.summarize(ms, r.from, r.to, now);
  return {
    period, normal_h: s.normal_h, extra_h: s.extra_h,
    expected_h: H.expectedHours(period, ctx.tenant, require('../lib/domain').holidaySet(period)),
    days: H.intervals(ms, now).filter((i) => i.start >= r.from && i.start < r.to).map((i) => ({ start: i.start, end: i.end, extra: i.extra, open: !!i.open })).reverse(),
  };
});

// ---------- Vacaciones y permisos ----------
const PERMIT_TYPES = ['dia', 'vacaciones', 'maternidad', 'paternidad', 'casamiento', 'fallecimiento', 'examen', 'otro'];
function vacationInfo(user) {
  const v = H.vacationDays(user.hire_date);
  const year = String(H.arParts(Date.now()).y);
  const rows = all("SELECT from_date,to_date,status FROM permits WHERE user_id=? AND type='vacaciones' AND substr(from_date,1,4)=? AND status IN ('approved','pending')", user.id, year);
  const sum = (st) => rows.filter((r) => r.status === st).reduce((a, r) => a + H.daysBetween(r.from_date, r.to_date), 0);
  const used = sum('approved'), pending = sum('pending');
  return { years: Math.round(v.years * 10) / 10, entitled: v.days, used, pending, available: Math.max(0, v.days - used - pending), approx: !!v.approx };
}
route('GET', '/api/me/vacation', E, (ctx) => vacationInfo(ctx.user));

route('GET', '/api/me/permits', E, (ctx) => ({ permits: all('SELECT id,type,from_date,to_date,note,status,created_at FROM permits WHERE user_id=? ORDER BY id DESC LIMIT 50', ctx.user.id) }));
route('POST', '/api/me/permits', E, (ctx) => {
  if (!dom.planFeatures(ctx.tenant).permits) throw forbidden('Tu plan no incluye permisos y licencias. Pedile al empleador que actualice a Pro o Completo.', 'PLAN_LOCKED');
  rateLimit('permit:' + ctx.user.id, 10, 3600e3);
  const b = ctx.body, type = b.type;
  if (!PERMIT_TYPES.includes(type)) throw bad('Tipo de permiso inválido');
  if (!isoDateOk(b.from)) throw bad('Fecha "desde" inválida');
  const to = type === 'dia' ? b.from : b.to;
  if (!isoDateOk(to)) throw bad('Fecha "hasta" inválida');
  if (to < b.from) throw bad('La fecha "hasta" no puede ser anterior a "desde"');
  const days = H.daysBetween(b.from, to);
  if (days > 400) throw bad('El período es demasiado largo');
  if (type === 'vacaciones') {
    const v = vacationInfo(ctx.user);
    if (days > v.available) throw bad(`Pedís ${days} días y tenés ${v.available} disponibles`);
  }
  const labels = { dia: 'Día libre', vacaciones: 'Vacaciones', maternidad: 'Maternidad', paternidad: 'Paternidad', casamiento: 'Casamiento', fallecimiento: 'Fallecimiento', examen: 'Examen', otro: 'Otro' };
  tx(() => {
    const r = run('INSERT INTO permits(tenant_id,user_id,type,from_date,to_date,note,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
      ctx.tenant.id, ctx.user.id, type, b.from, to, clean(b.note, 300) || null, 'pending', Date.now());
    run("INSERT INTO notifs(tenant_id,type,user_id,ref_id,text,detail,created_at) VALUES(?,?,?,?,?,?,?)",
      ctx.tenant.id, 'permit', ctx.user.id, Number(r.lastInsertRowid), `${labels[type]} — ${ctx.user.name}`, `${b.from}${to !== b.from ? ' al ' + to : ''} · ${days} día${days > 1 ? 's' : ''}`, Date.now());
  });
  return { ok: true };
});

// ---------- Documentos ----------
route('GET', '/api/me/docs', E, (ctx) => {
  const cols = 'id,kind,title,period,cert_type,filename,created_at,sign_status,sign_note,signed_at';
  return {
    certs: all(`SELECT ${cols} FROM docs WHERE user_id=? AND kind='cert' ORDER BY id DESC`, ctx.user.id),
    recibos: dom.planFeatures(ctx.tenant).recibos ? all(`SELECT ${cols} FROM docs WHERE user_id=? AND kind='recibo' ORDER BY period DESC`, ctx.user.id) : null,
  };
});
route('POST', '/api/me/certs', { auth: ['employee', 'manager', 'hr'], limit: 8 * 1024 * 1024 }, (ctx) => {
  rateLimit('cert:' + ctx.user.id, 10, 3600e3);
  const types = { medico: 'Certificado médico', estudio: 'Estudio / examen', dni: 'DNI / documentación', otro: 'Otro' };
  const ct = types[ctx.body.cert_type] ? ctx.body.cert_type : 'otro';
  const up = decodeUpload(ctx.body.data, ctx.body.filename);
  if (up.buf.length > cfg.MAX_UPLOAD_BYTES) throw new HttpError(413, 'TOO_LARGE', 'El archivo supera los 5 MB');
  if (get("SELECT COUNT(*) n FROM docs WHERE user_id=? AND kind='cert'", ctx.user.id).n >= 100) throw bad('Llegaste al máximo de certificados');
  const rel = saveFile(ctx.tenant.id, up);
  run('INSERT INTO docs(tenant_id,user_id,kind,title,cert_type,filename,mime,path,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    ctx.tenant.id, ctx.user.id, 'cert', types[ct], ct, up.filename, up.mime, rel, Date.now());
  return { ok: true };
});
route('POST', '/api/me/docs/:id/sign', E, (ctx) => {
  if (!dom.planFeatures(ctx.tenant).recibos) throw new HttpError(402, 'MOD_LOCKED', 'El módulo Recibos no está activo');
  const d = get("SELECT * FROM docs WHERE id=? AND user_id=? AND kind='recibo'", Number(ctx.params.id), ctx.user.id);
  if (!d) throw notFound();
  if (d.sign_status !== 'pending') throw bad('Este recibo ya fue firmado');
  const result = ctx.body.result;
  if (!['conforme', 'desconforme'].includes(result)) throw bad('Resultado inválido');
  const note = clean(ctx.body.note, 300);
  if (result === 'desconforme' && note.length < 3) throw bad('Contanos el motivo de tu disconformidad');
  run('UPDATE docs SET sign_status=?, sign_note=?, signed_at=?, signed_name=? WHERE id=?',
    result, note || null, Date.now(), ctx.user.name, d.id);
  return { ok: true, signed_name: ctx.user.name, signed_at: Date.now(), result };
});

// Descarga autenticada (dueño del negocio o el empleado titular)
route('GET', '/api/docs/:id/file', { auth: 'user' }, (ctx) => {
  const d = get('SELECT * FROM docs WHERE id=? AND tenant_id=?', Number(ctx.params.id), ctx.user.tenant_id);
  if (!d) throw notFound();
  if (d.user_id !== ctx.user.id && !['owner', 'manager', 'hr', 'superadmin'].includes(ctx.user.role)) throw notFound();
  if (ctx.user.role === 'manager' && d.user_id !== ctx.user.id) { // el encargado solo ve documentos de su sucursal
    const du = get('SELECT branch_id FROM users WHERE id=?', d.user_id);
    if (!du || du.branch_id !== ctx.user.branch_id) throw notFound();
  }
  const file = path.join(cfg.DATA_DIR, 'uploads', d.path);
  if (!file.startsWith(path.join(cfg.DATA_DIR, 'uploads') + path.sep) || !fs.existsSync(file)) throw notFound('Archivo no disponible');
  return { __file: { buf: fs.readFileSync(file), filename: d.filename, mime: d.mime, inline: true } };
});

// Firma del empleador para mostrarla en un recibo (dueño del negocio o empleado titular del recibo)
route('GET', '/api/docs/:id/sign', { auth: 'user' }, (ctx) => {
  const d = get("SELECT id,user_id FROM docs WHERE id=? AND tenant_id=? AND kind='recibo'", Number(ctx.params.id), ctx.user.tenant_id);
  if (!d) throw notFound();
  if (d.user_id !== ctx.user.id && !['owner', 'manager', 'hr', 'superadmin'].includes(ctx.user.role)) throw notFound();
  const row = get('SELECT sign_path FROM tenants WHERE id=?', ctx.user.tenant_id);
  if (!row || !row.sign_path) throw notFound('Sin firma cargada');
  const base = path.join(cfg.DATA_DIR, 'uploads');
  const file = path.join(base, row.sign_path);
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) throw notFound('Sin firma cargada');
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { __file: { buf: fs.readFileSync(file), filename: 'firma' + ext, mime, inline: true, cache: 'private, max-age=60' } };
});

// ---------- Perfil y cumpleaños ----------
route('PATCH', '/api/me/profile', E, (ctx) => {
  const b = ctx.body;
  const u = fc.decryptUserFields({ ...ctx.user }) || ctx.user;
  if (b.birthday && !isoDateOk(b.birthday)) throw bad('Fecha de cumpleaños inválida');
  const pick = (key, max) => {
    if (b[key] === undefined) return u[key] || '';
    let v = clean(b[key], max);
    // Nunca re-guardar ciphertext si el form mandó el valor encriptado por error
    if (typeof v === 'string' && v.startsWith('enc:')) v = u[key] || '';
    return v;
  };
  const phone = pick('phone', 40);
  const address = pick('address', 120);
  const emg_name = pick('emg_name', 80);
  const emg_phone = pick('emg_phone', 40);
  const dni = pick('dni', 20);
  const personal_email = pick('personal_email', 120);
  const notes = pick('notes', 400);
  const emg_rel = b.emg_rel !== undefined ? clean(b.emg_rel, 40) : (u.emg_rel || '');
  const blood_type = pick('blood_type', 8);
  const obra_social = pick('obra_social', 80);
  const birthday = b.birthday !== undefined ? (b.birthday || null) : u.birthday;
  run(`UPDATE users SET phone=?,address=?,birthday=?,emg_name=?,emg_rel=?,emg_phone=?,
    dni=?,personal_email=?,blood_type=?,obra_social=?,notes=? WHERE id=?`,
    fc.encrypt(phone || null), fc.encrypt(address || null), birthday,
    fc.encrypt(emg_name || null), emg_rel || null, fc.encrypt(emg_phone || null),
    fc.encrypt(dni || null), fc.encrypt(personal_email || null),
    fc.encrypt(blood_type || null), fc.encrypt(obra_social || null), fc.encrypt(notes || null),
    ctx.user.id);
  return { ok: true };
});

route('GET', '/api/team/birthdays', { auth: 'user' }, (ctx) => {
  const p = H.arParts(Date.now()), today = Date.UTC(p.y, p.m - 1, p.d);
  const rows = all("SELECT name,birthday FROM users WHERE tenant_id=? AND role='employee' AND status='active' AND birthday IS NOT NULL", ctx.user.tenant_id);
  const out = rows.map((r) => {
    const [, m, d] = r.birthday.split('-').map(Number);
    let next = Date.UTC(p.y, m - 1, d); if (next < today) next = Date.UTC(p.y + 1, m - 1, d);
    return { name: r.name, day: d, month: m, in_days: Math.round((next - today) / 864e5) };
  }).sort((a, b) => a.in_days - b.in_days).slice(0, 8);
  return { birthdays: out };
});
