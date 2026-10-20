import { S, acts, forms, html, raw, $, get, post, patch, api, render, patchEl, toast, openModal, closeModal, money, fmtH, fmtTime, fmtDateTime, fmtDay, periodOptions, periodLabel, badge, applyTheme, copyText, fileToBase64, todayAR } from './util.js';
import { qrSvg } from './qr.js';
import { startCheckout } from './app.js';

const O = { tab: 'inicio', showNews: false, period: null, qrBranch: null, qrTimer: null, emps: [], branches: [] };
const TABS_OWNER = [['inicio', 'Inicio'], ['notif', 'Notif.'], ['solicitudes', 'Solicitudes'], ['empleados', 'Empleados'], ['qr', 'Local'], ['sucursales', 'Sucursales'], ['reportes', 'Reportes'], ['facturas', 'Facturas'], ['config', 'Config']];
const TABS_MANAGER = [['inicio', 'Inicio'], ['notif', 'Notif.'], ['solicitudes', 'Permisos'], ['empleados', 'Mi equipo'], ['mi-marcar', 'Marcar'], ['mi-permisos', 'Mis pedidos'], ['reportes', 'Reportes']];
const TABS_HR = [['inicio', 'Inicio'], ['notif', 'Notif.'], ['solicitudes', 'Solicitudes'], ['empleados', 'Empleados'], ['mi-marcar', 'Marcar'], ['mi-permisos', 'Mis pedidos'], ['reportes', 'Reportes']];
const tabsFor = () => {
  const r = S.me?.user?.role;
  if (r === 'manager') return TABS_MANAGER;
  if (r === 'hr') return TABS_HR;
  return TABS_OWNER;
};
const isManager = () => S.me?.user?.role === 'manager';
const isHr = () => S.me?.user?.role === 'hr';
const isStaffOnly = () => isManager() || isHr(); // no dueño

const SWATCHES = ['#0f766e', '#16a34a', '#2563eb', '#7c3aed', '#db2777', '#ea580c'];
const loading = html`<p class="muted" style="padding:24px;text-align:center"><span class="spinner"></span></p>`;

export async function renderOwner() {
  const { tenant, notice } = S.me;
  const allowed = tabsFor().map(([k]) => k);
  if (!allowed.includes(O.tab)) O.tab = 'inicio';
  if (isStaffOnly()) O.ob = null;
  else { try { O.ob = await get('/api/owner/onboarding'); } catch { O.ob = null; } }
  const ob = O.ob;
  render(html`
  <header class="topbar topbar-pro"><div class="brand">${tenant.logo_url
    ? html`<img class="brand-logo" src="${tenant.logo_url}" alt="" width="34" height="34">`
    : html`<div class="brand-mark brand-mark-logo" aria-hidden="true"></div>`}<span>${tenant.name}</span></div>
    <button class="btn btn-sm btn-outline" data-act="feedback-open" data-ctx="owner/${O.tab}" type="button" aria-label="Reportar un problema o enviar una idea">💬</button>
    <button class="btn btn-sm btn-outline" data-act="dark" type="button" aria-label="Cambiar tema">🌓</button>
    <button class="btn btn-sm btn-outline" data-act="logout" type="button">Cerrar sesión</button></header>
  <main class="dash-body">
    ${S.cfg.email_verification && !S.me.user.email_verified ? html`<div class="alert alert-warn row between"><span>✉️ Confirmá tu email: te enviamos un link a ${S.me.user.email}.</span><button class="link" type="button" data-act="resend-verify">Reenviar email</button></div>` : ''}
    ${isManager() ? html`<div class="alert alert-info" style="background:#ecfeff;border-color:#a5f3fc;color:#155e75">👤 <strong>Modo encargado</strong> · Ves tu sucursal (equipo, permisos, reportes). También podés <strong>marcar asistencia</strong> y pedir permisos; tus pedidos los autoriza RRHH o el dueño. No gestionás pagos ni la config general.</div>` : ''}
    ${isHr() ? html`<div class="alert alert-info" style="background:#f0fdf4;border-color:#bbf7d0;color:#166534">👥 <strong>Modo RRHH</strong> · Ves asistencia y permisos de todo el negocio (autorizás empleados y encargados). También podés <strong>marcar</strong> y pedir permisos; tus pedidos los autoriza el dueño. No gestionás pagos ni la config general.</div>` : ''}
    ${!isStaffOnly() && tenant.trial && tenant.trial_until ? html`<div class="alert alert-info" style="background:#fff7ed;border-color:#fed7aa;color:#9a3412">🎁 <strong>Prueba gratis</strong> · Acceso hasta el <strong>${new Date(tenant.trial_until).toLocaleDateString('es-AR')}</strong>. Mercado Pago cobrará el plan automáticamente al terminar (si no cancelás la suscripción).</div>` : ''}
    ${!isStaffOnly() && notice ? html`<div class="alert alert-warn">📈 ${notice}</div>` : ''}
    ${!isStaffOnly() && ob && ob.dismissed && !ob.all_done ? html`<div class="alert alert-warn row between"><span>🧭 Te faltan ${ob.total - ob.completed} paso(s) para dejar todo listo.</span><button class="link" type="button" data-act="ob-reopen">Ver checklist</button></div>` : ''}
    <div class="tabs" role="tablist">${tabsFor().map(([k, l]) => html`<button class="tab ${O.tab === k ? 'active' : ''}" data-act="o-tab" data-tab="${k}" type="button">${l}${k === 'notif' ? html` <span id="notif-count" class="pending-badge hidden"></span>` : ''}</button>`)}</div>
    <div id="tab-body">${loading}</div>
  </main>`);
  loadTab();
}
acts['o-tab'] = (el) => {
  const allowed = tabsFor().map(([k]) => k);
  O.tab = allowed.includes(el.dataset.tab) ? el.dataset.tab : 'inicio';
  renderOwner();
};


function newsBlock(news) {
  const entries = news?.entries || [];
  if (!entries.length) {
    return html`<div class="card"><strong>📣 Novedades</strong><p class="muted">Todavía no hay novedades.</p></div>`;
  }
  const open = !!O.showNews;
  const list = open ? entries : entries.slice(0, 1);
  return html`<div class="card">
    <div class="row between">
      <strong>📣 Novedades</strong>
      <button class="btn btn-outline btn-sm" type="button" data-act="news-toggle">${open ? 'Ocultar' : 'Ver todas (' + entries.length + ')'}</button>
    </div>
    ${list.map((n) => html`<div class="news-item">
      <div class="row between"><strong>Versión ${n.version}</strong><span class="muted">${fmtDay(n.date)}</span></div>
      ${open ? [['added', '➕ Agregado'], ['changed', '🔧 Cambiado'], ['removed', '➖ Quitado']].filter(([k]) => n[k]).map(([k, l]) => html`<div class="muted" style="margin-top:4px">${l}</div><ul>${n[k].split('\n').filter(Boolean).map((li) => html`<li>${li}</li>`)}</ul>`) : html`<p class="muted" style="font-size:.8rem;margin:4px 0 0">Tocá “Ver todas” para el detalle.</p>`}
    </div>`)}
    ${!open && entries.length > 1 ? html`<p class="muted" style="font-size:.8rem;margin-top:6px">+ ${entries.length - 1} versión(es) anterior(es)</p>` : ''}
  </div>`;
}

async function loadTab() {
  clearInterval(O.qrTimer);
  const tabs = { inicio: tabInicio, notif: tabNotif, solicitudes: tabSolicitudes, empleados: tabEmpleados, qr: tabQr, sucursales: tabSucursales, reportes: tabReportes, facturas: tabFacturas, config: tabConfig, 'mi-marcar': tabMiMarcar, 'mi-permisos': tabMiPermisos };
  const fn = tabs[O.tab] || tabInicio;
  try {
    await fn();
  } catch (e) {
    const body = document.querySelector('#tab-body');
    if (body) body.innerHTML = '<p class="muted" style="padding:24px;text-align:center">No se pudo cargar. Tocá otra pestaña o recargá.</p>';
    const { fail } = await import('./app.js');
    fail(e);
  }
}
const setBadge = (n) => { const b = $('#notif-count'); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); } };

// ---------- Primeros pasos (onboarding) ----------
const obCard = (ob) => {
  if (!ob || ob.dismissed) return '';
  if (ob.all_done) return html`<div class="card ob-card"><div class="row between"><div><strong>🎉 ¡Todo listo!</strong><div class="muted">Completaste la configuración inicial de AsistOK. Tu equipo ya puede marcar asistencia. Si necesitás el checklist de nuevo, está en Config.</div></div><button class="btn btn-outline btn-sm" data-act="ob-dismiss" type="button">Cerrar</button></div></div>`;
  const nextIdx = ob.steps.findIndex((s) => !s.done);
  return html`<div class="card ob-card"><div class="row between"><div><strong>🧭 Configurá AsistOK</strong><div class="muted">${ob.completed} de ${ob.total} pasos · guía según tu negocio</div></div><button class="btn btn-outline btn-sm" data-act="ob-dismiss" type="button">Omitir por ahora</button></div>
    <div class="ob-bar"><i style="width:${(ob.completed / ob.total) * 100}%"></i></div>
    ${ob.steps.map((st, i) => {
      const isNext = i === nextIdx;
      const showDetail = !st.done && (isNext || i <= nextIdx + 1);
      return html`<div class="ob-step ${st.done ? 'done' : ''} ${isNext ? 'ob-next' : ''}"><div class="ob-dot">${st.done ? '✓' : i + 1}</div><div class="grow"><div class="t">${st.title}</div>
        ${st.done ? html`<div class="h" style="opacity:.7">Listo</div>` : showDetail ? html`<div class="h">${st.hint}</div><div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn btn-primary btn-sm" data-act="ob-go" data-tab="${st.go}" type="button">Ir a ${st.go === 'qr' ? 'Local' : st.go === 'config' ? 'Config' : st.go === 'empleados' ? 'Empleados' : st.go === 'reportes' ? 'Reportes' : 'Inicio'}</button>${st.key !== 'business' ? html`<button class="btn btn-outline btn-sm" data-act="ob-done" data-step="${st.key}" type="button">Ya lo hice</button>` : ''}</div>` : html`<div class="h muted">Siguiente después del paso actual</div>`}</div></div>`;
    })}</div>`;
};
const obAct = (body) => async () => { O.ob = await post('/api/owner/onboarding', body); renderOwner(); };
acts['ob-dismiss'] = obAct({ action: 'dismiss' });
acts['ob-reopen'] = async () => { O.tab = 'inicio'; await obAct({ action: 'reopen' })(); };
acts['ob-done'] = async (el) => { await obAct({ action: 'done', step: el.dataset.step })(); };
acts['ob-go'] = (el) => { O.tab = el.dataset.tab; renderOwner(); };

// ---------- Inicio ----------
async function tabInicio() {
  O.period ||= new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7);
  const d = await get('/api/owner/dashboard?period=' + O.period);
  O.ob = d.onboarding; setBadge(d.notif_count);
  const t0 = d.totals, w = d.workdays, hols = d.holidays.filter((h) => h.kind === 'feriado');
  const days = `${w.weekdays} días hábiles${w.saturdays ? ` + ${w.saturdays} sábados` : ''}`;
  const pct = Math.min(100, t0.pct || 0);
  const maxH = Math.max(...d.employees.map((e) => e.normal_h + e.extra_h), 1);
  const on = d.employees.filter((e) => e.state !== 'fuera').length;
  const off = d.employees.length - on;
  patchEl('#tab-body', html`
  ${obCard(O.ob)}
  <div class="dash-hero">
    <div>
      <div class="muted" style="font-size:.8rem;font-weight:600">Panel en vivo · ${periodLabel(O.period)}</div>
      <div class="dash-hero-title">${t0.working_now} en jornada ahora</div>
      <div class="muted">${d.is_manager && d.manager_branch ? d.manager_branch.name + ' · ' : ''}${d.employees.length} en tu equipo</div>
    </div>
    <div class="form-group" style="margin:0;min-width:140px">
      <label for="per" class="muted" style="font-size:.75rem">Período</label>
      <select id="per" data-change="period">${periodOptions(O.period)}</select>
    </div>
  </div>
  <div class="stats-row dash-stats">
    <div class="stat stat-pro"><div class="stat-l">Horas del equipo</div><div class="stat-v" style="color:var(--theme)">${fmtH(t0.total_h)}</div><div class="muted">${t0.pct}% de ${fmtH(t0.expected_h)}</div>
      <div class="bar-track mt"><div class="bar-fill" style="width:${pct}%"></div></div></div>
    <div class="stat stat-pro"><div class="stat-l">Extras</div><div class="stat-v" style="color:#0891b2">${fmtH(t0.extra_h)}</div><div class="muted">En el período</div></div>
    <div class="stat stat-pro"><div class="stat-l">Horas laborables</div><div class="stat-v">${fmtH(d.expected_per_emp)}</div><div class="muted">${days} · por persona</div></div>
    <div class="stat stat-pro"><div class="stat-l">Presentes / fuera</div><div class="stat-v">${on} <span class="muted" style="font-size:1rem;font-weight:600">/ ${off}</span></div><div class="muted">Ahora mismo</div></div>
  </div>
  ${d.employees.length ? html`<div class="card dash-chart-card">
    <strong>Horas por empleado</strong>
    <p class="muted mb">Normales y extras del período</p>
    <div class="bar-chart">
      ${d.employees.slice(0, 12).map((e) => {
        const tot = e.normal_h + e.extra_h;
        const wn = Math.round((e.normal_h / maxH) * 100);
        const we = Math.round((e.extra_h / maxH) * 100);
        return html`<div class="bar-chart-row">
          <div class="bar-chart-name">${e.name.split(' ')[0]}</div>
          <div class="bar-chart-bars">
            <div class="bar-n" style="width:${wn}%" title="Normales ${fmtH(e.normal_h)}"></div>
            <div class="bar-e" style="width:${we}%" title="Extras ${fmtH(e.extra_h)}"></div>
          </div>
          <div class="bar-chart-val">${fmtH(tot)}</div>
        </div>`;
      })}
    </div>
    <div class="row mt muted" style="font-size:.75rem;gap:16px"><span><span class="leg leg-n"></span> Normales</span><span><span class="leg leg-e"></span> Extras</span></div>
  </div>` : ''}
  ${d.pending.length ? html`<div class="card"><strong>Solicitudes de alta</strong>${d.pending.map((p) => html`<div class="hours-emp-row"><div><div style="font-weight:600">${p.name}</div><div class="muted">${p.email}</div></div>
    <div class="row"><button class="btn btn-primary btn-sm" data-act="emp-ok" data-id="${p.id}" type="button">Aprobar</button><button class="btn btn-outline btn-sm" data-act="emp-no" data-id="${p.id}" type="button">Rechazar</button></div></div>`)}</div>` : ''}
  <div class="card"><div class="row between mb"><strong>${d.is_manager ? 'Mi equipo ahora' : 'Equipo ahora'}</strong><span class="muted">${d.employees.length} persona${d.employees.length === 1 ? '' : 's'}${d.manager_branch ? ' · ' + d.manager_branch.name : ''}</span></div>
  <div class="emp-grid-live">${d.employees.map((e) => html`<div class="live-card" data-act="emp-detail" data-id="${e.id}"><div class="emp-av" style="margin:0 auto 8px">${e.name.slice(0, 1)}</div>
    <div style="font-weight:600;font-size:.85rem">${e.name.split(' ')[0]}</div>
    <div class="status-live ${e.state === 'jornada' ? 'jornada' : e.state === 'extra' ? 'extra' : 'fuera'}">${e.state === 'jornada' ? 'En jornada' : e.state === 'extra' ? 'Extra' : 'Fuera'}</div>
    ${e.since ? html`<div class="muted" style="font-size:.72rem">Desde ${fmtTime(e.since)}</div>` : e.last_mark_at ? html`<div class="muted" style="font-size:.72rem">Última marca ${fmtTime(e.last_mark_at)}</div>` : html`<div class="muted" style="font-size:.72rem">Sin marcas hoy</div>`}
    ${e.late_count ? html`<div style="font-size:.7rem;font-weight:700;color:#d97706;margin-top:4px">${e.late_count} tardanza${e.late_count === 1 ? '' : 's'}</div>` : ''}</div>`)}</div></div>
  ${d.rrhh ? html`<div class="card"><strong>📊 RRHH del período</strong>
    <div class="stats-row" style="margin-top:10px">
      <div class="stat"><div class="stat-l">Tardanzas</div><div class="stat-v" style="color:#d97706">${d.rrhh.late_total}</div></div>
      <div class="stat"><div class="stat-l">Ausencias sin marca</div><div class="stat-v" style="color:#dc2626">${d.rrhh.absent_total}</div></div>
      <div class="stat"><div class="stat-l">Equipo activo</div><div class="stat-v">${d.rrhh.employees}</div></div>
    </div>
    ${d.rrhh.top_late?.length ? html`<div style="margin-top:12px;font-size:.85rem"><strong>Más tardanzas</strong>${d.rrhh.top_late.map((x) => html`<div class="row between" style="padding:4px 0"><span>${x.name}</span><span class="muted">${x.late} vez${x.late === 1 ? '' : 'es'}</span></div>`)}</div>` : ''}
    ${d.rrhh.top_absent?.length ? html`<div style="margin-top:10px;font-size:.85rem"><strong>Sin marcar entrada</strong>${d.rrhh.top_absent.map((x) => html`<div class="row between" style="padding:4px 0"><span>${x.name}</span><span class="muted">${x.absent} día${x.absent === 1 ? '' : 's'}</span></div>`)}</div>` : ''}
    ${d.rrhh.low_attendance?.length ? html`<div style="margin-top:10px;font-size:.85rem"><strong>Menor % de horas</strong>${d.rrhh.low_attendance.map((x) => html`<div class="row between" style="padding:4px 0"><span>${x.name}</span><span class="muted">${x.pct}%</span></div>`)}</div>` : ''}
    ${!d.rrhh.top_late?.length && !d.rrhh.top_absent?.length ? html`<p class="muted mt" style="font-size:.85rem">Sin tardanzas ni ausencias registradas en este período.</p>` : ''}
  </div>` : ''}
  ${hols.length ? html`<div class="card"><strong>Feriados del mes</strong><div class="muted mt">${hols.map((h) => h.date.slice(8) + '/' + h.date.slice(5, 7) + ' ' + h.name).join(' · ')}</div></div>` : ''}
  `);
}
const initials = (n) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
acts['o-period'] = (el) => { O.period = el.value; loadTab(); };
const pendingRow = (p) => html`<div class="emp-row" style="cursor:default"><div class="emp-av">${initials(p.name)}</div><div class="grow"><div style="font-weight:600;font-size:.88rem">${p.name}</div><div class="muted">${p.email}</div></div>
  <button class="btn btn-primary btn-sm" data-act="emp-approve" data-id="${p.id}" type="button">Autorizar</button><button class="btn btn-danger btn-sm" data-act="emp-reject" data-id="${p.id}" type="button">Rechazar</button></div>`;

// ---------- Notificaciones ----------
const DOT = { late: 'late', no_exit: 'out', geo_out: 'zona', absent: 'out', permit: 'perm', auth: 'perm', emp_request: 'perm' };
const SEC = { geo_out: 'Intento fuera de zona', qr_invalid: 'QR inválido o vencido', geo_missing: 'Intentó marcar sin ubicación', display_geo_out: 'Pantalla del QR fuera del local', display_reuse: 'Link de pantalla usado en otro dispositivo', display_gps: 'Pantalla del QR sin GPS' };
async function tabNotif() {
  const [n, sec] = await Promise.all([get('/api/owner/notifs' + (O.showHist ? '?history=1' : '')), get('/api/owner/security')]);
  const item = (x, resolved) => html`<div class="notif-item ${!resolved && !x.read_at ? 'notif-new' : ''}" style="cursor:default"><div class="notif-dot dot-${DOT[x.type] || 'perm'}"></div>
    <div class="grow"><div class="notif-title">${x.text}${!resolved && !x.read_at ? html` <span class="pending-badge" style="font-size:.6rem">nuevo</span>` : ''}</div><div class="notif-sub">${x.detail || ''} · ${fmtDateTime(x.created_at)}</div>
    ${resolved ? '' : html`<div class="row mt">${x.type === 'permit' ? html`<button class="btn btn-primary btn-sm" data-act="permit-decide" data-id="${x.ref_id}" data-ok="1" type="button">Aprobar</button><button class="btn btn-outline btn-sm" data-act="permit-decide" data-id="${x.ref_id}" data-ok="0" type="button">Rechazar</button>`
      : x.type === 'emp_request' ? html`<button class="btn btn-primary btn-sm" data-act="go-tab" data-tab="solicitudes" type="button">Ver solicitud</button><button class="btn btn-outline btn-sm" data-act="notif-seen" data-id="${x.id}" type="button">Marcar leída</button>`
      : x.type === 'auth' ? html`<button class="btn btn-primary btn-sm" data-act="emp-approve" data-id="${x.ref_id}" type="button">Autorizar</button><button class="btn btn-outline btn-sm" data-act="emp-reject" data-id="${x.ref_id}" type="button">Rechazar</button>`
      : html`${(x.type === 'no_exit' || x.type === 'geo_out') && x.user_id ? html`<button class="btn btn-outline btn-sm" data-act="mm-open" data-id="${x.user_id}" type="button">Corregir marca</button>` : ''}<button class="btn btn-primary btn-sm" data-act="notif-seen" data-id="${x.id}" type="button">Marcar como resuelto</button>`}</div>`}</div><button class="btn btn-outline btn-sm" style="align-self:flex-start" data-act="notif-del" data-id="${x.id}" type="button" aria-label="Borrar esta notificación" title="Borrar">🗑</button></div>`;
  patchEl('#tab-body', html`<div class="card"><div class="row between"><div><strong>Notificaciones</strong><p class="muted">${n.notifs.length ? `${n.notifs.length} pendiente(s) · una acción por aviso` : 'Todo al día'}</p></div>
      <div class="row"><button class="btn btn-outline btn-sm" data-act="notif-history" type="button">${O.showHist ? 'Ocultar historial' : 'Ver historial'}</button><button class="btn btn-danger btn-sm" data-act="notif-clear" type="button">Borrar todas</button></div></div>
    ${n.notifs.length ? n.notifs.map((x) => item(x, false)) : html`<p class="muted">No tenés avisos pendientes 🎉</p>`}
    ${O.showHist ? html`<div style="font-weight:600;font-size:.85rem;margin:14px 0 4px">Resueltos (últimos 30)</div>${n.history.length ? n.history.map((x) => item(x, true)) : html`<p class="muted">Todavía no resolviste ninguno.</p>`}` : ''}</div>
  ${n.orphan_permits.length ? html`<div class="card"><strong>Permisos pendientes</strong><p class="muted mb">Borraste el aviso, pero estas solicitudes siguen esperando tu respuesta.</p>${n.orphan_permits.map((p) => html`<div class="hours-emp-row" style="display:block"><div style="font-weight:600;font-size:.85rem">${p.employee} · ${fmtDay(p.from_date)}${p.to_date !== p.from_date ? ' al ' + fmtDay(p.to_date) : ''}</div><div class="row mt"><button class="btn btn-primary btn-sm" data-act="permit-decide" data-id="${p.id}" data-ok="1" type="button">Aprobar</button><button class="btn btn-outline btn-sm" data-act="permit-decide" data-id="${p.id}" data-ok="0" type="button">Rechazar</button></div></div>`)}</div>` : ''}
  <div class="card"><div class="row between"><div><strong>🔒 Seguridad: intentos rechazados</strong><p class="muted mb">Marcaciones que el sistema frenó. Si ves muchos de la misma persona, hablá con ella.</p></div>
    ${sec.events.length ? html`<button class="btn btn-danger btn-sm" data-act="sec-clear" type="button">Borrar todos</button>` : ''}</div>
    ${sec.events.length ? sec.events.map((e) => html`<div class="hours-emp-row"><div class="grow"><div style="font-weight:600;font-size:.85rem">${SEC[e.kind] || e.kind}</div><div class="muted">${e.employee || 'Alguien'}${e.detail ? ' · ' + e.detail : ''} · ${fmtDateTime(e.ts)}</div></div>
      <button class="btn btn-outline btn-sm" data-act="sec-del" data-id="${e.id}" type="button" aria-label="Borrar" title="Borrar">🗑</button></div>`) : html`<p class="muted">Sin intentos rechazados. ✅</p>`}</div>`);
  if (n.unread) { await post('/api/owner/notifs/read-all'); setBadge(0); }
}
acts['notif-history'] = () => { O.showHist = !O.showHist; loadTab(); };
acts['notif-del'] = async (el) => { await api('DELETE', `/api/owner/notifs/${el.dataset.id}`); loadTab(); };
acts['sec-del'] = async (el) => { await api('DELETE', `/api/owner/security/${el.dataset.id}`); loadTab(); };
acts['theme-live'] = (el) => {
  const c = el.dataset.color;
  if (!c) return;
  document.documentElement.style.setProperty('--theme', c);
  if (S.me?.tenant) S.me.tenant.theme = c;
  // marcar radio aunque data-act haga preventDefault
  const radio = el.querySelector?.('input[type=radio]') || el;
  if (radio && radio.type === 'radio') radio.checked = true;
  document.querySelectorAll('input[name=theme]').forEach((r) => { r.checked = r.value === c; });
  document.querySelectorAll('.theme-swatch').forEach((s) => s.classList.toggle('active', (s.parentElement?.dataset?.color || s.style.background) === c));
};
acts['sec-clear'] = async () => { if (!confirm('¿Borrar todos los intentos de seguridad? No se puede deshacer.')) return; const r = await post('/api/owner/security/clear'); toast(`${r.deleted} intento(s) borrado(s)`); loadTab(); };

acts['notif-clear'] = async () => {
  if (!confirm('¿Borrar TODAS las notificaciones (nuevas, leídas y el historial)? No se puede deshacer.\n\nLos permisos pendientes no se pierden: te van a seguir apareciendo para resolver.')) return;
  const r = await post('/api/owner/notifs/clear'); toast(`${r.deleted} notificación(es) borrada(s)`); loadTab();
};
acts['permit-decide'] = async (el) => { await post(`/api/owner/permits/${el.dataset.id}/decide`, { approve: el.dataset.ok === '1' }); toast(el.dataset.ok === '1' ? 'Aprobado' : 'Rechazado'); loadTab(); };
acts['notif-seen'] = async (el) => { await post(`/api/owner/notifs/${el.dataset.id}/resolve`); loadTab(); };
const afterEmpChange = async () => {
  O.emps = []; // forzar lista fresca (rol actualizado)
  try { await refreshMe(); } catch {}
  await loadTab();
};
acts['emp-approve'] = async (el) => { await post(`/api/owner/employees/${el.dataset.id}/approve`); toast('Empleado autorizado'); afterEmpChange(); };
acts['emp-reject'] = async (el) => { await post(`/api/owner/employees/${el.dataset.id}/reject`); toast('Solicitud rechazada'); afterEmpChange(); };
async function refreshMe() { S.me = await get('/api/auth/me'); applyTheme(); }

// ---------- Empleados ----------

// ---------- Solicitudes (empleados: RH, horas, fichaje + permisos/certs pendientes) ----------
async function tabSolicitudes() {
  const [{ requests }, n] = await Promise.all([
    get('/api/owner/emp-requests?status=' + (O.reqFilter || 'pending')),
    get('/api/owner/notifs'),
  ]);
  const pendingPermits = (n.orphan_permits || []).concat(
    (n.notifs || []).filter((x) => x.type === 'permit' && !x.resolved_at)
  );
  // de-dupe by ref_id
  const seen = new Set();
  const permits = [];
  for (const p of pendingPermits) {
    const k = p.ref_id || p.id;
    if (seen.has(k)) continue;
    seen.add(k);
    permits.push(p);
  }
  const KIND = { rh: 'RRHH', horas: 'Horas', fichaje: 'Fichaje', turno: 'Turno', otro: 'Otro' };
  const filterBtn = (val, label) => html`<button class="btn btn-sm ${O.reqFilter === val || (!O.reqFilter && val === 'pending') ? 'btn-primary' : 'btn-outline'}" data-act="req-filter" data-f="${val}" type="button">${label}</button>`;
  patchEl('#tab-body', html`
  <div class="card">
    <div class="row between" style="flex-wrap:wrap;gap:8px">
      <div><strong>Solicitudes de empleados</strong>
        <p class="muted" style="margin:4px 0 0">Pedidos de RRHH, horas, corrección de fichaje y turnos.</p></div>
      <div class="row" style="gap:6px">${filterBtn('pending','Pendientes')}${filterBtn('answered','Respondidas')}${filterBtn('all','Todas')}</div>
    </div>
  </div>
  ${requests.length ? requests.map((r) => html`<div class="card">
    <div class="row between" style="align-items:flex-start">
      <div class="grow">
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          <span class="badge b-${r.status === 'pending' ? 'fallido' : r.status === 'answered' ? 'activo' : 'fuera'}">${r.status === 'pending' ? 'Pendiente' : r.status === 'answered' ? 'Respondida' : r.status === 'rejected' ? 'Rechazada' : r.status === 'approved' ? 'Aprobada' : r.status}</span>
          <span class="muted" style="font-size:.78rem">${KIND[r.kind] || r.kind}</span>
        </div>
        <div style="font-weight:700;margin-top:6px">${r.subject}</div>
        <div class="muted" style="font-size:.85rem;margin-top:2px">${r.employee} · ${fmtDateTime(r.created_at)}</div>
        <p style="margin:10px 0 0;white-space:pre-wrap;font-size:.9rem">${r.body}</p>
        ${r.reply ? html`<div class="alert" style="margin-top:10px;background:color-mix(in srgb,var(--theme) 10%,transparent)"><strong>Tu respuesta:</strong> ${r.reply}</div>` : ''}
      </div>
    </div>
    ${r.status === 'pending' ? html`<form data-form="emp-req-reply" data-id="${r.id}" class="mt">
      <div class="form-group"><label>Respuesta</label><textarea name="reply" rows="2" placeholder="Escribí la respuesta al empleado…" required></textarea></div>
      <div class="row" style="gap:8px">
        <button class="btn btn-primary btn-sm" type="submit">Responder y cerrar</button>
        <button class="btn btn-outline btn-sm" data-act="emp-req-reject" data-id="${r.id}" type="button">Rechazar</button>
      </div>
    </form>` : ''}
  </div>`) : html`<div class="card"><p class="muted">No hay solicitudes ${O.reqFilter === 'all' ? '' : 'pendientes'}.</p></div>`}

  <div class="card mt"><strong>Licencias y permisos pendientes</strong>
    <p class="muted mb">Vacaciones, licencias y cambios de horario que esperan tu decisión.</p>
    ${permits.length ? permits.map((p) => html`<div class="hours-emp-row" style="display:block;margin-bottom:8px">
      <div style="font-weight:600;font-size:.88rem">${p.employee || p.text || 'Empleado'}${p.detail ? html`<span class="muted"> · ${p.detail}</span>` : ''}</div>
      <div class="row mt">
        <button class="btn btn-primary btn-sm" data-act="permit-decide" data-id="${p.ref_id || p.id}" data-ok="1" type="button">Aprobar</button>
        <button class="btn btn-outline btn-sm" data-act="permit-decide" data-id="${p.ref_id || p.id}" data-ok="0" type="button">Rechazar</button>
      </div>
    </div>`) : html`<p class="muted">No hay permisos pendientes.</p>`}
  </div>

  <div class="card mt"><strong>Certificados recientes</strong>
    <p class="muted mb">Los certificados los cargan los empleados en su panel (médico, estudio, etc.). Revisá notificaciones o la ficha de cada empleado.</p>
    <button class="btn btn-outline btn-sm" data-act="go-tab" data-tab="empleados" type="button">Ir a Empleados</button>
  </div>`);
}
acts['req-filter'] = (el) => { O.reqFilter = el.dataset.f; loadTab(); };
acts['go-tab'] = (el) => { O.tab = el.dataset.tab; renderOwner(); };
acts['emp-req-reject'] = async (el) => {
  if (!confirm('¿Rechazar esta solicitud?')) return;
  await patch('/api/owner/emp-requests/' + el.dataset.id, { status: 'rejected', reply: 'Rechazada por el empleador' });
  toast('Solicitud rechazada');
  loadTab();
};
forms['emp-req-reply'] = async (v, f) => {
  await patch('/api/owner/emp-requests/' + f.dataset.id, { status: 'answered', reply: v.reply });
  toast('Respuesta enviada');
  loadTab();
};

async function tabEmpleados() {
  const [{ employees }, { branches }] = await Promise.all([get('/api/owner/employees'), get('/api/owner/branches')]);
  O.emps = employees; O.branches = branches;
  const t = S.me.tenant, pct = Math.min(100, (t.employee_count / t.employee_limit) * 100);
  const pend = employees.filter((e) => e.status === 'pending');
  const link = `${S.me.app_url}/alta/${t.slug}`;
  patchEl('#tab-body', html`<div class="card">
    <div class="row between"><div><strong>Empleados</strong><div class="muted">${t.employee_count} de ${t.employee_limit} activos</div></div>
      <button class="btn btn-primary btn-sm" data-act="emp-add" type="button">+ Agregar</button></div>
    <div class="emp-bar"><div class="emp-bar-fill" style="width:${pct}%"></div></div>
    <div class="row mb"><button class="btn btn-outline btn-sm" data-act="alta-qr" type="button">QR de alta</button>
      ${!isStaffOnly() ? html`<button class="btn btn-outline btn-sm" data-act="csv-open" type="button">Importar CSV</button>` : ''}
      <button class="btn btn-outline btn-sm" data-act="copy" data-text="${link}" type="button">Copiar link de registro</button></div>
    ${pend.length ? html`<div class="card" style="background:var(--bg)"><strong>Pendientes de autorización</strong><p class="muted mb">Se registraron con el link/QR y esperan tu OK.</p>${pend.map(pendingRow)}</div>` : ''}
    ${employees.filter((e) => e.status !== 'pending' && e.status !== 'rejected').map((e) => html`<div class="emp-row" data-act="emp-detail" data-id="${e.id}"><div class="emp-av">${initials(e.name)}</div>
      <div class="grow"><div style="font-weight:600;font-size:.88rem">${e.name}${e.role === 'manager' ? html` <span class="pill" style="font-size:.65rem">Encargado</span>` : e.role === 'hr' ? html` <span class="pill" style="font-size:.65rem;background:#dcfce7;color:#166534">RRHH</span>` : ''}</div><div class="muted">${e.cargo || 'Sin cargo'} · ${(branches.find((b) => b.id === e.branch_id) || {}).name || ''}</div></div>
      ${e.status === 'active' ? badge(e.state) : badge(e.status)}</div>`)}
    ${employees.length ? '' : html`<p class="muted">Todavía no cargaste empleados.</p>`}</div>`);
}
acts.copy = (el) => copyText(el.dataset.text);
acts['alta-qr'] = () => { const link = `${S.me.app_url}/alta/${S.me.tenant.slug}`; openModal(html`<h3 style="margin-bottom:6px">QR de alta de empleados</h3><p class="muted">Mostralo o imprimilo. Quien lo escanee queda pendiente hasta que lo autorices.</p><div class="qr-big">${raw(qrSvg(link))}</div><p class="muted" style="text-align:center;word-break:break-all">${link}</p><button class="btn btn-outline btn-block mt" data-act="close-modal" type="button">Cerrar</button>`); };

const empForm = (e = {}) => html`
  <div class="form-group"><label for="ef-name">Nombre y apellido</label><input id="ef-name" name="name" required minlength="2" value="${e.name || ''}"></div>
  ${e.id ? '' : html`<div class="form-group"><label for="ef-email">Email (es su usuario)</label><input id="ef-email" name="email" type="email" required></div>`}
  <div class="grid2"><div class="form-group"><label for="ef-cargo">Cargo</label><input id="ef-cargo" name="cargo" value="${e.cargo || ''}"></div>
    <div class="form-group"><label for="ef-branch">Sucursal</label><select id="ef-branch" name="branch_id">${O.branches.map((b) => html`<option value="${b.id}" ${b.id === e.branch_id ? raw('selected') : ''}>${b.name}</option>`)}</select></div></div>
  <div class="grid2"><div class="form-group"><label for="ef-shift">Entrada habitual (aviso de tarde)</label><input id="ef-shift" name="shift_start" type="time" value="${e.shift_start || ''}"></div>
    <div class="form-group"><label for="ef-hire">Fecha de ingreso</label><input id="ef-hire" name="hire_date" type="date" value="${e.hire_date || ''}"></div></div>
  <div class="grid2"><div class="form-group"><label for="ef-dni">DNI</label><input id="ef-dni" name="dni" value="${e.dni || ''}" maxlength="20"></div>
    <div class="form-group"><label for="ef-pe">Email personal</label><input id="ef-pe" name="personal_email" type="email" value="${e.personal_email || ''}"></div></div>
  <div class="grid2"><div class="form-group"><label for="ef-blood">Grupo sanguíneo</label><select id="ef-blood" name="blood_type">${['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((o) => html`<option value="${o}" ${o === (e.blood_type || '') ? raw('selected') : ''}>${o || '—'}</option>`)}</select></div>
    <div class="form-group"><label for="ef-obra">Obra social</label><input id="ef-obra" name="obra_social" value="${e.obra_social || ''}" maxlength="80"></div></div>
  <div class="form-group"><label for="ef-notes">Notas internas</label><textarea id="ef-notes" name="notes" rows="2" maxlength="400">${e.notes || ''}</textarea></div>
`;

acts['emp-add'] = () => openModal(html`<h3 style="margin-bottom:10px">Agregar empleado</h3><form data-form="emp-new">${empForm()}<button class="btn btn-primary btn-block" type="submit">Crear empleado</button>
  <p class="muted mt">Se genera una contraseña temporal que el empleado tiene que cambiar al ingresar.</p></form>`);
forms['emp-new'] = async (v) => {
  try {
    const r = await post('/api/owner/employees', { ...v, branch_id: Number(v.branch_id) });
    openModal(html`<h3>Empleado creado</h3><p class="muted mt">Pasale estos datos. La contraseña se muestra una sola vez.</p><p><strong>Usuario:</strong> ${v.email}</p><div class="pw-box">${r.temp_password}</div>
      <button class="btn btn-outline btn-block" data-act="copy" data-text="${r.temp_password}" type="button">Copiar contraseña</button><button class="btn btn-primary btn-block mt" data-act="close-modal" type="button">Listo</button>`);
    afterEmpChange();
  } catch (e) {
    if (e.code !== 'LIMIT_REACHED') throw e;
    const price = e.data.price_extra;
    openModal(html`<h3>Llegaste al límite</h3><p class="muted mt">${e.message}</p><div class="form-group mt"><label for="xq">Cantidad de empleados extra</label><input id="xq" type="number" min="1" max="500" value="5"></div>
      <p class="muted"><strong>Pago único por cupos adicionales:</strong> ${money(price)} por empleado. Los cupos no vencen y se suman al límite de tu plan.</p><button class="btn btn-mp btn-block mt" data-act="buy-extra" type="button">Pagar con Mercado Pago</button><button class="btn btn-outline btn-block mt" data-act="close-modal" type="button">Cancelar</button>`);
  }
};
acts['buy-extra'] = () => startCheckout('extra', Number($('#xq').value) || 1);

acts['emp-detail'] = async (el) => {
  const id = Number(el.dataset.id);
  if (!O.emps.length) { O.emps = (await get('/api/owner/employees')).employees; O.branches = (await get('/api/owner/branches')).branches; }
  const e = O.emps.find((x) => x.id === id); if (!e) return;
  const { docs } = await get(`/api/owner/employees/${id}/docs`);
  const t = S.me.tenant;
  openModal(html`<div class="row between mb"><h3>Ficha del empleado</h3><button class="btn btn-outline btn-sm" data-act="close-modal" type="button" aria-label="Cerrar">✕</button></div>
  <form data-form="emp-save" data-id="${id}">${empForm(e)}
    <div class="grid2"><div class="form-group"><label for="ef-tel">Teléfono</label><input id="ef-tel" name="phone" value="${e.phone || ''}"></div><div class="form-group"><label for="ef-bd">Cumpleaños</label><input id="ef-bd" name="birthday" type="date" value="${e.birthday || ''}"></div></div>
    <div class="form-group"><label for="ef-dir">Domicilio</label><input id="ef-dir" name="address" value="${e.address || ''}" placeholder="Calle, número y localidad"></div>
    <div style="font-weight:700;font-size:.85rem;margin:12px 0 6px">Contacto de emergencia</div>
    <div class="grid2"><div class="form-group"><label for="ef-emg">Nombre</label><input id="ef-emg" name="emg_name" value="${e.emg_name || ''}"></div>
      <div class="form-group"><label for="ef-emg-rel">Relación</label><input id="ef-emg-rel" name="emg_rel" value="${e.emg_rel || ''}"></div></div>
    <div class="form-group"><label for="ef-emg-ph">Teléfono emergencia</label><input id="ef-emg-ph" name="emg_phone" value="${e.emg_phone || ''}"></div>
    <button class="btn btn-primary btn-block" type="submit">Guardar</button></form>
  <div class="row mt"><button class="btn btn-primary btn-sm" data-act="mm-open" data-id="${id}" type="button">🕘 Marcas / corregir</button><button class="btn btn-outline btn-sm" data-act="emp-reset" data-id="${id}" type="button">Restablecer contraseña</button>
    ${e.status === 'active' ? html`<button class="btn btn-danger btn-sm" data-act="emp-disable" data-id="${id}" type="button">Deshabilitar</button>` : html`<button class="btn btn-primary btn-sm" data-act="emp-enable" data-id="${id}" type="button">Habilitar</button>
    <button class="btn btn-danger btn-sm" data-act="emp-delete" data-id="${id}" type="button">Eliminar</button>`}
    ${S.me.user.role === 'owner' && e.status === 'active' ? html`
    <div class="card" style="margin-top:10px;padding:12px">
      <strong style="font-size:.9rem">Rol en el sistema</strong>
      <p class="muted" style="font-size:.8rem;margin:4px 0 8px">Ahora: <strong>${e.role === 'manager' ? 'Encargado de sucursal' : e.role === 'hr' ? 'RRHH' : 'Empleado'}</strong></p>
      <div class="row" style="flex-wrap:wrap;gap:6px">
        <button class="btn ${e.role === 'employee' || !e.role ? 'btn-primary' : 'btn-outline'} btn-sm" data-act="emp-role" data-id="${id}" data-role="employee" type="button">Empleado</button>
        <button class="btn ${e.role === 'manager' ? 'btn-primary' : 'btn-outline'} btn-sm" data-act="emp-role" data-id="${id}" data-role="manager" type="button">Encargado</button>
        <button class="btn ${e.role === 'hr' ? 'btn-primary' : 'btn-outline'} btn-sm" data-act="emp-role" data-id="${id}" data-role="hr" type="button">RRHH</button>
      </div>
      <p class="muted" style="font-size:.75rem;margin-top:8px">Encargado = solo su sucursal. RRHH = ve todo el negocio (sin pagos ni config).</p>
    </div>` : ''}</div>
  <div style="font-weight:700;font-size:.85rem;margin:14px 0 6px">Datos personales (Ley 25.326)</div>
  <p class="muted" style="font-size:.82rem;margin-bottom:8px">Exportá el paquete completo del empleado (para entregárselo o responder a la AAIP) o eliminá todos sus datos personales a pedido del titular.</p>
  <div class="row"><a class="btn btn-outline btn-sm" href="/api/owner/employees/${id}/export">📥 Exportar datos</a>
    ${!isStaffOnly() ? html`<button class="btn btn-danger btn-sm" data-act="emp-erase" data-id="${id}" data-name="${e.name}" type="button">🗑️ Eliminar todos los datos</button>` : ''}</div>
  <div style="font-weight:700;font-size:.85rem;margin:14px 0 6px">Documentos</div>
  ${docs.length ? docs.map((d) => html`<div class="cert-item"><span>📄</span><div class="grow"><div style="font-weight:600">${d.title}${d.period ? ' · ' + d.period : ''}</div><div class="muted">${fmtDateTime(d.created_at)}${d.sign_status ? ' · ' + d.sign_status : ''}${d.sign_note ? ' · “' + d.sign_note + '”' : ''}</div></div>
    <a class="btn btn-outline btn-sm" href="/api/docs/${d.id}/file" target="_blank" rel="noopener">Ver</a></div>`) : html`<p class="muted">Sin documentos.</p>`}
  ${t.mod_rec ? html`<form data-form="recibo-up" data-id="${id}" class="mt"><div class="grid2"><div class="form-group"><label for="rp">Período</label><input id="rp" name="period" type="month" required></div><div class="form-group"><label for="rf">PDF del recibo</label><input id="rf" name="file" type="file" accept="application/pdf" required></div></div><button class="btn btn-outline btn-block" type="submit">Subir recibo</button></form>`
    : html`<div class="mod-lock-banner mt"><span>🔒</span><div>Activá el módulo <strong>Recibos</strong> en Config para subir recibos de sueldo.</div></div>`}`);
};
forms['emp-save'] = async (v, f) => { await patch(`/api/owner/employees/${f.dataset.id}`, { ...v, branch_id: Number(v.branch_id) }); closeModal(); toast('Ficha actualizada'); loadTab(); };
forms['recibo-up'] = async (v, f) => {
  const file = f.querySelector('input[type=file]').files[0];
  await post(`/api/owner/employees/${f.dataset.id}/recibos`, { period: v.period, filename: file.name, data: await fileToBase64(file) });
  toast('Recibo cargado · el empleado ya puede verlo y firmar'); closeModal();
};
// ---------- Corregir / cargar marcas ----------
const MM = { id: null, date: null };
const KIND_LBL = { in: 'Entrada', out: 'Salida', xin: 'Entrada extra', xout: 'Salida extra' }, SRC_LBL = { qr: 'QR', panel: 'Panel', manual: 'Manual', auto: 'Cierre automático' };
const nowHHMM = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
async function mmView() {
  const d = await get(`/api/owner/marks?user_id=${MM.id}&date=${MM.date}`);
  const t = MM.date === todayAR() ? nowHHMM() : '08:00';
  openModal(html`<div class="row between mb"><h3>Marcas de ${d.employee}</h3><button class="btn btn-outline btn-sm" data-act="close-modal" type="button" aria-label="Cerrar">✕</button></div>
    <div class="form-group"><label for="mm-date">Día</label><input id="mm-date" type="date" value="${MM.date}" max="${todayAR()}" data-change="mm-date"></div>
    ${d.marks.length ? d.marks.map((m) => html`<div class="hours-emp-row" style="display:block"><div class="row between"><div><strong>${KIND_LBL[m.kind]} · ${fmtTime(m.ts)}</strong> <span class="src-badge">${SRC_LBL[m.source] || m.source}</span>
      <div class="muted">${[m.branch, m.dist != null ? `a ${m.dist} m` : '', m.note, m.created_by ? 'cargó ' + m.created_by : ''].filter(Boolean).join(' · ')}</div></div>
      ${m.source === 'manual' ? html`<button class="btn btn-danger btn-sm" data-act="mm-del" data-id="${m.id}" type="button">Borrar</button>` : ''}</div></div>`) : html`<p class="muted">Sin marcas ese día.</p>`}
    <div style="font-weight:700;font-size:.9rem;margin:16px 0 4px">Cargar una marca</div><p class="muted mb">Para cuando el GPS no anduvo o se olvidó de marcar. Queda registrada como carga manual y cuenta en las horas.</p>
    <form data-form="mm-new"><div class="form-group"><label for="mm-action">Qué cargar</label><select id="mm-action" name="action" data-change="mm-action"><option value="in">Entrada</option><option value="out">Salida</option><option value="extra">Entrada extra</option></select></div>
      <div class="form-group"><label for="mm-ts">Fecha y hora (Argentina)</label><input id="mm-ts" name="ts" type="datetime-local" value="${MM.date}T${t}" max="${todayAR()}T23:59" required></div>
      <div class="form-group" id="mm-out-wrap"><label for="mm-out">Hora de salida (opcional: carga la jornada completa)</label><input id="mm-out" name="out_ts" type="datetime-local" max="${todayAR()}T23:59"></div>
      <div class="form-group"><label for="mm-note">Motivo / nota</label><input id="mm-note" name="note" maxlength="200" placeholder="Ej.: el GPS no anduvo"></div>
      <div id="mm-conflict"></div><button class="btn btn-primary btn-block" type="submit">Cargar marca</button></form>`);
}
acts['mm-open'] = async (el) => { MM.id = Number(el.dataset.id); MM.date = todayAR(); await mmView(); };
acts['mm-date'] = (el) => { if (el.value) { MM.date = el.value; mmView(); } };
acts['mm-action'] = (el) => $('#mm-out-wrap').classList.toggle('hidden', el.value === 'out');
forms['mm-new'] = async (v) => {
  const body = { user_id: MM.id, action: v.action, ts: v.ts, note: v.note, force: v.force === 'on' };
  if (v.out_ts && v.action !== 'out') body.out_ts = v.out_ts;
  try { await post('/api/owner/marks/manual', body); }
  catch (e) {
    if (e.code !== 'SEQUENCE_CONFLICT') throw e;
    patchEl('#mm-conflict', html`<div class="alert alert-warn" role="alert">${e.message}</div><label class="row mb" style="font-size:.85rem"><input type="checkbox" name="force"> Forzar y cargarla igual (escribí el motivo arriba)</label>`);
    return;
  }
  toast('Marca cargada'); await mmView(); loadTab();
};
acts['mm-del'] = async (el) => { if (!confirm('¿Borrar esta marca cargada a mano?')) return; await api('DELETE', `/api/owner/marks/${el.dataset.id}`); toast('Marca borrada'); await mmView(); loadTab(); };

acts['emp-reset'] = async (el) => { const r = await post(`/api/owner/employees/${el.dataset.id}/reset-password`); openModal(html`<h3>Contraseña restablecida</h3><p class="muted mt">Se muestra una sola vez:</p><div class="pw-box">${r.temp_password}</div><button class="btn btn-primary btn-block" data-act="close-modal" type="button">Listo</button>`); };
acts['emp-disable'] = async (el) => { await post(`/api/owner/employees/${el.dataset.id}/disable`); closeModal(); toast('Empleado deshabilitado'); afterEmpChange(); };
acts['emp-enable'] = async (el) => { await post(`/api/owner/employees/${el.dataset.id}/enable`); closeModal(); toast('Empleado habilitado'); afterEmpChange(); };

// ---------- Importar empleados por CSV ----------
acts['csv-open'] = () => openModal(html`<h3 style="margin-bottom:6px">Empleados · CSV</h3>
  <p class="muted mb" style="font-size:.88rem;line-height:1.45">Importá muchos de una vez o bajá los que ya tenés cargados. Formato: columnas separadas por <strong>;</strong> (Excel en español).</p>
  <div class="csv-actions mb">
    <a class="btn btn-outline btn-sm" href="/api/owner/employees/export-csv">📤 Exportar empleados</a>
    <a class="btn btn-outline btn-sm" href="/api/owner/employees/import-template">📥 Plantilla vacía</a>
    <a class="btn btn-outline btn-sm" href="/api/owner/employees/import-template?examples=1">📄 Plantilla con ejemplos</a>
  </div>
  <p class="muted mb" style="font-size:.8rem">La plantilla vacía solo tiene los títulos. La de ejemplos trae 2 filas de muestra para copiar el formato.</p>
  <form data-form="csv-import">
    <div class="form-group"><label for="csv-file">Subir CSV (hasta 200 filas)</label><input id="csv-file" name="file" type="file" accept=".csv,text/csv,text/plain" required></div>
    <label class="row mb" style="font-size:.85rem"><input type="checkbox" name="as_pending"> Cargarlos como <strong>pendientes</strong> (los autorizás vos uno por uno)</label>
    <p class="muted mb" style="font-size:.82rem">Sin tildar, quedan activos con contraseña temporal. Si superás el límite del plan, las filas de más se rechazan.</p>
    <button class="btn btn-primary btn-block" type="submit">Importar</button>
    <button class="btn btn-outline btn-block mt" type="button" data-act="close-modal">Cancelar</button>
  </form>`);
forms['csv-import'] = async (v, f) => {
  const file = f.querySelector('input[type=file]').files[0];
  if (file.size > 900 * 1024) throw new Error('El archivo es muy grande. Dividilo en partes de hasta 200 filas.');
  const r = await post('/api/owner/employees/import', { csv: await file.text(), as_pending: !!f.querySelector('[name=as_pending]').checked });
  O.lastImport = r;
  openModal(html`<h3 style="margin-bottom:8px">Resultado de la importación</h3>
    <div class="alert ${r.created.length ? 'alert-ok' : 'alert-warn'}"><strong>${r.created.length}</strong> de ${r.total} empleados cargados${r.errors.length ? ` · ${r.errors.length} con errores` : ''}.</div>
    ${r.created.length ? html`<p class="muted mb">Las contraseñas temporales se muestran solo ahora. Descargalas y pasáselas a cada persona (la cambian al primer ingreso).${r.created[0].status === 'pending' ? ' Como están pendientes, primero autorizalos en la pestaña Empleados.' : ''}</p>
      <button class="btn btn-primary btn-sm mb" data-act="csv-dl" type="button">📥 Descargar credenciales (CSV)</button>` : ''}
    ${r.errors.length ? html`<div style="font-weight:700;font-size:.85rem;margin:8px 0 4px">Filas con errores</div>${r.errors.map((e) => html`<div class="hours-emp-row" style="display:block"><strong>Línea ${e.line}</strong> · ${e.name}<div class="muted">${e.message}</div></div>`)}` : ''}
    <button class="btn btn-outline btn-block mt" data-act="close-modal" type="button">Cerrar</button>`);
  loadTab(); refreshMe();
};
acts['csv-dl'] = () => {
  const rows = [['nombre', 'email', 'contraseña_temporal', 'estado'], ...O.lastImport.created.map((c) => [c.name, c.email, c.temp_password, c.status === 'pending' ? 'pendiente' : 'activo'])];
  const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'credenciales-empleados.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

// ---------- QR ----------
async function tabQr() {
  const [{ branches }, { links }] = await Promise.all([get('/api/owner/branches'), get('/api/owner/display-links')]); O.branches = branches;
  if (!branches.find((b) => b.id === O.qrBranch)) O.qrBranch = branches[0].id;
  const b = branches.find((x) => x.id === O.qrBranch), t = S.me.tenant;
  patchEl('#tab-body', html`
  <div class="card"><div class="form-group" style="margin:0"><label for="qb">Sucursal</label><select id="qb" data-change="qr-branch">${branches.map((x) => html`<option value="${x.id}" ${x.id === b.id ? raw('selected') : ''}>${x.name}</option>`)}</select></div></div>
  <div class="card"><strong>📍 Ubicación del local · ${b.name}</strong><p class="muted">Es lo único obligatorio: tus empleados marcan desde su panel y el sistema verifica que estén dentro del radio.</p>
    ${b.lat == null ? html`<div class="alert alert-warn mt">Sin ubicación cargada: tus empleados <strong>no van a poder marcar desde su panel</strong>. Parate en el local y tocá “Usar mi ubicación actual”, o pegá el link de Google Maps.</div>` : ''}
    <div class="form-group mt"><label for="g-maps">Pegá el link de Google Maps del local</label><div class="row"><input id="g-maps" class="grow" placeholder="https://maps.app.goo.gl/… o -33.2394, -61.6108" autocomplete="off"><button class="btn btn-outline btn-sm" type="button" data-act="geo-maps">Tomar ubicación</button></div>
      <p class="muted">En Google Maps buscá tu local → <strong>Compartir → Copiar vínculo</strong>. Si el local no aparece, tocá el punto exacto en el mapa y compartí ese lugar.</p><div id="g-maps-res">${b.lat != null ? html`<a class="link" href="https://www.google.com/maps?q=${b.lat},${b.lng}" target="_blank" rel="noopener">Ver la ubicación guardada en Google Maps ↗</a>` : ''}</div></div>
    <form data-form="geo" data-id="${b.id}" class="mt"><div class="grid2"><div class="form-group"><label for="g-lat">Latitud</label><input id="g-lat" name="lat" inputmode="decimal" value="${b.lat ?? ''}"></div>
      <div class="form-group"><label for="g-lng">Longitud</label><input id="g-lng" name="lng" inputmode="decimal" value="${b.lng ?? ''}"></div></div>
      <div class="form-group"><label for="g-rad">Radio máximo</label><select id="g-rad" name="radius">${[20, 30, 40, 50, 75, 100, 150].map((r) => html`<option value="${r}" ${r === b.radius ? raw('selected') : ''}>${r} metros</option>`)}</select></div>
      <div class="row"><button class="btn btn-outline btn-sm" data-act="geo-here" type="button">📍 Usar mi ubicación actual</button><button class="btn btn-primary btn-sm" type="submit">Guardar</button></div></form></div>
  <div class="card" style="text-align:center"><strong>QR opcional (modo estricto)</strong><p class="muted mb">Tus empleados <strong>no necesitan escanear nada</strong> para marcar: lo hacen desde su panel. Usá el QR solo si además querés exigirlo en el local.</p>
    <div id="qr-box"><span class="spinner"></span></div>
    <p class="muted" id="qr-label"></p>
    <p class="muted">El código cambia cada minuto: no sirve una foto. Para la tablet o TV del local usá un <strong>link de pantalla</strong> (más abajo) y no dejes tu cuenta abierta.</p>
    <button class="btn btn-outline btn-sm mt" data-act="qr-full" type="button">Pantalla completa</button></div>
  ${displayCard(links)}
  <div class="card"><strong>Sucursales</strong>
    ${!t.mod_suc ? html`<div class="mod-lock-banner mt"><span>🔒</span><div><strong>Módulo Multi-sucursal no activado</strong>Hoy tenés solo una sucursal. Activalo en Config (${money(S.me.prices.mod_suc)}, pago único).</div></div>` : ''}
    <div class="mt">${branches.map((x) => html`<span class="branch-tag">${x.name}${branches.length > 1 ? html` <button type="button" data-act="branch-del" data-id="${x.id}" aria-label="Eliminar ${x.name}" style="border:none;background:none;cursor:pointer;color:inherit">×</button>` : ''}</span>`)}</div>
    ${t.mod_suc ? html`<button class="btn btn-primary btn-sm mt" data-act="bw-open" type="button">＋ Nueva sucursal (asistente)</button>` : ''}</div>`);
  qrLoop();
}
acts['qr-branch'] = (el) => { O.qrBranch = Number(el.value); loadTab(); };
acts['qr-full'] = () => $('#qr-box')?.parentElement.requestFullscreen?.();
async function qrLoop() {
  clearInterval(O.qrTimer);
  let total = 60000, until = 0;
  const draw = async () => {
    try {
      const r = await get(`/api/owner/qr/${O.qrBranch}`);
      total = 60000; until = Date.now() + r.refresh_in;
      patchEl('#qr-box', html`<div class="qr-big">${raw(qrSvg(r.url))}</div><div class="countdown"><i id="qr-bar" style="width:100%"></i></div>`);
      patchEl('#qr-label', `Dinámico · se renueva cada 60 s · ${r.geofence ? 'Geocerca ' + r.radius + ' m' : 'Sin geocerca'}`);
    } catch { /* se reintenta en el próximo tick */ }
  };
  await draw();
  O.qrTimer = setInterval(() => {
    if (!$('#qr-box')) return clearInterval(O.qrTimer);
    const left = until - Date.now();
    const bar = $('#qr-bar'); if (bar) bar.style.width = Math.max(0, (left / total) * 100) + '%';
    if (left <= 500) draw();
  }, 1000);
}
forms.geo = async (v, f) => { await patch(`/api/owner/branches/${f.dataset.id}`, { lat: v.lat === '' ? null : Number(v.lat), lng: v.lng === '' ? null : Number(v.lng), radius: Number(v.radius) }); toast('Geocerca guardada'); loadTab(); };
acts['geo-here'] = () => new Promise((resolve) => {
  if (!navigator.geolocation) { toast('Tu navegador no permite obtener la ubicación'); return resolve(); }
  toast('Obteniendo ubicación…');
  navigator.geolocation.getCurrentPosition((p) => { $('#g-lat').value = p.coords.latitude.toFixed(6); $('#g-lng').value = p.coords.longitude.toFixed(6); toast(`Ubicación lista (±${Math.round(p.coords.accuracy)} m). Tocá Guardar.`); resolve(); },
    () => { toast('No pudimos obtener tu ubicación. Revisá los permisos del navegador.'); resolve(); }, { enableHighAccuracy: true, timeout: 15000 });
});
// Asistente: nombre -> ubicación -> radio -> QR de la nueva sucursal
const BW = {};
function bwView() {
  const st = BW.step;
  const body = st === 0 ? html`<div class="form-group"><label for="bw-name">Nombre de la sucursal</label><input id="bw-name" value="${BW.name}" maxlength="60" placeholder="Ej.: Sucursal Centro"></div><div class="form-group"><label for="bw-addr">Dirección (opcional)</label><input id="bw-addr" value="${BW.address}" maxlength="120"></div>`
    : st === 1 ? html`<p class="muted mb">Si estás en el local ahora, tocá “Usar mi ubicación actual”. Si no, cargá las coordenadas a mano o completalas después desde la pestaña QR.</p><div class="form-group"><label for="bw-maps">Link de Google Maps del local</label><div class="row"><input id="bw-maps" class="grow" placeholder="https://maps.app.goo.gl/…" autocomplete="off"><button class="btn btn-outline btn-sm" type="button" data-act="bw-maps">Tomar</button></div></div>
      <button class="btn btn-outline btn-sm mb" type="button" data-act="bw-here">📍 Usar mi ubicación actual</button>
      <div class="grid2"><div class="form-group"><label for="bw-lat">Latitud</label><input id="bw-lat" inputmode="decimal" value="${BW.lat}"></div><div class="form-group"><label for="bw-lng">Longitud</label><input id="bw-lng" inputmode="decimal" value="${BW.lng}"></div></div>`
    : html`<div class="form-group"><label for="bw-rad">Radio máximo para marcar</label><select id="bw-rad">${[20, 30, 40, 50, 75, 100, 150].map((r) => html`<option value="${r}" ${r === BW.radius ? raw('selected') : ''}>${r} metros</option>`)}</select></div>
      <div class="alert">Vas a crear <strong>${BW.name}</strong>${BW.lat !== '' ? ' con geocerca.' : html` <strong>sin geocerca</strong>: los empleados podrían marcar desde cualquier lugar (la configurás después en la pestaña QR).`} Al terminar te mostramos el QR propio de esa sucursal.</div>`;
  openModal(html`<h3 style="margin-bottom:8px">Nueva sucursal</h3><div class="wizard-steps">${[0, 1, 2].map((i) => html`<i class="${i <= st ? 'on' : ''}"></i>`)}</div><div class="muted mb">Paso ${st + 1} de 3 · ${['Datos', 'Ubicación', 'Radio'][st]}</div>${body}
    <div class="row mt">${st > 0 ? html`<button class="btn btn-outline btn-sm" type="button" data-act="bw-back">Atrás</button>` : html`<button class="btn btn-outline btn-sm" type="button" data-act="close-modal">Cancelar</button>`}<button class="btn btn-primary btn-sm grow" type="button" data-act="bw-next">${st < 2 ? 'Siguiente' : 'Crear sucursal'}</button></div>`);
}
const bwRead = () => {
  const v = (id) => ($('#' + id)?.value ?? '').trim();
  if (BW.step === 0) { BW.name = v('bw-name'); BW.address = v('bw-addr'); }
  if (BW.step === 1) { BW.lat = v('bw-lat'); BW.lng = v('bw-lng'); }
  if (BW.step === 2) BW.radius = Number(v('bw-rad')) || 50;
};
acts['bw-open'] = () => { Object.assign(BW, { step: 0, name: '', address: '', lat: '', lng: '', radius: 50 }); bwView(); };
acts['bw-back'] = () => { bwRead(); BW.step--; bwView(); };
acts['bw-here'] = () => new Promise((resolve) => {
  if (!navigator.geolocation) { toast('Tu navegador no permite obtener la ubicación'); return resolve(); }
  toast('Obteniendo ubicación…');
  navigator.geolocation.getCurrentPosition((p) => { BW.lat = p.coords.latitude.toFixed(6); BW.lng = p.coords.longitude.toFixed(6); bwView(); toast(`Ubicación lista (±${Math.round(p.coords.accuracy)} m)`); resolve(); },
    () => { toast('No pudimos obtener tu ubicación. Revisá los permisos del navegador o cargala a mano.'); resolve(); }, { enableHighAccuracy: true, timeout: 15000 });
});
acts['bw-next'] = async () => {
  bwRead();
  if (BW.step === 0 && BW.name.length < 2) return toast('Escribí el nombre de la sucursal.');
  if (BW.step === 1 && (BW.lat !== '' || BW.lng !== '')) {
    const la = Number(BW.lat), ln = Number(BW.lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return toast('Revisá las coordenadas: tienen que ser números, por ejemplo -33.2394 y -61.6108.', 5000);
  }
  if (BW.step < 2) { BW.step++; return bwView(); }
  const r = await post('/api/owner/branches', { name: BW.name, address: BW.address, lat: BW.lat === '' ? null : Number(BW.lat), lng: BW.lng === '' ? null : Number(BW.lng), radius: BW.radius });
  closeModal(); toast('Sucursal creada. Acá está su QR.'); O.qrBranch = r.id; O.tab = 'qr'; renderOwner();
};
acts['branch-del'] = async (el) => { if (!confirm('¿Eliminar la sucursal? Sus empleados pasan a otra sucursal.')) return; await api('DELETE', `/api/owner/branches/${el.dataset.id}`); loadTab(); };

// ---------- Pantalla del local: links sin sesión + ubicación desde Google Maps ----------
const DL_STATUS = (l) => ({
  pending: `Esperando que lo abran (vence ${fmtDateTime(l.claim_by)})`,
  active: `En uso${l.expires_at ? ' · termina ' + fmtDateTime(l.expires_at) : ' · sin vencimiento'}${l.last_seen_at ? ` · visto ${fmtTime(l.last_seen_at)}${l.last_dist != null ? ' a ' + l.last_dist + ' m del local' : ''}` : ''}`,
  expired: 'Vencido',
}[l.status]);
const displayCard = (links) => html`<div class="card"><strong>📺 Pantalla del QR (opcional, sin iniciar sesión)</strong>
  <p class="muted mb">Mostrá el QR sin dejar tu cuenta abierta: generá un link y abrilo en la tablet o TV del local, o mandáselo a un encargado.</p>
  <div class="grid2"><button class="btn btn-primary btn-sm" data-act="dl-new" data-kind="fixed" type="button">📺 Pantalla fija del local</button><button class="btn btn-outline btn-sm" data-act="dl-new" data-kind="shift" type="button">👤 Link para encargado</button></div>
  <p class="muted mt"><strong>Pantalla fija:</strong> se abre una vez y queda atada a ese dispositivo hasta que la canceles.<br><strong>Encargado:</strong> un solo uso, atado al primer dispositivo que lo abre y vence a las 8 h (podés elegir de 1 a 16). Sirve si se corta la luz y se apaga la pantalla fija.<br>El dispositivo tiene que estar en el local con el GPS activado.</p>
  ${links.map((l) => html`<div class="hours-emp-row" style="display:block"><div class="row between"><div><div style="font-weight:600;font-size:.85rem">${l.kind === 'fixed' ? '📺' : '👤'} ${l.label || (l.kind === 'fixed' ? 'Pantalla fija' : 'Encargado')} · ${l.branch || ''}</div><div class="muted">${DL_STATUS(l)}${l.require_gps ? '' : ' · sin control de GPS'}</div></div>
    ${l.status === 'pending' || l.status === 'active' ? html`<button class="btn btn-danger btn-sm" data-act="dl-revoke" data-id="${l.id}" type="button">Cancelar</button>` : ''}</div></div>`)}</div>`;
acts['dl-new'] = (el) => {
  const kind = el.dataset.kind, shift = kind === 'shift';
  openModal(html`<h3 style="margin-bottom:6px">${shift ? 'Link para encargado' : 'Pantalla fija del local'}</h3>
    <p class="muted mb">${shift ? 'Un solo uso: el primer celular que lo abra queda como la pantalla y los demás son rechazados. Ideal para cortes de luz o para que un encargado muestre el QR por el día.' : 'Abrilo una vez en la tablet o TV del local. Queda atado a ese dispositivo hasta que lo canceles.'}</p>
    <form data-form="dl-new" data-kind="${kind}">
      <div class="form-group"><label for="dl-label">Nombre (para reconocerlo)</label><input id="dl-label" name="label" maxlength="60" placeholder="${shift ? 'Ej.: Encargado Juan' : 'Ej.: TV de la entrada'}"></div>
      <div class="form-group"><label for="dl-branch">Sucursal</label><select id="dl-branch" name="branch_id">${O.branches.map((b) => html`<option value="${b.id}" ${b.id === O.qrBranch ? raw('selected') : ''}>${b.name}</option>`)}</select></div>
      ${shift ? html`<div class="form-group"><label for="dl-hours">Dura desde que lo abren</label><select id="dl-hours" name="hours">${[2, 4, 8, 12, 16].map((h) => html`<option value="${h}" ${h === 8 ? raw('selected') : ''}>${h} horas${h === 8 ? ' (una jornada)' : ''}</option>`)}</select></div>` : ''}
      <label class="row mb" style="font-size:.85rem"><input type="checkbox" name="require_gps" checked> Exigir que el dispositivo esté en el local con el GPS activado</label>
      <p class="muted mb">${shift ? 'Si nadie lo abre en 12 horas, vence solo.' : 'Destildalo solo si la pantalla es un TV o PC sin GPS (los empleados igual tienen que estar en el local para marcar).'}</p>
      <button class="btn btn-primary btn-block" type="submit">Crear link</button><button class="btn btn-outline btn-block mt" type="button" data-act="close-modal">Cancelar</button></form>`);
};
forms['dl-new'] = async (v, f) => {
  const shift = f.dataset.kind === 'shift';
  const r = await post('/api/owner/display-links', { kind: f.dataset.kind, label: v.label, branch_id: Number(v.branch_id), hours: shift ? Number(v.hours) : undefined, require_gps: v.require_gps === 'on' });
  const msg = `Hola${v.label ? ' ' + v.label : ''}, este es el link para mostrar el QR de asistencia de ${r.branch}. Abrilo en tu celular estando en el local, activá el GPS y dejá la pantalla encendida. Es de un solo uso${shift ? ` y dura ${r.hours} horas desde que lo abrís` : ''}: ${r.url}`;
  openModal(html`<h3 style="margin-bottom:8px">Link creado</h3><div class="alert alert-warn">Copialo ahora: por seguridad <strong>no se vuelve a mostrar</strong>. Si lo perdés, cancelalo y creá otro.</div>
    <div class="pw-box" style="font-size:.74rem;word-break:break-all">${r.url}</div>
    <div class="row mb"><button class="btn btn-outline btn-sm" data-act="copy" data-text="${r.url}" type="button">Copiar link</button><a class="btn btn-primary btn-sm" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Enviar por WhatsApp</a></div>
    <p class="muted">${shift ? `Vence si nadie lo abre en ${r.claim_hours} horas. Una vez abierto dura ${r.hours} horas y solo funciona en ese dispositivo.` : 'Abrilo en la tablet o TV del local. Se ata a ese dispositivo.'}</p>
    <button class="btn btn-primary btn-block mt" data-act="dl-done" type="button">Listo</button>`);
};
acts['dl-done'] = () => { closeModal(); loadTab(); };
acts['dl-revoke'] = async (el) => { if (!confirm('¿Cancelar este link? La pantalla que lo esté usando deja de mostrar el QR en unos segundos.')) return; await api('DELETE', `/api/owner/display-links/${el.dataset.id}`); toast('Link cancelado'); loadTab(); };

acts['geo-maps'] = async () => {
  const text = $('#g-maps').value.trim();
  const r = await post('/api/owner/geo/parse', { text });
  $('#g-lat').value = r.lat; $('#g-lng').value = r.lng;
  patchEl('#g-maps-res', html`<div class="alert alert-ok">Tomamos ${r.lat}, ${r.lng}. <a class="link" href="${r.maps_url}" target="_blank" rel="noopener">Verificar el punto en Google Maps ↗</a> y después tocá <strong>Guardar</strong>.</div>`);
};
acts['bw-maps'] = async () => {
  bwRead();
  const r = await post('/api/owner/geo/parse', { text: ($('#bw-maps').value || '').trim() });
  BW.lat = String(r.lat); BW.lng = String(r.lng); bwView(); toast('Ubicación tomada del link de Google Maps');
};


// ---------- Sucursales (módulo multi-sucursal) ----------
async function tabSucursales() {
  await refreshMe();
  const t = S.me.tenant;
  const [{ branches }, { employees }] = await Promise.all([get('/api/owner/branches'), get('/api/owner/employees')]);
  if (!t.mod_suc) {
    const price = S.me.prices?.mod_suc;
    patchEl('#tab-body', html`<div class="card">
      <strong>🏢 Multi-sucursal</strong>
      <p class="muted mt">Administrá varios locales con QR y geocerca propios, reportes por sucursal y empleados asignados a cada uno.</p>
      <ul class="muted" style="margin:12px 0 16px 18px;line-height:1.6">
        <li>QR y pantalla fija por local</li>
        <li>Geocerca independiente por sucursal</li>
        <li>Asignación de empleados a cada local</li>
        <li>Reportes filtrados por sucursal</li>
      </ul>
      <p style="font-weight:700;font-size:1.1rem;margin-bottom:12px">${price != null ? money(price) + ' · pago único' : 'Consultá el precio en Config'}</p>
      <button class="btn btn-mp btn-block" data-act="checkout" data-kind="mod_suc" type="button">Activar Multi-sucursal con Mercado Pago</button>
    </div>`);
    return;
  }
  const byBranch = {};
  for (const e of employees.filter((x) => x.status === 'active')) {
    const k = e.branch_id || 0;
    (byBranch[k] ||= []).push(e);
  }
  patchEl('#tab-body', html`<div class="card">
    <div class="row between"><div><strong>🏢 Multi-sucursal</strong><p class="muted">${branches.length} local(es) · módulo activo</p></div>
      <button class="btn btn-primary btn-sm" data-act="bw-open" type="button">+ Nueva sucursal</button></div>
    <div class="row mb" style="flex-wrap:wrap;gap:8px">
      <button class="btn btn-outline btn-sm" data-act="o-tab" data-tab="qr" type="button">📍 Ubicación y QR</button>
      <button class="btn btn-outline btn-sm" data-act="o-tab" data-tab="empleados" type="button">👥 Asignar empleados</button>
      <button class="btn btn-outline btn-sm" data-act="o-tab" data-tab="reportes" type="button">📄 Reportes</button>
    </div>
    ${branches.map((b) => {
      const emps = byBranch[b.id] || [];
      return html`<div class="card" style="background:var(--bg);margin-top:10px">
        <div class="row between" style="align-items:flex-start"><div class="grow">
          <div style="font-weight:700;font-size:1rem">${b.name}</div>
          <div class="muted" style="margin-top:4px">${b.address || 'Sin dirección cargada'}</div>
          <div class="row mt" style="gap:8px;flex-wrap:wrap">
            <span class="pill ${b.lat != null ? 'pill-g' : 'pill-x'}" style="font-size:.72rem;font-weight:700;padding:4px 8px;border-radius:999px;background:${b.lat != null ? '#d1fae5' : '#fef3c7'};color:${b.lat != null ? '#065f46' : '#92400e'}">${b.lat != null ? '📍 Geocerca OK' : '⚠️ Sin geocerca'}</span>
            <span class="muted" style="font-size:.78rem">${emps.length} empleado(s)</span>
            ${b.radius ? html`<span class="muted" style="font-size:.78rem">Radio ${b.radius} m</span>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="btn btn-outline btn-sm" data-act="o-tab" data-tab="qr" type="button">Configurar</button>
          ${branches.length > 1 ? html`<button class="btn btn-danger btn-sm" data-act="branch-del" data-id="${b.id}" type="button">Eliminar</button>` : ''}
        </div></div>
        ${emps.length ? html`<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
          <div class="muted" style="font-size:.75rem;margin-bottom:6px">Empleados en este local</div>
          ${emps.map((e) => html`<div class="hours-emp-row"><span>${e.name}</span><span class="muted">${e.cargo || 'Sin cargo'}</span></div>`)}
        </div>` : html`<p class="muted mt">Sin empleados asignados. Asignalos desde Empleados.</p>`}
      </div>`;
    })}
    <div class="card mt" style="background:var(--bg)">
      <strong>¿Qué incluye multi-sucursal?</strong>
      <ul class="muted" style="margin:10px 0 0 18px;line-height:1.7;font-size:.88rem">
        <li>QR y pantalla fija por cada local</li>
        <li>Geocerca independiente (radio y punto GPS)</li>
        <li>Empleados asignados a una sucursal</li>
        <li>Reportes y marcaciones separadas por local</li>
      </ul>
    </div>
  </div>`);
}

// ---------- Reportes ----------
const REP = { hours: 'Horas + extras', daily: 'Asistencia diaria', late: 'Tardanzas', auto: 'Salidas automáticas', contable: 'Export contable' };
const repState = { type: 'hours', period: null };
async function tabReportes() {
  if (S.me.tenant.features && !S.me.tenant.features.reports) {
    patchEl('#tab-body', html`<div class="card"><strong>📄 Reportes</strong>
      <p class="muted mt">Los reportes avanzados están en el plan <strong>Pro</strong> o <strong>Completo</strong>.</p>
      <p class="muted">Esencial incluye marcación, horas y avisos. Actualizá tu plan para exportar Excel y ver totales del equipo.</p>
    </div>`);
    return;
  }
  repState.period ||= new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7);
  const branchQ = repState.branch ? `&branch_id=${repState.branch}` : '';
  const [r, br] = await Promise.all([
    get(`/api/owner/reports?type=${repState.type}&period=${repState.period}${branchQ}`),
    S.me.tenant.mod_suc ? get('/api/owner/branches') : Promise.resolve({ branches: [] }),
  ]);
  const qs = `type=${repState.type}&period=${repState.period}${branchQ}`;
  const summary = r.summary || null;
  const branches = br.branches || [];
  patchEl('#tab-body', html`<div class="card"><strong>📄 Reportes</strong>
    <div class="grid2 mt"><div class="form-group"><label for="rp-p">Período</label><select id="rp-p" data-change="rep-period">${periodOptions(repState.period)}</select></div>
      <div class="form-group"><label for="rp-t">Tipo</label><select id="rp-t" data-change="rep-type">${Object.entries(REP).map(([k, l]) => html`<option value="${k}" ${k === repState.type ? raw('selected') : ''}>${l}</option>`)}</select></div></div>
    ${branches.length > 1 ? html`<div class="form-group"><label for="rp-b">Sucursal</label><select id="rp-b" data-change="rep-branch">
      <option value="">Todas</option>
      ${branches.map((b) => html`<option value="${b.id}" ${String(b.id) === String(repState.branch || '') ? raw('selected') : ''}>${b.name}</option>`)}
    </select></div>` : ''}
    ${summary ? html`<div class="rep-summary">${Object.entries(summary).map(([k, v]) => {
      const num = parseFloat(String(v).replace(/[^0-9,.\-]/g, '').replace(',', '.'));
      const cls = isNaN(num) ? '' : (num < 0 ? 'is-neg' : num === 0 ? 'is-zero' : 'is-pos');
      return html`<div class="rep-stat"><div class="rep-stat-l">${k}</div><div class="rep-stat-v ${cls}">${v}</div></div>`;
    })}</div>` : ''}
    <div class="rep-toolbar">
      <a class="btn btn-primary btn-sm" href="/api/owner/reports/export?${qs}&format=csv">📥 Excel / CSV</a>
      <a class="btn btn-outline btn-sm" href="/api/owner/reports/export?${qs}&format=json">JSON</a>
      <button class="btn btn-outline btn-sm" data-act="rep-print" type="button">🖨 PDF / Imprimir</button>
      ${!isStaffOnly() ? html`<a class="btn btn-outline btn-sm" href="/api/owner/export/all" title="JSON completo del negocio (empleados, marcas, permisos, docs)">📥 Exportar todos los datos</a>` : ''}
    </div>
    <div class="tbl-wrap">${tableHtml(r)}</div></div>`);
  O.lastReport = r;
}
const tableHtml = (r) => {
  if (!r.rows.length) return html`<div class="rep-empty">No hay datos para este período.<br><span style="font-size:.82rem">Cuando haya marcaciones, van a aparecer acá.</span></div>`;
  const diffIdx = r.columns.findIndex((c) => /diferencia/i.test(c));
  return html`<table class="tbl"><thead><tr>${r.columns.map((c) => html`<th>${c}</th>`)}</tr></thead><tbody>${r.rows.map((row) => html`<tr>${row.map((c, i) => {
    let cls = '';
    if (i === diffIdx) {
      const n = parseFloat(String(c).replace(',', '.'));
      if (!isNaN(n) && n < 0) cls = 'diff-neg';
      else if (!isNaN(n) && n > 0) cls = 'diff-pos';
    }
    return html`<td class="${cls}">${c}</td>`;
  })}</tr>`)}</tbody></table>`;
};
acts['rep-period'] = (el) => { repState.period = el.value; loadTab(); };
acts['rep-type'] = (el) => { repState.type = el.value; loadTab(); };
acts['rep-branch'] = (el) => { repState.branch = el.value || null; loadTab(); };
acts['rep-print'] = () => {
  const r = O.lastReport;
  $('#print-area').innerHTML = html`<h2>${S.me.tenant.name} · ${r.title}</h2><p>${periodLabel(r.period)}</p>${tableHtml(r)}`.toString();
  window.print();
};

// ---------- Configuración ----------
async function tabConfig() {
  const [s, { payments }, news] = await Promise.all([get('/api/owner/settings'), get('/api/pay/history'), get('/api/owner/changelog')]);
  await refreshMe();
  const t = S.me.tenant, p = S.me.prices;
  const sel = (name, opts, cur) => html`<select name="${name}" id="c-${name}">${opts.map(([v, l]) => html`<option value="${v}" ${String(v) === String(cur) ? raw('selected') : ''}>${l}</option>`)}</select>`;
  patchEl('#tab-body', html`<form data-form="settings">
  ${S.me.user.role === 'owner' ? html`<div class="card"><strong>🏪 Plantilla por rubro</strong>
    <p class="muted mb">Atajo para arrancar: aplica <strong>horario de entrada/salida, tolerancia de tardanza y radio GPS</strong> típicos del rubro. Después podés cambiar todo a mano en esta misma pestaña.</p>
    <div class="row" style="flex-wrap:wrap;gap:8px">
      <button type="button" class="btn btn-outline btn-sm" data-act="industry" data-k="comercio" title="9–18 · lun–sáb · tol. 10 min · 50 m">Comercio</button>
      <button type="button" class="btn btn-outline btn-sm" data-act="industry" data-k="gastronomia" title="8–00 · lun–sáb · tol. 15 min · 40 m">Gastronomía</button>
      <button type="button" class="btn btn-outline btn-sm" data-act="industry" data-k="taller" title="7–16 · lun–vie · tol. 10 min · 80 m">Taller</button>
      <button type="button" class="btn btn-outline btn-sm" data-act="industry" data-k="oficina" title="9–18 · lun–vie · tol. 15 min">Oficina</button>
      <button type="button" class="btn btn-outline btn-sm" data-act="industry" data-k="salud" title="8–14 · lun–vie · tol. 10 min · 40 m">Salud</button>
    </div>
    <p class="muted" style="font-size:.75rem;margin-top:8px">No cambia empleados ni ubicación del mapa: solo horarios y radio sugeridos.</p>
  </div>` : ''}
  <div class="card"><strong>🕐 Horario del local (turno fijo)</strong>
    <p class="muted mb">No inicia la jornada sola: solo sirve para <strong>avisarte si alguien llega tarde</strong>. Si un empleado tiene “Entrada habitual” en su ficha, se usa esa hora en lugar de esta.</p>
    <div class="grid2">
      <div class="form-group"><label for="c-schedule_start">Entrada del turno</label><input id="c-schedule_start" name="schedule_start" type="time" value="${s.schedule_start || ''}"></div>
      <div class="form-group"><label for="c-schedule_end">Salida del turno</label><input id="c-schedule_end" name="schedule_end" type="time" value="${s.schedule_end || ''}"></div>
    </div>
    <div class="form-group"><label for="c-late_tolerance_min">Tolerancia de llegada tarde</label>${sel('late_tolerance_min', [[0, 'Sin tolerancia'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '60 min']], s.late_tolerance_min)}</div>
    <p class="muted" style="font-size:.8rem">Ej.: entrada 09:00 y tolerancia 10 min → si marca a las 09:15, te llega el aviso “Llegó tarde”.</p>
  </div>
  <div class="card"><strong>⏱ Cierre automático de jornada</strong><p class="muted mb">Si alguien olvida marcar la salida, el sistema cierra su jornada a esta hora y te avisa. ${!(t.features && t.features.auto_close) ? html`<span class="module-status status-off">Plan Pro/Completo</span>` : ''}</p>
    <div class="form-group"><label for="c-auto_close_hour">Hora de cierre</label>${sel('auto_close_hour', Array.from({ length: 24 }, (_, h) => [h, String(h).padStart(2, '0') + ':00']), s.auto_close_hour)}</div>
    <div class="config-row"><div><div class="title">Permitir horas extra</div><div class="desc">Botón “Extra” en la app del empleado</div></div><label class="switch"><input type="checkbox" name="allow_extra" ${s.allow_extra ? raw('checked') : ''}><span class="slider"></span></label></div></div>
  <div class="card"><strong>📍 Métodos de marcación</strong>
    <p class="muted mb">Activá uno o los dos. Si desactivás GPS, los empleados marcan solo con QR y <strong>no se les pide ubicación</strong>. Si desactivás QR, marcan solo con el GPS del celular.</p>
    <div class="mark-mode-grid">
      <label class="mark-mode-card ${(s.mark_qr !== false && s.mark_qr !== 0) ? 'mode-on' : 'mode-off'}">
        <input type="checkbox" name="mark_qr" ${(s.mark_qr !== false && s.mark_qr !== 0) ? raw('checked') : ''}>
        <div>
          <div class="row between"><strong>QR dinámico</strong>
            <span class="mark-chip ${(s.mark_qr !== false && s.mark_qr !== 0) ? 'on' : 'off'}">${(s.mark_qr !== false && s.mark_qr !== 0) ? 'Habilitado' : 'Deshabilitado'}</span>
          </div>
          <div class="muted">Pantalla del local o tablet con código que rota. Ideal sin GPS estable.</div>
        </div>
      </label>
      <label class="mark-mode-card ${(s.mark_gps !== false && s.mark_gps !== 0) ? 'mode-on' : 'mode-off'}">
        <input type="checkbox" name="mark_gps" ${(s.mark_gps !== false && s.mark_gps !== 0) ? raw('checked') : ''}>
        <div>
          <div class="row between"><strong>GPS / geocerca</strong>
            <span class="mark-chip ${(s.mark_gps !== false && s.mark_gps !== 0) ? 'on' : 'off'}">${(s.mark_gps !== false && s.mark_gps !== 0) ? 'Habilitado' : 'Deshabilitado'}</span>
          </div>
          <div class="muted">Marcan desde el celular dentro del radio del local. Sin escanear QR.</div>
        </div>
      </label>
    </div>
  </div>
  <div class="card"><strong>⏱ Horas laborales</strong><p class="muted mb">Jornada de referencia. Los días hábiles de cada mes se calculan solos (menos feriados).</p>
    <div class="form-group"><label for="c-hpd">Horas por día</label>${sel('hpd', [6, 7, 8, 9].map((h) => [h, h + ' horas']), s.hpd)}</div>
    <div class="form-group"><label for="c-dpw">Días por semana</label>${sel('dpw', [[5, 'Lunes a viernes'], [6, 'Lunes a sábado']], s.dpw)}</div>
    <div class="form-group"><label for="c-sat_h">Horas de los sábados</label>${sel('sat_h', [[0, 'No trabaja'], [4, '4 horas'], [6, '6 horas'], [8, '8 horas']], s.sat_h)}</div></div>
  <button class="btn btn-primary btn-block mb" type="submit">Guardar configuración</button></form>
  <div class="card"><strong>🖼 Logo del negocio</strong>
    <p class="muted mb">Se muestra en la barra del dueño y del empleado. Formatos: JPG, PNG o WebP. Máximo 2 MB. Recomendado: cuadrado 256×256 px o más.</p>
    <div class="row" style="align-items:center;gap:14px;margin-bottom:12px">
      ${S.me.tenant.logo_url
        ? html`<img class="brand-logo-preview" src="${S.me.tenant.logo_url}" alt="Logo">`
        : html`<div class="brand-mark brand-mark-logo" style="width:56px;height:56px"></div>`}
      <div class="grow">
        <input id="logo-file" type="file" accept="image/jpeg,image/png,image/webp" style="margin-bottom:8px">
        <button class="btn btn-primary btn-sm" data-act="logo-up" type="button">Subir logo</button>
        ${S.me.tenant.logo_url ? html`<button class="btn btn-outline btn-sm" data-act="logo-del" type="button">Quitar logo</button>` : ''}
      </div>
    </div>
  </div>
  <form data-form="settings-theme" class="card"><strong>🎨 Tema</strong><p class="muted mb">Se aplica al instante. Guardá para que quede permanente.</p><div class="theme-presets" role="radiogroup">${SWATCHES.map((c) => html`<label data-act="theme-live" data-color="${c}"><input class="sr-only" type="radio" name="theme" value="${c}" ${c === s.theme ? raw('checked') : ''}><span class="theme-swatch ${c === s.theme ? 'active' : ''}" style="background:${c};display:block"></span></label>`)}</div></div>
  <button class="btn btn-primary btn-block mb" type="submit">Guardar configuración</button></form>
  <div class="card"><strong>Módulos opcionales</strong><p class="muted mb">Pago único. Si no los activás, esas funciones quedan bloqueadas.</p>
    ${[['mod_suc', '🏢 Multi-sucursal', 'Varios locales con QR y geocerca propios'], ['mod_rec', '📄 Recibos de sueldo', 'Subir recibos y firma conforme/disconforme']].map(([k, name, desc]) => html`<div class="config-row"><div><div class="title">${name} <span class="module-status ${t[k] ? 'status-on' : 'status-off'}">${t[k] ? 'Activo' : 'Bloqueado'}</span></div><div class="desc">${desc}</div></div>
      ${t[k] ? '' : html`<button class="btn btn-primary btn-sm" data-act="checkout" data-kind="${k}" type="button">${money(p[k])}</button>`}</div>`)}</div>
  <div class="card plan-card-pro"><strong>Tu plan</strong>
    <p class="muted mt">${({ esencial: 'Esencial', pro: 'Pro', completo: 'Completo' })[t.plan_tier || 'esencial'] || t.plan_tier} · ${t.plan === 'once' ? 'Pago único' : 'Suscripción mensual'} · ${t.paid_until ? 'hasta ' + new Date(t.paid_until).toLocaleDateString('es-AR') : 'sin vencimiento'} · ${t.employee_limit} empleados</p>
    ${(t.plan_tier || 'esencial') !== 'completo' ? html`<div class="plan-upgrade mt">
      <p class="muted mb" style="font-size:.85rem">Mejorá tu plan para desbloquear más funciones.</p>
      <div class="row" style="flex-wrap:wrap;gap:8px">
        ${(t.plan_tier || 'esencial') === 'esencial' ? html`<button class="btn btn-primary btn-sm" data-act="upgrade-plan" data-tier="pro" type="button">Pasar a Pro</button>` : ''}
        <button class="btn btn-outline btn-sm" data-act="upgrade-plan" data-tier="completo" type="button">Pasar a Completo</button>
      </div>
    </div>` : html`<p class="muted" style="font-size:.85rem;margin-top:8px">Tenés el plan más completo.</p>`}

    ${t.sub_state ? html`<p class="mt"><strong>Estado de la suscripción:</strong> ${{ active: 'Activa (se renueva sola cada mes)', cancelled: 'Cancelada', past_due: 'Pago vencido' }[t.sub_state]}${t.sub_state === 'active' && !t.sub_linked && S.cfg.payments.mp ? ' · esperando la confirmación de Mercado Pago' : ''}</p>` : ''}
    ${t.cancel_at ? html`<div class="alert alert-warn mt">Suscripción cancelada. Seguirás con acceso hasta ${t.paid_until ? new Date(t.paid_until).toLocaleDateString('es-AR') : 'el fin del período'}.</div>` : ''}
    ${t.extra_slots ? html`<p class="muted">Tenés ${t.extra_slots} cupos extra comprados (pago único, sin vencimiento).</p>` : ''}
    ${payments.length ? html`<div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Estado</th></tr></thead><tbody>${payments.map((x) => html`<tr><td>${fmtDateTime(x.created_at)}</td><td>${{ plan: 'Plan', extra: 'Extras ×' + x.qty, mod_suc: 'Multi-sucursal', mod_rec: 'Recibos' }[x.kind]}</td><td>${money(x.amount)}</td><td>${badge(x.status)}</td></tr>`)}</tbody></table></div>` : ''}
    <div class="row mt">${t.plan === 'sub' && !t.cancel_at ? html`<button class="btn btn-danger btn-sm" data-act="plan-cancel" type="button">Cancelar suscripción</button>` : ''}<button class="btn btn-outline btn-sm" data-act="change-pw" type="button">Cambiar mi contraseña</button></div></div>
  ${O.ob && (O.ob.dismissed || O.ob.all_done) ? html`<div class="card"><div class="row between"><div><strong>🧭 Primeros pasos</strong><div class="muted">${O.ob.completed} de ${O.ob.total} completados</div></div><button class="btn btn-outline btn-sm" data-act="ob-reopen" type="button">Ver checklist</button></div></div>` : ''}
  ${newsBlock(news)}
  <div class="card"><strong>⭐ Valorá AsistOK</strong>
    <p class="muted mb">Tu opinión puede salir en la página de inicio (con el logo de tu negocio si lo cargaste). La revisamos antes de publicarla.</p>
    <form data-form="review">
      <div class="form-group"><label for="rv-stars">Estrellas</label>
        <select id="rv-stars" name="stars">${[5,4,3,2,1].map((n) => html`<option value="${n}">${'★'.repeat(n)}${'☆'.repeat(5-n)}</option>`)}</select>
      </div>
      <div class="form-group"><label for="rv-text">Frase corta</label><textarea id="rv-text" name="text" rows="2" maxlength="280" required placeholder="Ej.: Nos simplificó el control del equipo."></textarea></div>
      <div class="form-group"><label for="rv-name">Tu nombre (opcional)</label><input id="rv-name" name="author_name" maxlength="60" placeholder="Cómo querés figurar"></div>
      <button class="btn btn-outline btn-sm" type="submit">Enviar valoración</button>
    </form>
  </div>
  <div class="card"><strong>💬 ¿Algo no funciona o tenés una idea?</strong><p class="muted mb">Contanos. Lo lee el equipo de AsistOK.</p><button class="btn btn-outline btn-sm" data-act="feedback-open" data-ctx="owner/config" type="button">Reportar problema / enviar idea</button></div>`);
}
forms.settings = async (v, f) => {
  // Checkboxes: leer del DOM (FormData omite los desmarcados de forma confiable solo con === 'on')
  const qrEl = f?.querySelector?.('[name=mark_qr]');
  const gpsEl = f?.querySelector?.('[name=mark_gps]');
  const extraEl = f?.querySelector?.('[name=allow_extra]');
  const mark_qr = qrEl ? !!qrEl.checked : v.mark_qr === 'on';
  const mark_gps = gpsEl ? !!gpsEl.checked : v.mark_gps === 'on';
  const allow_extra = extraEl ? !!extraEl.checked : v.allow_extra === 'on';
  if (!mark_qr && !mark_gps) throw Object.assign(new Error('Tenés que dejar al menos un método de marcación (QR o GPS)'), { status: 400 });
  await patch('/api/owner/settings', {
    auto_close_hour: +v.auto_close_hour,
    late_tolerance_min: +v.late_tolerance_min,
    allow_extra,
    hpd: +v.hpd,
    dpw: +v.dpw,
    sat_h: +v.dpw === 6 ? +v.sat_h : 0,
    theme: v.theme || S.me?.tenant?.theme,
    schedule_start: v.schedule_start || '',
    schedule_end: v.schedule_end || '',
    mark_qr,
    mark_gps,
  });
  await refreshMe();
  toast('Configuración guardada');
  loadTab();
};

acts['news-toggle'] = () => { O.showNews = !O.showNews; loadTab(); };
acts['plan-cancel'] = async () => {
  if (!confirm('¿Cancelar la suscripción?\n\nTu cuenta seguirá activa hasta el final del período ya pagado. Después pasará a inactiva. Los datos no se borran.')) return;
  const r = await post('/api/owner/plan/cancel'); // si Mercado Pago no confirma la baja, falla con un mensaje y NO se marca como cancelada
  toast(r.already ? 'La suscripción ya estaba cancelada' : 'Suscripción cancelada en Mercado Pago. Seguís con acceso hasta el fin del período pagado.');
  await refreshMe(); loadTab();
};

acts['logo-up'] = async () => {
  const file = document.getElementById('logo-file')?.files?.[0];
  if (!file) return toast('Elegí una imagen primero');
  if (file.size > 2 * 1024 * 1024) return toast('Máximo 2 MB');
  try {
    toast('Subiendo logo…');
    await post('/api/owner/branding/logo', { filename: file.name, data: await fileToBase64(file) });
    await refreshMe();
    if (S.me?.tenant) S.me.tenant.logo_url = '/api/tenant/logo?t=' + Date.now();
    toast('Logo actualizado');
    renderOwner();
  } catch (e) { toast(e.message || 'No se pudo subir el logo'); }
};
acts['sign-up'] = async () => {
  const file = document.getElementById('sign-file')?.files?.[0];
  if (!file) return toast('Elegí una imagen de firma primero');
  if (file.size > 2 * 1024 * 1024) return toast('Máximo 2 MB');
  try {
    toast('Subiendo firma…');
    await post('/api/owner/branding/sign', { filename: file.name, data: await fileToBase64(file) });
    await refreshMe();
    if (S.me?.tenant) S.me.tenant.has_sign = true;
    toast('Firma guardada');
    loadTab();
  } catch (e) { toast(e.message || 'No se pudo subir la firma'); }
};
acts['logo-del'] = async () => {
  if (!confirm('¿Quitar el logo?')) return;
  await api('DELETE', '/api/owner/branding/logo');
  await refreshMe();
  if (S.me?.tenant) S.me.tenant.logo_url = null;
  toast('Logo quitado');
  renderOwner();
};
acts['sign-del'] = async () => {
  if (!confirm('¿Quitar la firma?')) return;
  await api('DELETE', '/api/owner/branding/sign');
  await refreshMe();
  if (S.me?.tenant) S.me.tenant.has_sign = false;
  toast('Firma quitada');
  loadTab();
};
acts['industry'] = async (el) => {
  if (!confirm('¿Aplicar la plantilla «' + el.dataset.k + '»? Se actualizan horarios, tolerancia y radio de las sucursales.')) return;
  await post('/api/owner/industry-template', { template: el.dataset.k });
  toast('Plantilla aplicada');
  loadTab();
};
forms['settings-theme'] = async (v) => {
  const theme = v.theme || S.me?.tenant?.theme;
  if (!theme) return toast('Elegí un color');
  await patch('/api/owner/settings', { theme });
  if (S.me?.tenant) S.me.tenant.theme = theme;
  await refreshMe();
  applyTheme();
  toast('Tema guardado');
};

acts['emp-role'] = async (el) => {
  const role = el.dataset.role;
  const msgs = {
    manager: '¿Convertir en encargado de su sucursal? Verá solo su local (equipo, tardanzas, permisos). Sin pagos ni config.\n\nSe cerrará su sesión actual para que vuelva a ingresar.',
    hr: '¿Convertir en RRHH? Verá asistencia de todo el negocio. Sin pagos ni configuración general.\n\nSe cerrará su sesión actual.',
    employee: '¿Volver a empleado normal? Solo marcará asistencia desde su panel.\n\nSe cerrará su sesión de encargado/RRHH si estaba abierta.',
  };
  if (!confirm(msgs[role] || msgs.employee)) return;
  const id = el.dataset.id;
  try {
    await post('/api/owner/employees/' + id + '/role', { role });
    toast(role === 'manager' ? 'Ahora es encargado · debe volver a ingresar' : role === 'hr' ? 'Ahora es RRHH · debe volver a ingresar' : 'Volvió a empleado · debe volver a ingresar');
  } catch (err) {
    toast(err.message || 'No se pudo cambiar el rol');
    return;
  }
  closeModal();
  await afterEmpChange();
};
acts['emp-delete'] = async (el) => {
  if (!confirm('¿Eliminar este empleado de forma permanente?\n\nSe borran su usuario y sesiones. Las marcas históricas pueden quedar sin nombre.')) return;
  try {
    await post(`/api/owner/employees/${el.dataset.id}/delete`);
  } catch (e) {
    if (!confirm('El empleado está activo u ocurrió un error. ¿Forzar eliminación?')) return;
    await post(`/api/owner/employees/${el.dataset.id}/delete-force`);
  }
  closeModal(); toast('Empleado eliminado'); afterEmpChange();
};
acts['emp-erase'] = async (el) => {
  const name = el.dataset.name || 'este empleado';
  if (!confirm('¿Eliminar TODOS los datos personales de ' + name + '?\n\nSe borran: ficha, marcas, permisos, documentos y archivos. Esta acción no se puede deshacer.\n\nUsala solo si el titular (o la AAIP) lo solicitó.')) return;
  const reason = prompt('Motivo (opcional, queda en la auditoría):', 'solicitud_titular_o_aaip') || 'solicitud_titular_o_aaip';
  await post('/api/owner/employees/' + el.dataset.id + '/erase', { reason });
  toast('Datos eliminados');
  closeModal();
  loadTab();
};

forms.review = async (v) => {
  await post('/api/owner/review', { stars: +v.stars, text: v.text, author_name: v.author_name || '' });
  toast('¡Gracias! Revisamos tu valoración antes de publicarla');
};

acts['upgrade-plan'] = async (el) => {
  const tier = el.dataset.tier;
  if (!confirm('¿Actualizar al plan ' + (tier === 'pro' ? 'Pro' : 'Completo') + '?\n\nSe abrirá el pago correspondiente.')) return;
  try {
    await post('/api/owner/plan/upgrade', { plan_tier: tier });
    await refreshMe();
    toast('Plan actualizado');
    loadTab();
  } catch (e) {
    // si requiere pago, disparar checkout
    if (e.code === 'PAYMENT_REQUIRED' || e.status === 402) {
      acts.checkout?.({ dataset: { kind: 'plan_upgrade', tier } });
      toast(e.message || 'Completá el pago para subir de plan');
    } else toast(e.message || 'No se pudo actualizar');
  }
};


// ---------- Mi asistencia (encargado / RRHH también marcan y piden) ----------
async function tabMiMarcar() {
  const st = await get('/api/me/state');
  const on = st.on;
  const allowExtra = S.me.tenant.allow_extra !== 0 && S.me.tenant.allow_extra !== false;
  patchEl('#tab-body', html`<div class="card">
    <strong>📱 Marcar asistencia</strong>
    <p class="muted mt">Como ${isHr() ? 'RRHH' : 'encargado'} también registrás tu propia jornada (GPS / QR según la config del negocio).</p>
    <div class="mt" style="text-align:center;padding:12px 0">
      <div style="font-size:2.5rem">${on ? (st.extra ? '⏱️' : '🟢') : '⚪'}</div>
      <div style="font-weight:700;margin-top:8px">${on ? (st.extra ? 'En horas extra' : 'En jornada') : 'Fuera de jornada'}</div>
      ${st.since ? html`<div class="muted" style="margin-top:4px">Desde ${new Date(st.since).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</div>` : ''}
    </div>
    <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center;margin-top:12px">
      ${!on ? html`<button class="btn btn-primary" data-act="staff-mark" data-action="in" type="button">Entrada</button>` : html`<button class="btn btn-primary" data-act="staff-mark" data-action="out" type="button">Salida</button>`}
      ${on && allowExtra && !st.extra ? html`<button class="btn btn-outline" data-act="staff-mark" data-action="extra" type="button">Pasar a extra</button>` : ''}
    </div>
    ${st.today?.length ? html`<div class="mt"><strong style="font-size:.85rem">Hoy</strong>
      <ul class="muted" style="margin:8px 0 0 18px;line-height:1.6">${st.today.map((m) => html`<li>${m.kind === 'in' ? 'Entrada' : m.kind === 'out' ? 'Salida' : m.kind === 'xin' ? 'Extra in' : m.kind === 'extra' || m.kind === 'xout' ? 'Extra out' : m.kind} · ${new Date(m.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}${m.auto ? ' (auto)' : ''}</li>`)}</ul>
    </div>` : ''}
  </div>`);
}

acts['staff-mark'] = async (el) => {
  const action = el.dataset.action;
  let body = { action };
  // Intentar GPS si el navegador lo permite
  try {
    const pos = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('no geo'));
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    });
    body.lat = pos.coords.latitude;
    body.lng = pos.coords.longitude;
    body.accuracy = pos.coords.accuracy;
  } catch (_) { /* el backend dirá si hace falta GPS */ }
  try {
    await post('/api/me/mark', body);
    toast(action === 'in' ? 'Entrada registrada' : action === 'out' ? 'Salida registrada' : 'Pasaste a horas extra');
    loadTab();
  } catch (e) {
    toast(e.message || 'No se pudo marcar', true);
  }
};

async function tabMiPermisos() {
  const [{ permits }, vac] = await Promise.all([
    get('/api/me/permits'),
    get('/api/me/vacation').catch(() => null),
  ]);
  const types = [
    ['dia', 'Día libre'], ['vacaciones', 'Vacaciones'], ['maternidad', 'Maternidad'],
    ['paternidad', 'Paternidad'], ['casamiento', 'Casamiento'], ['fallecimiento', 'Fallecimiento'],
    ['examen', 'Examen'], ['otro', 'Otro'],
  ];
  const who = isHr() ? 'el dueño' : 'RRHH o el dueño';
  patchEl('#tab-body', html`<div class="card">
    <strong>📅 Mis permisos y licencias</strong>
    <p class="muted mt">Tus pedidos los autoriza <strong>${who}</strong>.</p>
    ${vac ? html`<p class="muted" style="font-size:.85rem">Vacaciones: ${vac.available} día(s) disponible(s) de ${vac.entitled} (usados ${vac.used}${vac.pending ? ', pendientes ' + vac.pending : ''}).</p>` : ''}
    <form data-form="staff-permit" class="mt">
      <div class="form-group"><label>Tipo</label><select name="type" required>${types.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
      <div class="form-group"><label>Desde</label><input type="date" name="from" required></div>
      <div class="form-group"><label>Hasta (mismo día si es “Día libre”)</label><input type="date" name="to"></div>
      <div class="form-group"><label>Nota</label><textarea name="note" rows="2" placeholder="Opcional"></textarea></div>
      <button class="btn btn-primary btn-block" type="submit">Enviar pedido</button>
    </form>
  </div>
  <div class="card mt"><strong>Historial</strong>
    ${permits.length ? permits.map((p) => html`<div class="hours-emp-row" style="display:block;margin-bottom:8px">
      <div style="font-weight:600;font-size:.88rem">${p.type} · ${p.from_date}${p.to_date && p.to_date !== p.from_date ? ' → ' + p.to_date : ''}</div>
      <div class="muted">${p.status === 'pending' ? 'Pendiente de autorización' : p.status === 'approved' ? 'Aprobado' : 'Rechazado'}${p.note ? ' · ' + p.note : ''}</div>
    </div>`) : html`<p class="muted">Todavía no pediste permisos.</p>`}
  </div>`);
}

forms['staff-permit'] = async (v) => {
  const body = { type: v.type, from: v.from, to: v.to || v.from, note: v.note || '' };
  await post('/api/me/permits', body);
  toast('Pedido enviado');
  loadTab();
};



async function tabFacturas() {
  let st = { module_enabled: false, profile_complete: false, missing: [], profile: null };
  let inv = { invoices: [] };
  try {
    st = await get('/api/owner/billing/status');
    if (st.module_enabled) inv = await get('/api/owner/invoices');
  } catch (e) {
    // Si el backend aún no tiene billing o falla, no dejar el spinner infinito
    patchEl('#tab-body', html`<div class="card"><strong>Facturas</strong>
      <p class="muted mt">No se pudo cargar el módulo de facturación. Si acabás de actualizar, esperá el redeploy o recargá la página.</p>
      <p class="muted" style="font-size:.8rem">${e && e.message ? e.message : ''}</p>
    </div>`);
    return;
  }
  const moneyC = (c) => '$ ' + ((Number(c)||0)/100).toLocaleString('es-AR', { minimumFractionDigits: 2 });
  const missing = (st.missing || []).join(', ');
  patchEl('#tab-body', html`
  <div class="card mb">
    <strong>Datos fiscales</strong>
    <p class="muted mb">Necesarios para emitir comprobantes del servicio. <em>No reemplazan una factura AFIP/ARCA</em>.</p>
    ${!st.module_enabled ? html`<div class="alert alert-warn">La facturación aún no está habilitada por AsistOK.</div>` : ''}
    ${st.module_enabled && !st.profile_complete ? html`<div class="alert alert-warn">Faltan datos: ${missing || 'completá el formulario'}</div>` : ''}
    ${st.profile_complete ? html`<div class="alert alert-ok">Perfil fiscal completo</div>` : ''}
    <form data-form="bill-profile">
      <div class="grid2">
        <div class="form-group"><label>Razón social / Nombre</label><input name="legal_name" required value="${(st.profile&&st.profile.legal_name)||''}"></div>
        <div class="form-group"><label>CUIT / CUIL</label><input name="tax_id" required value="${(st.profile&&st.profile.tax_id)||''}"></div>
        <div class="form-group"><label>Domicilio fiscal</label><input name="address" required value="${(st.profile&&st.profile.address)||''}"></div>
        <div class="form-group"><label>Código postal</label><input name="zip" required value="${(st.profile&&st.profile.zip)||''}"></div>
        <div class="form-group"><label>Ciudad</label><input name="city" value="${(st.profile&&st.profile.city)||''}"></div>
        <div class="form-group"><label>Email de facturación</label><input name="email" type="email" required value="${(st.profile&&st.profile.email)||''}"></div>
        <div class="form-group"><label>Tipo de persona</label>
          <select name="person_type"><option value="juridica" ${(st.profile&&st.profile.person_type)==='juridica'?'selected':''}>Jurídica</option><option value="fisica" ${(st.profile&&st.profile.person_type)==='fisica'?'selected':''}>Física</option></select>
        </div>
        <div class="form-group"><label>Condición IVA</label>
          <select name="tax_condition"><option value="CF">Consumidor final</option><option value="RI">Responsable inscripto</option><option value="MONO">Monotributo</option><option value="EX">Exento</option></select>
        </div>
        <div class="form-group"><label>Tipo de comprobante</label>
          <select name="doc_type"><option value="recibo">Recibo / comprobante de servicio</option><option value="factura_x">Factura X (informativa)</option></select>
        </div>
      </div>
      <button class="btn btn-primary" type="submit">Guardar datos fiscales</button>
    </form>
  </div>
  <div class="card">
    <strong>Historial de comprobantes</strong>
    ${!(inv.invoices||[]).length ? html`<p class="muted mt">Todavía no hay comprobantes.</p>` : html`
    <div class="table-wrap mt"><table class="table"><thead><tr><th>#</th><th>Estado</th><th>Total</th><th>Fecha</th><th></th></tr></thead><tbody>
      ${(inv.invoices||[]).map((i) => html`<tr>
        <td>${i.number ? (i.series+'-'+i.number) : '—'}</td>
        <td><span class="mark-chip">${i.status}</span></td>
        <td>${moneyC(i.total_cents)}</td>
        <td>${i.issued_at ? new Date(i.issued_at).toLocaleDateString('es-AR') : new Date(i.created_at).toLocaleDateString('es-AR')}</td>
        <td><a class="btn btn-outline btn-sm" href="/api/owner/invoices/${i.id}/pdf" target="_blank">Ver / PDF</a>
          ${i.payment_id && i.status==='pending_data' ? html`<button class="btn btn-sm" data-act="inv-req" data-pay="${i.payment_id}" type="button">Reintentar</button>` : ''}
        </td>
      </tr>`)}
    </tbody></table></div>`}
    <p class="muted mt">Si tenés un pago aprobado y querés el comprobante, indicá el ID de pago:</p>
    <form data-form="inv-request" class="row" style="gap:8px;align-items:flex-end">
      <div class="form-group" style="margin:0"><label>payment_id</label><input name="payment_id" type="number" min="1" required></div>
      <button class="btn btn-primary btn-sm" type="submit">Solicitar factura</button>
    </form>
  </div>`);
}
forms['bill-profile'] = async (v) => {
  await api('PUT', '/api/owner/billing/profile', v);
  toast('Datos fiscales guardados');
  renderOwner();
};
forms['inv-request'] = async (v) => {
  const r = await post('/api/owner/invoices/request', { payment_id: +v.payment_id });
  toast(r.status === 'pending_data' ? 'Creada pendiente de datos fiscales' : 'Comprobante generado');
  renderOwner();
};
acts['inv-req'] = async (el) => {
  await post('/api/owner/invoices/request', { payment_id: +el.dataset.pay });
  toast('Solicitud enviada');
  renderOwner();
};
