'use strict';
const { get, all, run, tx, getSetting, setSetting, audit } = require('./db');
const fc = require('./fieldcrypto');
const { isoDate } = require('./hours');
const hol = require('./holidays');

const DEFAULTS = {
  prices: {
    sub: 45000, once: 385000, // alias Esencial (compat)
    esencial_m: 45000, esencial_y: 385000,
    pro_m: 55000, pro_y: 450000,
    completo_m: 70000, completo_y: 560000,
    extra: 2500, mod_suc: 60000, mod_rec: 60000,
  },
  free_employees: 40,
  hero: {
    h1: 'Tecnología que organiza tu equipo',
    sub: 'Control de asistencia por QR, geolocalización y reportes claros',
    box_title: 'Bienvenido',
    box_sub: 'Control de asistencia para tu negocio',
    overlay_color: '#0f172a',
    overlay_op: 45,
    slides: [],
  },
  contact: {
    email: 'hola@asistok.com',
    wa_link: '',
    wa_label: 'WhatsApp · Ayuda',
    copy: '© 2026 Asist OK. Todos los derechos reservados.',
    tagline: 'QR · Geolocalización · Reportes · Argentina',
  },
  legal: {
    privacy: `<h2>Política de Privacidad de AsistOK</h2>
<p><strong>Última actualización:</strong> 15 de octubre de 2026</p>

<h3>1. Responsable del tratamiento</h3>
<p>El responsable del tratamiento de los datos personales es <strong>[Razón Social completa]</strong>, CUIT <strong>[XX-XXXXXXXX-X]</strong>, con domicilio en <strong>[calle, número, localidad, provincia, CP]</strong>, Argentina (en adelante, “AsistOK”, “nosotros” o “el Responsable”).</p>
<p>Contacto para ejercer derechos o consultas sobre privacidad: <strong>hola@asistok.com</strong> (o el email de contacto configurado en el sitio).</p>

<h3>2. Ámbito de aplicación</h3>
<p>Esta Política se aplica al uso de la plataforma AsistOK (sitio web, aplicación web progresiva y servicios asociados), un sistema SaaS de control de asistencia laboral destinado a negocios en Argentina.</p>
<p>Al registrarte o utilizar el servicio, aceptás esta Política. Si no estás de acuerdo, no debés utilizar AsistOK.</p>

<h3>3. Datos personales que recolectamos</h3>
<p><strong>3.1. Datos de los titulares de cuenta (dueños / administradores del negocio)</strong></p>
<ul>
<li>Nombre completo o razón social del negocio</li>
<li>Correo electrónico</li>
<li>Contraseña (almacenada únicamente en forma hasheada)</li>
<li>Datos de facturación y suscripción (procesados a través de Mercado Pago; AsistOK no almacena datos de tarjetas)</li>
<li>Configuración del negocio (sucursales, horarios, políticas de extras, etc.)</li>
</ul>
<p><strong>3.2. Datos de los empleados</strong></p>
<ul>
<li>Nombre, apellido y correo electrónico</li>
<li>DNI</li>
<li>Correo electrónico personal (opcional)</li>
<li>Teléfono y domicilio</li>
<li>Grupo sanguíneo, obra social y notas / alergias (opcionales y sensibles)</li>
<li>Cargo y fecha de ingreso</li>
<li>Contacto de emergencia (nombre, relación, teléfono)</li>
<li>Registros de asistencia: fecha, hora, tipo de marca (entrada/salida/extra), coordenadas de geolocalización (latitud, longitud y precisión) únicamente en el momento de la marcación, distancia al local y sucursal</li>
<li>Solicitudes de permisos y vacaciones</li>
<li>Documentos laborales: certificados y recibos de sueldo (incluyendo firmas digitales de conformidad o disconformidad)</li>
</ul>
<p><strong>3.3. Datos técnicos y de uso</strong></p>
<ul>
<li>Dirección IP, tipo de dispositivo y navegador</li>
<li>Logs de acceso y seguridad (intentos de login fallidos, etc.)</li>
<li>Cookies técnicas estrictamente necesarias para el funcionamiento de la sesión</li>
</ul>
<p><strong>Nota sobre geolocalización:</strong> La ubicación se solicita y registra <strong>solo en el instante en que el empleado realiza una marcación de asistencia</strong>. No se realiza seguimiento continuo ni se almacena la ubicación fuera de ese momento.</p>

<h3>4. Finalidades del tratamiento</h3>
<ol>
<li>Prestar el servicio de control de asistencia, cálculo de horas, extras, permisos y reportes.</li>
<li>Permitir la gestión multi-sucursal y la verificación de presencia física en el local mediante QR dinámico y geolocalización.</li>
<li>Gestionar la cuenta, suscripciones, pagos y facturación a través de Mercado Pago.</li>
<li>Enviar comunicaciones transaccionales (confirmación de email, recuperación de contraseña, avisos del sistema).</li>
<li>Cumplir obligaciones legales y responder a requerimientos de autoridades competentes (incluida la AAIP).</li>
<li>Mejorar la seguridad y prevenir fraudes o usos indebidos.</li>
<li>Atender consultas, reclamos y ejercer o defender derechos.</li>
</ol>

<h3>5. Base legal del tratamiento</h3>
<ul>
<li><strong>Ejecución de contrato</strong> (art. 5 Ley 25.326): prestación del servicio contratado.</li>
<li><strong>Consentimiento</strong>: cuando el usuario lo otorga expresamente (ej. aceptación al registrarse).</li>
<li><strong>Interés legítimo</strong>: seguridad de la plataforma y prevención de abusos.</li>
<li><strong>Cumplimiento de obligación legal</strong>: conservación de registros cuando la ley lo exija.</li>
</ul>

<h3>6. Destinatarios y cesiones</h3>
<ul>
<li><strong>Con el empleador (titular de la cuenta del negocio)</strong>: los datos de sus empleados son visibles y gestionables por él, ya que es el responsable primario del tratamiento laboral.</li>
<li><strong>Mercado Pago</strong>: para el procesamiento de pagos y suscripciones (sujeto a su propia política de privacidad).</li>
<li><strong>Proveedor de correo electrónico</strong>: solo para el envío de emails transaccionales.</li>
<li><strong>Autoridades públicas</strong>: cuando exista una orden judicial o requerimiento legal válido (incluida la Agencia de Acceso a la Información Pública).</li>
</ul>
<p><strong>No vendemos ni alquilamos datos personales a terceros.</strong></p>

<h3>7. Transferencias internacionales</h3>
<p>Algunos proveedores (ej. servicio de correo) pueden procesar datos fuera de Argentina. En esos casos se aplican las salvaguardas previstas por la normativa argentina y, cuando corresponda, cláusulas contractuales o mecanismos equivalentes de protección.</p>

<h3>8. Plazo de conservación</h3>
<ul>
<li>Mientras la cuenta del negocio permanezca activa.</li>
<li>Tras la baja: se conservan los datos el tiempo mínimo necesario para cumplir obligaciones legales, atender reclamos o defender derechos (en general, hasta 10 años para documentación laboral, según la normativa aplicable al empleador).</li>
<li>Los datos de geolocalización asociados a cada marcación se conservan junto con el registro de asistencia.</li>
<li>Los logs de seguridad se conservan por un período razonable (habitualmente hasta 12 meses).</li>
</ul>
<p>El empleador puede exportar los datos de sus empleados en cualquier momento. Una vez eliminada la cuenta, los datos se borran de forma segura, salvo aquellos que deban conservarse por mandato legal.</p>

<h3>9. Seguridad de los datos</h3>
<ul>
<li>Cifrado en reposo (AES-256-GCM) de datos sensibles de empleados (teléfono, domicilio, DNI, emails personales, notas, etc.).</li>
<li>Contraseñas hasheadas (nunca almacenadas en texto plano).</li>
<li>Sesiones mediante cookies HttpOnly y Secure.</li>
<li>Control de acceso basado en roles (dueño, empleado, superadmin).</li>
<li>Permisos restrictivos de archivos en el servidor.</li>
<li>Limitación de intentos de login y protección contra fuerza bruta.</li>
<li>Comunicaciones cifradas mediante HTTPS en producción.</li>
</ul>

<h3>10. Derechos de los titulares (acceso, rectificación, supresión y oposición)</h3>
<p>De conformidad con la Ley 25.326, tenés derecho a:</p>
<ul>
<li>Acceso a tus datos</li>
<li>Rectificación de datos inexactos o incompletos</li>
<li>Supresión (cuando corresponda)</li>
<li>Oposición al tratamiento</li>
<li>Información sobre cesiones</li>
</ul>
<p>Para ejercer estos derechos, escribí a <strong>hola@asistok.com</strong> (o el email de contacto del sitio) indicando claramente tu solicitud y adjuntando documentación que acredite tu identidad. Responderemos en los plazos legales.</p>
<p>El dueño del negocio puede exportar o eliminar los datos de un empleado desde el panel (ficha del empleado → Exportar datos / Eliminar datos). También puede solicitar al soporte de AsistOK un paquete completo para responder a un requerimiento de la AAIP.</p>
<p>La <strong>Agencia de Acceso a la Información Pública (AAIP)</strong> es el órgano de control de la Ley 25.326. Podés presentar denuncias o reclamos ante ella (<a href="https://www.argentina.gob.ar/aaip" target="_blank" rel="noopener">www.argentina.gob.ar/aaip</a>).</p>

<h3>11. Cookies</h3>
<p>AsistOK utiliza cookies técnicas <strong>necesarias</strong> (sesión HttpOnly) para autenticación y seguridad. No se pueden desactivar sin afectar el servicio.</p>
<p>No cargamos por defecto cookies analíticas ni de marketing de terceros. Si en el futuro se habilitan, podrás gestionar tu consentimiento desde el enlace <strong>Preferencias de cookies</strong> en el pie de página del sitio.</p>
<p>También usamos almacenamiento local del navegador (por ejemplo para el tema oscuro y para recordar tu decisión sobre cookies).</p>

<h3>12. Datos de menores</h3>
<p>AsistOK no está dirigido a menores de 18 años. No recolectamos conscientemente datos de menores. Si detectamos que se ha registrado un menor sin autorización, procederemos a eliminar la cuenta.</p>

<h3>13. Responsabilidad del empleador</h3>
<p>El titular de la cuenta del negocio (empleador) es el responsable primario del tratamiento de los datos de sus empleados en el marco de la relación laboral. AsistOK actúa como encargado del tratamiento únicamente en la medida necesaria para prestar el servicio técnico.</p>
<p>El empleador debe informar a sus empleados sobre el uso de AsistOK y, cuando corresponda, obtener las autorizaciones laborales o consentimientos que la normativa laboral y de datos personales exijan.</p>

<h3>14. Modificaciones</h3>
<p>Podemos actualizar esta Política. Las modificaciones sustanciales se comunicarán a través del panel o por correo electrónico. El uso continuado del servicio tras la notificación implica la aceptación de la nueva versión.</p>

<h3>15. Contacto</h3>
<p>Para cualquier consulta relacionada con esta Política de Privacidad:<br>Email: <strong>hola@asistok.com</strong></p>`,

    terms: `<h2>Términos y Condiciones de Uso de AsistOK</h2>
<p><strong>Última actualización:</strong> 15 de octubre de 2026</p>

<h3>1. Aceptación de los términos</h3>
<p>Estos Términos y Condiciones (los “Términos”) regulan el acceso y uso de la plataforma AsistOK (en adelante, el “Servicio”), operada por <strong>[Razón Social]</strong>, CUIT <strong>[XX-XXXXXXXX-X]</strong>, con domicilio en <strong>[domicilio completo]</strong> (en adelante, “AsistOK”, “nosotros” o “el Prestador”).</p>
<p>Al registrarte, crear una cuenta o utilizar el Servicio, aceptás estos Términos en forma plena e irrevocable. Si no estás de acuerdo, no debés utilizar AsistOK.</p>

<h3>2. Descripción del Servicio</h3>
<p>AsistOK es una plataforma SaaS de control de asistencia laboral diseñada para negocios en Argentina. Permite, entre otras funciones:</p>
<ul>
<li>Marcación de entrada, salida y horas extras mediante interfaz web o código QR dinámico.</li>
<li>Verificación de presencia física mediante geolocalización (solo en el momento de la marcación).</li>
<li>Cálculo de horas normales, extras y feriados según configuración del empleador y feriados argentinos.</li>
<li>Gestión de permisos, vacaciones y certificados.</li>
<li>Emisión y firma de recibos de sueldo.</li>
<li>Reportes, multi-sucursal (según plan) y panel de administración.</li>
<li>Integración de pagos con Mercado Pago.</li>
</ul>
<p>AsistOK es una herramienta tecnológica de apoyo. <strong>No constituye asesoramiento laboral, contable ni legal</strong>, ni reemplaza las obligaciones del empleador frente a la Ley de Contrato de Trabajo (LCT), AFIP, sindicatos o cualquier otra normativa aplicable.</p>

<h3>3. Registro y cuentas</h3>
<ol>
<li>Para utilizar el Servicio debés registrarte con datos veraces y completos.</li>
<li>El titular de la cuenta del negocio es responsable de la exactitud de los datos cargados y del uso que hagan de la plataforma sus empleados autorizados.</li>
<li>Las contraseñas son personales e intransferibles. Debés mantenerlas en secreto.</li>
<li>AsistOK puede suspender o cancelar cuentas que contengan datos falsos, sean utilizadas de forma fraudulenta o incumplan estos Términos.</li>
<li>En producción, la confirmación del correo electrónico es obligatoria para poder pagar y activar el negocio.</li>
</ol>

<h3>4. Planes, precios y pagos</h3>
<ol>
<li>Los precios vigentes se publican en la página web y pueden modificarse con aviso previo razonable.</li>
<li>Existen planes de suscripción mensual y planes de pago único (de por vida), además de módulos y cupos extras.</li>
<li>Los pagos se procesan exclusivamente a través de Mercado Pago. AsistOK no almacena datos de tarjetas de crédito o débito.</li>
<li>La suscripción se renueva automáticamente cada mes hasta que el usuario la cancele desde el panel o a través de Mercado Pago.</li>
<li>La cancelación de la suscripción se hace efectiva según la confirmación de Mercado Pago. El acceso se mantiene hasta la fecha de vencimiento ya abonada.</li>
<li>No se realizan reembolsos por períodos ya abonados, salvo disposición legal imperativa en contrario o decisión comercial expresa de AsistOK.</li>
<li>Los cupones de descuento tienen las condiciones y vigencia que se indiquen al momento de su uso.</li>
</ol>

<h3>5. Obligaciones del usuario (empleador)</h3>
<ul>
<li>Utilizar el Servicio de conformidad con la ley argentina y estos Términos.</li>
<li>Informar a sus empleados sobre el uso de AsistOK para el control de asistencia y, cuando corresponda, obtener las autorizaciones necesarias.</li>
<li>Ser el único responsable del cumplimiento de la normativa laboral aplicable (LCT, convenios colectivos, AFIP, etc.).</li>
<li>No cargar datos de personas sin legitimación para hacerlo.</li>
<li>Mantener actualizados los datos de sus empleados y sucursales.</li>
<li>No intentar vulnerar la seguridad de la plataforma ni realizar ingeniería inversa.</li>
</ul>

<h3>6. Obligaciones de los empleados</h3>
<p>Los empleados autorizados por el empleador pueden utilizar el Servicio únicamente para marcar asistencia, consultar su información y firmar documentos según las funcionalidades habilitadas. Deben utilizar sus credenciales de forma personal e intransferible.</p>

<h3>7. Geolocalización y QR</h3>
<p>La geolocalización se utiliza exclusivamente en el momento de la marcación para verificar que el empleado se encuentra dentro del radio configurado del local. El empleador es responsable de configurar correctamente las coordenadas y el radio de tolerancia de cada sucursal.</p>
<p>El código QR es dinámico y está firmado criptográficamente. Su uso indebido puede generar rechazos de marcación.</p>

<h3>8. Propiedad intelectual</h3>
<p>Todo el software, diseño, código, marcas, logotipos y contenidos de AsistOK son propiedad de [Razón Social] o de sus licenciantes. Queda prohibida su reproducción, modificación, distribución o explotación sin autorización escrita previa.</p>
<p>Los datos que el usuario carga en la plataforma siguen siendo de su propiedad. AsistOK solo los utiliza para prestar el Servicio.</p>

<h3>9. Limitación de responsabilidad</h3>
<ol>
<li>AsistOK se presta “tal cual es”. No garantizamos que el Servicio esté libre de interrupciones, errores o que satisfaga necesidades específicas del usuario.</li>
<li>En la máxima medida permitida por la ley argentina, AsistOK no será responsable por daños indirectos, lucro cesante, pérdida de datos o daños emergentes; por decisiones laborales, disciplinarias o de liquidación de sueldos que el empleador tome basándose en la información generada por la plataforma; por incumplimientos del empleador respecto de la LCT u otras normas laborales; ni por fallos de terceros (Mercado Pago, proveedores de internet, GPS del dispositivo del empleado, etc.).</li>
<li>La responsabilidad total de AsistOK frente al usuario, por cualquier concepto, no excederá el monto abonado por el usuario en los últimos tres (3) meses anteriores al hecho que dio origen al reclamo.</li>
</ol>

<h3>10. Disponibilidad y mantenimiento</h3>
<p>Nos esforzamos por mantener el Servicio disponible las 24 horas. Podemos realizar mantenimientos programados o de emergencia, que se comunicarán cuando sea posible. No garantizamos disponibilidad ininterrumpida.</p>

<h3>11. Suspensión y terminación</h3>
<ol>
<li>Podés cancelar tu cuenta en cualquier momento desde el panel o solicitándolo por escrito.</li>
<li>AsistOK puede suspender o dar de baja la cuenta en caso de incumplimiento de estos Términos, falta de pago, uso fraudulento o por razones de seguridad.</li>
<li>Tras la terminación, el usuario podrá solicitar la exportación de sus datos durante un plazo razonable. Luego se procederá a la eliminación conforme a la Política de Privacidad.</li>
</ol>

<h3>12. Datos personales y derechos ARCO</h3>
<p>El tratamiento de datos personales se rige por la Política de Privacidad y la Ley 25.326. El empleador puede exportar o eliminar los datos de un empleado desde el panel. Ante un requerimiento de la AAIP u otra autoridad, AsistOK colaborará entregando el paquete de datos correspondiente.</p>

<h3>13. Modificaciones de los Términos</h3>
<p>Podemos modificar estos Términos. Las modificaciones sustanciales se notificarán a través del panel o por correo electrónico. El uso continuado del Servicio después de la notificación implica la aceptación de los nuevos Términos.</p>

<h3>14. Ley aplicable y jurisdicción</h3>
<p>Estos Términos se rigen por las leyes de la República Argentina. Para cualquier controversia, las partes se someten a la jurisdicción de los tribunales ordinarios de la Ciudad Autónoma de Buenos Aires, con renuncia a cualquier otro fuero que pudiera corresponder, salvo que la normativa de defensa del consumidor disponga lo contrario a favor del usuario.</p>

<h3>15. Disposiciones generales</h3>
<ul>
<li>Si alguna cláusula fuera declarada nula, las restantes permanecerán vigentes.</li>
<li>La falta de ejercicio de un derecho no implica renuncia al mismo.</li>
<li>Estos Términos constituyen el acuerdo completo entre las partes respecto del objeto.</li>
</ul>

<h3>16. Contacto</h3>
<p>Para consultas sobre estos Términos:<br>Email: <strong>hola@asistok.com</strong></p>`,
  },
};

function seed() {
  for (const k of Object.keys(DEFAULTS)) {
    if (getSetting(k, null) === null) setSetting(k, DEFAULTS[k]);
  }
  // Migrar textos legales de la plantilla corta de ejemplo a la versión completa (una sola vez)
  const curLegal = getSetting('legal', null);
  if (curLegal && typeof curLegal.privacy === 'string' && /Texto de ejemplo: reemplazalo/i.test(curLegal.privacy)) {
    setSetting('legal', DEFAULTS.legal);
  }
  const y = new Date().getUTCFullYear();
  hol.ensureYears(y - 1, y + 2); // calcula por ley los feriados que falten (se guardan en la tabla local)
  if (!get('SELECT 1 FROM changelog LIMIT 1')) {
    const ins = (v, d, a, c, r) => run('INSERT INTO changelog(version,date,added,changed,removed,created_at) VALUES(?,?,?,?,?,?)', v, d, a, c, r, Date.now());
    ins('3.0.0', '2026-10-06', 'Marcación por QR dinámico con geolocalización\nPanel del dueño con horas, extras y reportes\nCobro con Mercado Pago', '', '');
    ins('3.1.0', new Date().toISOString().slice(0, 10), 'Checklist de primeros pasos\nNovedades y botón para enviar sugerencias\nCálculo automático de feriados argentinos', 'Los empleados extra ahora son un pago único (no vencen)', '');
  }
  if (!get('SELECT 1 FROM coupons LIMIT 1')) {
    run("INSERT INTO coupons(code,pct,months,scope,active) VALUES('BIENVENIDA20',20,3,'new',1)");
  }
}

// Las horas se calculan siempre con la tabla local (nunca se consulta una API por cada marca).
const holidaySet = (period) => {
  const y = new Date().getUTCFullYear();
  hol.ensureYears(y - 1, y + 1);
  if (period) hol.ensureYear(Number(String(period).slice(0, 4)));
  return new Set(all("SELECT date FROM holidays WHERE kind='feriado'").map((r) => r.date));
};

// ---------- Precios (con aumento programado) ----------
function getPrices() {
  const stored = getSetting('prices', null);
  let prices = { ...DEFAULTS.prices, ...(stored && typeof stored === 'object' ? stored : {}) };
  const sch = getSetting('price_schedule', null);
  if (sch && sch.date && sch.date <= isoDate(Date.now())) {
    const next = {
      ...prices,
      sub: sch.sub ?? sch.esencial_m ?? prices.sub,
      once: sch.once ?? sch.esencial_y ?? prices.once,
      esencial_m: sch.esencial_m ?? sch.sub ?? prices.esencial_m ?? prices.sub,
      esencial_y: sch.esencial_y ?? sch.once ?? prices.esencial_y ?? prices.once,
      pro_m: sch.pro_m ?? prices.pro_m,
      pro_y: sch.pro_y ?? prices.pro_y,
      completo_m: sch.completo_m ?? prices.completo_m,
      completo_y: sch.completo_y ?? prices.completo_y,
      extra: sch.extra ?? prices.extra,
      mod_suc: sch.mod_suc ?? prices.mod_suc,
      mod_rec: sch.mod_rec ?? prices.mod_rec,
    };
    const hist = getSetting('price_history', []);
    hist.unshift({ at: Date.now(), from: prices, to: next, legacy: sch.legacy });
    setSetting('price_history', hist.slice(0, 50));
    setSetting('prices', next);
    setSetting('price_schedule', null);
    setSetting('price_pending_sync', sch.legacy === 'all' ? { sub: next.sub, at: Date.now() } : null);
    audit(null, null, 'price.applied', next);
    prices = next;
  }
  return prices;
}
function priceNotice() {
  const sch = getSetting('price_schedule', null);
  if (!sch) return null;
  const days = (new Date(sch.date) - new Date(isoDate(Date.now()))) / 864e5;
  if (days > (sch.notify_days || 15) || days < 0) return null;
  const fmt = (n) => Number(n).toLocaleString('es-AR');
  return String(sch.text || 'A partir del {fecha} los planes se actualizan.')
    .replaceAll('{fecha}', sch.date.split('-').reverse().join('/'))
    .replaceAll('{sub}', fmt(sch.sub)).replaceAll('{once}', fmt(sch.once)).replaceAll('{extra}', fmt(sch.extra));
}

// ---------- Tenants ----------
// Cupos extra: pago único, no vencen.
const employeeLimit = (t) => getSetting('free_employees', 40) + (t.extra_slots || 0);
const employeeCount = (tenantId) => get("SELECT COUNT(*) n FROM users WHERE tenant_id=? AND role='employee' AND status='active'", tenantId).n;

function slugify(name) {
  const base = String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'negocio';
  const reserved = new Set(['admin', 'api', 'app', 'login', 'alta', 'm', 'static', 'public', 'terminos', 'privacidad', 'reset']);
  let slug = reserved.has(base) ? base + '-1' : base, i = 1;
  while (get('SELECT 1 FROM tenants WHERE slug=?', slug)) slug = `${base}-${++i}`;
  return slug;
}

/** ms de duración del beneficio una vez canjeado */
function couponDurationMs(c) {
  const n = Math.max(1, Number(c.duration_n != null ? c.duration_n : c.months) || 1);
  const u = String(c.duration_unit || 'months').toLowerCase();
  if (u === 'days' || u === 'day' || u === 'dias' || u === 'día') return n * 864e5;
  if (u === 'years' || u === 'year' || u === 'anos' || u === 'años') return n * 365.25 * 864e5;
  return n * 30 * 864e5; // months
}
function couponDurationLabel(c) {
  const n = Number(c.duration_n != null ? c.duration_n : c.months) || 1;
  const u = String(c.duration_unit || 'months').toLowerCase();
  if (u === 'days' || u === 'day' || u === 'dias') return n === 1 ? '1 día' : n + ' días';
  if (u === 'years' || u === 'year' || u === 'anos' || u === 'años') return n === 1 ? '1 año' : n + ' años';
  return n === 1 ? '1 mes' : n + ' meses';
}
/** ¿El tenant todavía tiene descuento activo? */
function tenantHasDiscount(t) {
  if (!t || !t.discount_pct) return false;
  if (t.discount_until && Number(t.discount_until) > Date.now()) return true;
  if (Number(t.discount_months) > 0) return true;
  return false;
}
function findCoupon(code, scope = 'new', email = null, plan = null, plan_tier = null) {
  if (!code) return null;
  const c = get('SELECT * FROM coupons WHERE code=? AND active=1', String(code).trim().toUpperCase());
  if (!c) return null;
  const now = Date.now();
  if (!(c.scope === 'all' || c.scope === scope)) return null;
  if (c.starts_at && Number(c.starts_at) > now) return null; // todavía no vigente
  if (c.expires_at && Number(c.expires_at) < now) return null; // venció el código
  if (c.max_uses != null && Number(c.uses_count || 0) >= Number(c.max_uses)) return null;
  const applies = String(c.applies_to || 'both');
  if (plan === 'once' && applies === 'sub') return null;
  if (plan === 'sub' && applies === 'once') return null;
  // plan_tiers: "esencial,pro" o vacío/all = cualquiera
  if (c.plan_tiers && String(c.plan_tiers).trim() && plan_tier) {
    const allowed = String(c.plan_tiers).split(/[,|]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes('all') && !allowed.includes(String(plan_tier).toLowerCase())) return null;
  }
  if (email && (c.per_email_once == null || Number(c.per_email_once) !== 0)) {
    const em = fc.emailHash(email) || String(email).trim().toLowerCase();
    if (get('SELECT 1 FROM coupon_redemptions WHERE code=? AND email=?', c.code, em)) return null;
  }
  return c;
}
function consumeCoupon(code, email = null, tenantId = null) {
  if (!code) return;
  const c = String(code).trim().toUpperCase();
  run('UPDATE coupons SET uses_count = COALESCE(uses_count,0) + 1 WHERE code=?', c);
  if (email) {
    try {
      const em = fc.emailHash(email) || String(email).trim().toLowerCase();
      run('INSERT INTO coupon_redemptions(code,email,tenant_id,created_at) VALUES(?,?,?,?)',
        c, em, tenantId || null, Date.now());
    } catch (e) {
      if (!String(e.message || e).includes('UNIQUE')) throw e;
    }
  }
}

function chargeFor(tenant, kind, qty = 1) {
  const p = getPrices();
  if (kind === 'plan') {
    const tier = tenant.plan_tier || 'esencial';
    const key = tier + (tenant.plan === 'once' ? '_y' : '_m');
    const base = p[key] ?? (tenant.plan === 'once' ? p.once : p.sub);
    const pct = tenantHasDiscount(tenant) || tenant.plan === 'once' ? (tenant.discount_pct || 0) : 0;
    return { amount: Math.max(1, Math.round(base * (1 - pct / 100))), base, pct };
  }
  if (kind === 'extra') return { amount: p.extra * qty, base: p.extra, pct: 0 };
  if (kind === 'mod_suc') return { amount: p.mod_suc, base: p.mod_suc, pct: 0 };
  if (kind === 'mod_rec') return { amount: p.mod_rec, base: p.mod_rec, pct: 0 };
  throw new Error('kind inválido');
}

// Aplica un pago aprobado (idempotente)
function applyApprovedPayment(paymentId, mpPaymentId) {
  return tx(() => {
    const p = get('SELECT * FROM payments WHERE id=?', paymentId);
    if (!p || p.applied_at) return false;
    const t = get('SELECT * FROM tenants WHERE id=?', p.tenant_id);
    if (!t) return false;
    const now = Date.now();
    if (p.kind === 'plan') {
      const mods = (t.plan_tier === 'completo') ? ', mod_suc=1, mod_rec=1' : '';
      run(`UPDATE tenants SET status='active', paid_until=?${mods} WHERE id=?`, t.plan === 'once' ? null : now + 31 * 864e5, t.id);
    } else if (p.kind === 'extra') {
      run('UPDATE tenants SET extra_slots=extra_slots+? WHERE id=?', p.qty, t.id);
    } else if (p.kind === 'mod_suc') run('UPDATE tenants SET mod_suc=1 WHERE id=?', t.id);
    else if (p.kind === 'mod_rec') run('UPDATE tenants SET mod_rec=1 WHERE id=?', t.id);
    run("UPDATE payments SET status='approved', applied_at=?, mp_payment_id=COALESCE(?,mp_payment_id) WHERE id=?", now, mpPaymentId || null, p.id);
    audit(null, t.id, 'payment.applied', { kind: p.kind, qty: p.qty, amount: p.amount });
    return true;
  });
}

// Cobro recurrente aprobado de una suscripción. Idempotente: MP reintenta y duplica notificaciones,
// así que el id del cobro se registra en mp_events (PRIMARY KEY) y el plazo se extiende SOLO la primera vez.
function applyRecurringCharge(tenantId, extId) {
  if (!extId) return { applied: false, reason: 'sin_id' };
  return tx(() => {
    const ins = run('INSERT OR IGNORE INTO mp_events(ext_id,kind,tenant_id,created_at) VALUES(?,?,?,?)', String(extId), 'authorized_payment', tenantId, Date.now());
    if (ins.changes === 0) return { applied: false, duplicate: true };
    const t = get('SELECT * FROM tenants WHERE id=?', tenantId);
    if (!t) return { applied: false, reason: 'sin_negocio' };
    const now = Date.now();
    // un negocio suspendido por el Super Admin NO se reactiva solo por un cobro
    run("UPDATE tenants SET status=CASE WHEN status='suspended' THEN status ELSE 'active' END, paid_until=? WHERE id=?", Math.max(now, t.paid_until || 0) + 31 * 864e5, t.id);
    let resetPrice = false;
    if (t.discount_until && Number(t.discount_until) <= Date.now()) {
      run('UPDATE tenants SET discount_pct=0, discount_months=0, discount_until=NULL WHERE id=?', t.id);
      resetPrice = true;
    } else if (t.discount_months > 0) {
      run('UPDATE tenants SET discount_months=discount_months-1 WHERE id=?', t.id);
      resetPrice = t.discount_months - 1 === 0;
      if (resetPrice) run('UPDATE tenants SET discount_pct=0, discount_until=NULL WHERE id=?', t.id);
    }
    audit(null, t.id, 'payment.recurring', { ext: String(extId) });
    return { applied: true, resetPrice, preapproval: t.mp_preapproval_id };
  });
}

// ¿Siguen los textos legales siendo la plantilla de ejemplo? (no son un texto definitivo)
function legalIsPlaceholder() {
  const l = getSetting('legal', DEFAULTS.legal) || {};
  return l.privacy === DEFAULTS.legal.privacy || l.terms === DEFAULTS.legal.terms
    || /Texto de ejemplo|\[completar\]|\[Razón social|\[email\]/i.test(`${l.privacy || ''}\n${l.terms || ''}`);
}

function createTenant({ business, email, name, hash, plan, coupon, plan_tier }) {
  return tx(() => {
    const now = Date.now(), slug = slugify(business);
    const tier = ['esencial', 'pro', 'completo'].includes(plan_tier) ? plan_tier : 'esencial';
    let discPct = 0, discMonths = 0, discUntil = null, couponCode = null;
    if (coupon) {
      discPct = coupon.pct || 0;
      couponCode = coupon.code;
      const ms = couponDurationMs(coupon);
      discUntil = now + ms;
      // compat: meses aproximados para cobros recurrentes viejos
      discMonths = Math.max(1, Math.ceil(ms / (30 * 864e5)));
    }
    const t = run(`INSERT INTO tenants(slug,name,plan,status,created_at,discount_pct,discount_months,discount_until,coupon,plan_tier) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      slug, business, plan === 'once' ? 'once' : 'sub', 'pending_payment', now, discPct, discMonths, discUntil, couponCode, tier);
    const tid = Number(t.lastInsertRowid);
    const b = run("INSERT INTO branches(tenant_id,name) VALUES(?, 'Casa Central')", tid);
    const em = fc.encryptEmail(email); const eh = fc.emailHash(email);
    const u = run(`INSERT INTO users(tenant_id,email,email_hash,name,pass_hash,role,status,branch_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      tid, em, eh, name, hash, 'owner', 'active', Number(b.lastInsertRowid), now);
    if (coupon?.code) consumeCoupon(coupon.code, email, tid);
    audit(Number(u.lastInsertRowid), tid, 'tenant.created', { slug, plan, coupon: coupon?.code });
    return { uid: Number(u.lastInsertRowid), tid, slug };
  });
}


/** Features by plan tier (esencial | pro | completo). Modules can also be bought separately. */
function planFeatures(tenant) {
  const tier = tenant.plan_tier || 'esencial';
  const pro = tier === 'pro' || tier === 'completo';
  const full = tier === 'completo';
  return {
    tier,
    permits: pro,
    reports: pro,
    auto_close: pro,
    multi_suc: full || !!tenant.mod_suc,
    recibos: full || !!tenant.mod_rec,
  };
}

module.exports = { planFeatures, 
  createTenant, DEFAULTS, seed, holidaySet, getPrices, priceNotice, employeeLimit, employeeCount,
  slugify, findCoupon, consumeCoupon, chargeFor, applyApprovedPayment, applyRecurringCharge, legalIsPlaceholder, couponDurationMs, couponDurationLabel, tenantHasDiscount,
};
