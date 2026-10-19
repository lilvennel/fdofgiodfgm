'use strict';
// Crea el archivo .env a partir de .env.example con una SECRET y una contraseña de Super Admin aleatorias y seguras.
//   node scripts/gen-env.js https://tudominio.com admin@tudominio.com
// No pisa un .env existente. Imprime la contraseña UNA vez: guardala en un gestor de contraseñas.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const target = path.join(root, '.env');
if (fs.existsSync(target)) { console.error('Ya existe .env: no se modifica. Borralo o renombralo si querés generar uno nuevo.'); process.exit(1); }
const appUrl = (process.argv[2] || '').replace(/\/+$/, '');
const email = process.argv[3] || '';
if (!/^https:\/\/[^/\s]+$/.test(appUrl) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Uso: node scripts/gen-env.js https://tudominio.com admin@tudominio.com');
  process.exit(1);
}
const secret = crypto.randomBytes(32).toString('hex');
const adminPw = crypto.randomBytes(18).toString('base64url');
let txt = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const set = (k, v) => { txt = txt.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`); };
set('APP_URL', appUrl); set('SECRET', secret); set('ADMIN_EMAIL', email); set('ADMIN_PASSWORD', adminPw);
fs.writeFileSync(target, txt, { mode: 0o600 });
console.log('.env creado (permisos 600).');
console.log(`Super Admin: ${email}\nContraseña inicial: ${adminPw}\n`);
console.log('1) Guardá la contraseña y el valor de SECRET en un gestor de contraseñas (sin SECRET no se pueden descifrar los datos personales).');
console.log('2) Completá RESEND_API_KEY y las credenciales de Mercado Pago cuando las tengas.');
console.log('3) Después del primer arranque BORRÁ la línea ADMIN_PASSWORD del .env.');
