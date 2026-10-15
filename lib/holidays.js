'use strict';
// Feriados argentinos: se calculan solos por ley (Ley 27.399) y se pueden contrastar con una fuente online.
const cfg = require('./config');
const { get, all, run, getSetting, setSetting } = require('./db');

// Domingo de Pascua (algoritmo gregoriano anónimo)
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (t, n) => t + n * 864e5;

// Feriados con fecha puesta por el calendario oficial para días puente (decretados año a año).
const DECRETED_BRIDGES = { 2026: ['2026-03-23', '2026-07-10', '2026-12-07'] };

function computeHolidays(y) {
  const out = [], seen = new Set();
  const add = (date, name, kind = 'feriado') => { if (!seen.has(date)) { seen.add(date); out.push({ date, name, kind }); } };
  const fixed = [['01-01', 'Año Nuevo'], ['03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia'], ['04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas'],
    ['05-01', 'Día del Trabajador'], ['05-25', 'Día de la Revolución de Mayo'], ['06-20', 'Paso a la Inmortalidad del General Belgrano (Día de la Bandera)'],
    ['07-09', 'Día de la Independencia'], ['12-08', 'Inmaculada Concepción de María'], ['12-25', 'Navidad']];
  const pascua = easter(y);
  const movable = [['06-17', 'Paso a la Inmortalidad del General Güemes'], ['08-17', 'Paso a la Inmortalidad del General San Martín'], ['10-12', 'Día del Respeto a la Diversidad Cultural'], ['11-20', 'Día de la Soberanía Nacional']];
  // Trasladables: martes/miércoles -> lunes anterior; jueves/viernes -> lunes siguiente
  const moved = movable.map(([md, name]) => {
    const t = Date.UTC(y, +md.slice(0, 2) - 1, +md.slice(3)), dow = new Date(t).getUTCDay();
    return [iso(dow === 2 || dow === 3 ? addDays(t, -(dow - 1)) : dow === 4 || dow === 5 ? addDays(t, 8 - dow) : t), name + (dow >= 2 && dow <= 5 ? ' (trasladado)' : '')];
  });
  for (const [md, n] of fixed) add(`${y}-${md}`, n);
  add(iso(addDays(pascua, -48)), 'Carnaval'); add(iso(addDays(pascua, -47)), 'Carnaval');
  add(iso(addDays(pascua, -2)), 'Viernes Santo');
  for (const [d, n] of moved) add(d, n);
  add(iso(addDays(pascua, -3)), 'Jueves Santo (día no laborable)', 'no_laborable');
  for (const d of DECRETED_BRIDGES[y] || []) add(d, 'Día no laborable con fines turísticos', 'no_laborable');
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const removed = () => new Set(getSetting('hol_removed', []));
function insertRows(rows, source, { overwrite = false } = {}) {
  const rem = removed(); let n = 0;
  for (const r of rows) {
    if (rem.has(r.date)) continue;
    const cur = get('SELECT source FROM holidays WHERE date=?', r.date);
    if (cur && (cur.source === 'manual' || !overwrite)) continue;
    run('INSERT INTO holidays(date,name,kind,source) VALUES(?,?,?,?) ON CONFLICT(date) DO UPDATE SET name=excluded.name, kind=excluded.kind, source=excluded.source', r.date, r.name, r.kind, source);
    n++;
  }
  return n;
}
const generated = new Set();
function ensureYear(y) {
  if (generated.has(y)) return;
  const done = getSetting('hol_years', []);
  if (!done.includes(y)) { insertRows(computeHolidays(y), 'auto'); setSetting('hol_years', [...done, y]); }
  generated.add(y);
}
function ensureYears(from, to) { for (let y = from; y <= to; y++) ensureYear(y); }

// Recalcula el año desde la ley (descarta lo automático/online de ese año; respeta lo cargado a mano)
function regenerate(y) {
  run("DELETE FROM holidays WHERE substr(date,1,4)=? AND source!='manual'", String(y));
  setSetting('hol_removed', [...removed()].filter((d) => !d.startsWith(String(y))));
  const n = insertRows(computeHolidays(y), 'auto');
  const done = getSetting('hol_years', []); if (!done.includes(y)) setSetting('hol_years', [...done, y]);
  generated.add(y);
  return n;
}

// Contrasta con la fuente online. No pisa lo cargado a mano.
async function syncFromApi(y) {
  const res = await fetch(`${cfg.HOLIDAYS_API_URL}/${y}`, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`La fuente respondió ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('La fuente no devolvió feriados');
  const rows = data.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.fecha || x.date || '')).map((x) => {
    const tipo = String(x.tipo || x.type || '').toLowerCase();
    return { date: x.fecha || x.date, name: String(x.nombre || x.name || 'Feriado').slice(0, 80), kind: /puente|laborable/.test(tipo) ? 'no_laborable' : 'feriado' };
  }).filter((r) => r.date.startsWith(String(y)));
  ensureYear(y);
  const n = insertRows(rows, 'api', { overwrite: true });
  setSetting('hol_last_sync', { at: Date.now(), year: y, ok: true, count: n });
  return n;
}
async function autoSync() {
  if (getSetting('hol_auto_sync', true) === false) return;
  const y = new Date().getUTCFullYear();
  for (const year of [y, y + 1]) {
    try { await syncFromApi(year); } catch (e) { setSetting('hol_last_sync', { at: Date.now(), year, ok: false, error: e.message }); }
  }
}
const markRemoved = (date) => setSetting('hol_removed', [...new Set([...removed(), date])]);
const unmarkRemoved = (date) => setSetting('hol_removed', [...removed()].filter((d) => d !== date));

module.exports = { computeHolidays, ensureYear, ensureYears, regenerate, syncFromApi, autoSync, markRemoved, unmarkRemoved, easter };
