// Pantalla del local: muestra el QR dinámico sin iniciar sesión. Se autoriza con el link (un solo dispositivo).
import { acts, html, raw, render, $, post, fmtTime } from './util.js';
import { qrSvg } from './qr.js';

const D = {};
const FATAL = ['LINK_EXPIRED', 'LINK_REVOKED', 'LINK_USED', 'LINK_INVALID', 'TENANT_INACTIVE'];
const TITLE = { LINK_EXPIRED: 'Este link ya venció', LINK_REVOKED: 'Link cancelado', LINK_USED: 'Link ya usado en otro dispositivo', LINK_INVALID: 'Link no válido', TENANT_INACTIVE: 'Negocio inactivo' };

const shell = (content) => render(html`<div class="kiosk"><div class="kiosk-card">${content}</div></div>`);
function fatal(e) {
  D.stop = true; clearInterval(D.timer); D.wake?.release?.().catch(() => {});
  shell(html`<div class="brand-mark brand-mark-logo" style="margin:0 auto 12px"></div><h2 style="font-size:1.15rem;margin-bottom:8px">${TITLE[e.code] || 'No se pudo abrir la pantalla'}</h2>
    <div class="alert alert-err" role="alert">${e.message}</div><p class="muted">Si necesitás mostrar el QR, pedile al dueño del negocio un link nuevo.</p>`);
}

function startGps() {
  if (!D.info.require_gps) { D.gps = 'off'; return Promise.resolve(); }
  if (!navigator.geolocation) { D.gps = 'unsupported'; return Promise.resolve(); }
  return new Promise((resolve) => {
    navigator.geolocation.watchPosition((p) => { D.pos = p.coords; D.posAt = Date.now(); D.gps = 'ok'; resolve(); },
      (e) => { D.gps = e.code === 1 ? 'denied' : 'unavailable'; resolve(); }, { enableHighAccuracy: true, maximumAge: 20000, timeout: 30000 });
    setTimeout(resolve, 12000);
  });
}
async function keepAwake() { try { if ('wakeLock' in navigator) D.wake = await navigator.wakeLock.request('screen'); } catch { /* no es crítico */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && D.info && !D.stop) keepAwake(); });

async function refresh() {
  if (D.busy || D.stop) return;
  D.busy = true;
  try {
    const fresh = D.pos && Date.now() - D.posAt < 90000;
    const r = await post('/api/display/qr', { token: D.token, ...(fresh ? { lat: D.pos.latitude, lng: D.pos.longitude, accuracy: D.pos.accuracy } : {}) });
    D.qr = r; D.err = null; D.qrEnd = Date.now() + r.refresh_in; D.qrDue = D.qrEnd - 3000;
  } catch (e) {
    if (FATAL.includes(e.code)) { D.busy = false; return fatal(e); }
    D.err = e; D.qr = null; D.qrDue = Date.now() + 8000;
  }
  D.busy = false;
  paint();
}

const gpsHelp = () => D.gps === 'denied' ? 'El navegador bloqueó la ubicación. Tocá el candado de la barra de direcciones → Ubicación → Permitir, y después “Reintentar”.'
  : D.gps === 'unsupported' ? 'Este navegador no permite usar la ubicación. Abrí el link con Chrome o Safari.' : 'Activá el GPS del dispositivo, esperá unos segundos y tocá “Reintentar”.';

function paint() {
  const i = D.info, q = D.qr;
  if (!q) {
    shell(html`<div class="kiosk-head"><div class="brand-mark brand-mark-logo"></div><div style="text-align:left"><strong>${i.tenant}</strong><div class="muted">${i.branch}</div></div></div>
      <div class="alert alert-err" role="alert"><strong>${D.err?.code === 'GEO_OUT' ? 'Este dispositivo no está en el local' : D.err?.code === 'GEO_REQUIRED' ? 'Falta la ubicación de este dispositivo' : 'No se puede mostrar el QR'}</strong><br>${D.err?.message || ''}
        ${D.err?.code === 'GEO_REQUIRED' ? html`<br><span class="muted">${gpsHelp()}</span>` : ''}</div>
      <button class="btn btn-primary btn-block" data-act="k-retry" type="button">Reintentar</button>`);
    return;
  }
  shell(html`<div class="kiosk-head"><div class="brand-mark brand-mark-logo"></div><div style="text-align:left"><strong>${q.tenant}</strong><div class="muted">${q.branch}${i.label ? ' · ' + i.label : ''}</div></div></div>
    <h2 style="font-size:1.1rem">Escaneá para marcar tu asistencia</h2>
    <div class="qr-big">${raw(qrSvg(q.url))}</div><div class="countdown"><i id="k-bar" style="width:100%"></i></div>
    <div class="kiosk-status ${i.require_gps ? 'ok' : ''}">${i.require_gps ? `📍 GPS de este dispositivo en el local${q.dist != null ? ` (a ${q.dist} m)` : ''}` : '📍 Esta pantalla no controla GPS'}</div>
    ${i.expires_at ? html`<div class="muted" id="k-left"></div>` : ''}
    <div class="row" style="justify-content:center;margin-top:10px"><button class="btn btn-outline btn-sm" data-act="k-full" type="button">Pantalla completa</button></div>
    <p class="muted" style="margin-top:10px">El código cambia cada minuto. Dejá esta pantalla encendida y a la vista.</p>`);
  tickLeft();
}
function tickLeft() {
  const el = $('#k-left'); if (!el || !D.info.expires_at) return;
  const ms = D.info.expires_at - Date.now(), h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  el.textContent = `Este link vence a las ${fmtTime(D.info.expires_at)} (quedan ${h} h ${m} min)`;
}
function tick() {
  if (D.stop) return;
  const now = Date.now();
  if (D.info.expires_at && now >= D.info.expires_at) return fatal({ code: 'LINK_EXPIRED', message: 'La jornada de este link terminó. Pedile al dueño uno nuevo.' });
  const bar = $('#k-bar'); if (bar && D.qrEnd) bar.style.width = Math.max(0, ((D.qrEnd - now) / 60000) * 100) + '%';
  tickLeft();
  if (now >= (D.qrDue || 0)) refresh();
}

export async function renderDisplay(token) {
  clearInterval(D.timer);
  Object.assign(D, { token, info: null, qr: null, err: null, pos: null, stop: false, busy: false, qrDue: 0 });
  shell(html`<p class="muted"><span class="spinner"></span> Abriendo pantalla…</p>`);
  try { D.info = await post('/api/display/open', { token }); } catch (e) { return fatal(e); }
  document.documentElement.style.setProperty('--theme', D.info.theme || '#0f766e');
  shell(html`<p class="muted"><span class="spinner"></span> ${D.info.require_gps ? 'Verificando la ubicación de este dispositivo…' : 'Preparando el QR…'}</p>`);
  keepAwake();
  await startGps();
  await refresh();
  D.timer = setInterval(tick, 1000);
}
acts['k-full'] = () => document.documentElement.requestFullscreen?.();
acts['k-retry'] = async () => { D.qrDue = 0; if (D.gps !== 'ok') await startGps(); D.busy = false; await refresh(); };
