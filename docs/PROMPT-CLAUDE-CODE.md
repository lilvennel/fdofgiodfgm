# Prompt para continuar el trabajo sobre Asist OK (Claude Code / otro asistente)

> Copiá todo lo que está debajo de la línea y pegalo como primer mensaje en Claude Code, abierto en la raíz del repo.

---

Sos un ingeniero senior de Node.js a cargo de **Asist OK** (carpeta del repo), un SaaS argentino de control de asistencia: QR dinámico + geolocalización, horas/extras/feriados, permisos y vacaciones (LCT), recibos con firma, multi-sucursal y cobro con Mercado Pago.

## Contexto técnico (no lo cambies sin pedirlo)
- Node >= 22.13, **sin dependencias externas** (`node:http`, `node:sqlite`, `node:crypto`). No agregues paquetes npm.
- Backend: `server.js`, `lib/*` (db, domain, security, mp, jobs, backup…), `routes/*`. Front sin build: `public/js/*.js` (ES modules) con la plantilla `html\`...\`` que escapa por defecto.
- Multi-negocio: toda consulta debe filtrar por `tenant_id`. Roles: `superadmin`, `owner`, `manager` (encargado, limitado a su sucursal), `hr`, `employee`.
- Una sola instancia + SQLite en modo WAL. `SECRET` cifra datos personales y firma los QR.
- Textos de UI en español rioplatense (voseo). Mensajes de error claros para el usuario final.
- Tests: `npm test` (levantan el servidor real con base temporal). Deben quedar en verde (hoy: 27/27).

## Lo que ya está hecho (v3.1.11, ver CHANGES-AsistOK.md)
Jerarquía de cuentas (`getManagedEmp`), encargado limitado a su sucursal en marcas manuales y documentos, precio correcto al terminar un descuento, firma del webhook MP exigida en producción/https, carrera en la marcación, avisos "fuera de zona" limitados, "No llegó" sin feriados, auto-cierre acotado a 7 días, CSV sin inyección de fórmulas, `/api/owner/plan/upgrade` bloqueado fuera de modo demo, `.gitignore`/`.env.example`/`.dockerignore`.

## Tu tarea: resolver los pendientes, en este orden
Trabajá de a un punto, con un commit por punto, tests nuevos que fallen antes y pasen después, y una línea en `CHANGES-AsistOK.md` (subí la versión de `package.json`).

### A. Dinero (prioridad máxima)
1. **Upgrade de plan con cobro.** Hoy `/api/owner/plan/upgrade` está bloqueado fuera de demo porque no existe el cobro diferencial. Implementá `kind: 'upgrade'` en `/api/pay/checkout` (monto = diferencia entre tiers, o el nuevo precio según cómo se decida facturar), y que el cambio de `plan_tier` (y módulos de Completo) se aplique **solo** al aprobarse el pago, de forma idempotente (`applyApprovedPayment`). Actualizá también el monto de la suscripción en Mercado Pago (`updatePreapprovalAmount`) con `chargeFor`.
2. **Posible doble período en Pro/Completo** (y Esencial con `TRIAL_DAYS=0`): `applyApprovedPayment` da 31 días al autorizar la suscripción y luego `applyRecurringCharge` suma otros 31 con el primer cobro. Reproducilo con un servidor MP falso (hay `MP_API_URL` configurable para tests) y corregilo para que un pago equivalga a un solo período.
3. **Trial real:** `tenantView.isTrial` se infiere con "menos de 40 días desde el alta". Guardá un `trial_until` real al autorizar la suscripción y usalo en la UI.
4. **Cupo de empleados:** `employeeCount` cuenta solo `role='employee'`, así que pasar gente a encargado/RRHH libera cupo. Definí la regla (propongo contar todos los usuarios activos no dueños) y aplicala en `ensureRoom`, importación y habilitación.
5. Reembolsos/contracargos: hoy solo marcan el pago. Proponé (y cuando se apruebe, implementá) qué beneficios se revierten.

### B. Integridad de reportes
6. Los reportes de **tardanzas y ausencias** y el export contable salen de la tabla `notifs`, que el dueño puede vaciar ("borrar todas"). Creá una tabla propia (p. ej. `attendance_events`: tenant, user, tipo `late|absent`, fecha, detalle) alimentada por `employee.js` y `jobs.absentCheck`, migrá los datos existentes y hacé que los reportes lean de ahí.
7. **Horas esperadas** (`hours.expectedHours`): hoy iguales para todos. Prorratear por fecha de ingreso/baja dentro del mes y descontar licencias aprobadas; permitir `hpd` por empleado si existe turno propio.

### C. Reglas laborales (validar con un laboralista antes de dar por cerrado)
8. **Vacaciones:** la antigüedad se calcula a hoy; la LCT (art. 153, según lectura de la auditoría) la toma al 31/12 del año correspondiente. Revisá `hours.vacationDays` y agregá tests con casos límite.
9. **Turnos que cruzan medianoche:** "llegó tarde" y la plantilla de gastronomía (`schedule_end: '00:00'`) chocan con `auto_close_hour` por defecto (23). Agregá `auto_close_hour` a las plantillas por rubro y contemplá el cruce de medianoche en el cálculo de tardanza.
10. **Feriados:** `syncFromApi` agrega fechas pero no quita las calculadas que la fuente online ya no incluye (puede quedar un feriado doble si cambia por decreto). Hacé que el sync reemplace el año completo respetando lo cargado a mano. Reemplazá el objeto `DECRETED_BRIDGES` fijo por datos editables desde Super Admin.

### D. Seguridad y robustez
11. `lib/backup.js` copia `.secret` junto a las bases cuando `SECRET` no viene del entorno: no lo hagas; documentalo en `docs/CHECKLIST.md`. Documentá `BACKUP_UPLOAD_URL`/`BACKUP_UPLOAD_TOKEN` en el README y agregá un aviso en `lib/warnings.js` si no hay backup off-site configurado en producción.
12. **Cola de mails** (`lib/mailer.js`): hoy está en memoria (se pierde al reiniciar, incluye verificación y recuperación de clave) y reintenta solo cada hora. Persistila en SQLite y procesala cada minuto con backoff.
13. Filtración de existencia: varios endpoints responden 403 "no es de tu negocio" vs 404 según el id exista en otro negocio; unificá a 404. La importación CSV revela si un email ya tiene cuenta en cualquier negocio; devolvé un mensaje genérico. `/api/health` público muestra qué integraciones están activas; dejá solo `{ok}` para anónimos y el detalle para el superadmin.
14. Cerrá la base de datos limpiamente en `SIGTERM` (checkpoint WAL) antes de `process.exit`.
15. Documentá en el README la **limitación inherente** de la marcación web: la ubicación la informa el dispositivo (se puede falsificar) y el QR puede reenviarse durante ~3 minutos. Sugerí mitigaciones (ventana más corta, un solo uso por dispositivo, revisión de marcas con precisión sospechosa).

### E. Rendimiento
16. `jobs.absentCheck` hace 3 consultas por empleado por minuto: reescribilo con una sola consulta agrupada por negocio y corré el chequeo solo en la franja horaria relevante.
17. Reemplazá `readFileSync`/`existsSync`/`statSync` en rutas de archivos y en `serveStatic` por `fs.promises`/streams. Evitá que `lib/db.js` acumule sentencias preparadas con `IN (?,?,…)` de largo variable (cache acotada).
18. `dom.getPrices()` escribe en la base al leer (aplica aumentos programados): movelo al job horario y dejá la lectura pura.

### F. Pendientes de producto antes de salir a producción
19. Completar los placeholders legales (`[Razón Social]`, CUIT, domicilio) en Super Admin → Inicio web, o dejar el aviso crítico visible.
20. Versionado: unificá la versión entre `package.json`, README y el changelog sembrado en `lib/domain.js`.

## Reglas de trabajo
- Antes de tocar código, leé el archivo completo y buscá usos con `grep`.
- Nada de `localStorage` para datos sensibles ni dependencias nuevas.
- Cada endpoint nuevo: `auth` explícito, validación de entrada con los helpers de `routes/common.js`, filtro por `tenant_id`, y registro en `audit` si cambia estado.
- Si una decisión de negocio no está clara (puntos 4, 5, 7, 8), **preguntame antes de implementar** y mostrá las opciones con su impacto.
- Al terminar cada punto: `npm test`, resumen de 3 líneas de qué cambió y qué riesgo queda.
