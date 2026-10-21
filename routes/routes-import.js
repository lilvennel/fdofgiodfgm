'use strict';
// C3: importación de empleados por CSV
const { route, bad, HttpError } = require('../lib/http');
const { get, all, run, tx, audit } = require('../lib/db');
const sec = require('../lib/security');
const dom = require('../lib/domain');
const crypto = require('node:crypto');
const { clean, emailOk, hhmmOk, isoDateOk } = require('./common');

const A = { auth: 'owner' };
const MAX_ROWS = 200;
const strip = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const ALIASES = { name: ['nombre', 'nombre y apellido', 'apellido y nombre', 'name', 'empleado'], email: ['email', 'mail', 'correo', 'e-mail'], cargo: ['cargo', 'puesto', 'rol'],
  branch: ['sucursal', 'local', 'sede'], shift: ['entrada', 'turno', 'horario', 'hora de entrada'], hire: ['ingreso', 'fecha de ingreso', 'alta', 'fecha de alta'] };

// Parser CSV simple: comillas, comas / punto y coma / tab, saltos de línea CRLF
function parseCsv(text) {
  text = String(text || '').replace(/^\ufeff/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [';', ',', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
function normDate(s) {
  s = String(s || '').trim(); if (!s) return null;
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
  const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s;
  return isoDateOk(iso) ? iso : false;
}

function csvEscape(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita inyección de fórmulas en Excel
  if (/[;"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Plantilla vacía (solo encabezados). ?examples=1 agrega 2 filas de ejemplo.
route('GET', '/api/owner/employees/import-template', A, (ctx) => {
  let body = '\ufeffnombre;email;cargo;sucursal;entrada;ingreso\r\n';
  if (String(ctx.query.examples || '') === '1') {
    body += 'Juan Pérez;juan@ejemplo.com;Cajero;Casa Central;09:00;15/03/2024\r\n';
    body += 'María Gómez;maria@ejemplo.com;Encargada;Casa Central;08:30;01/11/2023\r\n';
  }
  return { __file: { buf: Buffer.from(body), filename: 'plantilla-empleados.csv', mime: 'text/csv; charset=utf-8' } };
});

// Exportar empleados actuales del negocio (misma estructura que la plantilla)
route('GET', '/api/owner/employees/export-csv', A, (ctx) => {
  const fc = require('../lib/fieldcrypto');
  const rows = all(
    `SELECT u.name, u.email, u.cargo, u.shift_start, u.hire_date, b.name AS branch_name, u.role, u.status
     FROM users u LEFT JOIN branches b ON b.id=u.branch_id
     WHERE u.tenant_id=? AND u.role IN ('employee','manager','hr','accountant','manager_ext','hr_ext','accountant_ext')
     ORDER BY u.name COLLATE NOCASE`,
    ctx.tenant.id
  );
  const header = 'nombre;email;cargo;sucursal;entrada;ingreso;rol;estado';
  const lines = [header];
  for (const u of rows) {
    const d = fc.decryptUserFields(u);
    const email = fc.decryptEmail(u.email) || '';
    const hire = d.hire_date || u.hire_date || '';
    let hireOut = hire;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(hire))) {
      const [y, m, day] = String(hire).split('-');
      hireOut = `${day}/${m}/${y}`;
    }
    lines.push([
      csvEscape(d.name || u.name || ''),
      csvEscape(email),
      csvEscape(u.cargo || ''),
      csvEscape(u.branch_name || ''),
      csvEscape(u.shift_start || ''),
      csvEscape(hireOut),
      csvEscape(u.role || 'employee'),
      csvEscape(u.status || ''),
    ].join(';'));
  }
  const slug = String(ctx.tenant.slug || 'negocio').slice(0, 40);
  return {
    __file: {
      buf: Buffer.from('\ufeff' + lines.join('\r\n') + (lines.length > 1 ? '\r\n' : '')),
      filename: `empleados-${slug}.csv`,
      mime: 'text/csv; charset=utf-8',
    },
  };
});

route('POST', '/api/owner/employees/import', { auth: 'owner', limit: 1024 * 1024 }, async (ctx) => {
  const t = ctx.tenant, asPending = ctx.body.as_pending === true;
  const rows = parseCsv(ctx.body.csv);
  if (rows.length < 2) throw bad('El archivo está vacío o le falta la fila de títulos. Descargá la plantilla y completala.');
  if (rows.length - 1 > MAX_ROWS) throw bad(`Máximo ${MAX_ROWS} empleados por archivo. Dividilo en partes.`);
  const header = rows[0].map(strip), col = {};
  for (const [k, names] of Object.entries(ALIASES)) col[k] = header.findIndex((h) => names.includes(h));
  if (col.name < 0 || col.email < 0) throw bad('Faltan las columnas "nombre" y "email". Usá la plantilla.');
  const branches = all('SELECT id,name FROM branches WHERE tenant_id=? ORDER BY id', t.id);
  const limit = dom.employeeLimit(t);
  let room = asPending ? Infinity : limit - dom.employeeCount(t.id);
  const seen = new Set(), errors = [], ok = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2, cell = (k) => (col[k] >= 0 ? clean(r[col[k]], 120) : '');
    const name = cell('name'), email = cell('email').toLowerCase();
    const err = (message) => errors.push({ line, name: name || email || '(vacía)', message });
    if (name.length < 2) return err('Falta el nombre (mínimo 2 letras).');
    if (!emailOk(email)) return err(`El email "${email}" no es válido.`);
    if (seen.has(email)) return err('Email repetido en el archivo.');
    if (require('../lib/security').findUserByEmail(email)) return err('Ese email ya tiene una cuenta.');
    const shift = cell('shift') ? cell('shift').padStart(5, '0') : null;
    if (shift && !hhmmOk(shift)) return err(`La entrada "${cell('shift')}" no es una hora válida (usá HH:MM).`);
    const hire = normDate(cell('hire'));
    if (hire === false) return err(`La fecha de ingreso "${cell('hire')}" no es válida (usá AAAA-MM-DD o DD/MM/AAAA).`);
    const bn = strip(cell('branch')), branch = branches.find((b) => strip(b.name) === bn) || (bn ? null : branches[0]);
    if (!branch) return err(`La sucursal "${cell('branch')}" no existe. Las tuyas: ${branches.map((b) => b.name).join(', ')}.`);
    if (room <= 0) return err(`Sin cupo: llegaste al límite de ${limit} empleados. Sumá empleados extra o importá como pendientes.`);
    seen.add(email); room--;
    ok.push({ line, name, email, cargo: cell('cargo') || null, branch: branch.id, shift, hire: hire || new Date().toISOString().slice(0, 10) });
  });
  const pw = ok.map(() => crypto.randomBytes(6).toString('base64url'));
  const hashes = await Promise.all(pw.map((p) => sec.hashPassword(p)));
  tx(() => ok.forEach((e, i) => { const pk = require('../lib/security').packEmail(e.email); run(`INSERT INTO users(tenant_id,email,email_hash,name,pass_hash,role,status,must_change_pw,cargo,branch_id,shift_start,hire_date,created_at) VALUES(?,?,?,?,?,'employee',?,1,?,?,?,?,?)`,
    t.id, pk.email, pk.email_hash, e.name, hashes[i], asPending ? 'pending' : 'active', e.cargo, e.branch, e.shift, e.hire, Date.now()); }));
  audit(ctx.user.id, t.id, 'employees.imported', { created: ok.length, errors: errors.length, as_pending: asPending });
  return { total: rows.length - 1, created: ok.map((e, i) => ({ line: e.line, name: e.name, email: e.email, temp_password: pw[i], status: asPending ? 'pending' : 'active' })), errors };
});
module.exports = { parseCsv };
