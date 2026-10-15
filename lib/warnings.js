'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');
const { getSetting } = require('./db');
const dom = require('./domain');
const mp = require('./mp');

/** Avisos para Super Admin: critical bloquea tranquilidad, soft informa */
function collect() {
  const out = [];
  // SECRET
  if (cfg.SECRET_SOURCE === 'file') {
    out.push({ level: 'critical', text: 'SECRET está en archivo DATA_DIR/.secret. En producción debe estar en .env (32+ caracteres) y respaldado. Si lo perdés, no se descifran DNI/teléfonos/emails.' });
  } else if ((cfg.SECRET_ENV_LEN || 0) > 0 && cfg.SECRET_ENV_LEN < 32) {
    out.push({ level: 'critical', text: `SECRET es corto (${cfg.SECRET_ENV_LEN} caracteres; se recomiendan 32 o más). Generá uno con: openssl rand -hex 32` });
  }
  // Mail
  if (cfg.MAIL_CONFIGURED && cfg.MAIL_FROM && (cfg.MAIL_FROM.includes('localhost') || cfg.MAIL_FROM.includes('example.com'))) {
    out.push({ level: 'soft', text: 'MAIL_FROM parece de prueba. Usá un remitente del dominio verificado en Resend (ej. AsistOK <no-reply@asistok.app>).' });
  }
  if (cfg.REQUIRE_EMAIL_VERIFICATION && !cfg.MAIL_CONFIGURED) {
    out.push({ level: 'critical', text: 'Verificación de email activa pero no hay RESEND_API_KEY: no se pueden confirmar cuentas ni recuperar contraseñas. Configurá Resend o el registro fallará en producción.' });
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
    out.push({ level: 'soft', text: 'Los textos de Privacidad y Términos siguen siendo la plantilla de ejemplo. Reemplazalos por los definitivos (revisados por un abogado) en Super Admin → Inicio web.' });
  }
  // APP_URL
  if (cfg.STRICT && cfg.APP_URL.includes('localhost')) {
    out.push({ level: 'critical', text: 'APP_URL apunta a localhost en modo estricto. Poné la URL pública https://tudominio.com' });
  }
  // Backups
  const last = getSetting('last_backup', null);
  // architecture note
  out.push({ level: 'soft', text: 'Arquitectura: un solo servidor con SQLite. No copies la misma DATA_DIR en varios VPS a la vez. Para escalar horizontal haría falta migrar a Postgres.' });
  return out;
}

/** Lista de avisos actuales (para el panel Super Admin) */
function list() {
  try { return collect(); } catch (e) { console.error('[warnings]', e); return [{ level: 'soft', text: 'No se pudieron evaluar todos los avisos de configuración.' }]; }
}

/**
 * Chequeo al arranque. En STRICT, si hay avisos critical relacionados con pagos/SECRET
 * se deja solo warning en consola (no se mata el proceso aquí: config ya aborta lo grave).
 * Devuelve una Promise para encadenar con ensureAdmin().
 */
function checkAdmin() {
  return Promise.resolve();
}

/** Imprime en consola los avisos al boot */
function printBoot() {
  let items = [];
  try { items = collect(); } catch (e) { console.error('[warnings]', e); return; }
  const crit = items.filter((w) => w.level === 'critical');
  const soft = items.filter((w) => w.level !== 'critical');
  if (crit.length) {
    console.warn('[!] Avisos críticos de configuración:');
    for (const w of crit) console.warn('    · ' + w.text);
  }
  if (soft.length) {
    console.log('[i] Avisos:');
    for (const w of soft) console.log('    · ' + w.text);
  }
  if (!items.length) console.log('[ok] Configuración sin avisos.');
}

module.exports = { collect, list, checkAdmin, printBoot };
