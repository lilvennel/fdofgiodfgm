# Checklist manual de aceptación

Hacelo una vez antes de lanzar (con `ALLOW_DEMO_PAYMENTS=1` en tu PC, o con una compra real chica en producción).

## Antes de hostear (producción)
- [ ] **HTTPS**: dominio con certificado (Certbot/Nginx). `APP_URL=https://tudominio.com`
- [ ] **SECRET**: `openssl rand -hex 32` en `.env` (32+ caracteres). Respaldo en gestor de contraseñas.
- [ ] **Resend**: API key + dominio verificado en resend.com (SPF/DKIM). `MAIL_FROM` con ese dominio.
- [ ] **Mercado Pago**: `MP_ACCESS_TOKEN` + webhook `https://tudominio.com/api/mp/webhook`
- [ ] Tras el primer arranque: borrar `ADMIN_PASSWORD` del `.env`

## Super Admin
- [ ] Entro con `ADMIN_EMAIL` / `ADMIN_PASSWORD`. No aparece el banner rojo (si aparece, leelo y corregí el `.env`).
- [ ] **Precios**: cambio un precio y programo un aumento con fecha futura; el aviso aparece en el inicio y en el panel de un cliente.
- [ ] **Inicio web**: edito textos y contacto; subo 3 imágenes al carrusel y se ven rotando en el inicio público.
- [ ] **Textos legales**: pego HTML con un `<script>`; la vista previa lo limpia; `/terminos` y `/privacidad` lo muestran.
- [ ] **Feriados**: "Generar feriados 2027" lista los feriados; edito uno, quito otro, agrego un día no laborable.
- [ ] **Novedades**: creo, edito y elimino una entrada; el dueño la ve en Config → Novedades.
- [ ] **Feedback**: llega lo que mandan dueño y empleado; cambio el estado y dejo una nota interna.
- [ ] **Sistema**: "Hacer backup ahora" crea una copia; aparece "Último backup hace 0 días"; descargo la copia.
- [ ] **Cuentas**: suspendo y reactivo un negocio; asigno un descuento; reseteo la clave de un dueño.

## Dueño
- [ ] Me registro (con cupón `BIENVENIDA20` para ver el 20 %) y pago; veo la lista **Primeros pasos** (1 de 4).
- [ ] Configuro la ubicación parado en el local (pestaña Local), agrego un empleado y el empleado marca su primera entrada: el checklist llega a 4 de 4. "Omitir" deja un banner y se reabre desde Config.
- [ ] **Empleados**: alta manual, alta por link/QR (queda pendiente y lo autorizo), importación CSV (con una fila mala a propósito), tope de empleados y compra de cupos extra (pago único).
- [ ] **Inicio**: horas laborables del mes, horas hechas, extras resaltadas y selector de mes.
- [ ] **Celular y PC**: recorro el panel del empleado, el del dueño y el Super Admin en el celular y en la compu: nada se corta ni se desborda.
- [ ] **Notif.**: veo "llegó tarde", "no marcó salida", "fuera de zona" y permisos; el contador baja al abrirla; la sección Seguridad lista intentos rechazados.
- [ ] **Corregir marcas**: desde la ficha del empleado cargo una jornada completa de ayer; fuerzo una marca incoherente con motivo; la borro. Se ve como *Manual* y cuenta en las horas.
- [ ] **Notificaciones**: borro una y luego "Borrar todas"; un permiso pendiente sigue apareciendo para resolver.
- [ ] **Reportes**: exporto CSV; **Config**: cambio horas, tema y cierre automático.
- [ ] **Pantalla del local**: pego un link de Google Maps y se llenan las coordenadas; creo una *pantalla fija* y un *link para encargado* (lo mando por WhatsApp).
- [ ] Abro el link del encargado en un celular en el local (GPS activo): se ve el QR y la hora de vencimiento. Lo abro en **otro** dispositivo: lo rechaza. Lo cancelo: la pantalla deja de mostrar el QR.
- [ ] Si compré Multi-sucursal: el asistente crea una sucursal y me muestra su QR. Si compré Recibos: subo un PDF y el empleado lo firma.

## Empleado
- [ ] Entro a mi panel: cambio la clave temporal y **acepto Términos + Privacidad** y marco Entrada, Salida y Extra **sin escanear QR**, con la ubicación activada. (Opcional: con el QR del local también funciona.)
- [ ] Pruebo a propósito: GPS bloqueado, estar lejos del local, un local sin ubicación cargada, un QR viejo. Cada mensaje dice qué pasó y qué hacer.
- [ ] Pido un permiso y vacaciones, subo un certificado, firmo un recibo, completo mi perfil.
- [ ] "Reportar un problema o idea" llega al Super Admin.
- [ ] Se puede "Agregar a pantalla de inicio" (PWA) desde el menú del navegador.
