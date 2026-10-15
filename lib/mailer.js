'use strict';
const cfg = require('./config');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Enmascara destinatario en logs: j***@dominio.com */
const mask = (to) => {
  const [u, d] = String(to || '').split('@');
  return d ? `${(u || '').slice(0, 1)}***@${d}` : '***';
};

const MAX_ATTEMPTS = 5;
const queue = []; // { id, to, subject, html, attempts, nextAt }
let seq = 0;
let processing = false;

async function deliver(to, subject, html) {
  if (!cfg.RESEND_API_KEY) {
    if (cfg.STRICT) {
      console.warn(`[mail] Sin RESEND_API_KEY: no se envió a ${mask(to)}. Contenido no registrado.`);
    } else {
      // Dev: sin tokens completos en log si el HTML trae links largos
      const plain = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200);
      console.log(`[mail:dev] Para: ${mask(to)} | Asunto: ${subject} | ${plain}…`);
    }
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${cfg.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.MAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) {
    // No loguear body del proveedor (puede repetir el email)
    throw new Error('Email: proveedor respondió ' + res.status);
  }
  return true;
}

/**
 * Encola el mail y intenta enviarlo. Reintentos con backoff.
 * Nunca loguea el email completo ni el HTML con tokens.
 */
function sendMail(to, subject, html) {
  const job = {
    id: ++seq,
    to: String(to || '').trim(),
    subject: String(subject || ''),
    html: String(html || ''),
    attempts: 0,
    nextAt: Date.now(),
  };
  if (!job.to) return Promise.resolve(false);
  queue.push(job);
  setImmediate(pump);
  return Promise.resolve(true);
}

async function pump() {
  if (processing) return;
  processing = true;
  try {
    const now = Date.now();
    for (let i = 0; i < queue.length; i++) {
      const job = queue[i];
      if (job.nextAt > now) continue;
      try {
        job.attempts++;
        await deliver(job.to, job.subject, job.html);
        queue.splice(i, 1);
        i--;
      } catch (e) {
        console.error(`[mail] fallo intento ${job.attempts}/${MAX_ATTEMPTS} → ${mask(job.to)}: ${e.message}`);
        if (job.attempts >= MAX_ATTEMPTS) {
          queue.splice(i, 1);
          i--;
        } else {
          // backoff: 30s, 2m, 8m, 30m…
          const delay = Math.min(30 * 60e3, 30e3 * Math.pow(4, job.attempts - 1));
          job.nextAt = Date.now() + delay;
        }
      }
    }
  } finally {
    processing = false;
  }
}

/** Llamar desde el job horario */
function processQueue() {
  setImmediate(pump);
  return { pending: queue.length };
}

module.exports = { sendMail, esc, mask, processQueue };
