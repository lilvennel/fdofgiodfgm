'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');
const { getSetting } = require('./db');
const dom = require('./domain');
const mp = require('./mp');

/** Avisos para Super Admin: critical = urgente, soft = informativo */
function collect() {
  const out = [];
  // SECRET
  if (cfg.SECRET_SOURCE === 'file') {
    out.push({ level: 'critical', text: 'SECRET está en archivo DATA_DIR/.secret. En producción debe estar en .env (32+ caracteres) y respaldado. Si lo perdés, no se descifran DNI/teléfonos/emails.' });
  } else if ((cfg.SECRET_ENV_LEN || 0) > 0 && cfg.SECRET_ENV_LEN < 32) {
    out.push({ level: 'critical', text: `SECRET es corto (${cfg.SECRET_ENV_LEN} caracteres; se recomiendan 32 o más). Generá uno con: openssl rand -hex 32` });
  }
  // Mail
  const from = String(cfg.MAIL_FROM || '');
  if (cfg.MAIL_CONFIGURED && from && (from.includes('localhost') || from.includes('example.com') || from.includes('tudominio'))) {
    out.push({ level: 'soft', text: 'MAIL_FROM parece de prueba. Usá un remitente del dominio verificado en Resend (ej. AsistOK <no-reply@tudominio.com>).' });
  }
  if (cfg.REQUIRE_EMAIL_VERIFICATION && !cfg.MAIL_CONFIGURED) {
    out.push({ level: 'critical', text: 'Verificación de email activa pero no hay RESEND_API_KEY: no se pueden confirmar cuentas ni recuperar contraseñas. Configurá Resend.' });
  }
  // MP
  if (cfg.STRICT && !mp.enabled() && !cfg.ALLOW_DEMO_PAYMENTS) {
    out.push({ level: 'critical', text: 'Sin MP_ACCESS_TOKEN y sin modo demo: los clientes no pueden pagar.' });
  }
  if (cfg.ALLOW_DEMO_PAYMENTS && cfg.STRICT) {
    out.push({ level: 'critical', text: 'ALLOW_DEMO_PAYMENTS=1 en un entorno que parece producción. Desactivalo para no simular cobros reales.' });
  }
  // Admin password still in env
  const marker = path.join(cfg.DATA_DIR, '.admin_bootstrapped');
  if (cfg.ADMIN_PASSWORD && fs.existsSync(marker)) {
    out.push({ level: 'soft', text: 'ADMIN_PASSWORD sigue en el .env después de crear el Super Admin. Borrá esa línea del .env y reiniciá (la cuenta ya existe en la base).' });
  }
  // Legal
  if (dom.legalIsPlaceholder()) {
    out.push({ level: 'soft', text: 'Los textos de Privacidad y Términos todavía tienen placeholders ([Razón Social], CUIT…). Completalos en Super Admin → Inicio web.' });
  }
  // APP_URL
  if (cfg.STRICT && /localhost|127\.0\.0\.1/i.test(String(cfg.APP_URL || ''))) {
    out.push({ level: 'critical', text: 'APP_URL apunta a localhost. Poné la URL pública https://tudominio.com' });
  }
  // Backups
  const last = getSetting('last_backup', null);
  if (cfg.STRICT && (!last || (Date.now() - (last.at || 0)) > 7 * 864e5)) {
    out.push({ level: 'soft', text: 'No hay backup reciente (más de 7 días o nunca). En Super Admin → Sistema tocá “Hacer backup ahora”.' });
  }
  out.push({ level: 'soft', text: 'Arquitectura: un solo servidor con SQLite. No copies la misma DATA_DIR en varios VPS a la vez.' });
  return out;
}

function list() {
  return collect();
}

/** Comprueba estado del Super Admin al arrancar (no lanza errores; solo registra). */
async function checkAdmin() {
  try {
    const { get } = require('./db');
    const sa = get("SELECT id,email FROM users WHERE role='superadmin' LIMIT 1");
    if (!sa) {
      console.warn('[!] No hay Super Admin en la base. Definí ADMIN_EMAIL y ADMIN_PASSWORD en .env y reiniciá.');
    }
  } catch (e) {
    console.warn('[warnings.checkAdmin]', e.message);
  }
}

function printBoot() {
  const items = collect();
  const crit = items.filter((x) => x.level === 'critical');
  const soft = items.filter((x) => x.level === 'soft');
  if (crit.length) {
    console.warn('[!!] Avisos críticos:');
    for (const c of crit) console.warn('    ·', c.text);
  }
  if (soft.length && !cfg.STRICT) {
    for (const s of soft.slice(0, 3)) console.log('[i]', s.text);
  } else if (soft.length) {
    for (const s of soft.slice(0, 5)) console.log('[i]', s.text);
  }
}

module.exports = { collect, list, checkAdmin, printBoot };
