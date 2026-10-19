# Guía de despliegue (AsistOK 3.1.11)

Requisitos: Node.js 22.13+ (o Docker), **disco persistente**, dominio con HTTPS. Sin `npm install`.

## 0. Antes de publicar (todas las opciones)

1. **Generá el `.env`** (crea SECRET y contraseña de Super Admin aleatorias, permisos 600):
   `node scripts/gen-env.js https://tudominio.com admin@tudominio.com`
2. **Guardá `SECRET` en un gestor de contraseñas.** Sin ese valor no se pueden descifrar DNI, teléfonos, emails ni datos de salud. **No lo cambies** una vez que haya datos.
3. Completá `RESEND_API_KEY` y `MAIL_FROM` (obligatorio: sin mails nadie confirma su cuenta ni recupera contraseña).
4. Cuando tengas Mercado Pago: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, y `ALLOW_DEMO_PAYMENTS=0` (ver README §3; webhook `https://tudominio.com/api/mp/webhook`).
5. Después del primer arranque **borrá `ADMIN_PASSWORD` del `.env`**.
6. En Super Admin → Inicio web: razón social, CUIT, domicilio y WhatsApp reales (los textos legales deben revisarse con un abogado).
7. Nunca subas el `.env` ni la carpeta de datos a GitHub (hay `.gitignore`/`.dockerignore`).

## A) VPS con Docker + nginx (recomendado)

```bash
git clone <tu repo> /opt/asistok && cd /opt/asistok
node scripts/gen-env.js https://tudominio.com admin@tudominio.com   # o copiá .env.example
docker compose up -d --build
# nginx + HTTPS
cp docs/nginx.conf.example /etc/nginx/sites-available/asistok   # editá el dominio
ln -s /etc/nginx/sites-available/asistok /etc/nginx/sites-enabled/ && certbot --nginx -d tudominio.com
```
Datos en el volumen `asistok-data` (`docker compose cp asistok:/data ./copia`). Firewall: abrí solo 80/443.

## B) VPS sin Docker (systemd)
Seguí los comentarios de `docs/asistok.service.example` (usuario dedicado, `DATA_DIR=/var/lib/asistok`, `HOST=127.0.0.1`) y `docs/nginx.conf.example`.

## C) Railway / Render
- Servicio desde el repo (usa el `Dockerfile`). Volumen persistente montado en **`/data`**.
- Variables: todas las del `.env.example` (`APP_URL` = tu dominio final con https, `TRUST_PROXY=1`, `DATA_DIR=/data`).
- **Railway**: agregá `RAILWAY_RUN_UID=0`. Healthcheck: `/healthz`.
- Una sola instancia (SQLite): no escales a 2 réplicas.

## Verificación posterior
- `https://tudominio.com/healthz` → `{"ok":true}`; Super Admin → Inicio: sin avisos críticos.
- Registrá un negocio de prueba, confirmá el email, hacé un pago real chico, marcá desde un celular (HTTPS obligatorio por el GPS).
- Super Admin → Sistema → "Hacer backup ahora" y copiá el `.db` fuera del servidor; probá restaurarlo en otra máquina.

## Recuperar el Super Admin
`ADMIN_PASSWORD='clave-larga-nueva' node scripts/reset-admin-password.js` (Docker: `docker compose exec -e ADMIN_PASSWORD='...' asistok node scripts/reset-admin-password.js`).
