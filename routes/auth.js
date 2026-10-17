'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('../lib/config');
const { route, bad, HttpError, cookie, rateLimit, notFound, failCheck, failRecord, failClear } = require('../lib/http');
const { get, all, run, tx, getSetting, audit } = require('../lib/db');
const sec = require('../lib/security');
const dom = require('../lib/domain');
const mp = require('../lib/mp');
const { sendMail, esc } = require('../lib/mailer');
const { clean, emailOk, tenantView } = require('./common');
const fc = require('../lib/fieldcrypto');
const { sanitizeHtml } = require('../lib/sanitize');

// ---- H2: confirmación de email (token de un solo uso, 24 h, guardado hasheado) ----
const VERIFY_TTL_MS = 24 * 3600e3;

function issueVerification(user) {
  const token = sec.randomToken(32), now = Date.now();
  run('DELETE FROM email_verifications WHERE user_id=?', user.id);
  run('INSERT INTO email_verifications(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)', sec.sha(token), user.id, now + VERIFY_TTL_MS, now);
  const link = `${cfg.APP_URL}/?verify=${token}`;
  const to = fc.decryptEmail(user.email) || user.email;

  sendMail(to, 'Confirmá tu email · AsistOK', `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0fdfa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdfa;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,118,110,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f766e 0%,#14b8a6 100%);padding:32px 40px;text-align:center;">
            <span style="color:#ffffff;font-size:22px;font-weight:700;">⏱ AsistOK</span>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#0f172a;line-height:1.3;">Confirmá tu email</h1>
            <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6;">
              Hola ${esc(user.name)}, gracias por registrarte en <strong style="color:#0f766e;">AsistOK</strong>. Solo falta un paso para activar tu cuenta.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr><td align="center">
                <a href="${link}" style="display:inline-block;background-color:#0f766e;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:10px;box-shadow:0 4px 14px rgba(15,118,110,0.35);">
                  Verificar mi correo
                </a>
              </td></tr>
            </table>
            <p style="margin:0 0 8px;font-size:14px;color:#64748b;line-height:1.5;">Este enlace es válido por <strong>24 horas</strong>.</p>
            <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.5;">Si no creaste una cuenta en AsistOK, podés ignorar este correo.</p>
            <div style="height:1px;background-color:#e2e8f0;margin:28px 0;"></div>
            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.5;">
              Si el botón no funciona, copiá y pegá este enlace:<br>
              <a href="${link}" style="color:#0f766e;word-break:break-all;">${link}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="margin:0 0 6px;font-size:13px;color:#64748b;">© 2025 AsistOK · Control de asistencia</p>
            <p style="margin:0;font-size:12px;color:#94a3b8;">Hecho para comercios y equipos en Argentina</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `).catch((e) => console.error('[mail]', e.message));
}

// ---- H5: límites de login solo por FALLOS; cada IP se bloquea a sí misma, nadie puede dejar afuera a otra persona ----
const LOGIN_PAIR = { free: 4, windowMs: 15 * 60e3, baseLockMs: 60e3, maxLockMs: 15 * 60e3 };
const LOGIN_IP = { free: 25, windowMs: 15 * 60e3, baseLockMs: 5 * 60e3, maxLockMs: 30 * 60e3 };

const setSession = (ctx, userId) => {
  const token = sec.createSession(userId);
  ctx.setCookie(cookie('sid', token, { maxAge: cfg.SESSION_DAYS * 86400 }));
};

const heroPublic = () => {
  const h = getSetting('hero', dom.DEFAULTS.hero);
  return { ...h, slides: (h.slides || []).map((s) => ({ id: s.id })) };
};

route('GET', '/api/public/hero/:id', (ctx) => {
  const sl = (getSetting('hero', dom.DEFAULTS.hero).slides || []).find((x) => x.id === ctx.params.id);
  const file = sl && path.join(cfg.DATA_DIR, 'uploads', 'site', sl.file);
  if (!sl || !fs.existsSync(file)) throw notFound('Imagen no encontrada');
  return { __file: { buf: fs.readFileSync(file), filename: sl.file, mime: sl.mime, inline: true, cache: 'public, max-age=86400' } };
});

route('GET', '/api/public/reviews', (ctx) => {
  const rows = all(`SELECT r.stars, r.text, r.author_name, t.id as tid, t.name as business, t.logo_path
    FROM reviews r JOIN tenants t ON t.id = r.tenant_id
    WHERE r.approved = 1 ORDER BY r.created_at DESC LIMIT 12`);
  return { reviews: rows.map((r) => ({
    stars: r.stars, text: r.text, author: r.author_name, business: r.business,
    logo_url: r.logo_path ? '/api/public/tenant-logo/' + r.tid : null,
  })) };
});

route('GET', '/api/public/tenant-logo/:tid', (ctx) => {
  const tid = String(ctx.params.tid || '').replace(/\D/g, '');
  if (!tid) throw notFound();
  const ok = get('SELECT 1 FROM reviews r WHERE r.tenant_id=? AND r.approved=1 LIMIT 1', Number(tid));
  if (!ok) throw notFound();
  const row = get('SELECT logo_path FROM tenants WHERE id=?', Number(tid));
  if (!row?.logo_path) throw notFound();
  const file = path.join(cfg.DATA_DIR, 'uploads', row.logo_path);
  if (!fs.existsSync(file)) throw notFound();
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { __file: { buf: fs.readFileSync(file), filename: 'logo' + ext, mime, inline: true, cache: 'public, max-age=300' } };
});

route('GET', '/api/public/config', () => ({
  prices: dom.getPrices(),
  free_employees: getSetting('free_employees', 40),
  hero: heroPublic(),
  contact: getSetting('contact', dom.DEFAULTS.contact),
  notice: dom.priceNotice(),
  payments: { mp: mp.enabled(), demo: !mp.enabled() && cfg.ALLOW_DEMO_PAYMENTS, provider: 'mercadopago' },
  email_verification: cfg.REQUIRE_EMAIL_VERIFICATION,
  app_url: cfg.APP_URL,
}));

route('GET', '/api/public/legal', () => {
  const l = getSetting('legal', dom.DEFAULTS.legal);
  return { privacy_html: sanitizeHtml(l.privacy), terms_html: sanitizeHtml(l.terms), placeholder: dom.legalIsPlaceholder() };
});

route('GET', '/api/public/tenant/:slug', (ctx) => {
  const t = get('SELECT name, slug, status FROM tenants WHERE slug=?', ctx.params.slug);
  if (!t || t.status !== 'active') throw notFound('Ese negocio no existe o no está activo');
  return { name: t.name, slug: t.slug };
});

route('POST', '/api/auth/register', async (ctx) => {
  rateLimit('reg:' + ctx.ip, 8, 3600e3);
  if (!ctx.body.accept_terms) throw bad('Tenés que aceptar los Términos y condiciones para registrarte');
  if (!ctx.body.accept_privacy) throw bad('Tenés que aceptar la Política de privacidad para registrarte');
  const business = clean(ctx.body.business, 80);
  const email = clean(ctx.body.email).toLowerCase();
  const password = ctx.body.password;
  if (business.length < 2) throw bad('Ingresá el nombre del negocio');
  if (!emailOk(email)) throw bad('Email inválido');
  const pwErr = sec.passwordProblem(password, email);
  if (pwErr) throw bad(pwErr);
  if (sec.findUserByEmail(email)) throw new HttpError(409, 'EMAIL_TAKEN', 'Ese email ya tiene una cuenta');
  const plan = ctx.body.plan === 'once' ? 'once' : 'sub';
  const plan_tier = ['esencial', 'pro', 'completo'].includes(ctx.body.plan_tier) ? ctx.body.plan_tier : 'esencial';
  let coupon = null;
  if (ctx.body.coupon && String(ctx.body.coupon).trim()) {
    coupon = dom.findCoupon(ctx.body.coupon, 'new', email, plan, plan_tier);
    if (!coupon) throw bad('El código de descuento no es válido, no aplica a este plan, venció o ya lo usaste');
  }
  const hash = await sec.hashPassword(password);
  const out = dom.createTenant({ business, email, name: clean(ctx.body.name, 80) || business, hash, plan, coupon, plan_tier });
  setSession(ctx, out.uid);
  const user = get('SELECT * FROM users WHERE id=?', out.uid);
  issueVerification(user);
  return { user: sec.publicUser(user), tenant: tenantView(get('SELECT * FROM tenants WHERE id=?', out.tid)) };
});

route('POST', '/api/auth/login', async (ctx) => {
  const email = clean(ctx.body.email).toLowerCase();
  const pw = String(ctx.body.password || '');
  const ipKey = 'lf-ip:' + ctx.ip, pairKey = 'lf:' + email.slice(0, 200) + '|' + ctx.ip;
  failCheck(ipKey); failCheck(pairKey);
  const u = sec.findUserByEmail(email);
  const ok = await sec.verifyPassword(pw, u ? u.pass_hash : sec.DUMMY);
  if (!u || !ok) {
    failRecord(pairKey, LOGIN_PAIR); failRecord(ipKey, LOGIN_IP);
    throw new HttpError(401, 'BAD_CREDENTIALS', 'Email o contraseña incorrectos');
  }
  failClear(pairKey);
  if (u.status === 'pending') {
    let extra = '';
    if (cfg.REQUIRE_EMAIL_VERIFICATION && !u.email_verified_at) {
      try { rateLimit('resendv:' + u.id, 3, 3600e3); issueVerification(u); extra = ' Te reenviamos el email para confirmar tu dirección.'; } catch { /* límite de reenvíos */ }
    }
    throw new HttpError(403, 'AUTH_PENDING', 'Tu cuenta todavía está pendiente. Avisale a tu empleador que te autorice desde su panel (Empleados → Pendientes) y volvé a ingresar.' + extra);
  }
  if (u.status !== 'active') throw new HttpError(403, 'ACCOUNT_DISABLED', 'Tu cuenta está deshabilitada. Consultá con tu empleador para que te vuelva a habilitar.');
  setSession(ctx, u.id);
  run('UPDATE users SET last_login=? WHERE id=?', Date.now(), u.id);
  return { user: sec.publicUser(u) };
});

route('POST', '/api/auth/logout', (ctx) => {
  sec.destroySession(ctx.cookies.sid);
  ctx.setCookie(cookie('sid', '', { maxAge: 0 }));
  return { ok: true };
});

route('GET', '/api/auth/me', (ctx) => {
  const user = sec.userFromSession(ctx.cookies.sid);
  if (!user || user.status !== 'active') return { user: null };
  const tenant = user.tenant_id ? get('SELECT * FROM tenants WHERE id=?', user.tenant_id) : null;
  return {
    user: sec.publicUser(user),
    tenant: tenantView(tenant, user.role),
    prices: user.role === 'owner' ? dom.getPrices() : undefined,
    notice: user.role === 'owner' ? dom.priceNotice() : null,
    app_url: cfg.APP_URL,
  };
});

route('POST', '/api/auth/password', { auth: 'user', anyStatus: true }, async (ctx) => {
  const { current, password } = ctx.body;
  rateLimit('chpw:' + ctx.user.id, 10, 15 * 60e3);
  if (!(await sec.verifyPassword(String(current || ''), ctx.user.pass_hash))) throw new HttpError(401, 'BAD_CREDENTIALS', 'La contraseña actual no es correcta');
  const plainEmail = fc.decryptEmail(ctx.user.email) || ctx.user.email;
  const err = sec.passwordProblem(password, plainEmail);
  if (err) throw bad(err);
  let legalSql = '';
  const legalParams = [];
  if (ctx.user.must_change_pw) {
    if (!ctx.body.accept_terms) throw bad('Tenés que aceptar los Términos y condiciones');
    if (!ctx.body.accept_privacy) throw bad('Tenés que aceptar la Política de privacidad');
    legalSql = ', legal_accepted_at=?';
    legalParams.push(Date.now());
  }
  run(`UPDATE users SET pass_hash=?, must_change_pw=0${legalSql} WHERE id=?`,
    await sec.hashPassword(password), ...legalParams, ctx.user.id);
  sec.destroyUserSessions(ctx.user.id);
  setSession(ctx, ctx.user.id);
  audit(ctx.user.id, ctx.user.tenant_id, 'password.changed', ctx.user.must_change_pw ? { legal: true } : undefined);
  return { ok: true };
});

route('POST', '/api/auth/forgot', async (ctx) => {
  rateLimit('forgot:' + ctx.ip, 6, 3600e3);
  const email = clean(ctx.body.email).toLowerCase();
  let u = emailOk(email) ? sec.findUserByEmail(email) : null; if (u && u.status !== 'active') u = null;
  if (u) {
    const token = sec.randomToken(32);
    run('DELETE FROM resets WHERE user_id=?', u.id);
    run('INSERT INTO resets(token_hash,user_id,expires_at) VALUES(?,?,?)', sec.sha(token), u.id, Date.now() + 3600e3);
    const link = `${cfg.APP_URL}/?reset=${token}`;
    const to = fc.decryptEmail(u.email) || u.email;
    sendMail(to, 'Recuperá tu contraseña · AsistOK', `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0fdfa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdfa;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,118,110,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f766e 0%,#14b8a6 100%);padding:32px 40px;text-align:center;">
            <span style="color:#ffffff;font-size:22px;font-weight:700;">⏱ AsistOK</span>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#0f172a;line-height:1.3;">Restablecé tu contraseña</h1>
            <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6;">
              Hola ${esc(u.name)}, recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong style="color:#0f766e;">AsistOK</strong>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr><td align="center">
                <a href="${link}" style="display:inline-block;background-color:#0f766e;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:10px;box-shadow:0 4px 14px rgba(15,118,110,0.35);">
                  Restablecer contraseña
                </a>
              </td></tr>
            </table>
            <p style="margin:0 0 8px;font-size:14px;color:#64748b;line-height:1.5;">Este enlace es válido por <strong>60 minutos</strong>.</p>
            <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.5;">Si no solicitaste este cambio, podés ignorar este correo. Tu cuenta seguirá segura.</p>
            <div style="height:1px;background-color:#e2e8f0;margin:28px 0;"></div>
            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.5;">
              Si el botón no funciona, copiá y pegá este enlace:<br>
              <a href="${link}" style="color:#0f766e;word-break:break-all;">${link}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="margin:0 0 6px;font-size:13px;color:#64748b;">© 2025 AsistOK · Control de asistencia</p>
            <p style="margin:0;font-size:12px;color:#94a3b8;">Hecho para comercios y equipos en Argentina</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`);
  }
  return { ok: true };
});

route('POST', '/api/auth/reset', async (ctx) => {
  rateLimit('reset:' + ctx.ip, 10, 3600e3);
  const r = get('SELECT * FROM resets WHERE token_hash=?', sec.sha(String(ctx.body.token || '')));
  if (!r || r.expires_at < Date.now()) throw bad('El link venció. Pedí uno nuevo.', 'RESET_EXPIRED');
  const u = get('SELECT * FROM users WHERE id=?', r.user_id);
  if (!u) throw bad('El link venció. Pedí uno nuevo.', 'RESET_EXPIRED');
  const err = sec.passwordProblem(ctx.body.password, u.email);
  if (err) throw bad(err);
  run('UPDATE users SET pass_hash=?, must_change_pw=0, email_verified_at=COALESCE(email_verified_at,?) WHERE id=?', await sec.hashPassword(ctx.body.password), Date.now(), u.id);
  run('DELETE FROM resets WHERE user_id=?', u.id);
  sec.destroyUserSessions(u.id);
  audit(u.id, u.tenant_id, 'password.reset');
  return { ok: true };
});

route('POST', '/api/public/join/:slug', async (ctx) => {
  rateLimit('join:' + ctx.ip, 10, 3600e3);
  const t = get("SELECT * FROM tenants WHERE slug=? AND status='active'", ctx.params.slug);
  if (!t) throw notFound('Ese negocio no existe o no está activo');
  const name = clean(ctx.body.name, 80), email = clean(ctx.body.email).toLowerCase();
  if (name.length < 2) throw bad('Ingresá tu nombre completo');
  if (!emailOk(email)) throw bad('Email inválido');
  const err = sec.passwordProblem(ctx.body.password, email);
  if (err) throw bad(err);
  if (sec.findUserByEmail(email)) throw new HttpError(409, 'EMAIL_TAKEN', 'Ese email ya está registrado');
  const first = get('SELECT id FROM branches WHERE tenant_id=? ORDER BY id LIMIT 1', t.id);
  const hash = await sec.hashPassword(ctx.body.password);
  const newId = tx(() => {
    const packed = sec.packEmail(email);
    const u = run(`INSERT INTO users(tenant_id,email,email_hash,name,pass_hash,role,status,branch_id,hire_date,created_at)
                   VALUES(?,?,?,?,?,'employee','pending',?,?,?)`, t.id, packed.email, packed.email_hash, name, hash, first?.id || null, new Date().toISOString().slice(0, 10), Date.now());
    run("INSERT INTO notifs(tenant_id,type,user_id,ref_id,text,detail,created_at) VALUES(?,?,?,?,?,?,?)",
      t.id, 'auth', Number(u.lastInsertRowid), Number(u.lastInsertRowid), `Alta por link — ${name}`, email, Date.now());
    return Number(u.lastInsertRowid);
  });
  issueVerification({ id: newId, email, name });
  return { ok: true, email_verification: cfg.REQUIRE_EMAIL_VERIFICATION };
});

route('POST', '/api/auth/verify-email', (ctx) => {
  rateLimit('verify:' + ctx.ip, 20, 3600e3);
  const r = get('SELECT * FROM email_verifications WHERE token_hash=?', sec.sha(String(ctx.body.token || '')));
  if (!r || r.expires_at < Date.now()) throw bad('El link venció o ya se usó. Pedí uno nuevo desde tu panel.', 'VERIFY_EXPIRED');
  const u = get('SELECT id,tenant_id FROM users WHERE id=?', r.user_id);
  if (!u) throw bad('El link venció o ya se usó. Pedí uno nuevo desde tu panel.', 'VERIFY_EXPIRED');
  tx(() => {
    run('UPDATE users SET email_verified_at=COALESCE(email_verified_at,?) WHERE id=?', Date.now(), u.id);
    run('DELETE FROM email_verifications WHERE user_id=?', u.id);
  });
  audit(u.id, u.tenant_id, 'email.verified');
  return { ok: true };
});

route('POST', '/api/auth/resend-verification', { auth: 'user', anyStatus: true }, (ctx) => {
  if (ctx.user.email_verified_at) return { ok: true, already: true };
  rateLimit('resendv:' + ctx.user.id, 5, 3600e3);
  issueVerification(ctx.user);
  return { ok: true };
});
