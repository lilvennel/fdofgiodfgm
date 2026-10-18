import { S, acts, forms, html, raw, $, get, post, render, toast, closeModal, openModal, api, applyTheme, toggleDark, money, esc, copyText, getCookieConsent, setCookieConsent, hasCookieDecision, applyCookieConsent } from './util.js';
import { renderOwner } from './owner.js';
import { renderEmployee, renderMark } from './employee.js';
import { renderAdmin } from './admin.js';
import { renderDisplay } from './display.js';

const q = new URLSearchParams(location.search);
let cleanUrl = () => history.replaceState(null, '', '/');

// ---------- Eventos globales (delegación; sin handlers inline por la CSP) ----------
document.addEventListener('click', async (e) => {
  if (e.target.id === 'modal') return closeModal();
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = acts[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  try { await fn(el, e); } catch (err) { fail(err); }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const btn = f.querySelector('button[type=submit]');
  btn && (btn.disabled = true);
  try { await forms[f.dataset.form](Object.fromEntries(new FormData(f)), f); } catch (err) { fail(err); }
  finally { btn && (btn.disabled = false); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  const rb = (e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[role=button][data-act]');
  if (rb && rb === e.target) { e.preventDefault(); rb.click(); }
});
document.addEventListener('input', (e) => { const el = e.target.closest('[data-input]'); if (el) acts[el.dataset.input]?.(el, e); });
document.addEventListener('change', (e) => { const el = e.target.closest('[data-change]'); if (el) acts[el.dataset.change]?.(el, e); });

export function fail(err) {
  if (!err.status) console.error(err);
  if (err.status === 401) { S.me = null; showAuth(); return toast('Tu sesión venció. Ingresá de nuevo.'); }
  // Rol cambiado o sin permiso: re-evaluar sesión (evita panel colgado en bucle)
  if (err.status === 403 && (err.code === 'FORBIDDEN' || err.code === 'ACCOUNT_DISABLED')) {
    toast(err.message || 'No tenés permiso para esto');
    boot();
    return;
  }
  if (['PAYMENT_REQUIRED', 'TENANT_SUSPENDED', 'TENANT_INACTIVE', 'ACCOUNT_DISABLED'].includes(err.code)) { boot(); return; }
  if (err.code === 'MUST_CHANGE_PW') { boot(); return; }
  toast(err.message || 'Ocurrió un error');
}

// ---------- Pantalla de acceso ----------
const eyeless = (id, label, type = 'text', extra = '') => html`<div class="form-group"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" ${raw(extra)}></div>`;
let authTab = 'login';

function turnstileSlot() {
  const key = S.cfg?.turnstile_site_key;
  if (!key) return '';
  return html`<div class="form-group ts-wrap"><div class="cf-turnstile" data-sitekey="${key}" data-theme="auto"></div>
    <input type="hidden" name="turnstile_token" id="ts-token" value=""></div>`;
}
function loadTurnstile() {
  const key = S.cfg?.turnstile_site_key;
  if (!key) return;
  window.__tsToken = '';
  window.__onTs = (tok) => { window.__tsToken = tok; const el = document.getElementById('ts-token'); if (el) el.value = tok; };
  if (!document.getElementById('cf-ts-script')) {
    const s = document.createElement('script');
    s.id = 'cf-ts-script';
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => {
      document.querySelectorAll('.cf-turnstile').forEach((el) => {
        if (el.dataset.rendered) return;
        el.dataset.rendered = '1';
        try { window.turnstile.render(el, { sitekey: key, callback: window.__onTs }); } catch {}
      });
    };
    document.head.appendChild(s);
  } else if (window.turnstile) {
    document.querySelectorAll('.cf-turnstile').forEach((el) => {
      if (el.dataset.rendered) return;
      el.dataset.rendered = '1';
      try { window.turnstile.render(el, { sitekey: key, callback: window.__onTs }); } catch {}
    });
  }
}
export async function showAuth(message, opts = {}) {
  // Refrescar precios/textos si la landing ya estaba abierta
  if (!opts.skipCfg) {
    try { S.cfg = await get('/api/public/config'); } catch {}
  }
  const c = S.cfg || {}, h = c.hero || {}, ct = c.contact || {};
  const reg = authTab === 'reg', forgot = authTab === 'forgot';
  const waHref = ct.wa_link || 'https://wa.me/5491100000000';
  const wa = ct.wa_link ? html`<a href="${ct.wa_link}" target="_blank" rel="noopener">${ct.wa_label || 'WhatsApp'}</a>` : html`<a href="${waHref}" target="_blank" rel="noopener">WhatsApp</a>`;
  const loginForm = forgot ? html`
    <form data-form="forgot"><p class="muted mb">Ingresá tu email y te enviamos un link para elegir una nueva contraseña.</p>
      ${eyeless('f-email', 'Email', 'email', 'required autocomplete="email"')}
      <button class="btn btn-primary btn-block" type="submit">Enviar link</button>
      <p class="sa-link" style="text-align:center;margin-top:12px"><a href="#" data-act="auth-tab" data-tab="login">← Volver</a></p></form>`
  : reg ? html`
    <form data-form="register">
      ${eyeless('business', 'Nombre del negocio', 'text', 'required minlength="2" maxlength="80" autocomplete="organization"')}
      ${eyeless('email', 'Email', 'email', 'required autocomplete="email"')}
      ${eyeless('password', 'Contraseña (mínimo 8 caracteres)', 'password', 'required minlength="8" autocomplete="new-password"')}
      <div class="form-group"><label for="plan_tier">Plan</label><select id="plan_tier" name="plan_tier">
        <option value="esencial">Esencial</option>
        <option value="pro">Pro</option>
        <option value="completo">Completo (multi-sucursal + recibos)</option></select></div>
      <div class="form-group"><label for="plan">Facturación</label><select id="plan" name="plan">
        <option value="sub">Suscripción mensual</option>
        <option value="once">Pago único (de por vida)</option></select></div>
      ${eyeless('coupon', 'Código de descuento (opcional)', 'text', 'autocomplete="off" style="text-transform:uppercase"')}
      <p class="muted" style="font-size:.85rem;margin-bottom:8px">Incluye hasta ${c.free_employees ?? 40} empleados.</p>
      <p class="muted" style="font-size:.85rem;margin-bottom:8px;line-height:1.45">🎁 Con <strong>suscripción mensual</strong>: <strong>30 días de prueba gratis</strong> vía Mercado Pago (cargás un medio de pago y no se cobra hasta que termine la prueba). El pago único no tiene trial.</p>
      <label class="terms-check" style="display:flex;gap:10px;align-items:flex-start;margin:12px 0 8px">
        <input type="checkbox" name="accept_terms" value="1" required style="margin-top:3px;width:18px;height:18px;flex-shrink:0">
        <span class="muted" style="font-size:.85rem;line-height:1.4">Leí y acepto los <a href="/terminos" target="_blank" rel="noopener">Términos y condiciones</a>.</span>
      </label>
      <label class="terms-check" style="display:flex;gap:10px;align-items:flex-start;margin:0 0 16px">
        <input type="checkbox" name="accept_privacy" value="1" required style="margin-top:3px;width:18px;height:18px;flex-shrink:0">
        <span class="muted" style="font-size:.85rem;line-height:1.4">Leí y acepto la <a href="/privacidad" target="_blank" rel="noopener">Política de privacidad</a>.</span>
      </label>
      <p class="muted" style="font-size:.8rem;margin:-8px 0 12px">Al registrarte te enviamos un email para <strong>confirmar tu dirección</strong>. Sin eso no podés pagar ni activar el negocio.</p>
      ${turnstileSlot()}
      <button class="btn btn-primary btn-block" type="submit">Crear cuenta y continuar al pago</button>
    </form>`
  : html`
    <form data-form="login">
      ${eyeless('email', 'Email', 'email', 'required autocomplete="username"')}
      ${eyeless('password', 'Contraseña', 'password', 'required autocomplete="current-password"')}
      <a class="login-link" href="#" data-act="auth-tab" data-tab="forgot">¿Olvidaste tu contraseña?</a>
      ${turnstileSlot()}
      <button class="btn btn-primary btn-block" type="submit">Ingresar</button>
    </form>`;

  render(html`
  <div class="ok-landing">
    ${c.payments.demo ? html`<div class="demo-banner">MODO DE PRUEBA · los pagos son simulados</div>` : ''}
    <header class="nav">
      <div class="wrap nav-inner">
        <a class="logo" href="#" data-act="auth-tab" data-tab="login"><div class="logo-mark" aria-hidden="true"></div><span class="logo-text" style="font-weight:800">AsistOK</span></a>
        <nav class="nav-links">
          <a href="#producto">Producto</a>
          <a href="#soporte">Soporte</a>
          <a href="#pricing">Precios</a>
          <a href="#login">Ingresar</a>
        </nav>
        <div class="nav-actions">
          <button class="btn btn-outline" type="button" data-act="scroll-login">Iniciar sesión</button>
          <button class="btn btn-primary" type="button" data-act="auth-tab" data-tab="reg">Probar ahora</button>
        </div>
      </div>
    </header>

    <section class="hero">
      <div class="wrap grid-2">
        <div>
          <span class="tag">Hecho para comercios y equipos en Argentina</span>
          <h1 style="margin-top:14px">Dejá la planilla.<br>Controlá quién está<br><span class="h1-last">y <span id="tw-text" class="tw-inline">recuperá tiempo</span><span class="tw-dots" aria-hidden="true">...</span></span></h1>
          <p>AsistOK es el control de asistencia online para tu negocio: marcación simple desde el celular, ubicación del local, horas y extras claras. Fácil desde el primer día.</p>
          <div class="hero-cta">
            <button class="btn btn-primary" type="button" data-act="auth-tab" data-tab="reg">Ver planes / registrarse</button>
            <a class="btn btn-outline" href="#producto">Cómo funciona</a>
          </div>
          <div class="stats">
            <div class="stat"><b>QR + GPS</b><span>Marca en el local</span></div>
            <div class="stat"><b>Horas claras</b><span>Normales y extras</span></div>
            <div class="stat"><b>Avisos</b><span>Tarde, zona, permisos</span></div>
            <div class="stat"><b>Mercado Pago</b><span>Cobro simple</span></div>
          </div>
        </div>
        <div class="mock">
          <div class="mock-top"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span style="margin-left:8px">Panel en vivo · demo</span><span class="live-dot" title="En vivo"></span></div>
          <div class="mock-body live-demo" id="live-demo">
            <div class="live-jornada-card">
              <div class="muted" style="font-size:.7rem;letter-spacing:.04em;font-weight:700">MI JORNADA · HOY</div>
              <div style="font-size:1.15rem;font-weight:800;margin:4px 0">08:00 — 17:00</div>
              <div class="muted" style="font-size:.78rem">Entrada registrada: <span class="live-in">08:02</span></div>
              <div class="live-j-box">
                <div class="muted" style="font-size:.75rem">Tiempo trabajado</div>
                <div class="live-worked" style="font-size:1.25rem;font-weight:800">04 h 15 min</div>
                <div class="muted" style="font-size:.7rem">Ejemplo ilustrativo · datos simulados</div>
              </div>
              <div class="row between" style="margin-top:8px"><span class="pill pill-g live-pulse">En jornada</span><span class="live-ticker muted" style="font-size:.72rem">hace un momento</span></div>
            </div>
            <div class="live-row" style="margin-top:10px"><span>María López · caja</span><span class="pill pill-g">En jornada</span></div>
            <div class="live-row"><span>Diego Ruiz · depósito</span><span class="pill pill-e">Extra</span></div>
            <div class="live-row" style="border:0"><span>Horas del mes</span><strong class="live-num" style="color:#0f766e">164 h</strong></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="login">
      <div class="wrap">
        <div class="login-panel">
          <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:16px">
            <div class="logo-mark" aria-hidden="true"></div><strong style="font-size:1.15rem;font-weight:800">AsistOK</strong>
          </div>
          <h2>${forgot ? 'Recuperar contraseña' : reg ? 'Crear cuenta' : 'Iniciar sesión'}</h2>
          <p class="sub">${forgot ? 'Te enviamos un link al email' : reg ? 'Empezá en minutos' : 'Dueño o empleado'}</p>
          ${message ? html`<div class="alert alert-ok">${message}</div>` : ''}
          ${forgot ? '' : html`<div class="login-tabs" role="tablist" style="margin-bottom:14px">
            <button type="button" class="${reg ? '' : 'active'}" data-act="auth-tab" data-tab="login">Iniciar sesión</button>
            <button type="button" class="${reg ? 'active' : ''}" data-act="auth-tab" data-tab="reg">Registrarse</button></div>`}
          ${loginForm}
        </div>
      </div>
    </section>

    <section class="section" id="producto">
      <div class="wrap">
        <span class="tag">01 · Producto</span>
        <h2>Todo lo que necesitás, sin complicaciones</h2>
        <p class="lead">Marcación, horas, permisos y reportes en un solo lugar. Pensado para el local real.</p>
        <div class="grid-3">
          <article class="feat-card"><div class="feat-icon">📱</div><h3 style="margin-bottom:8px">Marcación simple</h3><p class="muted">Desde el celular, con ubicación del local. Sin escanear si no querés.</p></article>
          <article class="feat-card"><div class="feat-icon">⏱</div><h3 style="margin-bottom:8px">Horas y extras</h3><p class="muted">Normales, extras y feriados. Reportes listos para Excel.</p></article>
          <article class="feat-card"><div class="feat-icon">🔔</div><h3 style="margin-bottom:8px">Avisos al dueño</h3><p class="muted">Llegó tarde, no marcó salida o intento fuera de zona.</p></article>
          <article class="feat-card"><div class="feat-icon">🗂</div><h3 style="margin-bottom:8px">Permisos y recibos</h3><p class="muted">Día libre, vacaciones y firma de recibos en PDF.</p></article>
          <article class="feat-card"><div class="feat-icon">🏢</div><h3 style="margin-bottom:8px">Multi-sucursal</h3><p class="muted">Cada local con su ubicación, QR y empleados.</p></article>
          <article class="feat-card"><div class="feat-icon">💳</div><h3 style="margin-bottom:8px">Mercado Pago</h3><p class="muted">Suscripción o pago único. Activás y listo.</p></article>
        </div>
      </div>
    </section>

    <section class="section" id="soporte">
      <div class="wrap">
        <div class="support">
          <span class="tag" style="background:rgba(255,255,255,.15);color:#fff">02 · Soporte</span>
          <h2 style="margin-top:12px">Estamos cuando el local está abierto</h2>
          <p class="lead">Ayuda humana por WhatsApp. Te guiamos con la ubicación, los empleados y la primera marca.</p>
          <div class="support-grid">
            <div class="support-item"><b>Respuesta rápida</b><span>En días hábiles, en el horario en que más lo necesitás.</span></div>
            <div class="support-item"><b>WhatsApp real</b><span>Hablás con una persona, no con un bot infinito.</span></div>
            <div class="support-item"><b>Hecho en Argentina</b><span>Entendemos feriados, LCT y el día a día del local.</span></div>
            <div class="support-item"><b>Puesta en marcha</b><span>Te ayudamos a cargar el local y a marcar la primera vez.</span></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="pricing">
      <div class="wrap" style="text-align:center">
        <span class="tag">03 · Planes simples</span>
        <h2>Elegí tu plan</h2>
        <p class="lead" style="margin-left:auto;margin-right:auto">Cada plan incluye una cantidad de empleados. Si el equipo crece, sumás extras o módulos sin cambiar de plan de golpe.</p>
        <div class="billing" role="tablist" style="display:inline-flex;background:#e2e8f0;padding:4px;border-radius:999px;margin-bottom:28px">
          <button type="button" class="on" id="btn-m" data-act="bill-mode" data-mode="m" style="border:0;background:transparent;padding:8px 16px;border-radius:999px;font-weight:700;cursor:pointer">Mensual</button>
          <button type="button" id="btn-y" data-act="bill-mode" data-mode="y" style="border:0;background:transparent;padding:8px 16px;border-radius:999px;font-weight:700;cursor:pointer;color:#64748b">Pago único <span style="color:#059669;font-size:.75rem">mejor valor</span></button>
        </div>
        <div class="grid-3" style="text-align:left">
          <div class="price-card">
            <h3>Esencial</h3>
            <div class="price" data-m="${c.prices.esencial_m ?? c.prices.sub}" data-y="${c.prices.esencial_y ?? c.prices.once}">${money(c.prices.esencial_m ?? c.prices.sub)} <small>/ mes</small></div>
            <p class="muted" style="font-size:.8rem"><strong>${c.free_employees ?? 40} empleados incluidos</strong> · 1 sucursal<br><span style="font-size:.75rem">Podés sumar más cuando los necesites (${money(c.prices.extra)} c/u, pago único)</span></p>
            <ul>
              <li>Marcación panel + GPS</li>
              <li>QR opcional en puerta</li>
              <li>Horas y extras del mes</li>
              <li>Notificaciones al dueño</li>
            </ul>
            <button class="btn btn-primary btn-block" type="button" data-act="pick-plan" data-tier="esencial" data-plan-billing data-billing="sub">Activar Esencial</button>
          </div>
          <div class="price-card featured">
            <span class="badge" style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:#4f46e5;color:#fff;font-size:.72rem;font-weight:800;padding:4px 10px;border-radius:999px">Más elegido</span>
            <h3>Pro</h3>
            <div class="price" data-m="${c.prices.pro_m ?? 55000}" data-y="${c.prices.pro_y ?? 450000}">${money(c.prices.pro_m ?? 55000)} <small>/ mes</small></div>
            <p class="muted" style="font-size:.8rem"><strong>${c.free_employees ?? 40} empleados incluidos</strong> · todo Esencial +<br><span style="font-size:.75rem">Extras al mismo precio (${money(c.prices.extra)} c/u)</span></p>
            <ul>
              <li>Cierre automático de jornada</li>
              <li>Permisos y vacaciones</li>
              <li>Reportes exportables</li>
              <li>Prioridad de soporte</li>
            </ul>
            <button class="btn btn-primary btn-block" style="background:#fff;color:#0b1220" type="button" data-act="pick-plan" data-tier="pro" data-plan-billing data-billing="sub">Activar Pro</button>
          </div>
          <div class="price-card">
            <h3>Completo</h3>
            <div class="price" data-m="${c.prices.completo_m ?? 70000}" data-y="${c.prices.completo_y ?? 560000}">${money(c.prices.completo_m ?? 70000)} <small>/ mes</small></div>
            <p class="muted" style="font-size:.8rem"><strong>${c.free_employees ?? 40} empleados incluidos</strong> · todo Pro + módulos<br><span style="font-size:.75rem">Extras disponibles (${money(c.prices.extra)} c/u)</span></p>
            <ul>
              <li>Multi-sucursal incluido</li>
              <li>Recibos de sueldo incluido</li>
              <li>Misma base de empleados + extras</li>
              <li>Ideal cadenas chicas</li>
            </ul>
            <button class="btn btn-primary btn-block" type="button" data-act="pick-plan" data-tier="completo" data-plan-billing data-billing="sub">Activar Completo</button>
          </div>
        </div>
        <div class="addons" style="text-align:left;margin-top:28px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:18px">
          <h3 style="font-size:1rem;margin-bottom:10px">Módulos y extras (pago único)</h3>
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #e2e8f0;font-size:.92rem"><span>Multi-sucursal</span><strong>${money(c.prices.mod_suc)}</strong></div>
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #e2e8f0;font-size:.92rem"><span>Recibos de sueldo</span><strong>${money(c.prices.mod_rec)}</strong></div>
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #e2e8f0;font-size:.92rem;gap:12px"><span>Empleado extra <span class="muted" style="font-size:.8rem">(cuando superás los incluidos del plan)</span></span><strong style="white-space:nowrap">${money(c.prices.extra)} c/u</strong></div>
        </div>
      </div>
    </section>


    <section class="section sav-section" id="tiempo">
      <div class="wrap sav-grid">
        <div>
          <h2 class="sav-title">Mirá cuánto tiempo recuperás</h2>
          <p class="muted sav-lead">AsistOK automatiza la marcación, el control de horas y los avisos. Contanos cómo trabajás y estimamos las horas que te devuelve al mes.</p>
          <div class="sav-control">
            <div class="row between"><span class="muted">Empleados</span><strong id="sav-emp-val">8</strong></div>
            <input id="sav-emp" type="range" min="2" max="40" value="8" data-input="sav-recalc">
          </div>
          <div class="sav-control">
            <div class="row between"><span class="muted">Días que abrís por semana</span></div>
            <div class="sav-days" role="group">
              <button type="button" data-act="sav-days" data-d="5">5 días</button>
              <button type="button" class="on" data-act="sav-days" data-d="6">6 días</button>
              <button type="button" data-act="sav-days" data-d="7">7 días</button>
            </div>
          </div>
        </div>
        <div class="sav-result">
          <div class="muted">Por mes recuperás</div>
          <div class="sav-hours"><span id="sav-h">24</span><span class="sav-h-unit">h</span></div>
          <p class="muted" id="sav-sub">Son 3 jornadas de 8 horas para dedicarle a tu negocio.</p>
          <div class="sav-rows">
            <div class="sav-row"><span>Armar planilla / revisar marcas</span><span class="sav-old" id="sav-o1">45 min</span><span class="sav-new" id="sav-n1">5 min</span></div>
            <div class="sav-row"><span>Calcular horas y extras</span><span class="sav-old" id="sav-o2">40 min</span><span class="sav-new" id="sav-n2">3 min</span></div>
            <div class="sav-row"><span>Avisos de tarde y faltas</span><span class="sav-old" id="sav-o3">25 min</span><span class="sav-new" id="sav-n3">2 min</span></div>
          </div>
          <p class="muted" style="font-size:.78rem;margin-top:10px">Tiempo por día, a mano vs. con AsistOK. Estimación orientativa.</p>
          <button class="btn btn-primary btn-block mt" type="button" data-act="auth-tab" data-tab="reg">Recuperar mi tiempo</button>
        </div>
      </div>
    </section>

    <section class="section reviews-section" id="valoraciones">
      <div class="wrap">
        <span class="tag">Clientes</span>
        <h2>Lo que dicen los que ya usan AsistOK</h2>
        <p class="lead muted">Valoraciones reales de dueños de negocio. Cada una con el logo de su local.</p>
        <div class="reviews-grid" id="reviews-grid"><p class="muted">Cargando valoraciones…</p></div>
      </div>
    </section>
<section class="section" id="faq">
      <div class="wrap" style="max-width:720px;margin:0 auto">
        <span class="tag">04 · Dudas</span>
        <h2>Preguntas frecuentes</h2>
        <p class="lead">Si no está acá, escribinos por WhatsApp.</p>
        <details open><summary>¿Necesito instalar una app de la tienda?</summary><p>No. Funciona en el navegador del celular o la compu. Podés “Agregar a inicio” para tener un ícono, pero sigue siendo web.</p></details>
        <details><summary>¿Hace falta un QR en la puerta?</summary><p>No es obligatorio. El empleado puede marcar desde su panel con la ubicación activada. El QR es opcional si preferís control en la entrada o una pantalla fija.</p></details>
        <details><summary>¿Qué pasa si marca desde la casa?</summary><p>Configurás el punto del local una vez. Si intentan marcar lejos, el sistema rechaza el intento y te llega un aviso de seguridad.</p></details>
        <details><summary>¿Cómo sé si alguien llegó tarde?</summary><p>En Config cargás la hora de entrada del turno y los minutos de tolerancia. Si marcan después de eso, te llega la notificación. No inicia la jornada sola: solo avisa.</p></details>
        <details><summary>¿Qué incluye cada plan?</summary><p><strong>Esencial:</strong> marcación, GPS, horas, extras y avisos (1 sucursal). <strong>Pro:</strong> todo eso + permisos, reportes y cierre automático. <strong>Completo:</strong> Pro + multi-sucursal y recibos de sueldo incluidos.</p></details>
        <details><summary>¿Puedo pagar una sola vez?</summary><p>Sí. En cada plan podés elegir suscripción mensual o pago único (licencia de por vida del plan).</p></details>
        <details><summary>¿Y si no hay luz o se corta internet?</summary><p>Con el celular y datos móviles pueden marcar. Si no hay red, el dueño puede corregir marcas a mano desde el panel.</p></details>
        <details><summary>¿Puedo cancelar la suscripción?</summary><p>Sí. Desde Config cancelás la renovación; seguís con acceso hasta el fin del período ya pagado.</p></details>
      </div>
    </section>

    <footer class="ok-foot">
      <div class="wrap" style="display:flex;flex-wrap:wrap;gap:28px;justify-content:space-between">
        <div style="flex:1;min-width:200px">
          <div class="logo" style="color:#fff;margin-bottom:10px"><div class="logo-mark" aria-hidden="true"></div><span style="font-weight:800;letter-spacing:-.02em">AsistOK</span></div>
          <p style="font-size:.85rem;max-width:36ch;margin-bottom:12px">Control de asistencia para negocios en Argentina.</p>
          <p class="ok-disclaimer">Sistema de control de asistencia para negocios de Argentina. Los registros, horas y documentos son responsabilidad de cada empleador; AsistOK es una herramienta de apoyo y no reemplaza la LCT ni otras obligaciones laborales. La ubicación se usa solo al marcar, no es seguimiento continuo.</p>
        </div>
        <div style="font-size:.85rem">
          <div class="ok-foot-h">Producto</div>
          <div><a href="#producto">Características</a></div>
          <div><a href="#pricing">Precios</a></div>
          <div><a href="#soporte">Soporte</a></div>
        </div>
        <div style="font-size:.85rem">
          <div class="ok-foot-h">Legal</div>
          <div><a href="/privacidad">Privacidad</a></div>
          <div><a href="/estado">Estado del servicio</a></div>
          <div><a href="/terminos">Términos</a></div>
          <div><a href="#" data-act="cookies-open">Preferencias de cookies</a></div>
        </div>
        <div style="font-size:.85rem">
          <div class="ok-foot-h">Contacto</div>
          <div><a href="mailto:${ct.email || 'hola@asistok.app'}">${ct.email || 'hola@asistok.app'}</a></div>
          <div style="margin-top:6px">${wa}</div>
          <div style="margin-top:14px;opacity:.85">© 2026 AsistOK · Todos los derechos reservados</div>
        </div>
      </div>
    </footer>
    <a class="wa-fab" href="${waHref}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp">💬</a>
  </div>`);
  ensureCookieUI();
  if (reg && typeof window !== 'undefined') {
    const tier = window.__pickTier, bill = window.__pickBilling;
    if (tier) { const s = document.getElementById('plan_tier'); if (s) s.value = tier; }
    if (bill) { const s = document.getElementById('plan'); if (s) s.value = bill; }
  }
  initLandingEffects();
  if (typeof loadTurnstile === 'function') loadTurnstile();
  startLandingCfgPoll();
}

let heroTimer;
function startHero() {
  clearInterval(heroTimer);
  const slides = [...document.querySelectorAll('.hero-slide')];
  if (slides.length < 2) return;
  let i = 0;
  heroTimer = setInterval(() => { if (!document.querySelector('.hero-slide')) return clearInterval(heroTimer); slides[i].classList.remove('active'); i = (i + 1) % slides.length; slides[i].classList.add('active'); }, 6000);
}
acts['auth-tab'] = async (el) => {
  authTab = el.dataset.tab || 'login';
  const y = window.scrollY;
  await showAuth(undefined, { skipCfg: true }); // pestaña: no hace falta re-pedir config
  window.scrollTo(0, y);
  requestAnimationFrame(() => window.scrollTo(0, y));
};
acts['bill-mode'] = (el) => {
  const mode = el.dataset.mode;
  document.getElementById('btn-m')?.classList.toggle('on', mode === 'm');
  document.getElementById('btn-y')?.classList.toggle('on', mode === 'y');
  document.querySelectorAll('.price[data-m]').forEach((node) => {
    const v = mode === 'm' ? node.dataset.m : node.dataset.y;
    const label = mode === 'm' ? '/ mes' : ' pago único';
    node.innerHTML = '$ ' + Number(v).toLocaleString('es-AR') + ' <small>' + label + '</small>';
  });
  document.querySelectorAll('[data-plan-billing]').forEach((b) => { b.dataset.billing = mode === 'y' ? 'once' : 'sub'; });
};
acts['pick-plan'] = async (el) => {
  authTab = 'reg';
  window.__pickTier = el.dataset.tier || 'esencial';
  window.__pickBilling = el.dataset.billing || 'sub';
  await showAuth();
  setTimeout(() => document.getElementById('login')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
};
acts['scroll-login'] = async () => {
  authTab = 'login';
  await showAuth();
  setTimeout(() => document.getElementById('login')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
};


forms.login = async (v) => {
  const r = await post('/api/auth/login', { email: v.email, password: v.password, turnstile_token: v.turnstile_token || window.__tsToken || '' });
  S.me = null; await boot();
};
forms.register = async (v) => {
  if (!v.accept_terms) throw Object.assign(new Error('Tenés que aceptar los Términos y condiciones'), { status: 400 });
  if (!v.accept_privacy) throw Object.assign(new Error('Tenés que aceptar la Política de privacidad'), { status: 400 });
  await post('/api/auth/register', { ...v, accept_terms: true, accept_privacy: true, turnstile_token: v.turnstile_token || window.__tsToken || '' });
  await boot();
};
forms.forgot = async (v) => { await post('/api/auth/forgot', { email: v.email }); authTab = 'login'; await showAuth('Si el email existe, te enviamos un link para recuperar tu contraseña.'); };
acts.logout = async () => { await post('/api/auth/logout'); S.me = null; S.markCode = null; authTab = 'login'; cleanUrl(); applyTheme(); await showAuth(); };
acts.dark = () => toggleDark();

// ---------- Cambio de contraseña ----------
export function changePasswordScreen(forced) {
  const body = html`<form data-form="chpw">
    <h2 style="font-size:1.1rem;margin-bottom:6px">${forced ? 'Elegí tu contraseña' : 'Cambiar contraseña'}</h2>
    ${forced ? html`<p class="muted mb">Por seguridad tenés que reemplazar la contraseña temporal que te dio tu empleador antes de continuar.</p>` : ''}
    ${eyeless('current', forced ? 'Contraseña temporal' : 'Contraseña actual', 'password', 'required autocomplete="current-password"')}
    ${eyeless('password', 'Nueva contraseña (mínimo 8)', 'password', 'required minlength="8" autocomplete="new-password"')}
    ${forced ? html`
      <label class="terms-check" style="display:flex;gap:10px;align-items:flex-start;margin:12px 0 8px">
        <input type="checkbox" name="accept_terms" value="1" required style="margin-top:3px;width:18px;height:18px;flex-shrink:0">
        <span class="muted" style="font-size:.85rem;line-height:1.4">Leí y acepto los <a href="/terminos" target="_blank" rel="noopener">Términos y condiciones</a>.</span>
      </label>
      <label class="terms-check" style="display:flex;gap:10px;align-items:flex-start;margin:0 0 16px">
        <input type="checkbox" name="accept_privacy" value="1" required style="margin-top:3px;width:18px;height:18px;flex-shrink:0">
        <span class="muted" style="font-size:.85rem;line-height:1.4">Leí y acepto la <a href="/privacidad" target="_blank" rel="noopener">Política de privacidad</a>.</span>
      </label>` : ''}
    <button class="btn btn-primary btn-block" type="submit">Guardar</button>
    ${forced ? html`<button class="btn btn-outline btn-block mt" type="button" data-act="logout">Cerrar sesión</button>` : html`<button class="btn btn-outline btn-block mt" type="button" data-act="close-modal">Cancelar</button>`}</form>`;
  if (forced) render(html`<div class="page-center"><div class="card form-card">${body}</div></div>`); else openModal(body);
}
forms.chpw = async (v) => {
  if (S.me?.user?.must_change_pw) {
    if (!v.accept_terms) throw Object.assign(new Error('Tenés que aceptar los Términos y condiciones'), { status: 400 });
    if (!v.accept_privacy) throw Object.assign(new Error('Tenés que aceptar la Política de privacidad'), { status: 400 });
  }
  await post('/api/auth/password', {
    current: v.current,
    password: v.password,
    accept_terms: !!v.accept_terms,
    accept_privacy: !!v.accept_privacy,
  });
  closeModal();
  toast('Contraseña actualizada');
  await boot();
};
acts['close-modal'] = () => closeModal();
acts['change-pw'] = () => changePasswordScreen(false);

// ---------- Pago ----------
function paymentScreen(statusMsg) {
  const { tenant, prices } = S.me;
  const base = tenant.plan === 'once' ? prices.once : prices.sub;
  const pct = tenant.discount_months > 0 || tenant.plan === 'once' ? tenant.discount_pct : 0;
  const total = Math.round(base * (1 - pct / 100));
  const demo = S.cfg.payments.demo;
  render(html`<div class="page-center"><div class="form-card card">
    <h2 style="font-size:1.1rem;margin-bottom:4px">Activá tu cuenta</h2>
    <p class="muted mb">${tenant.name}</p>
    ${statusMsg ? html`<div class="alert alert-warn">${statusMsg}</div>` : ''}
    ${S.cfg.email_verification && !S.me.user.email_verified ? html`<div class="alert alert-warn">Antes de pagar tenés que confirmar tu email: te enviamos un link a ${S.me.user.email}. <button class="link" type="button" data-act="resend-verify">Reenviar email</button></div>` : ''}
    ${tenant.status === 'past_due' ? html`<div class="alert alert-warn">Tu suscripción no está al día. Regularizá el pago para volver a usar el panel.</div>` : ''}
    <div class="summary">
      <div class="summary-row"><span>${tenant.plan === 'once' ? 'Licencia pago único' : 'Suscripción mensual'}</span><span>${money(base)}</span></div>
      ${pct ? html`<div class="summary-row"><span>Descuento ${pct}%${tenant.discount_months && tenant.plan === 'sub' ? ` (${tenant.discount_months} meses)` : ''}</span><span>− ${money(base - total)}</span></div>` : ''}
      <div class="summary-row summary-total"><span>Total${tenant.plan === 'sub' ? ' (primer mes)' : ''}</span><strong>${money(total)}</strong></div></div>
    <div class="secure-note"><span>🔒</span><div>Pago procesado por <strong>Mercado Pago</strong>. No guardamos datos de tu tarjeta.</div></div>
    <p class="muted mb" style="font-size:.88rem;line-height:1.45">🎁 <strong>30 días de prueba gratis</strong> al suscribirte. Mercado Pago te pide un medio de pago y <strong>no cobra nada</strong> hasta que termine la prueba. Si cancelás antes, no se te debita.</p>
    <button class="btn btn-mp btn-block" data-act="checkout" data-kind="plan" type="button">${demo ? 'Activar prueba (modo demo)' : 'Empezar prueba gratis con Mercado Pago'}</button>
    <button class="btn btn-outline btn-block mt" data-act="logout" type="button">Cerrar sesión</button>
  </div></div>`);
}
export async function startCheckout(kind, qty) {
  const r = await post('/api/pay/checkout', { kind, qty });
  if (r.demo) { location.href = r.url; return; }
  if (r.url) { location.href = r.url; return; }
  toast(r.note || 'No se pudo iniciar el pago');
}
acts.checkout = (el) => startCheckout(el.dataset.kind, el.dataset.qty ? Number(el.dataset.qty) : undefined);

function demoPayScreen(ref) {
  render(html`<div class="demo-banner">MODO DE PRUEBA · no se cobra nada</div><div class="page-center"><div class="form-card card" style="text-align:center">
    <div class="mp-logo-big">Mercado Pago</div><p class="muted mb">Simulación de checkout</p>
    <button class="btn btn-mp btn-block" data-act="demo-pay" data-ref="${ref}" type="button">Pagar ahora</button>
    <button class="btn btn-outline btn-block mt" data-act="demo-cancel" type="button">Cancelar</button></div></div>`);
}
acts['demo-pay'] = async (el) => { await post('/api/pay/demo-confirm', { ref: el.dataset.ref }); cleanUrl(); q.delete('demo_pay'); toast('Pago aprobado'); await boot(); };
acts['demo-cancel'] = () => { cleanUrl(); location.reload(); };

// ---------- Cookies (banner + preferencias) ----------
function cookiePrefsModal() {
  const c = getCookieConsent() || { analytics: false, marketing: false };
  openModal(html`<div class="row between mb"><h3 style="margin:0">Preferencias de cookies</h3><button class="btn btn-outline btn-sm" data-act="close-modal" type="button" aria-label="Cerrar">✕</button></div>
    <p class="muted mb" style="font-size:.88rem;line-height:1.45">Elegí qué categorías de cookies querés permitir. Podés cambiar esta decisión cuando quieras desde el enlace <strong>Preferencias de cookies</strong> en el pie de página.</p>
    <div class="cookie-cat">
      <div class="row between"><strong>Necesarias</strong><span class="muted" style="font-size:.8rem">Siempre activas</span></div>
      <p class="muted" style="font-size:.82rem;margin-top:4px">Imprescindibles para el funcionamiento del sitio: sesión, autenticación y seguridad. Son cookies técnicas (HttpOnly) y no se pueden desactivar.</p>
    </div>
    <div class="cookie-cat">
      <div class="row between"><strong>Analíticas</strong>
        <label class="switch"><input type="checkbox" id="ck-analytics" ${c.analytics ? raw('checked') : ''}><span class="slider"></span></label>
      </div>
      <p class="muted" style="font-size:.82rem;margin-top:4px">Hoy AsistOK <strong>no carga</strong> herramientas de medición de terceros. Si en el futuro se activan (por ejemplo para mejorar el producto), esta opción controlará si se permiten.</p>
    </div>
    <div class="cookie-cat">
      <div class="row between"><strong>Marketing</strong>
        <label class="switch"><input type="checkbox" id="ck-marketing" ${c.marketing ? raw('checked') : ''}><span class="slider"></span></label>
      </div>
      <p class="muted" style="font-size:.82rem;margin-top:4px">Hoy AsistOK <strong>no usa</strong> píxeles de publicidad (Meta, TikTok, etc.). Si se integran más adelante, esta opción decidirá si se habilitan.</p>
    </div>
    <button class="btn btn-primary btn-block mt" type="button" data-act="cookies-save">Guardar preferencias</button>
    <button class="btn btn-outline btn-block mt" type="button" data-act="cookies-reject">Rechazar todas (solo necesarias)</button>`);
}
function ensureCookieUI() {
  applyCookieConsent();
  if (hasCookieDecision()) {
    const b = document.getElementById('cookie-banner');
    if (b) b.remove();
    return;
  }
  if (document.getElementById('cookie-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'cookie-banner';
  bar.className = 'cookie-banner';
  bar.innerHTML = html`<div class="cookie-banner-inner">
    <p><strong>Usamos cookies necesarias</strong> para que puedas iniciar sesión y usar AsistOK con seguridad. No cargamos analíticas ni publicidad de terceros por defecto. Podés gestionar tus preferencias.</p>
    <div class="cookie-banner-actions">
      <button type="button" class="btn btn-primary btn-sm" data-act="cookies-accept">Aceptar</button>
      <button type="button" class="btn btn-outline btn-sm" data-act="cookies-reject">Solo necesarias</button>
      <button type="button" class="btn btn-outline btn-sm" data-act="cookies-open">Preferencias</button>
    </div>
  </div>`.toString();
  document.body.appendChild(bar);
}
acts['cookies-open'] = (e) => { if (e && e.preventDefault) e.preventDefault(); cookiePrefsModal(); };
acts['cookies-accept'] = () => {
  setCookieConsent({ analytics: true, marketing: true });
  applyCookieConsent();
  document.getElementById('cookie-banner')?.remove();
  closeModal();
  toast('Preferencias guardadas');
};
acts['cookies-reject'] = () => {
  setCookieConsent({ analytics: false, marketing: false });
  applyCookieConsent();
  document.getElementById('cookie-banner')?.remove();
  closeModal();
  toast('Solo cookies necesarias');
};
acts['cookies-save'] = () => {
  const analytics = !!document.getElementById('ck-analytics')?.checked;
  const marketing = !!document.getElementById('ck-marketing')?.checked;
  setCookieConsent({ analytics, marketing });
  applyCookieConsent();
  document.getElementById('cookie-banner')?.remove();
  closeModal();
  toast('Preferencias guardadas');
};


async function statusPage() {
  let h = { ok: false };
  try { h = await get('/api/health'); } catch (e) { h = { ok: false, error: e.message }; }
  const ok = !!h.ok;
  render(html`<main class="dash-body" style="max-width:520px;margin:40px auto">
    <a href="/" class="btn btn-outline btn-sm mb">← Volver</a>
    <div class="card" style="text-align:center">
      <div style="font-size:2.5rem;margin-bottom:8px">${ok ? '✅' : '⚠️'}</div>
      <h1 style="font-size:1.3rem;margin-bottom:6px">Estado de AsistOK</h1>
      <p class="muted mb">${ok ? 'El servicio está operativo.' : 'Hay un problema con el servicio o la base de datos.'}</p>
      <div style="text-align:left;font-size:.88rem;line-height:1.6">
        <div class="row between"><span>API / base de datos</span><strong>${h.db === 'up' ? 'OK' : 'Error'}</strong></div>
        <div class="row between"><span>Emails (Resend)</span><strong>${h.mail ? 'Configurado' : 'No configurado'}</strong></div>
        <div class="row between"><span>Mercado Pago</span><strong>${h.mp ? 'Configurado' : 'No configurado'}</strong></div>
        <div class="row between"><span>CAPTCHA</span><strong>${h.turnstile ? 'Activo' : 'Opcional / off'}</strong></div>
        <div class="row between"><span>Último backup</span><strong>${h.backup?.at ? new Date(h.backup.at).toLocaleString('es-AR') : '—'}</strong></div>
        <div class="row between"><span>Hora servidor</span><strong>${h.time ? new Date(h.time).toLocaleString('es-AR') : '—'}</strong></div>
      </div>
    </div>
  </main>`);
}
// ---------- Páginas simples ----------
async function legalPage(kind) {
  const l = await get('/api/public/legal');
  render(html`<main class="dash-body"><a href="/" class="btn btn-outline btn-sm mb">← Volver</a><div class="card"><h1 style="font-size:1.2rem;margin-bottom:10px">${kind === 'terminos' ? 'Términos y condiciones' : 'Política de privacidad'}</h1>${l.placeholder ? html`<div class="alert alert-warn mb">Texto provisional: todavía no es la versión definitiva y puede cambiar.</div>` : ''}<div class="legal">${raw(kind === 'terminos' ? l.terms_html : l.privacy_html)}</div></div></main>`);
}
async function joinPage(slug) {
  let t; try { t = await get('/api/public/tenant/' + encodeURIComponent(slug)); } catch (e) { return render(html`<div class="page-center"><div class="card form-card"><p>${e.message}</p><a href="/" class="btn btn-outline btn-block mt">Ir al inicio</a></div></div>`); }
  render(html`<div class="page-center"><div class="card form-card"><h2 style="font-size:1.1rem">Sumate a ${t.name}</h2>
    <p class="muted mb">Completá tus datos. Tu empleador tiene que autorizarte antes de que puedas marcar asistencia.</p>
    <form data-form="join" data-slug="${t.slug}">
      ${eyeless('name', 'Nombre y apellido', 'text', 'required minlength="2" autocomplete="name"')}
      ${eyeless('email', 'Email', 'email', 'required autocomplete="email"')}
      ${eyeless('password', 'Contraseña (mínimo 8)', 'password', 'required minlength="8" autocomplete="new-password"')}
      <button class="btn btn-primary btn-block" type="submit">Solicitar acceso</button></form></div></div>`);
}
forms.join = async (v, f) => { await post('/api/public/join/' + f.dataset.slug, v); render(html`<div class="page-center"><div class="card form-card" style="text-align:center"><div class="success-icon">✓</div><h2 style="font-size:1.1rem">Solicitud enviada</h2><p class="muted mt">${S.cfg.email_verification ? 'Te enviamos un email para confirmar tu dirección: abrí el link. ' : ''}Cuando tu empleador te autorice vas a poder ingresar con tu email y contraseña.</p></div></div>`); };

// H2: confirmación de email desde el link del correo
async function verifyPage(token) {
  render(html`<div class="page-center"><div class="card form-card" style="text-align:center"><p class="muted">Confirmando tu email…</p></div></div>`);
  try {
    await post('/api/auth/verify-email', { token });
    cleanUrl(); q.delete('verify');
    render(html`<div class="page-center"><div class="card form-card" style="text-align:center"><div class="success-icon">✓</div><h2 style="font-size:1.1rem">¡Email confirmado!</h2><p class="muted mt">Ya podés seguir. Si pediste acceso a un negocio, avisale a tu empleador que te autorice.</p><a href="/" class="btn btn-primary btn-block mt">Continuar</a></div></div>`);
  } catch (e) {
    render(html`<div class="page-center"><div class="card form-card" style="text-align:center"><h2 style="font-size:1.1rem">No pudimos confirmar tu email</h2><p class="muted mt">${e.message}</p><a href="/" class="btn btn-outline btn-block mt">Ir al inicio</a></div></div>`);
  }
}
acts['resend-verify'] = async () => { await post('/api/auth/resend-verification'); toast('Te enviamos el email de confirmación. Revisá tu bandeja (y la carpeta de spam).', 6000); };

function resetPage(token) {
  render(html`<div class="page-center"><div class="card form-card"><h2 style="font-size:1.1rem;margin-bottom:10px">Nueva contraseña</h2>
    <form data-form="reset" data-token="${token}">${eyeless('password', 'Nueva contraseña (mínimo 8)', 'password', 'required minlength="8" autocomplete="new-password"')}
    <button class="btn btn-primary btn-block" type="submit">Guardar</button></form></div></div>`);
}
forms.reset = async (v, f) => { await post('/api/auth/reset', { token: f.dataset.token, password: v.password }); cleanUrl(); authTab = 'login'; await showAuth('Listo. Ya podés ingresar con tu nueva contraseña.'); };

// ---------- Sugerencias y reportes (dueño y empleado) ----------
acts['feedback-open'] = (el) => openModal(html`<h3 style="margin-bottom:4px">Reportar un problema o enviar una idea</h3><p class="muted mb">Lo lee el equipo de AsistOK. No hace falta que sea perfecto.</p>
  <form data-form="feedback" data-ctx="${el.dataset.ctx || ''}">
    <div class="form-group"><label for="fb-kind">¿Qué querés contarnos?</label><select id="fb-kind" name="kind"><option value="problem">Tuve un problema</option><option value="idea">Tengo una idea</option></select></div>
    <div class="form-group"><label for="fb-subject">Título corto</label><input id="fb-subject" name="subject" required minlength="3" maxlength="120"></div>
    <div class="form-group"><label for="fb-body">Detalle (qué pasó o qué te gustaría)</label><textarea id="fb-body" name="body" required minlength="10" maxlength="2000" rows="5"></textarea></div>
    <button class="btn btn-primary btn-block" type="submit">Enviar</button><button class="btn btn-outline btn-block mt" type="button" data-act="close-modal">Cancelar</button></form>`);
forms.feedback = async (v, f) => { await post('/api/feedback', { ...v, page_context: f.dataset.ctx }); closeModal(); toast('¡Gracias! Recibimos tu mensaje.'); };

// ---------- Arranque ----------
async function waitPayment() {
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const me = await get('/api/auth/me'); S.me = me;
    if (me.tenant?.status === 'active') return true;
  }
  return false;
}

export async function boot() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  // Siempre pedir config fresca (precios, textos, empleados incluidos, etc.)
  try { S.cfg = await get('/api/public/config'); } catch (e) { if (!S.cfg) throw e; }
  if (path.startsWith('/pantalla/')) return renderDisplay(path.split('/')[2]);
  if (path === '/estado') { await statusPage(); return; }
  if (path === '/terminos' || path === '/privacidad') { await legalPage(path.slice(1)); ensureCookieUI(); return; }
  if (path.startsWith('/alta/')) return joinPage(path.split('/')[2]);
  if (q.get('verify')) return verifyPage(q.get('verify'));
  if (q.get('reset')) return resetPage(q.get('reset'));
  const mk = path.startsWith('/m/') ? path.slice(3) : null;
  if (mk) S.markCode = mk;
  if (q.get('demo_pay') && (await get('/api/auth/me')).user) return demoPayScreen(q.get('demo_pay'));

  const me = await get('/api/auth/me');
  S.me = me.user ? me : null;
  applyTheme();
  if (!S.me) { await showAuth(S.markCode ? 'Ingresá para marcar tu asistencia.' : undefined, { skipCfg: true }); ensureCookieUI(); return; }

  const { user, tenant } = S.me;
  if (user.role === 'superadmin') return renderAdmin();
  if (user.must_change_pw) return changePasswordScreen(true);
  if (tenant.status === 'suspended') return render(html`<div class="page-center"><div class="card form-card"><h2 style="font-size:1.1rem">Cuenta suspendida</h2><p class="muted mt">El acceso de ${tenant.name} está suspendido. Contactá a soporte.</p><button class="btn btn-outline btn-block mt" data-act="logout">Cerrar sesión</button></div></div>`);
  if (tenant.status !== 'active') {
    if (user.role === 'employee') return render(html`<div class="page-center"><div class="card form-card"><p>El negocio todavía no está activo. Consultá con tu empleador.</p><button class="btn btn-outline btn-block mt" data-act="logout">Cerrar sesión</button></div></div>`);
    if (q.get('pay') === 'ok' || q.get('pay') === 'pending') {
      paymentScreen('Estamos confirmando tu pago con Mercado Pago. Esto puede tardar un minuto…');
      cleanUrl(); q.delete('pay');
      if (await waitPayment()) { toast('¡Pago confirmado!'); return boot(); }
      return paymentScreen('Todavía no recibimos la confirmación. Si ya pagaste, recargá en unos minutos.');
    }
    return paymentScreen(q.get('pay') === 'fail' ? 'El pago no se completó. Podés intentarlo de nuevo.' : '');
  }
  if (q.get('pay')) { toast('Pago recibido'); cleanUrl(); q.delete('pay'); }
  if (user.role === 'owner' || user.role === 'manager' || user.role === 'hr') return renderOwner();
  if (S.markCode) return renderMark();
  return renderEmployee();
}


// ---------- Landing: typewriter + calculadora ----------
let _twTimer = null;
let _liveTimer = null;

function initLandingEffects() {
  startTypewriter();
  startLiveDemo();
  loadReviews();
  // bind range directly (más fiable que solo data-input)
  const range = document.getElementById('sav-emp');
  if (range) {
    range.oninput = () => savRecalc();
  }
  savRecalc();
}

function startTypewriter() {
  if (_twTimer) { clearTimeout(_twTimer); _twTimer = null; }
  const el = document.getElementById('tw-text');
  const dots = document.querySelector('.tw-dots');
  if (!el) return;
  const phrases = [
    'recuperá tiempo.',
    'ordená el equipo.',
    'evitá planillas.',
    'controlá el local.',
    'simplificá marcas.',
    'mirá las horas.',
  ];
  let pi = 0;
  let ci = 0;
  let mode = 'type'; // type | pause | erase

  const tick = () => {
    const node = document.getElementById('tw-text');
    if (!node) { _twTimer = null; return; }
    const phrase = phrases[pi];
    if (mode === 'type') {
      ci++;
      node.textContent = phrase.slice(0, ci);
      if (dots) dots.style.opacity = ci >= phrase.length ? '1' : '0';
      if (ci >= phrase.length) {
        mode = 'pause';
        _twTimer = setTimeout(tick, 2000);
        return;
      }
      _twTimer = setTimeout(tick, 45);
    } else if (mode === 'pause') {
      mode = 'erase';
      if (dots) dots.style.opacity = '0';
      _twTimer = setTimeout(tick, 200);
    } else {
      ci--;
      node.textContent = phrase.slice(0, Math.max(0, ci));
      if (ci <= 0) {
        pi = (pi + 1) % phrases.length;
        mode = 'type';
        _twTimer = setTimeout(tick, 300);
        return;
      }
      _twTimer = setTimeout(tick, 25);
    }
  };
  el.textContent = '';
  if (dots) {
    dots.textContent = '...';
    dots.style.opacity = '0';
    dots.classList.add('blink');
  }
  _twTimer = setTimeout(tick, 400);
}

function startLiveDemo() {
  if (_liveTimer) clearInterval(_liveTimer);
  const root = document.getElementById('live-demo');
  if (!root) return;
  const names = [
    ['María López · caja', 'pill-g', 'En jornada'],
    ['Diego Ruiz · depósito', 'pill-e', 'Extra'],
    ['Andrea Paz · atención', 'pill-x', 'Fuera'],
    ['Lucía Méndez · cocina', 'pill-g', 'En jornada'],
    ['Pablo Sosa · delivery', 'pill-x', 'Fuera'],
  ];
  let i = 0, hours = 164, extra = 2.5;
  _liveTimer = setInterval(() => {
    if (!document.getElementById('live-demo')) { clearInterval(_liveTimer); return; }
    i = (i + 1) % names.length;
    const rows = root.querySelectorAll('.live-row');
    if (rows[0]) {
      const [n, cls, st] = names[i];
      rows[0].innerHTML = '<span>' + n + '</span><span class="pill ' + cls + '">' + st + '</span>';
    }
    hours += Math.random() > 0.55 ? 0.5 : 0;
    extra = Math.round((extra + (Math.random() * 0.25 - 0.05)) * 10) / 10;
    const hn = root.querySelector('.live-num');
    const he = root.querySelector('.live-extra');
    const tickEl = root.querySelector('.live-ticker');
    if (hn) hn.textContent = Math.round(hours) + ' h';
    if (he) he.textContent = '+' + extra.toFixed(1).replace('.', ',') + ' h';
    if (tickEl) tickEl.textContent = 'hace ' + (1 + Math.floor(Math.random() * 5)) + ' min';
    const worked = root.querySelector('.live-worked');
    if (worked) {
      const totalM = 4 * 60 + 15 + Math.floor(Math.random() * 8);
      worked.textContent = Math.floor(totalM / 60) + ' h ' + (totalM % 60) + ' min';
    }
  }, 2800);
}

window.__savDays = 6;
function savRecalc() {
  const range = document.getElementById('sav-emp');
  const emp = Number(range?.value || 8);
  const days = window.__savDays || 6;
  const valEl = document.getElementById('sav-emp-val');
  if (valEl) valEl.textContent = String(emp);

  // Tiempo a mano crece fuerte con el equipo; con AsistOK crece poco
  const rows = [
    { old: Math.round(20 + emp * 2.2), neu: Math.round(4 + emp * 0.25) },
    { old: Math.round(18 + emp * 1.8), neu: Math.round(3 + emp * 0.18) },
    { old: Math.round(12 + emp * 1.3), neu: Math.round(2 + emp * 0.12) },
  ];
  const daySaved = rows.reduce((a, r) => a + Math.max(0, r.old - r.neu), 0);
  const monthMin = daySaved * days * 4.3;
  const monthH = Math.max(1, Math.round(monthMin / 60));
  const jornadas = Math.max(1, Math.round(monthH / 8));

  const h = document.getElementById('sav-h');
  if (h) h.textContent = String(monthH);
  const sub = document.getElementById('sav-sub');
  if (sub) sub.textContent = 'Son ' + jornadas + ' jornada' + (jornadas > 1 ? 's' : '') + ' de 8 horas para dedicarle a tu negocio.';

  const fmt = (m) => (m >= 60 ? (Math.floor(m / 60) + ' h ' + (m % 60) + ' min') : (m + ' min'));
  rows.forEach((r, i) => {
    const o = document.getElementById('sav-o' + (i + 1));
    const n = document.getElementById('sav-n' + (i + 1));
    if (o) o.textContent = fmt(r.old);
    if (n) n.textContent = fmt(r.neu);
  });
}

acts['sav-days'] = (el) => {
  window.__savDays = Number(el.dataset.d) || 6;
  document.querySelectorAll('.sav-days button').forEach((b) => b.classList.toggle('on', b === el));
  savRecalc();
};
acts['sav-recalc'] = () => savRecalc();

async function loadReviews() {
  const box = document.getElementById('reviews-grid');
  if (!box) return;
  try {
    const { reviews } = await get('/api/public/reviews');
    if (!reviews?.length) {
      box.innerHTML = '<p class="muted">Pronto vas a ver acá las valoraciones de negocios que usan AsistOK.</p>';
      return;
    }
    box.innerHTML = reviews.map((r) => {
      const stars = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
      const logo = r.logo_url
        ? '<img class="rev-logo" src="' + r.logo_url + '" alt="">'
        : '<div class="rev-logo rev-logo-ph"></div>';
      return '<div class="rev-card">' + logo +
        '<div class="rev-stars">' + stars + '</div>' +
        '<p class="rev-text">“' + (r.text || '').replace(/</g,'&lt;') + '”</p>' +
        '<div class="rev-meta"><strong>' + (r.business || '').replace(/</g,'&lt;') + '</strong>' +
        (r.author ? '<span class="muted"> · ' + String(r.author).replace(/</g,'&lt;') + '</span>' : '') +
        '</div></div>';
    }).join('');
  } catch {
    box.innerHTML = '';
  }
}



boot().catch((e) => render(html`<p style="padding:40px;text-align:center">${e.message}</p>`));

// Landing: precios y textos se refrescan solos (poll + al volver a la pestaña)
let landingCfgTimer = null;
function startLandingCfgPoll() {
  stopLandingCfgPoll();
  const tick = async () => {
    if (S.me || !document.querySelector('.ok-landing')) return stopLandingCfgPoll();
    try {
      const cfg = await get('/api/public/config');
      const key = (c) => JSON.stringify({ p: c?.prices, f: c?.free_employees, h: c?.hero, ct: c?.contact });
      if (key(S.cfg) === key(cfg)) return;
      const y = window.scrollY;
      S.cfg = cfg;
      await showAuth(undefined, { skipCfg: true });
      window.scrollTo(0, y);
    } catch {}
  };
  landingCfgTimer = setInterval(tick, 20000); // cada 20 s mientras la landing esté abierta
  // Primera pasada a los 5 s por si el admin cambió recién
  setTimeout(tick, 5000);
}
function stopLandingCfgPoll() {
  if (landingCfgTimer) { clearInterval(landingCfgTimer); landingCfgTimer = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (S.me) return;
  if (!document.querySelector('.ok-landing')) return;
  get('/api/public/config').then(async (cfg) => {
    const key = (c) => JSON.stringify({ p: c?.prices, f: c?.free_employees });
    if (key(S.cfg) === key(cfg)) return;
    const y = window.scrollY;
    S.cfg = cfg;
    await showAuth(undefined, { skipCfg: true });
    window.scrollTo(0, y);
  }).catch(() => {});
});


if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});


