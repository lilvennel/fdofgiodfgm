# Informe de auditoría — AsistOK 3.1.10 → 3.1.11

Alcance: revisión completa del código (servidor, base de datos, pagos, frontend, Docker, documentación) + pruebas reales ejecutando el servidor. Estado final: **31/31 tests pasan**, arranque en modo producción verificado.

## 1. Errores graves encontrados y corregidos
| # | Problema | Efecto | Corrección |
|---|---|---|---|
| 1 | `routes/owner.js` usaba `fc` sin importarlo | La lista de empleados del dueño, exportaciones y pendientes daban error 500 | Import agregado + test |
| 2 | `POST /api/owner/plan/upgrade` cambiaba de plan **gratis** | Cualquier dueño se daba Completo sin pagar | Ahora exige pagar la diferencia (nuevo `kind=plan_upgrade` en el checkout) |
| 3 | Editar un empleado guardaba teléfono/DNI/etc. **en claro** | Incumplía el cifrado prometido | Se cifra siempre; grupo sanguíneo y obra social ahora también se cifran; migración automática de datos viejos |
| 4 | Email del dueño (cifrado) se enviaba tal cual a Mercado Pago | El cobro real fallaría | Se descifra antes de enviarlo |
| 5 | `scripts/reset-admin-password.js` buscaba el email en texto | La recuperación del Super Admin nunca encontraba la cuenta | Busca por hash |
| 6 | Dockerfile con `VOLUME` | Railway rechaza el build; además `/data` sin permisos para el usuario `node` | Sin `VOLUME`, `/data` con permisos, `TZ` Argentina, `.dockerignore`, volumen con nombre |
| 7 | Reseñas se publicaban solas en la landing | El mensaje decía "revisamos antes de publicar" | Quedan pendientes hasta aprobar |
| 8 | CSP bloqueaba el captcha Turnstile y la vista previa de PDF | Captcha/PDF no funcionaban | CSP ajustada |
| 9 | Webhook MP aceptaba sin firma si `NODE_ENV≠production` aunque la URL fuera https; IPN clásico sin firma era rechazado | Riesgo / notificaciones perdidas | Firma obligatoria en modo estricto; IPN aceptado porque siempre se verifica contra la API de MP; ids validados |
| 10 | Un encargado podía resetear la clave de otro encargado/RRHH y editar otras sucursales | Toma de cuentas lateral | Restringido |
| 11 | Super Admin veía emails cifrados (`enc:…`) en cuentas/feedback; MRR ignoraba el plan | Datos ilegibles/erróneos | Corregido |
| 12 | Número de WhatsApp de ejemplo (`5491100000000`) visible en la landing | Contacto falso | Solo se muestra si cargás el real |
| 13 | Archivos de certificados/recibos quedaban en disco al borrar un empleado | Datos personales huérfanos | Se borran |
| 14 | Fechas "de hoy" usaban la zona horaria del servidor | Feriados/permisos corridos 3 h en servidores UTC | Siempre hora de Argentina |
| 15 | `.env` real (con SECRET y contraseña) venía dentro del zip | Secretos expuestos | **No se incluye**; `gen-env.js` crea uno nuevo |
| 16 | 16 de 26 tests fallaban (desactualizados) | Sin red de seguridad | Actualizados + 5 tests nuevos |

Otros: cookies mal formadas / URLs inválidas daban 500 (ahora 400), backup off-site exige https, el service worker ya no guarda en caché URLs con tokens, handlers de errores globales, `keepAliveTimeout` para evitar 502, opción `HOST`, re-cifrado innecesario de emails en cada arranque eliminado, landing.html huérfana eliminada.

## 2. Protección de datos — veredicto
**Bien resuelto:** contraseñas con scrypt + sal; sesiones con token aleatorio guardado hasheado, cookie HttpOnly/Secure/SameSite; cifrado AES-256-GCM de DNI, teléfono, domicilio, emails, contacto de emergencia, notas y datos de salud; aislamiento entre negocios en todas las consultas revisadas; control de origen (CSRF); límites de intentos de login; XSS (plantilla `html` escapa todo); cabeceras CSP/HSTS/XFO; subidas validadas por contenido real; descargas autenticadas; permisos de archivos 600/700; tokens de reset/verificación de un solo uso y hasheados; auditoría; exportación y supresión de datos (Ley 25.326).

**Riesgos que quedan (decisión tuya):**
- `SECRET` único: si se pierde o cambia, los datos cifrados son irrecuperables; no hay rotación de claves. Respaldalo.
- Latitud/longitud de cada marca, nombres y fechas se guardan sin cifrar (necesarios para reportes); el backup los contiene → guardalo cifrado y fuera del servidor.
- El GPS lo informa el celular y puede falsearse (limitación de cualquier control por GPS; el QR dinámico ayuda).
- Super Admin sin doble factor: usá una clave larga única; considerá poner el panel detrás de Cloudflare Access/VPN.
- Registro y alta por link revelan si un email ya existe (compromiso de usabilidad).
- Límites de intentos en memoria (se reinician al reiniciar; una sola instancia). nginx agrega un límite extra.
- Encargados y RRHH no tienen panel para marcar su propia asistencia (diseño actual).
- Legal: textos con placeholders (razón social, CUIT); revisalos con un abogado y evaluá la inscripción de la base de datos ante la AAIP.

## 3. Pendiente del lado tuyo
Mercado Pago (token + secreto de webhook, `ALLOW_DEMO_PAYMENTS=0`), Resend, dominio/HTTPS, datos legales, y una compra real de prueba. Guía: `docs/DESPLIEGUE.md`.

## 4. No verificado (no tengo acceso desde acá)
Build real de Docker, Mercado Pago y Resend reales, Railway/VPS en vivo, dispositivos móviles reales (GPS).
