'use strict';
// Toma las coordenadas de un link de Google Maps (largo o corto) o de un texto "lat, lng".
const { validCoords } = require('./geo');
const N = '(-?\\d{1,3}(?:\\.\\d+)?)';
const PATTERNS = [
  new RegExp(`!3d${N}!4d${N}`),                                   // pin exacto del lugar (el más preciso)
  new RegExp(`[?&](?:q|ll|query|destination|center)=(?:loc:)?\\+?${N}[,+ ]\\s*${N}`), // ?q=lat,lng
  new RegExp(`@${N},${N}`),                                       // centro del mapa en pantalla
  new RegExp(`^\\(?${N}\\s*[,; ]\\s*${N}\\)?$`),                  // "lat, lng" pegado a mano
];
function parseCoords(input) {
  let t = String(input || '').trim();
  try { t = decodeURIComponent(t); } catch { /* se usa tal cual */ }
  for (const re of PATTERNS) {
    const m = re.exec(t);
    if (m && validCoords(+m[1], +m[2]) && !(+m[1] === 0 && +m[2] === 0)) return { lat: +m[1], lng: +m[2] };
  }
  return null;
}

// Solo se siguen links de Google (evita que el servidor sea usado para consultar cualquier sitio)
const ALLOWED = new Set(['maps.app.goo.gl', 'goo.gl', 'google.com', 'www.google.com', 'maps.google.com', 'google.com.ar', 'www.google.com.ar']);
const hostOk = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && ALLOWED.has(x.hostname); } catch { return false; } };

async function resolveCoords(input, fetchImpl = fetch) {
  const direct = parseCoords(input);
  if (direct) return direct;
  const m = /https?:\/\/[^\s]+/.exec(String(input || ''));
  if (!m) return null;
  let url = m[0];
  if (!hostOk(url)) throw Object.assign(new Error('Host no permitido'), { code: 'BAD_HOST' });
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Asist OK/3)', 'Accept-Language': 'es-AR' } });
    const loc = res.headers.get('location');
    if (loc) {
      const next = new URL(loc, url).href;
      const c = parseCoords(next);
      if (c) return c;
      if (!hostOk(next)) throw Object.assign(new Error('Redirección a un sitio no permitido'), { code: 'BAD_HOST' });
      url = next; continue;
    }
    const body = (await res.text()).slice(0, 400000);
    return parseCoords(body.match(/!3d-?\d+(?:\.\d+)?!4d-?\d+(?:\.\d+)?/)?.[0] || '') || parseCoords(body.match(/[?&]center=[^&"']+/)?.[0] || '') || parseCoords(body.match(/@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/)?.[0] || '');
  }
  return null;
}
module.exports = { parseCoords, resolveCoords, hostOk };
