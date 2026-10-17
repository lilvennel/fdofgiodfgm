'use strict';
const cfg = require('./config');
const { all } = require('./db');
const mailer = require('./mailer');
const fc = require('./fieldcrypto');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Notifica al dueño por email (Resend) y opcionalmente WhatsApp (ALERT_WHATSAPP_URL) */
function notifyOwner(tenantId, { title, detail }) {
  try {
    const owners = all("SELECT email, name FROM users WHERE tenant_id=? AND role='owner' AND status='active'", tenantId);
    for (const o of owners) {
      const email = fc.decryptEmail(o.email) || o.email;
      if (!email || !String(email).includes('@')) continue;
      const html = `<p><strong>${esc(title)}</strong></p><p>${esc(detail || '')}</p><p style="color:#64748b;font-size:13px">AsistOK · aviso automático. Revisá el panel de notificaciones.</p>`;
      mailer.sendMail(email, `[AsistOK] ${title}`, html);
    }
    if (cfg.ALERT_WHATSAPP_URL) {
      const text = encodeURIComponent(title + (detail ? ' — ' + detail : ''));
      const url = cfg.ALERT_WHATSAPP_URL.includes('{text}')
        ? cfg.ALERT_WHATSAPP_URL.replace('{text}', text)
        : cfg.ALERT_WHATSAPP_URL + (cfg.ALERT_WHATSAPP_URL.includes('?') ? '&' : '?') + 'text=' + text;
      fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) }).catch(() => {});
    }
  } catch (e) {
    console.error('[alerts]', e.message);
  }
}

module.exports = { notifyOwner };
