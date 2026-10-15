# Asist OK 3.1 (ex Asist OK 3.0)

Sistema SaaS de control de asistencia para negocios argentinos: **QR dinámico + geolocalización**, horas y extras con feriados, permisos y vacaciones (LCT), certificados, recibos con firma, multi-sucursal, reportes y cobro con **Mercado Pago**. Multi-negocio: cada cliente ve solo lo suyo.

- **Sin dependencias**: Node.js 22.13+ y nada más (no hay `npm install`). Base de datos SQLite incluida.
- Un solo proceso sirve la web y la API.

## 1. Probarlo en tu PC (2 minutos)

```bash
cp .env.example .env        # editá ADMIN_EMAIL y ADMIN_PASSWORD; dejá ALLOW_DEMO_PAYMENTS=1 para probar sin Mercado Pago
node server.js              # abrí http://localhost:3000
npm test                    # 54 tests de integración
```
Entrá con el email/contraseña de `ADMIN_*` para ver el Super Admin. Para ver el flujo del cliente: **Registrarse** → pago de prueba → panel.

> Para probar la marcación desde el celular necesitás HTTPS (los navegadores bloquean el GPS en HTTP). Usá el dominio ya publicado o un túnel (p. ej. Cloudflare Tunnel).

## 1b. Primer cliente de prueba en 10 minutos

1. `node server.js` con `ALLOW_DEMO_PAYMENTS=1` y abrí `http://localhost:3000` (o tu dominio con HTTPS si vas a usar el celular).
2. **Registrate** como negocio ("Mi Negocio de prueba") con el cupón `BIENVENIDA20` y tocá *Pagar (modo prueba)* → *Pagar ahora*.
3. En el panel, seguí **Primeros pasos**: en la pestaña **Local** parate donde estás y tocá *Usar mi ubicación actual* (o pegá el link de Google Maps) → *Guardar*.
4. En **Empleados** tocá *+ Agregar* (o *Importar CSV*) y anotá la contraseña temporal que muestra.
5. Con el celular entrá a la misma web con el empleado, cambiá la clave temporal y tocá **Marcar asistencia → Entrada**. No hace falta escanear ningún QR.
6. Volvé al panel del dueño: el empleado aparece **En jornada** en *Inicio*. Tocá **Salida** desde el celular y mirá las horas del mes.

Para recorrer todo el producto: `docs/CHECKLIST.md`.

## 2. Publicarlo (elegí una opción)

Requisito del hosting: **Node.js 22.13 o superior** y **disco persistente** (ahí viven la base y los archivos). El hosting compartido "solo PHP" no sirve.

**A) VPS (DonWeb, Hostinger VPS, DigitalOcean, etc.) – recomendado**
1. Subí la carpeta a `/opt/asistok`, copiá `.env.example` a `.env` y completalo (`APP_URL=https://tudominio.com`, `TRUST_PROXY=1`).
2. Instalá Node 22 y levantalo con systemd (`docs/asistok.service.example`) o Docker (`docker compose up -d`).
3. Nginx + HTTPS: `docs/nginx.conf.example` y `certbot --nginx`.

**B) Render / Railway / Fly.io**: creá un servicio desde esta carpeta (usa el `Dockerfile`), agregá un **volumen persistente montado en `/data`**, cargá las variables del `.env.example` y asigná tu dominio.

**C) cPanel con "Setup Node.js App"**: elegí Node 22, archivo de inicio `server.js`, cargá las variables de entorno desde el panel.

## 3. Mercado Pago (para cobrar de verdad)

1. En <https://www.mercadopago.com.ar/developers/panel/app> creá una aplicación y copiá el **Access Token de producción** → `MP_ACCESS_TOKEN`.
2. En *Webhooks* configurá la URL `https://tudominio.com/api/mp/webhook` con los eventos **Pagos**, **Planes y suscripciones** y **Pagos recurrentes**; copiá la clave secreta → `MP_WEBHOOK_SECRET`.
3. Poné `ALLOW_DEMO_PAYMENTS=0`. Hacé una compra real chica y verificá que la cuenta se active.

Cómo cobra: suscripción mensual = *preapproval* (débito recurrente); pago único, módulos y empleados extra = *Checkout Pro* (siempre pago único, nunca recurrente). El monto lo calcula siempre el servidor y la activación se confirma consultando a Mercado Pago (no se confía en lo que manda el navegador).

## 4. Antes de lanzar (checklist)

- [ ] `ADMIN_PASSWORD` larga y única; cambiala desde el panel si querés.
- [ ] `APP_URL` con `https://` y `TRUST_PROXY=1` si hay proxy.
- [ ] Textos legales: ya hay plantilla completa (Ley 25.326). En **Super Admin → Inicio web** completá razón social, CUIT y domicilio; guardá. Exportación/eliminación de datos de empleados disponible en ficha del empleado y en Cuentas (Super Admin).
- [ ] Feriados: se **calculan solos por ley** para cualquier año (fijos, Carnaval, Semana Santa y trasladables). Los días no laborables turísticos los decreta el Gobierno cada año: revisalos en **Super Admin → Feriados** y cargá los que falten (o tocá *Sincronizar con fuente online*).
- [ ] Backups: el sistema guarda **una copia diaria de la base** en `data/backups` (rotación de 7) y avisa en Super Admin si pasaron más de 7 días sin backup. Igual llevate una copia **fuera del servidor** y respaldá `data/uploads` y `data/.secret`.
- [ ] Emails (**obligatorio en producción**): con `RESEND_API_KEY` se envían la confirmación de email y la recuperación de contraseña. Sin eso, los dueños nuevos no pueden pagar (tienen que confirmar su email) y nadie puede recuperar su clave. **En producción el contenido de los emails nunca se escribe en el log** (traería links con tokens). Solo en desarrollo (sin `https://` en `APP_URL`) los links salen por consola.
- [ ] Configurá la ubicación de cada local (Panel → QR → "Usar mi ubicación actual" parado en el local).

## 5. Cómo funciona la marcación

**Modo principal: desde el panel, sin QR.** El empleado entra a su panel (email y contraseña), toca **Entrada**, **Salida** o **Extra** y el sistema verifica **en el servidor** que esté dentro del radio del local con el GPS del celular. No hay que comprar pantallas ni escanear nada. Lo único que configura el dueño es la **ubicación del local** (Panel → Local → Ubicación; se puede pegar el link de Google Maps) y después cargar a sus empleados.

**Modo opcional: QR.** Si el dueño quiere además exigir presencia física, puede mostrar el QR dinámico (cambia cada 60 s). El empleado lo escanea y se abre `/m/<código>`; el flujo sigue funcionando igual que siempre y también valida el GPS.

**Si el GPS falla:** el dueño puede **cargar o corregir la marca** desde la ficha del empleado (🕘 *Marcas / corregir*) o desde el aviso "fuera de zona". Se puede cargar una entrada, una salida o una **jornada completa**; si la secuencia es incoherente avisa y solo se fuerza con un motivo. Queda marcada como *Manual* (con quién la cargó y la nota), cuenta en las horas y aparece en el reporte diario. Solo se pueden borrar las marcas manuales.

**Si se olvidan de marcar la salida:** el cierre automático la cierra a la hora configurada y avisa. Las notificaciones se pueden borrar de a una o todas juntas (los permisos pendientes no se pierden).

### Cómo mostrar el QR en el local (3 formas)
| Forma | Cuándo usarla | Seguridad |
|---|---|---|
| **Pantalla fija** (link) | Tablet, monitor o TV del local | El link se abre una sola vez y queda **atado a ese dispositivo** hasta que lo cancelás. No hay que dejar tu cuenta abierta. |
| **Link para encargado** | Un encargado muestra el QR desde su celular, o respaldo si se corta la luz | **Un solo uso**: el primer dispositivo que lo abre se queda con él y los demás son rechazados. Dura **8 horas** desde que se abre (elegís 1 a 16) y vence solo si nadie lo abre en 12 h. |
| Pestaña Local del panel | Probar o uso ocasional | Requiere tu sesión iniciada. |

- **GPS en la pantalla**: por defecto el dispositivo que muestra el QR también tiene que estar en el local con el GPS activado; si no, el servidor **no le entrega el QR** y le explica qué hacer. Para un TV o PC sin GPS, destildá esa opción al crear la pantalla fija (los empleados igual tienen que estar en el local para marcar).
- Los links se crean en **Panel → QR → Pantalla del local**. Se muestran **una sola vez** (copiar o enviar por WhatsApp); si se pierde, se cancela y se crea otro. Cancelar corta la pantalla en segundos.
- Los intentos raros (otro dispositivo usando el link, pantalla fuera del local, sin GPS) aparecen en **Notif. → Seguridad**.
- La pantalla pide a Chrome/Safari que **no se apague** (Wake Lock). En una tablet fija conviene además desactivar el bloqueo de pantalla del sistema.

### Ubicación del local desde Google Maps
En **Panel → Local → Ubicación del local**: buscá tu local en Google Maps → *Compartir → Copiar vínculo* → pegalo en el campo y tocá **Tomar ubicación**. Entiende links largos, cortos (`maps.app.goo.gl`) y coordenadas escritas a mano. Después hay un enlace para verificar el punto en Google Maps. También está en el asistente de nueva sucursal.

### Panel del empleado
Cada empleado tiene su propio acceso (email + contraseña): marcar asistencia, ver sus horas del mes, pedir permisos y vacaciones, subir certificados, ver y firmar recibos, ver cumpleaños y editar su perfil. Se registran de tres formas: los da de alta el dueño, se anotan solos con el **link / QR de alta** (el dueño los autoriza), o se importan por CSV.

## 6. Estructura

```
server.js            servidor HTTP, seguridad, enrutado
lib/                 config, base de datos, seguridad, horas, Mercado Pago, jobs
routes/              auth, pagos, dueño, empleado, super admin
public/              interfaz (HTML + CSS + JS modular, sin build)
test/                tests de integración
```

## 7. Límites conocidos (para tener presentes)

- Una sola instancia (SQLite + límites de intentos en memoria). Alcanza para cientos de negocios; para escalar más, migrar a PostgreSQL.
- Empleados extra: **pago único** por cupo (Checkout Pro). Los cupos no vencen y se suman al límite del plan; el precio por cupo se edita en Super Admin → Precios.
- Vacaciones: cálculo LCT orientativo (por antigüedad). Convenios especiales requieren revisión.
- **Rol "encargado de sucursal"** (D2): no se implementó a propósito. Exige permisos por sucursal en cada consulta y complicaría la autenticación; hoy el dueño ve y gestiona todas sus sucursales.
- **PWA**: se puede instalar en el celular y abre la interfaz sin conexión, pero **marcar siempre necesita internet** (el servidor valida QR y ubicación).
- **Fuente de feriados**: `api.argentinadatos.com` es un servicio de terceros. Solo se usa para completar la tabla local, nunca en cada marcación; si cae, siguen valiendo los feriados calculados por ley.
- Los emails que envía el sistema (confirmar email, recuperar contraseña, aviso de feedback al Super Admin) necesitan `RESEND_API_KEY`.

## 8. Seguridad en producción (lo que tenés que respetar)

- **Super Admin**: `ADMIN_PASSWORD` de 12+ caracteres, única y que no sea de ejemplo; si no, la app **no arranca** en producción. Después de la primera vez borrala del `.env`. Si perdés el acceso: `ADMIN_PASSWORD='nueva-clave-larga' node scripts/reset-admin-password.js` (con Docker: `docker compose exec -e ADMIN_PASSWORD='...' asistok node scripts/reset-admin-password.js`).
- **Proxy y puerto**: la app escucha solo en `127.0.0.1:3000` (docker-compose ya lo publica así) y se accede por nginx con HTTPS. `TRUST_PROXY=N` = cantidad de proxies de confianza (1 = nginx solo; 2 = Cloudflare + nginx). La IP real se toma de `X-Forwarded-For` contando desde la derecha; **nunca expongas el puerto de la app a internet** con `TRUST_PROXY` activo.
- **Login**: solo cuentan los intentos fallidos, por email+IP (4 libres y espera de 1, 2, 4… hasta 15 min) y por IP (25). Nadie puede bloquear a otra persona desde otra IP. Quien comparte IP con un atacante (misma oficina) puede esperar unos minutos. No hay captcha (haría falta un servicio externo como Cloudflare Turnstile).
- **Emails confirmados**: en producción el dueño tiene que confirmar su email para poder pagar, y un empleado que se anota por link no puede ser autorizado hasta confirmar el suyo. - **Archivos**: la base, `-wal`/`-shm`, `uploads/` y `backups/` quedan con permisos `600`/`700` (solo el usuario de la app). Con Docker y carpeta montada (`./data`), el dueño de los archivos es el usuario `node` del contenedor.
- **Suscripciones**: las cancelaciones se registran solo cuando Mercado Pago confirma la baja; cada cobro mensual se procesa una única vez aunque Mercado Pago repita la notificación.
- **Textos legales**: plantilla completa incluida. Mientras queden placeholders (`[Razón Social]`, CUIT, etc.) se muestran como “texto provisional” y Super Admin muestra un aviso. Completalos y guardá en Inicio web.


## Seguridad de datos (AsistOK)

- Base de datos: **SQLite** en `data/asistok.db` (permisos 600 en Linux).
- Datos sensibles del empleado (teléfono, dirección, DNI, emails personales, emergencia, notas) se **cifran en reposo** con AES-256-GCM usando `SECRET` del `.env`.
- Las contraseñas se hashean (nunca se guardan en texto plano).
- Sesiones en cookies HttpOnly.
- Pagos con Mercado Pago: el checkout ocurre en MP; AsistOK no almacena tarjetas.
