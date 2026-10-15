'use strict';
// Pantalla del local: links para mostrar el QR sin iniciar sesión (fija o de un solo uso para encargados) + ubicación desde Google Maps
const cfg = require('../lib/config');
const { route, bad, notFound, HttpError, cookie, rateLimit } = require('../lib/http');
const { get, all, run, audit } = require('../lib/db');
const sec = require('../lib/security');
const { haversine, validCoords } = require('../lib/geo');
const { resolveCoords } = require('../lib/gmaps');
const { intIn, clean } = require('./common');

const A = { auth: 'owner' };
const CLAIM_WINDOW = { shift: 12 * 3600e3, fixed: 24 * 3600e3 }; // si nadie abre el link a tiempo, vence
const MAX_ACTIVE = 20;
const logSec = (l, kind, detail) => run('INSERT INTO security_events(tenant_id,user_id,kind,detail,ts) VALUES(?,?,?,?,?)', l.tenant_id, null, kind, detail || null, Date.now());

function statusOf(l, now = Date.now()) {
  if (l.revoked_at) return 'revoked';
  if (!l.claimed_at) return l.claim_by < now ? 'expired' : 'pending';
  return l.expires_at && l.expires_at < now ? 'expired' : 'active';
}

// ---------- Dueño: crear, listar y cancelar links ----------
route('POST', '/api/owner/display-links', A, (ctx) => {
  const b = ctx.body, kind = b.kind === 'fixed' ? 'fixed' : b.kind === 'shift' ? 'shift' : null;
  if (!kind) throw bad('Elegí si es una pantalla fija o un link para encargado');
  const branch = get('SELECT * FROM branches WHERE id=? AND tenant_id=?', Number(b.branch_id), ctx.tenant.id);
  if (!branch) throw bad('Elegí una sucursal');
  const hours = kind === 'shift' ? intIn(b.hours ?? 8, 1, 16, 'Duración') : null;
  const live = all('SELECT * FROM display_links WHERE tenant_id=?', ctx.tenant.id).filter((l) => ['pending', 'active'].includes(statusOf(l))).length;
  if (live >= MAX_ACTIVE) throw bad(`Ya tenés ${MAX_ACTIVE} links activos. Cancelá alguno para crear otro.`);
  const token = sec.randomToken(32), now = Date.now();
  const r = run(`INSERT INTO display_links(tenant_id,branch_id,kind,label,token_hash,duration_ms,claim_by,require_gps,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ctx.tenant.id, branch.id, kind, clean(b.label, 60) || null, sec.sha(token), hours ? hours * 3600e3 : null, now + CLAIM_WINDOW[kind], b.require_gps === false ? 0 : 1, ctx.user.id, now);
  audit(ctx.user.id, ctx.tenant.id, 'display.created', { id: Number(r.lastInsertRowid), kind, branch: branch.id });
  return { id: Number(r.lastInsertRowid), url: `${cfg.APP_URL}/pantalla/${token}`, kind, hours, branch: branch.name, claim_hours: CLAIM_WINDOW[kind] / 3600e3 };
});
route('GET', '/api/owner/display-links', A, (ctx) => ({
  links: all(`SELECT l.*, b.name branch FROM display_links l LEFT JOIN branches b ON b.id=l.branch_id WHERE l.tenant_id=? AND (l.revoked_at IS NULL) ORDER BY l.id DESC LIMIT 40`, ctx.tenant.id)
    .map((l) => ({ id: l.id, kind: l.kind, label: l.label, branch: l.branch, status: statusOf(l), hours: l.duration_ms ? l.duration_ms / 3600e3 : null, require_gps: !!l.require_gps,
      created_at: l.created_at, claim_by: l.claim_by, claimed_at: l.claimed_at, expires_at: l.expires_at, last_seen_at: l.last_seen_at, last_dist: l.last_dist }))
    .filter((l) => l.status !== 'expired' || Date.now() - (l.expires_at || l.claim_by) < 2 * 864e5),
}));
route('DELETE', '/api/owner/display-links/:id', A, (ctx) => {
  const l = get('SELECT * FROM display_links WHERE id=? AND tenant_id=?', Number(ctx.params.id), ctx.tenant.id);
  if (!l) throw notFound();
  run('UPDATE display_links SET revoked_at=? WHERE id=?', Date.now(), l.id);
  audit(ctx.user.id, ctx.tenant.id, 'display.revoked', { id: l.id });
  return { ok: true };
});

// ---------- Pantalla (sin sesión): se autoriza con el link + el dispositivo que lo abrió primero ----------
const devCookie = (l) => `dsp-${l.id}`;
function loadLink(ctx, token, { needClaimed }) {
  rateLimit('disp:' + ctx.ip, 200, 5 * 60e3);
  const l = get('SELECT * FROM display_links WHERE token_hash=?', sec.sha(String(token || '')));
  if (!l) throw new HttpError(404, 'LINK_INVALID', 'Este link no es válido. Pedile al dueño uno nuevo.');
  if (l.revoked_at) throw new HttpError(403, 'LINK_REVOKED', 'El dueño canceló este link. Pedile uno nuevo si lo necesitás.');
  const tenant = get('SELECT * FROM tenants WHERE id=?', l.tenant_id);
  if (!tenant || tenant.status !== 'active') throw new HttpError(403, 'TENANT_INACTIVE', 'El negocio no está activo en este momento.');
  const now = Date.now();
  if (!l.claimed_at) {
    if (l.claim_by < now) throw new HttpError(410, 'LINK_EXPIRED', 'Este link venció sin usarse. Pedile al dueño uno nuevo.');
    if (needClaimed) throw new HttpError(409, 'NOT_OPENED', 'Abrí el link primero.');
    return { l, tenant, fresh: true };
  }
  if (l.expires_at && l.expires_at < now) throw new HttpError(410, 'LINK_EXPIRED', `La jornada de este link terminó (duraba ${Math.round(l.duration_ms / 3600e3)} horas). Pedile al dueño uno nuevo.`);
  const secret = ctx.cookies[devCookie(l)];
  if (!secret || sec.sha(secret) !== l.device_hash) {
    logSec(l, 'display_reuse', `${l.label || 'Link de pantalla'}: intento desde otro dispositivo`);
    throw new HttpError(403, 'LINK_USED', 'Este link ya se abrió en otro dispositivo y es de un solo uso. Pedile al dueño uno nuevo.');
  }
  return { l, tenant, fresh: false };
}

route('POST', '/api/display/open', (ctx) => {
  const { l, tenant, fresh } = loadLink(ctx, ctx.body.token, { needClaimed: false });
  const now = Date.now();
  if (fresh) { // primer dispositivo que lo abre: queda atado a él
    const secret = sec.randomToken(24), expires = l.kind === 'shift' ? now + l.duration_ms : null;
    run('UPDATE display_links SET claimed_at=?, expires_at=?, device_hash=? WHERE id=?', now, expires, sec.sha(secret), l.id);
    ctx.setCookie(cookie(devCookie(l), secret, { maxAge: l.kind === 'shift' ? Math.ceil(l.duration_ms / 1000) + 300 : 400 * 86400 }));
    audit(null, l.tenant_id, 'display.claimed', { id: l.id });
    l.expires_at = expires; l.claimed_at = now;
  }
  const b = get('SELECT * FROM branches WHERE id=?', l.branch_id);
  return { tenant: tenant.name, branch: b?.name || '', kind: l.kind, label: l.label, expires_at: l.expires_at, require_gps: !!l.require_gps, radius: b?.radius, theme: tenant.theme };
});

route('POST', '/api/display/qr', (ctx) => {
  const { l, tenant } = loadLink(ctx, ctx.body.token, { needClaimed: true });
  const b = get('SELECT * FROM branches WHERE id=? AND tenant_id=?', l.branch_id, l.tenant_id);
  if (!b) throw notFound('La sucursal de este link ya no existe. Pedile al dueño uno nuevo.');
  let dist = null;
  if (l.require_gps) {
    if (b.lat == null || b.lng == null) throw new HttpError(409, 'NO_BRANCH_GEO', 'El dueño todavía no cargó la ubicación del local. Pedile que la configure en Panel → QR.');
    const lat = Number(ctx.body.lat), lng = Number(ctx.body.lng), acc = Number(ctx.body.accuracy) || 0;
    if (!validCoords(lat, lng)) {
      logSec(l, 'display_gps', `${l.label || 'Pantalla'}: sin GPS`);
      throw new HttpError(400, 'GEO_REQUIRED', 'Activá el GPS de este dispositivo y permití la ubicación para mostrar el QR.');
    }
    dist = Math.round(haversine(lat, lng, b.lat, b.lng));
    if (dist > b.radius + Math.min(acc, 50) + 20) {
      logSec(l, 'display_geo_out', `${l.label || 'Pantalla'}: a ${dist} m de ${b.name}`);
      throw new HttpError(403, 'GEO_OUT', `Este dispositivo está a ${dist} m del local y el máximo es ${b.radius} m. Llevalo al local y volvé a abrir esta pantalla.`, { dist });
    }
  }
  run('UPDATE display_links SET last_seen_at=?, last_dist=? WHERE id=?', Date.now(), dist, l.id);
  return {
    url: `${cfg.APP_URL}/m/${b.id}.${sec.qrToken(b.id, l.tenant_id)}`, refresh_in: sec.QR_WINDOW_MS - (Date.now() % sec.QR_WINDOW_MS),
    branch: b.name, tenant: tenant.name, dist, expires_at: l.expires_at, geofence: !!l.require_gps,
  };
});

// ---------- Ubicación del local desde Google Maps ----------
route('POST', '/api/owner/geo/parse', A, async (ctx) => {
  rateLimit('geoparse:' + ctx.user.id, 30, 10 * 60e3);
  const text = clean(ctx.body.text, 600);
  if (!text) throw bad('Pegá el link de Google Maps de tu local o las coordenadas.');
  let c;
  try { c = await resolveCoords(text); }
  catch (e) {
    if (e.code === 'BAD_HOST') throw bad('Ese link no es de Google Maps. En Google Maps abrí tu local → Compartir → Copiar vínculo, y pegalo acá.');
    throw new HttpError(502, 'MAPS_UNREACHABLE', 'No pudimos abrir ese link. Probá con el link largo (el de la barra de direcciones del navegador) o pegá las coordenadas, por ejemplo -33.2394, -61.6108.');
  }
  if (!c) throw bad('No encontramos coordenadas en ese texto. Pegá el link de Google Maps (Compartir → Copiar vínculo) o las coordenadas como -33.2394, -61.6108.');
  return { lat: c.lat, lng: c.lng, maps_url: `https://www.google.com/maps?q=${c.lat},${c.lng}` };
});
module.exports = { statusOf };
