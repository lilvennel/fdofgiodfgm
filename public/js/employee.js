import { S, acts, forms, html, raw, $, get, post, patch, render, patchEl, toast, openModal, closeModal, fmtH, fmtTime, fmtDateTime, fmtDay, holKind, periodOptions, badge, todayAR, fileToBase64 } from './util.js';

const E = { screen: 'home', period: null };
const loading = html`<p class="muted" style="padding:24px;text-align:center"><span class="spinner"></span></p>`;
const NAV = [['home', '🏠', 'Inicio'], ['marcar', '📱', 'Marcar'], ['horas', '⏱', 'Horas'], ['perfil', '👤', 'Perfil']];
const PERM_INFO = {
  dia: 'Pedís un día libre particular. Tu empleador aprueba o rechaza.',
  vacaciones: 'Vacaciones según LCT (art. 150): 14, 21, 28 o 35 días corridos según tu antigüedad.',
  maternidad: 'Licencia por maternidad: 90 días corridos. Se informa al empleador para su registro.',
  paternidad: 'Licencia por paternidad según la ley o el convenio vigente.',
  casamiento: 'Licencia por matrimonio: 10 días corridos (LCT art. 158).',
  fallecimiento: 'Licencia por fallecimiento de familiar: 3 días (cónyuge, hijos, padres) o 1 día (otros), según LCT.',
  examen: 'Días de examen según convenio. Adjuntá la constancia en Certificados si te la piden.',
  otro: 'Otro permiso. Detallá el motivo para que tu empleador pueda evaluarlo.',
};

function shell(body) {
  const nav = NAV.map(([k, ico, l]) => html`<button class="${E.screen === k ? 'active' : ''}" data-act="e-go" data-s="${k}" type="button"><span class="ico">${ico}</span><span class="nav-label">${l}</span></button>`);
  render(html`<div class="emp-shell emp-shell-wide">
    <header class="topbar emp-topbar topbar-pro"><div class="brand">${S.me.tenant.logo_url
    ? html`<img class="brand-logo" src="${S.me.tenant.logo_url}" alt="" width="34" height="34">`
    : html`<div class="brand-mark brand-mark-logo" aria-hidden="true"></div>`}<span>${S.me.tenant.name}</span></div>
      <div class="emp-top-actions">
        <button class="btn btn-sm btn-outline" data-act="dark" type="button" aria-label="Cambiar tema">🌓</button>
        <button class="btn btn-sm btn-outline" data-act="logout" type="button">Cerrar sesión</button>
      </div>
    </header>
    <main class="emp-app"><div id="e-body" class="emp-body">${body}</div></main>
    <nav class="emp-nav" aria-label="Navegación">${nav}</nav>
  </div>`);
}
const back = html`<button class="btn btn-outline btn-sm emp-back" data-act="e-go" data-s="home" type="button">← Volver</button>`;

export function renderEmployee() { shell(loading); go(E.screen); }
export function renderMark() { E.screen = 'marcar'; shell(loading); go('marcar'); }
acts['e-go'] = (el) => go(el.dataset.s);
acts['extra-off'] = () => toast('Tu empleador no permite hacer horas extras.');

async function go(screen) {
  E.screen = screen;
  document.querySelectorAll('.emp-nav button').forEach((b) => b.classList.toggle('active', b.dataset.s === screen));
  patchEl('#e-body', loading);
  try { await ({ home, marcar, horas, permisos, certs, docs, cumples, perfil, inbox, calendario, sueldo, documentos, solicitudes })[screen](); }
  catch (e) { const { fail } = await import('./app.js'); fail(e); }
  window.scrollTo(0, 0);
}

const MENU = [
  ['inbox', '🔔', 'Avisos y pendientes', 'Recibos · permisos · recordatorios'],
  ['marcar', '📱', 'Marcar asistencia', 'Entrada · Salida · Extra, con tu ubicación'],
  ['horas', '⏱', 'Mis horas', 'Normales y extras'],
  ['calendario', '📆', 'Calendario laboral', 'Feriados · vacaciones · turnos'],
  ['permisos', '📅', 'Permisos y licencias', 'Vacaciones · día libre · licencias'],
  ['sueldo', '💰', 'Resumen de sueldo', 'Recibos · horas del mes'],
  ['certs', '📎', 'Certificados', 'Adjuntar para el empleador'],
  ['docs', '📄', 'Recibos de sueldo', 'Ver y firmar'],
  ['documentos', '📁', 'Mis documentos', 'Datos · certificados · contratos'],
  ['solicitudes', '✉️', 'Solicitudes', 'RH · horas · corrección de fichaje'],
  ['cumples', '🎂', 'Cumpleaños', 'Del equipo'],
  ['perfil', '👤', 'Mi perfil', 'Datos y contacto de emergencia'],
  ['feedback', '💬', 'Reportar un problema o idea', 'Contanos qué no funciona o qué te gustaría'],
];
async function home() {
  const h = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }));
  const [st, hol] = await Promise.all([get('/api/me/state'), get('/api/me/holidays').catch(() => ({ upcoming: [] }))]);
  const greet = h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  const illu = h < 12 ? '☀️' : h < 20 ? '👋' : '🌙';
  const first = S.me.user.name.split(' ')[0];
  const nextHol = (hol.upcoming || []).slice(0, 3);
  // Tiempo trabajado hoy a partir de las marcas del día
  let workedMin = 0, entryLabel = null;
  const marks = st.today || [];
  let openTs = null;
  for (const m of marks) {
    if (m.kind === 'in' || m.kind === 'xin') {
      if (!entryLabel) entryLabel = fmtTime(m.ts);
      openTs = m.ts;
    } else if ((m.kind === 'out' || m.kind === 'xout' || m.kind === 'extra') && openTs) {
      workedMin += Math.max(0, Math.round((m.ts - openTs) / 60000));
      openTs = null;
    }
  }
  if (openTs) workedMin += Math.max(0, Math.round((Date.now() - openTs) / 60000));
  const wh = Math.floor(workedMin / 60), wm = workedMin % 60;
  const workedStr = workedMin > 0 ? `${wh} h ${String(wm).padStart(2, '0')} min` : '0 h 00 min';
  const shift = S.me.user.shift_start || S.me.tenant.schedule_start || null;
  const shiftEnd = S.me.tenant.schedule_end || null;
  patchEl('#e-body', html`
    <div class="emp-home">
      <div class="greet-card">
        <div class="greet-left">
          <div class="greet-hi">Hola <strong>${first}</strong></div>
          <div class="greet-sub">${greet}${st.on ? ' · en jornada desde ' + fmtTime(st.since) : ''}</div>
          ${st.on
            ? html`<span class="status-pill on">En jornada</span>`
            : html`<span class="status-pill off">Fuera de jornada</span>`}
          ${nextHol.length ? html`<div class="greet-holidays">
            <div class="greet-hol-title">📅 Próximos feriados</div>
            ${nextHol.map((x) => html`<div class="greet-hol-row"><span>${fmtDay(x.date)}</span><span>${x.name}${x.kind ? html` · <span class="muted">${holKind(x.kind)}</span>` : ''}</span></div>`)}
          </div>` : ''}
        </div>
        <div class="greet-emoji" aria-hidden="true">${illu}</div>
      </div>

      <div class="card jornada-card">
        <div class="jornada-label">MI JORNADA · HOY</div>
        <div class="jornada-grid">
          <div>
            <div class="muted" style="font-size:.75rem">Entrada</div>
            <div style="font-weight:700;font-size:1.05rem">${entryLabel || (st.on ? fmtTime(st.since) : '—')}</div>
          </div>
          <div>
            <div class="muted" style="font-size:.75rem">Tiempo trabajado</div>
            <div style="font-weight:800;font-size:1.15rem;color:var(--theme)">${workedStr}</div>
          </div>
          <div>
            <div class="muted" style="font-size:.75rem">Turno</div>
            <div style="font-weight:600">${shift ? (shift + (shiftEnd ? ' – ' + shiftEnd : '')) : 'Sin turno fijo'}</div>
          </div>
        </div>
        <div class="row between" style="margin-top:10px">
          <span class="pill ${st.on ? 'pill-g' : ''}">${st.on ? (st.extra ? 'En horas extra' : 'En jornada') : 'Fuera de jornada'}</span>
          <button class="btn btn-primary btn-sm" data-act="e-go" data-s="marcar" type="button">${st.on ? 'Marcar salida' : 'Marcar entrada'}</button>
        </div>
      </div>

      <div class="menu-grid menu-grid-v2">
        ${MENU.map(([k, ico, title, sub]) => html`
          <div class="menu-row menu-row-v2" role="button" tabindex="0"
            data-act="${k === 'feedback' ? 'feedback-open' : 'e-go'}" data-s="${k}" data-ctx="employee/home">
            <div class="menu-icon menu-icon-v2">${ico}</div>
            <div class="grow"><div class="menu-title">${title}</div><div class="menu-sub">${sub}</div></div>
            <span class="menu-chevron" aria-hidden="true">›</span>
          </div>`)}
      </div>
    </div>`);
}

async function marcar() {
  const [st, br] = await Promise.all([get('/api/me/state'), get('/api/me/branches')]);
  const code = S.markCode, t = S.me.tenant;
  const flash = E.flash || ''; E.flash = null;
  const allowQr = t.mark_qr !== false && t.mark_qr !== 0;
  const allowGps = t.mark_gps !== false && t.mark_gps !== 0;
  const branches = br.branches || br || [];
  const needBranch = allowGps && branches.length > 1;

  patchEl('#e-body', html`${back}
    <div class="card">
      <strong>Marcar asistencia</strong>
      <div class="mark-modes-status mt">
        <span class="mark-chip ${allowQr ? 'on' : 'off'}">${allowQr ? 'QR habilitado' : 'QR deshabilitado'}</span>
        <span class="mark-chip ${allowGps ? 'on' : 'off'}">${allowGps ? 'GPS habilitado' : 'GPS deshabilitado'}</span>
      </div>
      ${!allowQr && !allowGps ? html`<div class="alert alert-warn mt">Tu empleador no tiene ningún método de marcación activo. Avisale.</div>` : ''}
      ${allowQr && !allowGps ? html`<p class="muted mt">Marcás solo con el <strong>QR del local</strong>. No se pide ubicación del celular.</p>` : ''}
      ${!allowQr && allowGps ? html`<p class="muted mt">Marcás con el <strong>GPS del celular</strong> dentro de la zona del local. No hace falta escanear QR.</p>` : ''}
      ${allowQr && allowGps ? html`<p class="muted mt">Podés marcar con GPS desde acá o escaneando el QR de la pantalla del local.</p>` : ''}
    </div>

    <div class="card">
      <div class="status-live ${st.on ? (st.extra ? 'extra' : 'jornada') : 'fuera'}"><div style="width:8px;height:8px;border-radius:50%;background:currentColor"></div>
        <div><div style="font-weight:600">${st.on ? (st.extra ? 'En horas extra' : 'En jornada') : 'Fuera de jornada'}</div>
        <div style="font-size:.75rem">${st.on ? 'Desde ' + fmtTime(st.since) : 'Sin entrada abierta'}</div></div>
      </div>
      ${code ? html`<div class="alert alert-ok mt">QR listo para usar</div>` : (allowQr && !allowGps ? html`<div class="alert alert-warn mt">Escaneá el QR de la pantalla del local para poder marcar.</div>` : '')}
      ${needBranch ? html`<div class="form-group mt"><label for="m-branch">Sucursal</label>
        <select id="m-branch">${branches.map((b) => html`<option value="${b.id}" ${String(b.id) === String(E.branch || S.me.user.branch_id || '') ? raw('selected') : ''}>${b.name}</option>`)}</select>
      </div>` : ''}
      <div id="mark-result">${flash || ''}</div>
      <div id="mark-btns" class="mark-btns mt">
        ${!st.on ? html`<button class="btn btn-primary btn-block" data-act="mark" data-a="in" type="button" ${(!allowQr && !allowGps) || (allowQr && !allowGps && !code) ? raw('disabled') : ''}>Entrada</button>
          ${t.allow_extra ? html`<button class="btn btn-outline btn-block mt" data-act="mark" data-a="extra" type="button" ${(!allowQr && !allowGps) || (allowQr && !allowGps && !code) ? raw('disabled') : ''}>Entrada extra</button>`
            : html`<button class="btn btn-outline btn-block mt" type="button" disabled title="Tu empleador no permite horas extras">Extra no permitido</button>`}`
          : html`<button class="btn btn-primary btn-block" data-act="mark" data-a="out" type="button">Salida</button>
          ${st.extra ? html`<button class="btn btn-outline btn-block mt" data-act="mark" data-a="out" type="button">Salida extra</button>` : ''}`}
      </div>
    </div>
    ${st.today?.length ? html`<div class="card"><strong>Marcas de hoy</strong>
      ${st.today.map((m) => html`<div class="row between" style="padding:4px 0"><span>${({ in: 'Entrada', out: 'Salida', xin: 'Extra in', xout: 'Extra out', extra: 'Extra' })[m.kind] || m.kind}</span><span class="muted">${fmtTime(m.ts)}${m.auto ? ' · auto' : ''}</span></div>`)}
    </div>` : ''}
  `);
}


const gpsErr = (code, message) => Object.assign(new Error(message), { code });
const getPos = () => new Promise((res, rej) => {
  if (!navigator.geolocation) return rej(gpsErr('GPS_UNSUPPORTED', 'Este navegador no permite usar la ubicación.'));
  navigator.geolocation.getCurrentPosition(
    (p) => res(p.coords),
    (e) => rej(gpsErr(e.code === 1 ? 'GPS_DENIED' : e.code === 3 ? 'GPS_TIMEOUT' : 'GPS_UNAVAILABLE', e.message)),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );
});
const MARK_MSG = {
  GPS_DENIED: ['No pudimos usar tu ubicación', 'El navegador tiene bloqueada la ubicación. Tocá el candado de la barra de direcciones → Ubicación → Permitir, y volvé a intentar.'],
  GPS_UNAVAILABLE: ['Tu ubicación no está disponible', 'Activá el GPS del celular y, si estás bajo techo, acercate a una ventana o a la entrada. Después probá de nuevo.'],
  GPS_TIMEOUT: ['El GPS tardó demasiado', 'Esperá unos segundos con el GPS activado y volvé a intentar.'],
  GPS_UNSUPPORTED: ['Este navegador no sirve para marcar', 'Abrí el link con Chrome o Safari actualizados.'],
  NO_LOCATION_CONFIG: ['El local todavía no tiene ubicación cargada', null],
  BAD_BRANCH: ['Sucursal no válida', null],
  GEO_REQUIRED: ['No recibimos tu ubicación', null],
  GEO_OUT: ['Estás fuera de la zona del local', null],
  QR_INVALID: ['El QR venció o no es válido', null],
  ALREADY_IN: ['Ya tenés una entrada abierta', null],
  NOT_IN: ['No tenés una entrada abierta', null],
  EXTRA_OFF: ['Horas extra no habilitadas', null],
  RATE_LIMIT: ['Demasiados intentos seguidos', 'Esperá un minuto y probá de nuevo.'],
  NETWORK: ['Sin conexión', 'Revisá tu internet y volvé a intentar. Marcar siempre necesita conexión.'],
};
const markError = (e) => {
  const [title, text] = MARK_MSG[e.code] || ['No pudimos registrar tu marcación', null];
  const extra = e.code === 'GEO_OUT' && e.data?.dist ? ` (a ${e.data.dist} m)` : '';
  return html`<div class="alert alert-err" role="alert"><strong>${title}${extra}</strong><br>${text || e.message}${e.code === 'QR_INVALID' ? html`<br><span class="muted">Podés escanear el código de nuevo o marcar desde acá, sin QR.</span>` : ''}</div>`;
};
acts.mark = async (el) => {
  const btns = [...document.querySelectorAll('#mark-btns button')];
  btns.forEach((b) => (b.disabled = true));
  const t = S.me.tenant;
  const allowGps = t.mark_gps !== false && t.mark_gps !== 0;
  patchEl('#mark-result', html`<p class="muted"><span class="spinner"></span> ${allowGps ? 'Verificando ubicación…' : 'Registrando…'}</p>`);
  try {
    let pos = null;
    if (allowGps) {
      try { pos = await getPos(); } catch (e) { pos = { error: e }; }
    }
    const body = { action: el.dataset.a };
    if (S.markCode) body.code = S.markCode;
    const sel = $('#m-branch');
    if (sel) { body.branch_id = Number(sel.value); E.branch = body.branch_id; }
    if (pos && !pos.error) Object.assign(body, { lat: pos.latitude, lng: pos.longitude, accuracy: pos.accuracy });
    try {
      const r = await post('/api/me/mark', body);
      toast({ in: '✅ Entrada registrada', out: '✅ Salida registrada', xin: '✅ Entrada extra registrada', xout: '✅ Salida extra registrada', extra: '✅ Extra registrada' }[r.kind] || '✅ Marcación registrada');
      return go('marcar');
    } catch (e) {
      if (e.code === 'GEO_REQUIRED' && pos?.error) throw pos.error;
      if (e.code === 'QR_INVALID') S.markCode = null;
      throw e;
    }
  } catch (e) {
    patchEl('#mark-result', markError(e));
    if (S.markCode) btns.forEach((b) => (b.disabled = false));
    else { E.flash = markError(e); go('marcar'); }
  }
};


async function horas() {
  E.period ||= todayAR().slice(0, 7);
  const d = await get('/api/me/hours?period=' + E.period);
  const tot = d.normal_h + d.extra_h;
  patchEl('#e-body', html`${back}<div class="card"><div class="row between mb"><strong>Mis horas</strong><select data-change="e-period" aria-label="Período" style="width:auto">${periodOptions(E.period)}</select></div>
    <div class="row between"><span>Normales</span><strong>${fmtH(d.normal_h)}</strong></div>
    <div class="row between" style="margin:4px 0 8px"><span style="color:#0891b2">Extras</span><strong style="color:#0891b2">${fmtH(d.extra_h)}</strong></div>
    <div class="hour-bar"><div class="n" style="width:${tot ? (d.normal_h / tot) * 100 : 100}%"></div><div class="x" style="width:${tot ? (d.extra_h / tot) * 100 : 0}%"></div></div>
    <p class="muted">Esperadas este mes: ${fmtH(d.expected_h)}</p></div>
    <div class="card"><strong>Detalle</strong>${d.days.length ? d.days.map((i) => html`<div class="hours-emp-row"><span>${new Date(i.start).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })} · ${fmtTime(i.start)} → ${i.open ? 'en curso' : fmtTime(i.end)}</span><span class="${i.extra ? 'h-extra' : ''}">${i.extra ? 'extra' : 'normal'}</span></div>`) : html`<p class="muted">Sin marcaciones en este período.</p>`}</div>`);
}
acts['e-period'] = (el) => { E.period = el.value; go('horas'); };

// ---------- Permisos ----------
async function permisos() {
  if (S.me.tenant.features && !S.me.tenant.features.permits) {
    patchEl('#e-body', html`${back}<div class="card"><strong>Permisos y licencias</strong>
      <p class="muted mt">Esta función está en el plan Pro o Completo de tu empleador.</p></div>`);
    return;
  }
  const [v, { permits }] = await Promise.all([get('/api/me/vacation'), get('/api/me/permits')]);
  const LBL = { dia: 'Día libre', vacaciones: 'Vacaciones', maternidad: 'Maternidad', paternidad: 'Paternidad', casamiento: 'Casamiento', fallecimiento: 'Fallecimiento', examen: 'Examen', otro: 'Otro' };
  patchEl('#e-body', html`${back}
  <div class="card"><strong>Tus vacaciones (LCT)</strong><p class="muted mb">Antigüedad: ${v.years} años${v.approx ? ' · cálculo proporcional' : ''}</p>
    <div class="row between"><span>Días correspondientes</span><strong>${v.entitled}</strong></div><div class="row between"><span>Usados este año</span><span>${v.used}</span></div>
    ${v.pending ? html`<div class="row between"><span>Pendientes de aprobación</span><span>${v.pending}</span></div>` : ''}<div class="row between"><span>Disponibles</span><strong style="color:var(--theme)">${v.available}</strong></div>
    <p class="muted mt">Referencia: hasta 5 años 14 días · 5 a 10: 21 · 10 a 20: 28 · más de 20: 35. Consultá tu convenio.</p></div>
  <div class="card"><strong>Solicitar permiso</strong>
    <form data-form="permit" class="mt"><div class="form-group"><label for="p-type">Tipo</label><select id="p-type" name="type" data-change="perm-type">${Object.entries(LBL).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></div>
    <div class="alert" id="p-info">${PERM_INFO.dia}</div>
    <div class="form-group"><label for="p-from">Desde</label><input id="p-from" name="from" type="date" required min="${todayAR()}" value="${todayAR()}"></div>
    <div class="form-group hidden" id="p-to-wrap"><label for="p-to">Hasta</label><input id="p-to" name="to" type="date" value="${todayAR()}"></div>
    <div class="form-group"><label for="p-note">Motivo (opcional)</label><textarea id="p-note" name="note" maxlength="300" rows="2"></textarea></div>
    <button class="btn btn-primary btn-block" type="submit">Enviar solicitud</button></form></div>
  <div class="card"><strong>Mis solicitudes</strong>${permits.length ? permits.map((p) => html`<div class="hours-emp-row"><div><div style="font-weight:600">${LBL[p.type]}</div><div class="muted">${fmtDay(p.from_date)}${p.to_date !== p.from_date ? ' al ' + fmtDay(p.to_date) : ''}</div></div>${badge(p.status === 'pending' ? 'pending' : p.status)}</div>`) : html`<p class="muted">Todavía no pediste ningún permiso.</p>`}</div>`);
}
acts['perm-type'] = (el) => { $('#p-info').textContent = PERM_INFO[el.value]; $('#p-to-wrap').classList.toggle('hidden', el.value === 'dia'); };
forms.permit = async (v) => { await post('/api/me/permits', { type: v.type, from: v.from, to: v.to || v.from, note: v.note }); toast('Solicitud enviada a tu empleador'); go('permisos'); };

// ---------- Certificados y recibos ----------
async function certs() {
  const { certs: list } = await get('/api/me/docs');
  patchEl('#e-body', html`${back}<div class="card"><strong>Mis certificados</strong><p class="muted mb">Tu empleador puede verlos en tu ficha.</p>
    ${list.length ? list.map((d) => html`<div class="cert-item"><span>📄</span><div class="grow"><div style="font-weight:600">${d.title}</div><div class="muted">${fmtDateTime(d.created_at)}</div></div><a class="btn btn-outline btn-sm" href="#" data-act="view-doc" data-id="${d.id}" data-name="${d.filename || d.title || 'documento'}">Ver</a></div>`) : html`<p class="muted">Sin certificados.</p>`}
    <form data-form="cert" class="mt"><div class="form-group"><label for="c-type">Tipo</label><select id="c-type" name="cert_type"><option value="medico">Médico</option><option value="estudio">Estudio / examen</option><option value="dni">DNI / documentación</option><option value="otro">Otro</option></select></div>
    <div class="form-group"><label for="c-file">Archivo (PDF, JPG o PNG · máx. 5 MB)</label><input id="c-file" name="file" type="file" accept=".pdf,image/jpeg,image/png" required></div>
    <button class="btn btn-primary btn-block" type="submit">Subir certificado</button></form></div>`);
}
forms.cert = async (v, f) => {
  const file = f.querySelector('input[type=file]').files[0];
  await post('/api/me/certs', { cert_type: v.cert_type, filename: file.name, data: await fileToBase64(file) });
  toast('Certificado subido · tu empleador ya puede verlo'); go('certs');
};
async function docs() {
  const { recibos } = await get('/api/me/docs');
  if (recibos === null) {
    patchEl('#e-body', html`${back}<div class="mod-lock-banner"><span>🔒</span><div><strong>Módulo Recibos no activado</strong>Tu empleador todavía no habilitó la firma digital de recibos.</div></div>`);
    return;
  }
  const tab = E.docsTab || 'pending';
  const pending = recibos.filter((d) => d.sign_status === 'pending');
  const signed = recibos.filter((d) => d.sign_status !== 'pending');
  const list = tab === 'pending' ? pending : signed;
  const item = (d) => {
    const status = d.sign_status === 'pending' ? 'Pendiente'
      : d.sign_status === 'conforme' ? 'Conforme' : 'Disconforme';
    const pill = d.sign_status === 'pending' ? 'pill-x'
      : d.sign_status === 'conforme' ? 'pill-g' : 'pill-e';
    return html`<div class="doc-item card">
      <div class="row between" style="align-items:flex-start">
        <div class="grow">
          <div class="menu-title">${d.title || 'Recibo'}</div>
          <div class="menu-sub">${d.period || ''}${d.signed_at ? ' · ' + fmtDateTime(d.signed_at) : ''}</div>
          <span class="pill ${pill}" style="margin-top:6px;display:inline-block">${status}</span>
        </div>
        <a class="btn btn-outline btn-sm" href="#" data-act="view-doc" data-id="${d.id}" data-name="${d.filename || d.title || 'documento'}">Ver PDF</a>
      </div>
      ${S.me.tenant.has_sign ? html`<div class="sign-block mt"><img class="sign-preview" src="/api/docs/${d.id}/sign" alt="Firma del empleador"><div class="muted" style="font-size:.78rem">Firma del empleador</div></div>` : ''}
      ${d.sign_status === 'pending' ? html`<div class="row mt"><button class="btn btn-primary btn-sm" data-act="sign" data-id="${d.id}" data-r="conforme" type="button">Firmar conforme</button>
        <button class="btn btn-outline btn-sm" data-act="sign-no" data-id="${d.id}" type="button">Disconforme</button></div>` : ''}
      ${d.sign_status !== 'pending' ? html`<div class="sign-block mt">
        <div class="sign-line">${d.signed_name || S.me.user.name}</div>
        <div class="muted" style="font-size:.78rem">${fmtDateTime(d.signed_at)} · FIRMADO ${d.sign_status === 'conforme' ? 'CONFORME' : 'DISCONFORME'}</div>
        ${d.sign_note ? html`<div class="muted" style="font-size:.78rem;margin-top:4px">Nota: ${d.sign_note}</div>` : ''}
      </div>` : ''}
    </div>`;
  };
  patchEl('#e-body', html`${back}
    <div class="card"><strong>📄 Mis documentos</strong>
      <div class="docs-tabs mt">
        <button type="button" class="${tab === 'pending' ? 'on' : ''}" data-act="docs-tab" data-t="pending">Pendientes (${pending.length})</button>
        <button type="button" class="${tab === 'signed' ? 'on' : ''}" data-act="docs-tab" data-t="signed">Firmados (${signed.length})</button>
      </div>
    </div>
    ${list.length ? list.map(item) : html`<div class="card"><p class="muted">${tab === 'pending' ? 'No hay recibos pendientes de firma.' : 'Todavía no firmaste ningún recibo.'}</p></div>`}`);
}
acts.sign = async (el) => { if (!confirm('Al firmar confirmás que revisaste el recibo. ¿Continuar?')) return; await post(`/api/me/docs/${el.dataset.id}/sign`, { result: el.dataset.r }); toast('Recibo firmado'); go('docs'); };
acts['sign-no'] = (el) => openModal(html`<h3 style="margin-bottom:8px">Firmar disconforme</h3><form data-form="sign-no" data-id="${el.dataset.id}"><div class="form-group"><label for="sn">Contanos el motivo</label><textarea id="sn" name="note" required minlength="3" maxlength="300" rows="3"></textarea></div><button class="btn btn-primary btn-block" type="submit">Enviar</button><button class="btn btn-outline btn-block mt" type="button" data-act="close-modal">Cancelar</button></form>`);
forms['sign-no'] = async (v, f) => { await post(`/api/me/docs/${f.dataset.id}/sign`, { result: 'desconforme', note: v.note }); closeModal(); toast('Registramos tu disconformidad'); go('docs'); };

async function cumples() {
  const { birthdays } = await get('/api/team/birthdays');
  patchEl('#e-body', html`${back}${birthdays.length ? birthdays.map((b) => html`<div class="card"><div class="row"><div class="emp-av">${b.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</div><div class="grow"><div style="font-weight:600;font-size:.88rem">${b.name}</div><div class="muted">${b.day}/${b.month}</div></div><span style="font-size:.75rem;color:var(--theme);font-weight:600">${b.in_days === 0 ? '¡Hoy! 🎉' : b.in_days === 1 ? 'Mañana' : 'En ' + b.in_days + ' días'}</span></div></div>`) : html`<div class="card"><p class="muted">Todavía no hay cumpleaños cargados.</p></div>`}`);
}

async function perfil() {
  const me = await get('/api/auth/me');
  S.me = me;
  const u = { ...(me.user || {}) };
  // Seguridad UI: nunca mostrar ciphertext en los inputs
  for (const k of ['phone','address','dni','personal_email','emg_name','emg_phone','notes']) {
    if (typeof u[k] === 'string' && u[k].startsWith('enc:')) u[k] = '';
  }
  patchEl('#e-body', html`${back}
  <form data-form="profile">
  <div class="card"><strong>Datos personales</strong>
    <div class="form-group"><label for="pf-t">Teléfono</label><input id="pf-t" name="phone" value="${u.phone || ''}" autocomplete="tel"></div>
    <div class="form-group"><label for="pf-d">Domicilio</label><input id="pf-d" name="address" value="${u.address || ''}" autocomplete="street-address" placeholder="Calle, número y localidad"></div>
    <div class="form-group"><label for="pf-b">Cumpleaños</label><input id="pf-b" name="birthday" type="date" value="${u.birthday || ''}"></div>
    <div class="form-group"><label for="pf-dni">DNI / Documento</label><input id="pf-dni" name="dni" value="${u.dni || ''}" maxlength="20" inputmode="numeric"></div>
    <div class="form-group"><label for="pf-pe">Email personal</label><input id="pf-pe" name="personal_email" type="email" value="${u.personal_email || ''}" autocomplete="email"></div>
  </div>
  <div class="card"><strong>Datos laborales</strong>
    <div class="form-group"><label>Cargo</label><input value="${u.cargo || 'Sin cargo'}" disabled></div>
    <div class="form-group"><label>Fecha de ingreso</label><input type="date" value="${u.hire_date || ''}" disabled></div>
  </div>
  <div class="card"><strong>Contacto de emergencia</strong>
    <div class="form-group"><label for="pf-en">Nombre</label><input id="pf-en" name="emg_name" value="${u.emg_name || ''}"></div>
    <div class="form-group"><label for="pf-er">Vínculo</label><select id="pf-er" name="emg_rel">${['', 'Madre/Padre', 'Cónyuge / pareja', 'Hermano/a', 'Hijo/a', 'Otro'].map((o) => html`<option value="${o}" ${o === (u.emg_rel || '') ? raw('selected') : ''}>${o || '—'}</option>`)}</select></div>
    <div class="form-group"><label for="pf-et">Teléfono de emergencia</label><input id="pf-et" name="emg_phone" value="${u.emg_phone || ''}"></div>
  </div>
  <div class="card"><strong>Información adicional</strong>
    <div class="form-group"><label for="pf-blood">Grupo sanguíneo</label><select id="pf-blood" name="blood_type">${['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((o) => html`<option value="${o}" ${o === (u.blood_type || '') ? raw('selected') : ''}>${o || '—'}</option>`)}</select></div>
    <div class="form-group"><label for="pf-obra">Obra social / cobertura</label><input id="pf-obra" name="obra_social" value="${u.obra_social || ''}" maxlength="80"></div>
    <div class="form-group"><label for="pf-notes">Notas / alergias</label><textarea id="pf-notes" name="notes" rows="2" maxlength="400">${u.notes || ''}</textarea></div>
  </div>
  <button class="btn btn-primary btn-block" type="submit">Guardar datos</button>
  </form>
  <div class="card mt"><button class="btn btn-outline btn-block" data-act="change-pw" type="button">Cambiar contraseña</button></div>`);
}
async function inbox() {
  const { items } = await get('/api/me/inbox');
  patchEl('#e-body', html`${back}
    <div class="card"><strong>Avisos y pendientes</strong>
      <p class="muted mb">Recibos, permisos, certificados y recordatorios de fichaje.</p>
      ${items.length ? items.map((n) => html`<div class="inbox-item ${n.priority === 'high' ? 'high' : ''}" data-act="e-go" data-s="${n.href || 'home'}" role="button">
        <div class="inbox-title">${n.title}</div>
        <div class="muted" style="font-size:.8rem">${n.detail || ''}</div>
      </div>`) : html`<p class="muted">No tenés pendientes por ahora.</p>`}
    </div>`);
}
async function calendario() {
  const c = await get('/api/me/calendar');
  patchEl('#e-body', html`${back}
    <div class="card"><strong>Tu turno</strong>
      <p class="muted">${c.shift_start && c.shift_end ? (c.shift_start + ' — ' + c.shift_end) : (c.shift_start ? ('Entrada habitual: ' + c.shift_start) : 'Sin horario fijo cargado')}</p>
    </div>
    <div class="card"><strong>Próximos feriados</strong>
      ${c.holidays?.length ? c.holidays.map((h) => html`<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)"><span>${h.date.slice(8)}/${h.date.slice(5,7)} · ${h.name}</span><span class="muted">${holKind(h.kind)}</span></div>`) : html`<p class="muted">Sin feriados próximos.</p>`}
    </div>
    <div class="card"><strong>Vacaciones / licencias aprobadas</strong>
      ${c.vacations?.length ? c.vacations.map((v) => html`<div class="row between" style="padding:6px 0"><span>${v.type}: ${v.from_date} → ${v.to_date}</span><span class="badge ok">Aprobada</span></div>`) : html`<p class="muted">No hay períodos aprobados a futuro.</p>`}
    </div>
    <button class="btn btn-outline btn-block" data-act="e-go" data-s="permisos" type="button">Solicitar permiso o cambio</button>`);
}
async function sueldo() {
  const s = await get('/api/me/payroll-summary');
  patchEl('#e-body', html`${back}
    <div class="card"><strong>Resumen · ${s.period}</strong>
      <div class="stat-v" style="font-size:1.4rem;margin:8px 0">${s.marks_this_month} marcas</div>
      <p class="muted">Marcaciones registradas este mes (entrada/salida/extra).</p>
    </div>
    <div class="card"><strong>Recibos</strong>
      ${s.recibos?.length ? s.recibos.map((r) => html`<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--border)">
        <div><div style="font-weight:600">${r.period || r.title || 'Recibo'}</div>
          <div class="muted" style="font-size:.78rem">${r.sign_status === 'conforme' ? 'Firmado conforme' : r.sign_status === 'desconforme' ? 'Desconforme' : 'Pendiente de firma'}</div></div>
        <button class="btn btn-outline btn-sm" data-act="e-go" data-s="docs" type="button">Ver</button>
      </div>`) : html`<p class="muted">Todavía no hay recibos cargados por tu empleador.</p>`}
    </div>
    <button class="btn btn-primary btn-block" data-act="e-go" data-s="horas" type="button">Ver detalle de horas</button>`);
}
async function documentos() {
  const [{ user }, docs] = await Promise.all([get('/api/auth/me').then(() => S.me), get('/api/me/docs')]);
  const u = user || S.me.user;
  patchEl('#e-body', html`${back}
    <div class="card"><strong>Datos registrados</strong>
      <div class="muted" style="font-size:.85rem;line-height:1.6">
        <div><strong>DNI:</strong> ${u.dni || '—'}</div>
        <div><strong>Email personal:</strong> ${u.personal_email || '—'}</div>
        <div><strong>Teléfono:</strong> ${u.phone || '—'}</div>
        <div><strong>Domicilio:</strong> ${u.address || '—'}</div>
        <div><strong>Ingreso:</strong> ${u.hire_date || '—'}</div>
        <div><strong>Cargo:</strong> ${u.cargo || '—'}</div>
      </div>
      <button class="btn btn-outline btn-sm mt" data-act="e-go" data-s="perfil" type="button">Completar / editar perfil</button>
    </div>
    <div class="card"><strong>Certificados presentados</strong>
      ${docs.certs?.length ? docs.certs.map((c) => html`<div class="row between" style="padding:6px 0"><span>${c.title || c.cert_type}</span><span class="muted">${fmtDateTime(c.created_at)}</span></div>`) : html`<p class="muted">Ningún certificado cargado.</p>`}
      <button class="btn btn-outline btn-sm mt" data-act="e-go" data-s="certs" type="button">Subir certificado</button>
    </div>
    <div class="card"><strong>Recibos</strong>
      ${docs.recibos?.length ? html`<p class="muted">${docs.recibos.length} recibo(s) en el historial.</p>` : html`<p class="muted">Sin recibos o el módulo no está activo.</p>`}
      <button class="btn btn-outline btn-sm" data-act="e-go" data-s="docs" type="button">Ir a recibos</button>
    </div>`);
}
async function solicitudes() {
  const { requests } = await get('/api/me/requests');
  patchEl('#e-body', html`${back}
    <div class="card"><strong>Nueva solicitud</strong>
      <form data-form="emp-request">
        <div class="form-group"><label for="rq-k">Tipo</label>
          <select id="rq-k" name="kind">
            <option value="rh">Consulta a RR.HH.</option>
            <option value="horas">Reclamo de horas</option>
            <option value="fichaje">Corrección de fichaje</option>
            <option value="turno">Cambio de turno</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div class="form-group"><label for="rq-s">Asunto</label><input id="rq-s" name="subject" required maxlength="120"></div>
        <div class="form-group"><label for="rq-b">Detalle</label><textarea id="rq-b" name="body" rows="3" required maxlength="2000"></textarea></div>
        <button class="btn btn-primary btn-block" type="submit">Enviar solicitud</button>
      </form>
    </div>
    <div class="card"><strong>Historial</strong>
      ${requests.length ? requests.map((r) => html`<div class="req-item">
        <div class="row between"><strong>${r.subject}</strong><span class="badge ${r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'err' : ''}">${({ pending: 'Pendiente', review: 'En revisión', answered: 'Respondida', approved: 'Aprobada', rejected: 'Rechazada' })[r.status] || r.status}</span></div>
        <div class="muted" style="font-size:.8rem;margin-top:4px">${r.body}</div>
        ${r.reply ? html`<div class="alert mt" style="font-size:.85rem"><strong>Respuesta:</strong> ${r.reply}</div>` : ''}
      </div>`) : html`<p class="muted">Todavía no enviaste solicitudes.</p>`}
    </div>`);
}
forms['emp-request'] = async (v) => {
  await post('/api/me/requests', v);
  toast('Solicitud enviada');
  go('solicitudes');
};

forms.profile = async (v) => {
  try {
    await patch('/api/me/profile', {
      phone: v.phone || '', address: v.address || '', birthday: v.birthday || '',
      dni: v.dni || '', personal_email: v.personal_email || '',
      emg_name: v.emg_name || '', emg_rel: v.emg_rel || '', emg_phone: v.emg_phone || '',
      blood_type: v.blood_type || '', obra_social: v.obra_social || '', notes: v.notes || '',
    });
    try {
      const { refreshMe } = await import('./app.js');
      if (refreshMe) await refreshMe();
      else S.me = await get('/api/auth/me');
    } catch (_) { S.me = await get('/api/auth/me'); }
    toast('Datos guardados');
    go('perfil');
  } catch (e) { toast(e.message || 'No se pudieron guardar los datos'); throw e; }
};

acts['docs-tab'] = (el) => { E.docsTab = el.dataset.t; go('docs'); };


acts['view-doc'] = async (el) => {
  const id = el.dataset.id;
  openModal(html`<h3 style="margin-bottom:8px">Documento</h3>
    <p class="muted mb">${el.dataset.name || ''}</p>
    <div style="text-align:center;padding:12px 0"><span class="spinner"></span><p class="muted">Cargando…</p></div>
    <button class="btn btn-outline btn-block mt" data-act="close-modal" type="button">Cerrar</button>`);
  try {
    const r = await fetch('/api/docs/' + id + '/file', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('No se pudo abrir el archivo');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const isImg = (blob.type || '').startsWith('image/');
    const isPdf = (blob.type || '') === 'application/pdf' || (el.dataset.name || '').toLowerCase().endsWith('.pdf');
    openModal(html`<h3 style="margin-bottom:8px">Documento</h3>
      <p class="muted mb">${el.dataset.name || ''}</p>
      ${isImg ? html`<img src="${url}" alt="" style="max-width:100%;border-radius:8px">`
        : isPdf ? html`<iframe src="${url}" title="PDF" style="width:100%;height:70vh;border:0;border-radius:8px;background:#fff"></iframe>`
        : html`<p class="muted">Vista previa no disponible para este tipo de archivo.</p>`}
      <div class="row mt" style="gap:8px;flex-wrap:wrap">
        <a class="btn btn-primary btn-sm" href="${url}" download="${el.dataset.name || 'documento'}">Descargar</a>
        <button class="btn btn-outline btn-sm" data-act="close-modal" type="button">Cerrar</button>
      </div>`);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) {
    openModal(html`<h3>No se pudo abrir</h3><p class="muted mt">${e.message || e}</p>
      <button class="btn btn-outline btn-block mt" data-act="close-modal" type="button">Cerrar</button>`);
  }
};
