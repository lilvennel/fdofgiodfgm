import { S, acts, forms, html, raw, $, get, post, patch, api, render, patchEl, toast, openModal, closeModal, money, fmtDateTime, fmtDay, badge, copyText, todayAR, fileToBase64, esc } from './util.js';

const A = { tab: 'cuentas', filter: 'all' };

const ACTION_LABELS = {
  'tenant.created': 'Negocio creado',
  'superadmin.created': 'Super admin creado',

  'employee.disabled': 'Empleado desactivado',
  'employee.approved': 'Empleado autorizado',
  'employee.rejected': 'Empleado rechazado',
  'employee.pw_reset': 'Contraseña de empleado reseteada',
  'employee.created': 'Empleado creado',
  'employee.updated': 'Empleado actualizado',
  'password.changed': 'Contraseña cambiada',
  'mark.manual': 'Marca manual',
  'mark.manual_deleted': 'Marca manual eliminada',
  'permit.approved': 'Permiso aprobado',
  'permit.rejected': 'Permiso rechazado',
  'payment.applied': 'Pago aplicado',
  'plan.cancelled': 'Suscripción cancelada',
  'admin.tenant_status': 'Estado de negocio cambiado',
  'admin.discount': 'Descuento aplicado',
  'admin.owner_pw_reset': 'Contraseña del dueño reseteada',
  'admin.site_updated': 'Sitio web actualizado',
  'admin.hero_slide_added': 'Slide de hero agregado',
  'admin.prices': 'Precios actualizados',
  'admin.price_schedule': 'Programación de precios',
  'admin.price_schedule_cancel': 'Programación de precios cancelada',
  'admin.holiday_saved': 'Feriado guardado',
  'admin.holidays_generated': 'Feriados generados',
  'admin.holidays_synced': 'Feriados sincronizados',
  'admin.backup': 'Backup descargado',
  'admin.backup_run': 'Backup ejecutado',
};
const ACTION_CAT = (a) => {
  if (a.startsWith('employee') || a === 'password.changed') return 'emp';
  if (a.startsWith('payment') || a.startsWith('plan')) return 'pay';
  if (a.startsWith('mark')) return 'mark';
  if (a.startsWith('permit')) return 'perm';
  if (a.startsWith('admin')) return 'sys';
  return 'sys';
};
const CAT_LABEL = { emp: 'Empleados', pay: 'Pagos', mark: 'Marcaciones', perm: 'Permisos', sys: 'Sistema' };
const humanDetail = (action, detail) => {
  if (!detail) return '';
  let d; try { d = typeof detail === 'string' ? JSON.parse(detail) : detail; } catch { return String(detail); }
  if (!d || typeof d !== 'object') return String(detail);
  if (action === 'payment.applied') {
    const kind = { plan: 'Plan', extra: 'Empleados extra', mod_suc: 'Multi-sucursal', mod_rec: 'Recibos' }[d.kind] || d.kind;
    return `${kind}${d.qty ? ' ×' + d.qty : ''}${d.amount != null ? ' · $ ' + Number(d.amount).toLocaleString('es-AR') : ''}`;
  }
  if (action.startsWith('mark')) {
    const k = { in: 'Entrada', out: 'Salida', xin: 'Entrada extra', xout: 'Salida extra' }[d.kind] || d.kind || '';
    return [k, d.user ? 'usuario #' + d.user : '', d.forced ? 'forzada' : ''].filter(Boolean).join(' · ');
  }
  if (d.id != null && Object.keys(d).length === 1) return 'ID #' + d.id;
  if (d.status) return 'Estado: ' + d.status;
  if (d.pct != null) return d.pct + '%' + (d.months ? ' · ' + d.months + ' mes(es)' : '');
  return Object.entries(d).map(([k, v]) => k + ': ' + v).join(' · ');
};

const TABS = [['cuentas', 'Cuentas'], ['sitio', 'Inicio web'], ['precios', 'Precios'], ['cupones', 'Cupones'], ['pagos', 'Pagos'], ['valoraciones', 'Valoraciones'], ['feriados', 'Feriados'], ['novedades', 'Novedades'], ['feedback', 'Feedback'], ['sistema', 'Sistema']];
const loading = html`<p class="muted" style="padding:24px;text-align:center"><span class="spinner"></span></p>`;

export async function renderAdmin() {
  const s = await get('/api/admin/stats');
  const crit = s.warnings.filter((w) => w.level === 'critical'), soft = s.warnings.filter((w) => w.level !== 'critical');
  render(html`<header class="topbar topbar-pro"><div class="brand"><div class="brand-mark brand-mark-logo"></div><span>Super Admin</span></div><button class="btn btn-sm btn-outline" data-act="dark" type="button" aria-label="Cambiar tema">🌓</button><button class="btn btn-sm btn-outline" data-act="logout" type="button">Cerrar sesión</button></header>
  <main class="dash-body wide">
  ${crit.map((w) => html`<div class="banner-crit" role="alert"><strong>⚠ Atención: configuración peligrosa</strong>${w.text}</div>`)}
  ${s.backup_stale ? html`<div class="alert alert-warn">💾 ${s.backup_age_days === null ? 'Todavía no hay ningún backup.' : `Hace ${s.backup_age_days} días que no hay un backup.`} <button class="link" type="button" data-act="a-tab" data-tab="sistema">Ir a Sistema</button></div>` : ''}
  ${soft.length ? html`<div class="alert alert-warn"><strong>Avisos de configuración</strong><ul style="margin:4px 0 0 18px">${soft.map((w) => html`<li>${w.text}</li>`)}</ul></div>` : ''}
  <div class="stats-row">
    <div class="stat"><div class="stat-l">Negocios activos</div><div class="stat-v" style="color:var(--theme)">${s.tenants_active}<span class="muted"> / ${s.tenants_total}</span></div></div>
    <div class="stat"><div class="stat-l">MRR estimado</div><div class="stat-v">${money(s.mrr)}</div></div>
    <div class="stat"><div class="stat-l">Cobrado este mes</div><div class="stat-v">${money(s.collected_month)}</div></div>
    <div class="stat"><div class="stat-l">Pagos vencidos</div><div class="stat-v">${s.past_due}</div></div>
    <div class="stat"><div class="stat-l">Empleados</div><div class="stat-v">${s.employees}</div></div>
    <div class="stat"><div class="stat-l">Módulos vendidos</div><div class="stat-v">${s.modules}</div></div></div>
  <div class="sa-tabs">${TABS.map(([k, l]) => html`<button class="sa-tab ${A.tab === k ? 'active' : ''}" data-act="a-tab" data-tab="${k}" type="button">${l}${k === 'feedback' && s.feedback_new ? html` <span class="pending-badge">${s.feedback_new}</span>` : ''}</button>`)}</div>
  <div id="a-body">${loading}</div></main>`);
  load();
}
acts['a-tab'] = (el) => { A.tab = el.dataset.tab; renderAdmin(); };
async function load() { try { await ({ cuentas, sitio, precios, cupones, pagos: paymentsCfg, valoraciones: reviewsAdmin, feriados, novedades, feedback, sistema })[A.tab](); } catch (e) { const { fail } = await import('./app.js'); fail(e); } }

async function cuentas() {
  const { tenants } = await get('/api/admin/tenants' + (A.filter === 'all' ? '' : '?status=' + A.filter));
  patchEl('#a-body', html`<div class="sa-filter">${[['all', 'Todas'], ['active', 'Activas'], ['past_due', 'Pago vencido'], ['pending_payment', 'Sin pagar'], ['suspended', 'Suspendidas']].map(([k, l]) => html`<button class="${A.filter === k ? 'active' : ''}" data-act="a-filter" data-f="${k}" type="button">${l}</button>`)}</div>
  ${tenants.length ? tenants.map((t) => html`<div class="account-card"><div class="row" style="gap:10px;align-items:flex-start"><div class="brand-mark brand-mark-logo" style="flex-shrink:0" title="AsistOK"></div><div class="grow"><div style="font-weight:700">${t.name}</div>
    <div class="account-meta">/${t.slug} · ${t.owner_email} · ${t.plan === 'once' ? 'Pago único' : 'Suscripción'} · ${t.employees} emp.${t.mod_suc ? ' · Multi-sucursal' : ''}${t.mod_rec ? ' · Recibos' : ''}</div>
    <div class="account-meta">Alta ${fmtDateTime(t.created_at)}${t.paid_until ? ' · hasta ' + new Date(t.paid_until).toLocaleDateString('es-AR') : ''}${t.trial ? ' · 🎁 prueba' : ''}${t.discount_pct ? ` · ${t.discount_pct}% OFF (${t.discount_months} m)` : ''}</div>
    <div style="margin-top:6px">${badge(t.status)}${t.trial ? html` <span class="pill" style="font-size:.7rem;background:#ffedd5;color:#9a3412">Prueba 30 días</span>` : ''}</div></div></div>
    <div class="account-actions">${t.status === 'suspended' || t.status === 'pending_payment' || t.status === 'past_due' ? html`<button class="btn btn-primary btn-sm" data-act="a-status" data-id="${t.id}" data-s="active" type="button">Activar</button>` : html`<button class="btn btn-outline btn-sm" data-act="a-status" data-id="${t.id}" data-s="suspended" type="button">Suspender</button>`}
    <button class="btn btn-outline btn-sm" data-act="a-disc" data-id="${t.id}" data-name="${t.name}" type="button">Descuento</button>
    <button class="btn btn-outline btn-sm" data-act="a-pw" data-id="${t.id}" type="button">Reset clave</button>
    <a class="btn btn-outline btn-sm" href="/api/admin/tenants/${t.id}/export" title="Paquete JSON para AAIP / orden judicial">📥 Exportar datos</a></div></div>`) : html`<p class="muted">No hay cuentas en esta vista.</p>`}`);
}
acts['a-filter'] = (el) => { A.filter = el.dataset.f; load(); };
acts['a-status'] = async (el) => { if (el.dataset.s === 'suspended' && !confirm('¿Suspender este negocio? Nadie podrá ingresar.')) return; await post(`/api/admin/tenants/${el.dataset.id}/status`, { status: el.dataset.s }); toast('Estado actualizado'); renderAdmin(); };
acts['a-disc'] = (el) => openModal(html`<h3 style="margin-bottom:8px">Descuento · ${el.dataset.name}</h3><form data-form="a-disc" data-id="${el.dataset.id}"><div class="grid2"><div class="form-group"><label for="dp">% descuento</label><input id="dp" name="pct" type="number" min="0" max="100" value="10" required></div><div class="form-group"><label for="dm">Meses</label><input id="dm" name="months" type="number" min="0" max="36" value="3" required></div></div><button class="btn btn-primary btn-block" type="submit">Asignar</button><button class="btn btn-outline btn-block mt" type="button" data-act="close-modal">Cancelar</button></form>`);
forms['a-disc'] = async (v, f) => { await post(`/api/admin/tenants/${f.dataset.id}/discount`, { pct: +v.pct, months: +v.months }); closeModal(); toast('Descuento asignado'); load(); };
acts['a-pw'] = async (el) => { if (!confirm('Se genera una contraseña temporal para el dueño. ¿Continuar?')) return; const r = await post(`/api/admin/tenants/${el.dataset.id}/reset-owner-password`); openModal(html`<h3>Contraseña temporal</h3><p class="muted mt">Para ${r.email}. Se muestra una sola vez:</p><div class="pw-box">${r.temp_password}</div><button class="btn btn-primary btn-block" data-act="close-modal" type="button">Listo</button>`); };

const slidesHtml = (slides) => html`<div class="row">${slides.map((sl) => html`<div class="slide-thumb" style="background-image:url('/api/public/hero/${sl.id}')"><button type="button" data-act="slide-del" data-id="${sl.id}" aria-label="Eliminar imagen">×</button></div>`)}
  ${slides.length < 6 ? html`<label class="btn btn-outline btn-sm" style="cursor:pointer">＋ Subir imagen<input type="file" accept="image/jpeg,image/png,image/webp" data-change="slide-upload" class="sr-only"></label>` : ''}</div>
  <p class="muted mt">${slides.length} de 6 imágenes (recomendado: 3 a 6). Se achican solas a 1600 px. Si no subís ninguna se usa el degradado de fondo.</p>`;
async function sitio() {
  const { hero: h, contact: c, legal: l } = await get('/api/admin/site');
  const f = (id, label, val, extra = '') => html`<div class="form-group"><label for="${id}">${label}</label><input id="${id}" name="${id}" value="${val}" ${raw(extra)}></div>`;
  patchEl('#a-body', html`<form data-form="site">
  <div class="card"><strong>Textos del inicio</strong>${f('h1', 'Título principal', h.h1, 'maxlength="90"')}${f('sub', 'Subtítulo', h.sub, 'maxlength="160"')}${f('box_title', 'Título de la tarjeta', h.box_title)}${f('box_sub', 'Subtítulo de la tarjeta', h.box_sub)}
    <div class="grid2"><div class="form-group"><label for="overlay_color">Color del fondo</label><input id="overlay_color" name="overlay_color" type="color" value="${h.overlay_color}" style="height:40px;padding:4px"></div><div class="form-group"><label for="overlay_op">Opacidad (20–80)</label><input id="overlay_op" name="overlay_op" type="range" min="20" max="80" value="${h.overlay_op}"></div></div></div>
  <div class="card"><strong>🖼 Carrusel de fondo</strong><p class="muted mb">Las imágenes rotan cada 6 segundos detrás del color. Se suben al instante (no hace falta guardar).</p><div id="slides-box">${slidesHtml(h.slides || [])}</div></div>
  <div class="card"><strong>Contacto (solo en el inicio)</strong>${f('email', 'Email de contacto', c.email, 'type="email"')}${f('wa_link', 'Link de WhatsApp (https://wa.me/549...)', c.wa_link, 'placeholder="https://wa.me/5491112345678"')}${f('wa_label', 'Texto del botón', c.wa_label)}${f('copy', 'Copyright', c.copy)}${f('tagline', 'Línea inferior', c.tagline)}</div>
  <div class="card"><strong>Textos legales</strong><p class="muted mb">Se muestran en /privacidad y /terminos. Podés escribir texto simple (los párrafos se separan con una línea en blanco) o pegar HTML básico: títulos h2/h3, p, ul/li, strong, em, a. Lo demás se elimina por seguridad. Pedile a un abogado que los revise (Ley 25.326).</p>
    ${[['privacy', 'Política de privacidad'], ['terms', 'Términos y condiciones']].map(([k, label]) => html`<div class="form-group"><div class="row between"><label for="${k}">${label}</label><button class="link" type="button" data-act="legal-reset" data-k="${k}">Restaurar plantilla</button></div>
      <textarea id="${k}" name="${k}" rows="9" data-input="legal-preview" data-k="${k}" style="font-family:ui-monospace,monospace;font-size:.78rem">${l[k]}</textarea>
      <div class="muted" style="margin:6px 0 4px">Vista previa</div><div class="legal card" id="prev-${k}" style="background:var(--bg)"></div></div>`)}</div>
  <button class="btn btn-primary btn-block" type="submit">Guardar</button></form>`);
  renderPreview('privacy'); renderPreview('terms');
}
async function toJpegB64(file) {
  try {
    const bmp = await createImageBitmap(file), sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await fileToBase64(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82)));
  } catch { return fileToBase64(file); }
}
const refreshSlides = async () => patchEl('#slides-box', slidesHtml((await get('/api/admin/site')).hero.slides || []));
acts['slide-upload'] = async (el) => { const f = el.files[0]; if (!f) return; toast('Subiendo imagen…'); await post('/api/admin/hero/slides', { filename: f.name, data: await toJpegB64(f) }); S.cfg = await get('/api/public/config'); toast('Imagen agregada'); refreshSlides(); };
acts['slide-del'] = async (el) => { if (!confirm('¿Eliminar esta imagen del carrusel?')) return; await api('DELETE', '/api/admin/hero/slides/' + el.dataset.id); S.cfg = await get('/api/public/config'); refreshSlides(); };
let prevTimer;
const renderPreview = async (k) => { const el = $('#' + k); if (!el) return; const r = await post('/api/admin/legal/preview', { text: el.value }); patchEl('#prev-' + k, raw(r.html)); };
acts['legal-preview'] = (el) => { clearTimeout(prevTimer); prevTimer = setTimeout(() => renderPreview(el.dataset.k).catch(() => {}), 350); };
acts['legal-reset'] = async (el) => { if (!confirm('Se reemplaza el texto del editor por la plantilla de ejemplo (todavía no se guarda). ¿Continuar?')) return; const d = await get('/api/admin/legal/defaults'); $('#' + el.dataset.k).value = d[el.dataset.k]; renderPreview(el.dataset.k); };
forms.site = async (v) => { await api('PUT', '/api/admin/site', { hero: { h1: v.h1, sub: v.sub, box_title: v.box_title, box_sub: v.box_sub, overlay_color: v.overlay_color, overlay_op: +v.overlay_op }, contact: { email: v.email, wa_link: v.wa_link, wa_label: v.wa_label, copy: v.copy, tagline: v.tagline }, legal: { privacy: v.privacy, terms: v.terms } }); S.cfg = await get('/api/public/config'); toast('Inicio actualizado'); };

async function precios() {
  const d = await get('/api/admin/prices'), p = d.prices, s = d.schedule;
  const n = (id, label, val) => html`<div class="form-group"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="number" min="0" step="100" value="${val}" required></div>`;
  patchEl('#a-body', html`
  <form data-form="prices" class="card">
    <strong>💰 Precios de planes (ARS)</strong>
    <p class="muted mb">Lo que ve el cliente en la landing y lo que se cobra. Guardá cuando termines.</p>
    <div class="price-admin-grid">
      <div class="price-admin-col">
        <div class="price-admin-h">Esencial</div>
        ${n('esencial_m', 'Mensual', p.esencial_m ?? p.sub)}
        ${n('esencial_y', 'Pago único', p.esencial_y ?? p.once)}
      </div>
      <div class="price-admin-col featured">
        <div class="price-admin-h">Pro <span class="pill" style="background:#4f46e5;color:#fff;font-size:.65rem">Popular</span></div>
        ${n('pro_m', 'Mensual', p.pro_m ?? 55000)}
        ${n('pro_y', 'Pago único', p.pro_y ?? 450000)}
      </div>
      <div class="price-admin-col">
        <div class="price-admin-h">Completo</div>
        ${n('completo_m', 'Mensual', p.completo_m ?? 70000)}
        ${n('completo_y', 'Pago único', p.completo_y ?? 560000)}
      </div>
    </div>
    <div style="font-weight:700;margin:16px 0 8px">Módulos y extras (pago único)</div>
    <div class="grid2">
      ${n('mod_suc', 'Multi-sucursal', p.mod_suc)}
      ${n('mod_rec', 'Recibos de sueldo', p.mod_rec)}
      ${n('extra', 'Empleado extra (c/u)', p.extra)}
      <div class="form-group"><label for="free_employees">Empleados incluidos en el plan</label>
        <input id="free_employees" name="free_employees" type="number" min="1" max="10000" step="1" value="${d.free_employees}" required>
        <p class="muted" style="font-size:.75rem;margin-top:4px">Cantidad gratis por plan (ej. 40). Después se cobra el extra por empleado.</p>
      </div>
    </div>
    <button class="btn btn-primary btn-block mt" type="submit">Guardar precios</button>
  </form>
  <form data-form="schedule" class="card">
    <strong>📈 Aumento programado</strong>
    <p class="muted mb">Aplica a <strong>todos</strong> los planes (Esencial, Pro, Completo) en la fecha elegida.</p>
    ${s ? html`<div class="alert alert-warn">Programado para el ${fmtDay(s.date)}.
      <button class="link" type="button" data-act="sch-cancel">Cancelar</button></div>` : html`<p class="muted">No hay aumento programado.</p>`}
    <div class="price-admin-grid">
      <div class="price-admin-col">
        <div class="price-admin-h">Esencial (nuevo)</div>
        ${n('esencial_m', 'Mensual', s?.esencial_m ?? s?.sub ?? p.esencial_m ?? p.sub)}
        ${n('esencial_y', 'Pago único', s?.esencial_y ?? s?.once ?? p.esencial_y ?? p.once)}
      </div>
      <div class="price-admin-col">
        <div class="price-admin-h">Pro (nuevo)</div>
        ${n('pro_m', 'Mensual', s?.pro_m ?? p.pro_m ?? 55000)}
        ${n('pro_y', 'Pago único', s?.pro_y ?? p.pro_y ?? 450000)}
      </div>
      <div class="price-admin-col">
        <div class="price-admin-h">Completo (nuevo)</div>
        ${n('completo_m', 'Mensual', s?.completo_m ?? p.completo_m ?? 70000)}
        ${n('completo_y', 'Pago único', s?.completo_y ?? p.completo_y ?? 560000)}
      </div>
    </div>
    ${n('extra', 'Empleado extra', s?.extra ?? p.extra)}
    <div class="grid2">
      <div class="form-group"><label for="date">Fecha de vigencia</label><input id="date" name="date" type="date" min="${todayAR()}" required value="${s?.date || ''}"></div>
      <div class="form-group"><label for="notify_days">Avisar con</label><select id="notify_days" name="notify_days">${[7, 15, 30].map((x) => html`<option value="${x}" ${x === (s?.notify_days || 15) ? raw('selected') : ''}>${x} días de anticipación</option>`)}</select></div>
    </div>
    <div class="form-group"><label for="legacy">Clientes actuales</label><select id="legacy" name="legacy">${[['renewal', 'Sin cambios hasta renovar'], ['newonly', 'Solo altas nuevas'], ['all', 'Todos desde la fecha']].map(([k, l]) => html`<option value="${k}" ${k === (s?.legacy || 'renewal') ? raw('selected') : ''}>${l}</option>`)}</select></div>
    <div class="form-group"><label for="text">Texto del aviso</label><textarea id="text" name="text" rows="2">${s?.text || 'A partir del {fecha} los planes se actualizan.'}</textarea></div>
    <button class="btn btn-outline btn-sm" type="submit">Programar aumento</button>
  </form>
  <div class="card"><strong>Historial de cambios</strong>
    ${d.history.length ? d.history.map((h) => html`<div class="changelog-item"><div class="muted">${fmtDateTime(h.at)}</div><div style="font-size:.85rem">Esencial ${money(h.from?.sub)} → ${money(h.to?.sub)} · Único ${money(h.from?.once)} → ${money(h.to?.once)}</div></div>`) : html`<p class="muted">Sin cambios todavía.</p>`}
  </div>`);
}
forms.prices = async (v) => { const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, +x])); await api('PUT', '/api/admin/prices', o); try { S.cfg = await get('/api/public/config'); } catch {} toast('Precios guardados'); load(); };
forms.schedule = async (v) => {
  const num = (x) => +x;
  await post('/api/admin/prices/schedule', {
    ...v,
    esencial_m: num(v.esencial_m), esencial_y: num(v.esencial_y),
    pro_m: num(v.pro_m), pro_y: num(v.pro_y),
    completo_m: num(v.completo_m), completo_y: num(v.completo_y),
    sub: num(v.esencial_m || v.sub), once: num(v.esencial_y || v.once),
    extra: num(v.extra), notify_days: num(v.notify_days),
  });
  toast('Aumento programado para todos los planes');
  load();
};
acts['sch-cancel'] = async () => { await api('DELETE', '/api/admin/prices/schedule'); toast('Aumento cancelado'); load(); };

async function cupones() {
  const { coupons } = await get('/api/admin/coupons');
  const unitLabel = (c) => {
    const n = c.duration_n ?? c.months ?? 1;
    const u = c.duration_unit || 'months';
    if (u === 'days') return n + (n === 1 ? ' día' : ' días');
    if (u === 'years') return n + (n === 1 ? ' año' : ' años');
    return n + (n === 1 ? ' mes' : ' meses');
  };
  const fmtD = (ts) => ts ? new Date(Number(ts)).toLocaleDateString('es-AR') : 'Sin límite';
  const usesTxt = (c) => c.max_uses == null ? `${c.uses_count || 0} / ∞` : `${c.uses_count || 0} / ${c.max_uses}`;
  const usesPct = (c) => {
    if (c.max_uses == null || !c.max_uses) return 0;
    return Math.min(100, Math.round(100 * (c.uses_count || 0) / c.max_uses));
  };
  const planL = { sub: 'Suscripción', once: 'Pago único', both: 'Todos los planes' };
  const statusOf = (c) => {
    const now = Date.now();
    if (!c.active) return { t: 'Inactivo', k: 'off' };
    if (c.starts_at && Number(c.starts_at) > now) return { t: 'Programado', k: 'warn' };
    if (c.expires_at && Number(c.expires_at) < now) return { t: 'Vencido', k: 'off' };
    if (c.max_uses != null && (c.uses_count || 0) >= c.max_uses) return { t: 'Agotado', k: 'off' };
    return { t: 'Activo', k: 'on' };
  };
  patchEl('#a-body', html`
  <div class="coupon-admin">
    <div class="card coupon-hero">
      <div class="row between" style="align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <strong style="font-size:1.15rem">Cupones y promociones</strong>
          <p class="muted mb" style="margin-top:6px;max-width:42rem">Reglas avanzadas: descuento, duración del beneficio, vigencia del código, tope de usos, 1 vez por email, tipo de facturación y plan (Esencial / Pro / Completo).</p>
        </div>
        <div class="coupon-stats">
          <div class="coupon-stat"><b>${coupons.length}</b><span>códigos</span></div>
          <div class="coupon-stat"><b>${coupons.filter((c) => statusOf(c).k === 'on').length}</b><span>activos</span></div>
        </div>
      </div>
    </div>

    <div class="coupon-list">
      ${coupons.length ? coupons.map((c) => {
        const st = statusOf(c);
        const pctU = usesPct(c);
        return html`<article class="card coupon-card ${st.k === 'on' ? '' : 'is-dim'}">
          <div class="coupon-card-top">
            <div class="coupon-code">${c.code}</div>
            <span class="mark-chip ${st.k}">${st.t}</span>
          </div>
          <div class="coupon-pct"><span class="big">${c.pct}%</span> <span class="muted">off · ${unitLabel(c)}</span></div>
          <div class="coupon-meta">
            <span>${c.scope === 'new' ? 'Solo altas nuevas' : 'Cualquier cliente'}</span>
            <span>${planL[c.applies_to] || 'Todos los planes'}</span>
            <span>${c.plan_tiers ? 'Planes: ' + c.plan_tiers : 'Todos los tiers'}</span>
            <span>${c.per_email_once == null || c.per_email_once ? '1× por email' : 'Reutilizable'}</span>
          </div>
          <div class="coupon-dates muted">Canje: ${fmtD(c.starts_at)} → ${fmtD(c.expires_at)}</div>
          <div class="coupon-uses">
            <div class="row between"><span class="muted">Usos</span><span>${usesTxt(c)}</span></div>
            ${c.max_uses != null ? html`<div class="coupon-bar"><i style="width:${pctU}%"></i></div>` : ''}
          </div>
          ${c.note ? html`<p class="coupon-note">${c.note}</p>` : ''}
          <div class="row mt" style="gap:8px">
            <button class="btn btn-outline btn-sm" data-act="coupon-toggle" data-code="${c.code}" type="button">${c.active ? 'Desactivar' : 'Activar'}</button>
            <button class="btn btn-danger btn-sm" data-act="coupon-del" data-code="${c.code}" type="button">Eliminar</button>
          </div>
        </article>`;
      }) : html`<div class="card"><p class="muted">No hay cupones. Creá el primero abajo.</p></div>`}
    </div>

    <form data-form="coupon" class="card coupon-form">
      <strong>Crear o actualizar cupón</strong>
      <p class="muted" style="font-size:.85rem;margin:6px 0 14px">Si el código ya existe, se actualizan las reglas (el contador de usos no se reinicia).</p>

      <div class="coupon-section-title">Identidad y descuento</div>
      <div class="grid2">
        <div class="form-group"><label for="cc">Código</label><input id="cc" name="code" required pattern="[A-Za-z0-9_-]{3,24}" style="text-transform:uppercase" placeholder="PROMO30"></div>
        <div class="form-group"><label for="cp">% de descuento</label><input id="cp" name="pct" type="number" min="1" max="100" value="20" required></div>
      </div>

      <div class="coupon-section-title">Duración del beneficio (después de canjear)</div>
      <div class="grid2">
        <div class="form-group"><label for="cdn">Cantidad</label><input id="cdn" name="duration_n" type="number" min="1" max="3650" value="3" required></div>
        <div class="form-group"><label for="cdu">Unidad</label>
          <select id="cdu" name="duration_unit">
            <option value="days">Días</option>
            <option value="months" selected>Meses</option>
            <option value="years">Años</option>
          </select>
        </div>
      </div>

      <div class="coupon-section-title">Quién y qué plan</div>
      <div class="grid2">
        <div class="form-group"><label for="cs">Audiencia</label>
          <select id="cs" name="scope">
            <option value="new">Solo altas nuevas (registro)</option>
            <option value="all">Cualquier cliente</option>
          </select>
        </div>
        <div class="form-group"><label for="cap">Facturación</label>
          <select id="cap" name="applies_to">
            <option value="both">Suscripción y pago único</option>
            <option value="sub">Solo suscripción mensual</option>
            <option value="once">Solo pago único</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label for="cpt">Planes (tiers)</label>
        <select id="cpt" name="plan_tiers">
          <option value="all">Todos (Esencial, Pro, Completo)</option>
          <option value="esencial">Solo Esencial</option>
          <option value="pro">Solo Pro</option>
          <option value="completo">Solo Completo</option>
          <option value="esencial,pro">Esencial + Pro</option>
          <option value="pro,completo">Pro + Completo</option>
        </select>
      </div>

      <div class="coupon-section-title">Límites de uso</div>
      <div class="grid2">
        <div class="form-group"><label for="cmu">Usos totales del código</label>
          <input id="cmu" name="max_uses" type="text" placeholder="Vacío = ilimitado" autocomplete="off">
        </div>
        <div class="form-group"><label for="cpe">Por email</label>
          <select id="cpe" name="per_email_once">
            <option value="1" selected>1 sola vez por email</option>
            <option value="0">El mismo email puede reutilizarlo</option>
          </select>
        </div>
      </div>

      <div class="coupon-section-title">Ventana de canje (vigencia del código)</div>
      <div class="grid2">
        <div class="form-group"><label for="cst">Válido desde</label><input id="cst" name="starts_at" type="date"></div>
        <div class="form-group"><label for="cex">Válido hasta</label><input id="cex" name="expires_at" type="date"></div>
      </div>

      <div class="form-group"><label for="cnote">Nota interna</label><input id="cnote" name="note" maxlength="200" placeholder="Campaña Instagram · marzo"></div>
      <button class="btn btn-primary" type="submit">Guardar cupón</button>
    </form>
  </div>`);
}
forms.coupon = async (v) => {
  await post('/api/admin/coupons', {
    code: v.code,
    pct: +v.pct,
    duration_n: +v.duration_n,
    duration_unit: v.duration_unit || 'months',
    scope: v.scope,
    applies_to: v.applies_to || 'both',
    plan_tiers: v.plan_tiers === 'all' ? null : (v.plan_tiers || null),
    max_uses: (!v.max_uses || v.max_uses === 'infinite') ? null : +v.max_uses,
    per_email_once: v.per_email_once === '0' ? 0 : 1,
    starts_at: v.starts_at || null,
    expires_at: v.expires_at || null,
    note: v.note || '',
  });
  toast('Cupón guardado'); load();
};
acts['coupon-del'] = async (el) => {
  if (!confirm('¿Eliminar el cupón ' + el.dataset.code + '?')) return;
  await api('DELETE', '/api/admin/coupons/' + encodeURIComponent(el.dataset.code));
  load();
};
acts['coupon-toggle'] = async (el) => {
  await post('/api/admin/coupons/' + encodeURIComponent(el.dataset.code) + '/toggle');
  load();
};

let holYear = new Date().getFullYear();
const SRC = { auto: 'Por ley', api: 'Fuente online', manual: 'Manual' };
async function feriados() {
  const d = await get('/api/admin/holidays?year=' + holYear);
  const sy = d.sync;
  patchEl('#a-body', html`<div class="card"><div class="row between mb"><strong>Feriados ${holYear}</strong><div class="row"><button class="btn btn-outline btn-sm" data-act="hol-year" data-d="-1" type="button" aria-label="Año anterior">◀</button><button class="btn btn-outline btn-sm" data-act="hol-year" data-d="1" type="button" aria-label="Año siguiente">▶</button></div></div>
    <p class="muted mb">Los feriados nacionales se <strong>calculan solos por ley</strong> para cualquier año (fijos, Carnaval, Semana Santa y trasladables). Los días no laborables turísticos los decreta el Gobierno cada año: cargalos a mano o traelos con la fuente online. Las horas del mes se calculan siempre con esta tabla; no se consulta internet en cada marcación.</p>
    <div class="row mb"><button class="btn btn-primary btn-sm" data-act="hol-gen" type="button">Generar feriados ${holYear}</button><button class="btn btn-outline btn-sm" data-act="hol-sync" type="button">🌐 Sincronizar con fuente online</button></div>
    <label class="row mb" style="font-size:.82rem"><input type="checkbox" data-change="hol-auto" ${d.auto_sync ? raw('checked') : ''}> Sincronizar solo una vez por día (año actual y siguiente)</label>
    <p class="muted mb">${sy ? (sy.ok ? `✅ Última sincronización: ${fmtDateTime(sy.at)} (año ${sy.year}, ${sy.count} cambios).` : `⚠ El último intento falló (${fmtDateTime(sy.at)}): ${sy.error}. No pasa nada: los feriados por ley siguen vigentes.`) : 'Todavía no se sincronizó con la fuente online.'} Fuente: ${d.source_url}</p>
    <p class="muted mb"><strong>Generar</strong> recalcula el año por ley y restaura los que hayas quitado; no toca los que cargaste a mano.</p>
    ${d.holidays.length ? d.holidays.map((h) => html`<div class="config-row"><div><div class="title">${fmtDay(h.date)} · ${h.name}</div><div class="desc">${h.kind === 'feriado' ? 'Feriado (se descuenta)' : 'Día no laborable (no se descuenta)'} <span class="src-badge">${SRC[h.source] || h.source}</span></div></div>
      <div class="row"><button class="btn btn-outline btn-sm" data-act="hol-edit" data-date="${h.date}" data-name="${h.name}" data-kind="${h.kind==='no_laborable'?'No laborable':h.kind==='feriado'?'Feriado':h.kind}" type="button">Editar</button><button class="btn btn-danger btn-sm" data-act="hol-del" data-date="${h.date}" type="button">Quitar</button></div></div>`)
      : html`<div class="alert alert-warn">No hay feriados cargados para ${holYear}. Tocá “Generar feriados ${holYear}”.</div>`}</div>
  <form data-form="holiday" class="card"><strong>Agregar feriado o día no laborable</strong><div class="grid2 mt"><div class="form-group"><label for="hd">Fecha</label><input id="hd" name="date" type="date" required value="${holYear}-01-01"></div><div class="form-group"><label for="hk">Tipo</label><select id="hk" name="kind"><option value="feriado">Feriado</option><option value="no_laborable">Día no laborable</option></select></div></div>
    <div class="form-group"><label for="hn">Nombre</label><input id="hn" name="name" required maxlength="80"></div><button class="btn btn-primary btn-sm" type="submit">Agregar</button></form>`);
}
acts['hol-gen'] = async () => { if (!confirm(`Se recalculan los feriados ${holYear} por ley y se restauran los que quitaste. Los cargados a mano no se tocan. ¿Continuar?`)) return; const r = await post('/api/admin/holidays/generate', { year: holYear }); toast(`Listo: ${r.count} feriados generados`); load(); };
acts['hol-sync'] = async () => { toast('Consultando la fuente online…'); const r = await post('/api/admin/holidays/sync', { year: holYear }); toast(`Sincronizado: ${r.count} cambios`); load(); };
acts['hol-auto'] = async (el) => { await api('PUT', '/api/admin/holidays/settings', { auto_sync: el.checked }); toast(el.checked ? 'Sincronización diaria activada' : 'Sincronización diaria desactivada'); };
acts['hol-edit'] = (el) => openModal(html`<h3 style="margin-bottom:8px">Editar · ${fmtDay(el.dataset.date)}</h3><form data-form="hol-edit" data-date="${el.dataset.date}">
  <div class="form-group"><label for="he-n">Nombre</label><input id="he-n" name="name" value="${el.dataset.name}" required maxlength="80"></div>
  <div class="form-group"><label for="he-k">Tipo</label><select id="he-k" name="kind"><option value="feriado" ${el.dataset.kind === 'feriado' ? raw('selected') : ''}>Feriado (se descuenta)</option><option value="no_laborable" ${el.dataset.kind === 'no_laborable' ? raw('selected') : ''}>Día no laborable (no se descuenta)</option></select></div>
  <p class="muted mb">Para cambiar la fecha, quitá este y agregá uno nuevo. Al editarlo queda marcado como “Manual” y la sincronización no lo pisa.</p>
  <button class="btn btn-primary btn-block" type="submit">Guardar</button><button class="btn btn-outline btn-block mt" type="button" data-act="close-modal">Cancelar</button></form>`);
forms['hol-edit'] = async (v, f) => { await post('/api/admin/holidays', { date: f.dataset.date, name: v.name, kind: v.kind }); closeModal(); toast('Feriado actualizado'); load(); };
acts['hol-year'] = (el) => { holYear += Number(el.dataset.d); load(); };
forms.holiday = async (v) => { await post('/api/admin/holidays', v); toast('Feriado guardado'); load(); };
acts['hol-del'] = async (el) => { await api('DELETE', '/api/admin/holidays/' + el.dataset.date); load(); };

async function sistema() {
  const [{ audit }, b] = await Promise.all([get('/api/admin/audit'), get('/api/admin/backup/status')]);
  const stats = await get('/api/admin/stats');
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  patchEl('#a-body', html`${stats.warnings.length ? html`<div class="card"><strong>Avisos de configuración</strong>${stats.warnings.map((w) => html`<div class="alert ${w.level === 'critical' ? 'alert-err' : 'alert-warn'} mt">${w.text}</div>`)}</div>` : html`<div class="alert alert-ok">✅ Configuración sin avisos.</div>`}
  <div class="card"><strong>💾 Backups</strong>
    <div class="alert ${b.stale ? 'alert-warn' : 'alert-ok'} mt">${b.age_days === null ? 'Todavía no hay ningún backup.' : b.stale ? `Pasaron ${b.age_days} días desde el último backup (el aviso salta a los ${b.warn_days}).` : `Último backup hace ${b.age_days} días.`}</div>
    <div class="muted">Automático: ${b.last_auto ? (b.last_auto.ok ? `${fmtDateTime(b.last_auto.at)} (${kb(b.last_auto.size)})` : `falló: ${b.last_auto.error}`) : 'todavía no corrió'} · Última descarga: ${b.last_download ? fmtDateTime(b.last_download.at) : 'nunca'}</div>
    <div class="row mt"><button class="btn btn-primary btn-sm" data-act="bk-run" type="button">Hacer backup ahora</button><a class="btn btn-outline btn-sm" href="/api/admin/backup">Descargar copia de la base</a></div>
    ${b.files.length ? html`<div style="font-weight:600;font-size:.82rem;margin:12px 0 4px">Copias guardadas en el servidor (data/backups)</div>${b.files.map((f) => html`<div class="hours-emp-row"><span>${f.file} · ${kb(f.size)}</span><a class="btn btn-outline btn-sm" href="/api/admin/backup/file/${f.file}">Descargar</a></div>`)}` : ''}
    <form data-form="bk-settings" class="mt"><div class="grid2"><div class="form-group"><label for="bk-keep">Copias que se guardan</label><input id="bk-keep" name="keep" type="number" min="1" max="60" value="${b.keep}"></div><div class="form-group"><label for="bk-warn">Avisar si pasaron más de (días)</label><input id="bk-warn" name="warn_days" type="number" min="1" max="90" value="${b.warn_days}"></div></div>
      <label class="row mb" style="font-size:.85rem"><input type="checkbox" name="auto" ${b.auto ? raw('checked') : ''}> Hacer una copia automática por día</label><button class="btn btn-outline btn-sm" type="submit">Guardar ajustes</button></form>
    <p class="muted mt">Las copias automáticas guardan la <strong>base de datos</strong>. Los archivos subidos (recibos y certificados en <code>data/uploads</code>) y el archivo <code>data/.secret</code> hay que respaldarlos aparte, y conviene llevar una copia fuera del servidor.</p></div>
  <div class="card"><strong>📋 Auditoría</strong><p class="muted mb">Últimos ${audit.length} eventos del sistema</p>
    <div class="row mb" style="flex-wrap:wrap;gap:8px">
      <select id="audit-cat" data-change="audit-filter" style="max-width:160px">
        <option value="">Todas las categorías</option>
        ${Object.entries(CAT_LABEL).map(([k,l]) => html`<option value="${k}">${l}</option>`)}
      </select>
      <input id="audit-q" data-input="audit-filter" type="search" placeholder="Buscar negocio o acción…" style="flex:1;min-width:140px">
    </div>
    <div class="audit-list" id="audit-list">${audit.length ? audit.map((a) => {
      const cat = ACTION_CAT(a.action);
      const label = ACTION_LABELS[a.action] || a.action;
      const det = humanDetail(a.action, a.detail);
      return html`<div class="audit-item" data-cat="${cat}" data-text="${esc((a.tenant||'')+' '+label+' '+det+' '+a.action)}">
        <span class="audit-badge audit-${cat}">${CAT_LABEL[cat] || cat}</span>
        <div class="grow"><div class="audit-title">${label}</div>
          <div class="audit-sub">${a.tenant || 'Sistema'}${det ? ' · ' + det : ''} · ${fmtDateTime(a.ts)}</div></div>
        <button class="btn btn-outline btn-sm" type="button" data-act="audit-raw" data-raw="${esc(typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail || {}))}" title="Ver técnico">{}</button>
      </div>`;
    }) : html`<p class="muted">Sin eventos todavía.</p>`}</div></div>`);
}
acts['bk-run'] = async () => { toast('Haciendo la copia…'); await post('/api/admin/backup/run'); toast('Backup listo'); renderAdmin(); };
forms['bk-settings'] = async (v) => { await api('PUT', '/api/admin/backup/settings', { auto: v.auto === 'on', keep: +v.keep, warn_days: +v.warn_days }); toast('Ajustes guardados'); renderAdmin(); };

// ---------- Novedades (changelog) ----------
const entryForm = (e = {}) => html`<form data-form="news-save" data-id="${e.id || ''}"><div class="grid2"><div class="form-group"><label for="nv-v">Versión</label><input id="nv-v" name="version" value="${e.version || ''}" required maxlength="20" placeholder="3.2.0"></div><div class="form-group"><label for="nv-d">Fecha</label><input id="nv-d" name="date" type="date" value="${e.date || todayAR()}" required></div></div>
  <p class="muted mb">Un renglón = un punto de la lista. Completá al menos uno de los tres.</p>
  ${[['added', '➕ Agregado'], ['changed', '🔧 Cambiado'], ['removed', '➖ Quitado']].map(([k, l]) => html`<div class="form-group"><label for="nv-${k}">${l}</label><textarea id="nv-${k}" name="${k}" rows="3">${e[k] || ''}</textarea></div>`)}
  <button class="btn btn-primary btn-block" type="submit">Guardar</button><button class="btn btn-outline btn-block mt" type="button" data-act="close-modal">Cancelar</button></form>`;
let newsCache = [];
async function novedades() {
  const { entries } = await get('/api/admin/changelog'); newsCache = entries;
  patchEl('#a-body', html`<div class="card"><div class="row between mb"><div><strong>Novedades</strong><div class="muted">Los dueños ven las últimas 5 en Config → Novedades.</div></div><button class="btn btn-primary btn-sm" data-act="news-new" type="button">＋ Nueva</button></div>
    ${entries.length ? entries.map((n) => html`<div class="news-item"><div class="row between"><div><strong>Versión ${n.version}</strong> <span class="muted">${fmtDay(n.date)}</span></div><div class="row"><button class="btn btn-outline btn-sm" data-act="news-edit" data-id="${n.id}" type="button">Editar</button><button class="btn btn-danger btn-sm" data-act="news-del" data-id="${n.id}" type="button">Eliminar</button></div></div>
      ${[['added', '➕ Agregado'], ['changed', '🔧 Cambiado'], ['removed', '➖ Quitado']].filter(([k]) => n[k]).map(([k, l]) => html`<div class="muted" style="margin-top:4px">${l}</div><ul>${n[k].split('\n').filter(Boolean).map((li) => html`<li>${li}</li>`)}</ul>`)}</div>`) : html`<p class="muted">Todavía no hay novedades.</p>`}</div>`);
}
acts['news-new'] = () => openModal(html`<h3 style="margin-bottom:8px">Nueva novedad</h3>${entryForm()}`);
acts['news-edit'] = (el) => openModal(html`<h3 style="margin-bottom:8px">Editar novedad</h3>${entryForm(newsCache.find((x) => x.id === Number(el.dataset.id)))}`);
forms['news-save'] = async (v, f) => { const id = f.dataset.id; if (id) await api('PUT', '/api/admin/changelog/' + id, v); else await post('/api/admin/changelog', v); closeModal(); toast('Novedad guardada'); load(); };
acts['news-del'] = async (el) => { if (!confirm('¿Eliminar esta novedad?')) return; await api('DELETE', '/api/admin/changelog/' + el.dataset.id); load(); };

// ---------- Feedback ----------
const FB = { status: '', kind: '' };
const FB_ST = { new: 'Nuevo', in_progress: 'En curso', done: 'Hecho', dismissed: 'Descartado' };
async function feedback() {
  const { items, new_count } = await get(`/api/admin/feedback?status=${FB.status}&kind=${FB.kind}`);
  const opt = (obj, cur, all) => html`<option value="">${all}</option>${Object.entries(obj).map(([k, l]) => html`<option value="${k}" ${k === cur ? raw('selected') : ''}>${l}</option>`)}`;
  patchEl('#a-body', html`<div class="card"><div class="row between mb"><div><strong>Sugerencias y reportes</strong><div class="muted">${new_count} nuevo(s) sin revisar</div></div>
    <div class="row"><select data-change="fb-status" aria-label="Estado" style="width:auto">${opt(FB_ST, FB.status, 'Todos los estados')}</select><select data-change="fb-kind" aria-label="Tipo" style="width:auto">${opt({ problem: 'Problemas', idea: 'Ideas' }, FB.kind, 'Problemas e ideas')}</select></div></div>
    ${items.length ? items.map((i) => html`<div class="account-card" style="display:block"><div class="row between"><div><strong>${i.kind === 'problem' ? '🐞' : '💡'} ${i.subject}</strong><div class="account-meta">${i.author || 'Usuario eliminado'} (${i.role}) · ${i.tenant || '—'} · ${fmtDateTime(i.created_at)}${i.page_context ? ' · ' + i.page_context : ''}</div></div>${badge(i.status === 'new' ? 'pending' : i.status === 'done' ? 'approved' : i.status === 'dismissed' ? 'rejected' : 'fuera')}</div>
      <p class="pre mt">${i.body}</p>
      <form data-form="fb-save" data-id="${i.id}" class="row mt"><select name="status" aria-label="Estado">${Object.entries(FB_ST).map(([k, l]) => html`<option value="${k}" ${k === i.status ? raw('selected') : ''}>${l}</option>`)}</select>
        <input name="admin_note" class="grow" placeholder="Nota interna (solo la ves vos)" value="${i.admin_note || ''}" maxlength="1000"><button class="btn btn-primary btn-sm" type="submit">Guardar</button></form></div>`) : html`<p class="muted">No hay mensajes con esos filtros.</p>`}</div>`);
}
acts['fb-status'] = (el) => { FB.status = el.value; load(); };
acts['fb-kind'] = (el) => { FB.kind = el.value; load(); };
forms['fb-save'] = async (v, f) => { await patch('/api/admin/feedback/' + f.dataset.id, v); toast('Guardado'); renderAdmin(); };

acts['audit-raw'] = (el) => openModal(html`<h3 style="margin-bottom:8px">Detalle técnico</h3><pre style="white-space:pre-wrap;font-size:.78rem;background:var(--bg);padding:12px;border-radius:8px;overflow:auto;max-height:50vh">${el.dataset.raw || '—'}</pre><button class="btn btn-outline btn-block mt" data-act="close-modal" type="button">Cerrar</button>`);

const applyAuditFilter = () => {
  const cat = document.getElementById('audit-cat')?.value || '';
  const q = (document.getElementById('audit-q')?.value || '').toLowerCase().trim();
  document.querySelectorAll('#audit-list .audit-item').forEach((el) => {
    const okCat = !cat || el.dataset.cat === cat;
    const okQ = !q || (el.dataset.text || '').toLowerCase().includes(q);
    el.style.display = okCat && okQ ? '' : 'none';
  });
};
acts['audit-filter'] = () => applyAuditFilter();


async function paymentsCfg() {
  const { config } = await get('/api/admin/payments-config');
  patchEl('#a-body', html`<div class="card">
    <strong>Pagos</strong>
    <p class="muted mb">Pagos solo con <strong>Mercado Pago</strong>. Las tarjetas no se guardan en AsistOK. Más adelante se puede sumar otro proveedor en el mismo punto del código.</p>
    <div class="config-row"><div><div class="title">Mercado Pago</div>
      <div class="desc">${config.mp_enabled ? 'Credenciales cargadas en el servidor (.env)' : 'Sin MP_ACCESS_TOKEN: en desarrollo puede usarse modo prueba si ALLOW_DEMO_PAYMENTS=1'}</div></div>
      <span class="mark-chip ${config.mp_enabled ? 'on' : 'off'}">${config.mp_enabled ? 'Activo' : 'No configurado'}</span></div>
    <p class="muted mt" style="font-size:.8rem">Configuración: <code>MP_ACCESS_TOKEN</code> y <code>MP_WEBHOOK_SECRET</code> en el archivo <code>.env</code> del servidor. Webhook: <code>/api/mp/webhook</code>.</p>
  </div>`);
}
forms.paycfg = async () => { toast('Nada que guardar: Mercado Pago se configura en el servidor'); };


async function reviewsAdmin() {
  const { reviews } = await get('/api/admin/reviews');
  patchEl('#a-body', html`<div class="card"><strong>Valoraciones de clientes</strong>
    <p class="muted mb">Las publicadas se muestran en la landing con el logo del negocio.</p>
    ${reviews && reviews.length ? reviews.map((r) => html`<div class="config-row">
      <div><div class="title">${'★'.repeat(r.stars)}${'☆'.repeat(5-r.stars)} · ${r.tenant_name || '—'}</div>
        <div class="desc">“${r.text}” — ${r.author_name || ''} · ${r.approved ? 'Publicada' : 'Pendiente'}</div></div>
      <div class="row">${!r.approved ? html`<button class="btn btn-primary btn-sm" data-act="rev-ok" data-id="${r.id}" type="button">Publicar</button>` : ''}
        <button class="btn btn-danger btn-sm" data-act="rev-no" data-id="${r.id}" type="button">Quitar</button></div>
    </div>`) : html`<p class="muted">Sin valoraciones todavía.</p>`}
  </div>`);
}
acts['rev-ok'] = async (el) => { await post('/api/admin/reviews/' + el.dataset.id + '/approve'); toast('Publicada'); load(); };
acts['rev-no'] = async (el) => { await post('/api/admin/reviews/' + el.dataset.id + '/reject'); toast('Eliminada'); load(); };
