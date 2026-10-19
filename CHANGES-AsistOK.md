# Asist OK — cambios sobre AsistOK v3

## v3.1.13 — Fusión de las ramas 3.1.11 (endurecimiento) y 3.1.12 (producto) + cierre pre-lanzamiento
La 3.1.12 había perdido correcciones de seguridad de la 3.1.11 (eran ramas paralelas). Esta versión junta ambas:
- **Recuperado de la 3.1.11:** grupo sanguíneo y obra social cifrados (con backfill idempotente de los datos viejos); reseñas pendientes hasta que el Super Admin las aprueba; el encargado solo edita SU sucursal; el cambio de plan **se paga** (diferencia, vía Mercado Pago; ya no hay upgrade gratis); `reset-admin-password` funciona con emails cifrados; webhook con validación de id e IPN (siempre confirma contra la API de MP); borrado de archivos huérfanos al eliminar un empleado; fechas "de hoy" en hora de Argentina; emails descifrados en Super Admin/feedback; MRR por plan; backup off-site solo por https; CSP con Turnstile, cabecera COOP, `keepAliveTimeout`; el service worker no cachea URLs con tokens; sin número de WhatsApp de ejemplo; `INFORME-AUDITORIA.md`, `docs/DESPLIEGUE.md`, `scripts/gen-env.js`, `test/hardening.test.js`.
- **Se conserva de la 3.1.12:** prueba gratis de Mercado Pago (Esencial mensual), landing y página de estado nuevas, encargado/RRHH que marcan y piden permisos, cadena de autorización de permisos, exportar CSV, aviso "fuera de zona" cada 30 min, Railway (entrypoint y permisos del volumen).
- **Backup:** ya no se copia el `SECRET` a `data/backups`; se borra `asistok.secret.bak` de versiones anteriores y se deja `SECRET-README.txt`.
- **Errores globales:** `unhandledRejection` se registra sin tumbar el servidor; `uncaughtException` se registra y reinicia el proceso limpio.
- **Red:** variable `HOST` (por defecto `127.0.0.1`; el contenedor Docker usa `0.0.0.0` y compose publica solo en local).
- **Tests:** 34 (se agregaron `hardening.test.js` y `hardening-v3113.test.js`; el test de vacaciones ahora paga el upgrade en modo demo).

## v3.1.12 — Fix pago con Mercado Pago
- **Fix:** `/api/pay/checkout` enviaba a Mercado Pago el email cifrado del usuario (`enc:…`) como `payer_email`, y MP respondía 400 "Invalid value for payer_email". Ahora se descifra antes de enviarlo.

## v3.1.11 — Correcciones de auditoría
- **Seguridad (jerarquía de cuentas):** nuevo `getManagedEmp`. Restablecer contraseña, deshabilitar, habilitar y editar una cuenta ahora respeta el rol: el dueño gestiona a todos, RRHH a empleados y encargados, el encargado solo a empleados de su sucursal (y no puede mover empleados a otra sucursal).
- **Encargado limitado a su sucursal** también en marcas manuales (cargar, ver y borrar) y en la descarga de documentos (`/api/docs/:id/file`).
- **Cobros:** al terminar un descuento (y en el ajuste masivo de precios) se actualiza la suscripción de Mercado Pago con el precio del plan de cada negocio (`chargeFor`), no con el precio Esencial.
- **Webhook MP:** sin `MP_WEBHOOK_SECRET` ya no se aceptan notificaciones sin firma cuando el entorno es de producción o usa https.
- **Marcación:** la lectura de la última marca ocurre dentro de la transacción (sin doble entrada por doble toque); aviso "fuera de zona" como máximo cada 30 min por empleado.
- **Jobs:** "No llegó" no se genera en feriados; el auto-cierre solo mira marcas de los últimos 7 días (antes recorría toda la tabla cada minuto).
- **Exportación CSV de empleados:** escapa fórmulas (`=`, `+`, `-`, `@`).
- **Robustez:** URL o cookie con `%` mal formado ya no da 500; `/api/auth/reset` valida contraseña contra el email descifrado.
- **Configuración:** se quitaron las variables `BACKUP_S3_*` (no se usaban). El backup off-site usa `BACKUP_UPLOAD_URL` / `BACKUP_UPLOAD_TOKEN`.
- **Repo:** `.gitignore`, `.dockerignore` y `.env.example`; `data/` ya no se incluye. Tests de registro actualizados (aceptar Términos y Privacidad).

## v3.1.4 — Legales, ARCO/AAIP y tutorial ampliado
- **Términos y Política de Privacidad** completos según Ley 25.326, Defensa del Consumidor y uso real del producto (geolocalización, cifrado, Mercado Pago, multi-sucursal).
- **Exportación de datos**: paquete JSON del negocio (`/api/owner/export/all`), de un empleado (`/api/owner/employees/:id/export`) y del Super Admin por tenant (`/api/admin/tenants/:id/export`) para responder a la AAIP.
- **Eliminación de datos (supresión)**: `POST /api/owner/employees/:id/erase` borra ficha, marcas, permisos, docs/archivos y notificaciones; queda auditoría sin el contenido de los datos.
- **Primeros pasos**: tutorial ampliado (datos del negocio, ubicación, horarios/extras, empleados, primera marcación, pantalla del local opcional) con instrucciones más claras.
- Migración automática de la plantilla legal corta a la versión completa al arrancar.

## Rebrand
- Nombre de producto: **Asist OK** (UI, meta, PWA, Mercado Pago, mails, README).
- Logo: marca **OK** (cuadrado verde) en topbar, login y kiosk.
- Favicon y manifest actualizados.

## Panel empleado
- Solo ve/usa la **sucursal asignada** (sin selector de otras).
- Botón **Extra**: si el empleador no permite extras, queda visible pero deshabilitado y muestra *“Tu empleador no permite hacer horas extras.”*
- **Perfil ampliado**: DNI, email personal, cargo y fecha de ingreso (solo lectura), grupo sanguíneo, obra social, notas/alergias.
- UI del home más clara (cards con chevron, saludo refinado).

## Panel dueño
- **Seguridad**: borrar intentos rechazados uno a uno o todos.
- **Cancelar suscripción** (plan mensual): cancela preapproval en MP; acceso hasta `paid_until`.
- **Tema**: al tocar el color se aplica al instante (se persiste al Guardar).
- **Reportes**: resumen de totales + colores en diferencias (rojo/verde).
- Nueva pestaña **Sucursales**: upsell si no tiene multi-sucursal; gestión con empleados por local si está activo.

## Super Admin
- **Auditoría** legible: acciones en español, detalle humanizado, badges por categoría, botón para ver JSON técnico.

## Base de datos
- Nuevas columnas en `users`: dni, personal_email, blood_type, obra_social, notes.
- Nueva columna en `tenants`: cancel_at.

## v3.1.1 — Landing integrada + estética
- La pantalla de acceso **ya no es el login viejo**: es la landing AsistOK (hero, producto, soporte, precios) con panel de login/registro embebido.
- Logo **OK** + AsistOK en nav y login.
- Panel empleado: fondo teal suave, cards con sombra, iconos en pastillas, bottom nav con blur.

## v3.1.2 — Corrección recibos / certificados
- **Fix**: `routes/employee.js` usaba `dom` sin importarlo → `GET /api/me/docs` y `POST /api/me/docs/:id/sign` devolvían error 500 ("Ocurrió un error inesperado") en Recibos y Certificados del empleado.
- **Firma del empleador**: nuevo `GET /api/docs/:id/sign` (dueño o empleado titular del recibo) y la firma se muestra en cada recibo del panel del empleado. Antes la firma solo se podía ver en Config del dueño.
- **Fix duplicados**: `index.html` cargaba `/js/app.js?v=32` y `owner.js`/`employee.js`/`admin.js` importaban `./app.js` (otra URL) → el módulo se ejecutaba dos veces y cada submit/click se procesaba doble (certificados y recibos duplicados). Ahora hay una sola URL (`/js/app.js`; el servidor ya manda `no-cache` en JS). Service worker a v33.
- **Fix alta de empleado**: `POST /api/owner/employees` ignoraba DNI, email personal, grupo sanguíneo, obra social y notas del formulario "Agregar empleado" (solo se guardaban al editar después). Ahora se guardan al crear; el email personal se valida. Test nuevo en `test/features.test.js`.
- **Etiqueta**: en los datos del empleado (ficha del dueño y perfil del empleado) "Dirección" pasó a "Domicilio", con ayuda "Calle, número y localidad", para no confundirla con la dirección de correo.

## v3.1.3 — Bloqueantes de producción (auditoría 14/10/2026)
- **H1** Webhook de suscripción idempotente: tabla `mp_events` (id del cobro único); un cobro repetido no vuelve a sumar días ni a descontar meses de cupón. Un negocio suspendido ya no se reactiva solo por un cobro.
- **H3** Cancelar plan: se registra solo si Mercado Pago confirma; si no, error 502 claro y el plan sigue igual. El panel muestra el estado real de la suscripción.
- **H2** Confirmación de email (token de un solo uso, 24 h): obligatoria en producción para pagar (dueño) y para autorizar a un empleado que se anotó por link. - **H5** Límite de login solo por fallos, por email+IP e IP, con espera progresiva. Script `scripts/reset-admin-password.js` para recuperar el Super Admin.
- **H6** En producción el mailer nunca escribe el contenido ni los links en el log.
- **H8** Permisos 600/700 en la base, `-wal`/`-shm`, `uploads`, `backups` y carpeta de datos (umask 077 + refuerzo al arrancar y cada hora).
- **H10** En producción no se crea un Super Admin con contraseña de ejemplo/débil (la app no arranca); aviso crítico si el existente la usa. `.env.example` ya no trae una clave.
- **H11** docker-compose publica `127.0.0.1:3000`; `TRUST_PROXY=N` cuenta proxies y toma la IP desde la derecha de `X-Forwarded-For` (no falsificable por el cliente).
- **Legales**: la plantilla se muestra como “texto provisional” y hay aviso crítico en Super Admin mientras no se reemplace.
