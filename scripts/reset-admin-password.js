'use strict';
// Recuperación del Super Admin (si perdiste la contraseña o te quedaste sin acceso). Se corre EN EL SERVIDOR:
//   ADMIN_PASSWORD='una-clave-larga-y-unica' node scripts/reset-admin-password.js [email-del-admin]
// Con Docker:
//   docker compose exec -e ADMIN_PASSWORD='una-clave-larga-y-unica' asistok node scripts/reset-admin-password.js
// Cambia la contraseña, cierra todas sus sesiones y deja registro en la auditoría. Los bloqueos de login viven en memoria:
// reiniciar la app los borra.
const cfg = require('../lib/config');
const { get, run, audit } = require('../lib/db');
const sec = require('../lib/security');
const fc = require('../lib/fieldcrypto');

(async () => {
  const pw = process.env.ADMIN_PASSWORD || '';
  const problem = sec.adminPasswordProblem(pw);
  if (problem) { console.error(`ADMIN_PASSWORD ${problem}. Usá una de 12+ caracteres, única y que no sea de ejemplo.`); process.exit(1); }
  const email = String(process.argv[2] || cfg.ADMIN_EMAIL || '').trim().toLowerCase();
  // los emails se guardan cifrados: se busca por su hash, no por el texto
  const a = email
    ? get("SELECT * FROM users WHERE role='superadmin' AND email_hash=?", fc.emailHash(email))
    : get("SELECT * FROM users WHERE role='superadmin' ORDER BY id LIMIT 1");
  if (!a) { console.error('No encontré un Super Admin con ese email.'); process.exit(1); }
  run('UPDATE users SET pass_hash=?, must_change_pw=0, email_verified_at=COALESCE(email_verified_at,?) WHERE id=?', await sec.hashPassword(pw), Date.now(), a.id);
  sec.destroyUserSessions(a.id);
  audit(null, null, 'superadmin.pw_reset_cli');
  console.log(`Listo: se actualizó la contraseña del Super Admin (${fc.decryptEmail(a.email) || 'sin email'}) y se cerraron sus sesiones.`);
})();
