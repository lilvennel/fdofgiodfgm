'use strict';
// Sanitizador HTML por lista blanca, para textos legales editables desde el panel.
const ALLOWED = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'a', 'blockquote', 'small']);
const escText = (s) => s.replace(/&(?!#?\w+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function safeHref(v) {
  const h = String(v).trim();
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(h) ? h : null;
}
function sanitizeHtml(src) {
  src = String(src || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1\s*>/gi, '');
  if (!/<\/?[a-z][a-z0-9]*(?=[\s/>])/i.test(src)) { // texto plano: párrafos por línea en blanco
    return src.trim().split(/\n{2,}/).filter(Boolean).map((p) => `<p>${escText(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  }
  let out = '', last = 0, m;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  while ((m = re.exec(src))) {
    out += escText(src.slice(last, m.index)); last = re.lastIndex;
    const closing = m[1] === '/', tag = m[2].toLowerCase();
    if (!ALLOWED.has(tag)) continue;
    if (closing) { if (tag !== 'br' && tag !== 'hr') out += `</${tag}>`; continue; }
    if (tag === 'a') {
      const hm = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3]);
      const href = hm && safeHref(hm[1] ?? hm[2] ?? hm[3]);
      out += href ? `<a href="${escAttr(href)}" rel="noopener noreferrer"${/^https?:/i.test(href) ? ' target="_blank"' : ''}>` : '<a>';
    } else out += `<${tag}>`;
  }
  out += escText(src.slice(last));
  return out.trim();
}
module.exports = { sanitizeHtml };
