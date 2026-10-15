'use strict';
// Todo el cálculo se hace en hora de Argentina (UTC-3, sin horario de verano).
const AR_OFFSET = -3 * 3600e3;

const arParts = (ts) => {
  const d = new Date(ts + AR_OFFSET);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes(), dow: d.getUTCDay() };
};
const arToTs = (y, m, d, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh, mm) - AR_OFFSET;
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (ts) => { const p = arParts(ts); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
const currentPeriod = (now = Date.now()) => { const p = arParts(now); return `${p.y}-${pad(p.m)}`; };

function periodRange(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period || '');
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12) return null;
  return { from: arToTs(y, mo, 1), to: arToTs(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1), y, m: mo };
}

// Días hábiles del mes (L-V) y sábados, descontando feriados (kind='feriado').
// holidays: Set de 'YYYY-MM-DD'
function workingDays(period, holidays) {
  const r = periodRange(period);
  const last = new Date(Date.UTC(r.y, r.m, 0)).getUTCDate();
  let weekdays = 0, saturdays = 0;
  for (let d = 1; d <= last; d++) {
    const dow = new Date(Date.UTC(r.y, r.m - 1, d)).getUTCDay();
    const iso = `${r.y}-${pad(r.m)}-${pad(d)}`;
    if (holidays.has(iso)) continue;
    if (dow >= 1 && dow <= 5) weekdays++;
    else if (dow === 6) saturdays++;
  }
  return { weekdays, saturdays };
}
function expectedHours(period, t, holidays) {
  const { weekdays, saturdays } = workingDays(period, holidays);
  return weekdays * t.hpd + (t.dpw === 6 ? saturdays * t.sat_h : 0);
}

// Convierte marcas en intervalos [start,end,extra]. Un intervalo abierto termina en `now`.
function intervals(marks, now = Date.now()) {
  const out = [];
  let open = null;
  for (const m of marks) {
    if (m.kind === 'in' || m.kind === 'xin') {
      if (open) out.push({ start: open.ts, end: m.ts, extra: open.kind === 'xin' });
      open = m;
    } else if (open) {
      out.push({ start: open.ts, end: m.ts, extra: open.kind === 'xin' });
      open = null;
    }
  }
  if (open) out.push({ start: open.ts, end: Math.max(now, open.ts), extra: open.kind === 'xin', open: true });
  return out;
}

function summarize(marks, from, to, now = Date.now()) {
  let normal = 0, extra = 0, open = null;
  for (const iv of intervals(marks, now)) {
    const s = Math.max(iv.start, from), e = Math.min(iv.end, to);
    if (e > s) (iv.extra ? (extra += e - s) : (normal += e - s));
    if (iv.open) open = { since: iv.start, extra: iv.extra };
  }
  return { normal_h: round2(normal / 3.6e6), extra_h: round2(extra / 3.6e6), open };
}
const round2 = (n) => Math.round(n * 100) / 100;

// Primer instante con HH:00 posterior a ts (hora AR)
function nextHourAfter(ts, hour) {
  const p = arParts(ts);
  let t = arToTs(p.y, p.m, p.d, hour, 0);
  if (t <= ts) t += 864e5;
  return t;
}

// Vacaciones LCT art. 150: 14 / 21 / 28 / 35 días corridos según antigüedad.
// Antigüedad < 6 meses: 1 día cada 20 de trabajo efectivo (aprox. por calendario).
function vacationDays(hireDate, now = Date.now()) {
  if (!hireDate) return { years: 0, days: 14, approx: true };
  const hd = new Date(hireDate + 'T00:00:00Z').getTime();
  const years = Math.max(0, (now - hd) / (365.25 * 864e5));
  if (years < 0.5) return { years, days: Math.floor(((now - hd) / 864e5) / 20), approx: true };
  if (years <= 5) return { years, days: 14 };
  if (years <= 10) return { years, days: 21 };
  if (years <= 20) return { years, days: 28 };
  return { years, days: 35 };
}
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5) + 1;

module.exports = {
  AR_OFFSET, arParts, arToTs, isoDate, currentPeriod, periodRange, workingDays, expectedHours,
  intervals, summarize, nextHourAfter, vacationDays, daysBetween, round2, pad,
};
