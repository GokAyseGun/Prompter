export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const num = (v, d = 2) => (+v).toFixed(d).replace('.', ',');
export const fmtTime = s => {
  const neg = s < 0; s = Math.abs(Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  return (neg ? '−' : '') + (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
};
export const parseTime = str => {
  if (str == null) return null;
  const t = String(str).trim(); if (!t) return null;
  const p = t.split(/[:.,]/).map(x => parseInt(x, 10));
  if (p.some(isNaN)) return null;
  let s = 0; for (const v of p) s = s * 60 + v;
  return s > 0 ? s : null;
};
export const debounce = (fn, ms) => { let t = 0; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; d.cancel = () => clearTimeout(t); return d; };
export const fmtDate = d => {
  const x = new Date(d); if (isNaN(x)) return '';
  return x.toLocaleDateString('tr-TR', {day:'numeric', month:'short', year: x.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'})
    + ' ' + x.toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
};
export const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
export const rid = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');

let noteT = 0;
export function note(msg, ms = 2600){
  let n = document.getElementById('note');
  if (!n) { n = document.createElement('div'); n.id = 'note'; n.className = 'note'; document.body.appendChild(n); }
  n.textContent = msg; n.classList.add('show');
  clearTimeout(noteT); noteT = setTimeout(() => n.classList.remove('show'), ms);
}

export function hexRgb(h){
  const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [255,255,255];
  const v = parseInt(m[1], 16); return [v >> 16 & 255, v >> 8 & 255, v & 255];
}

export function download(name, text, type = 'application/json'){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function confirmBox(msg, okText = 'Tamam', cancelText = 'Vazgeç'){
  return new Promise(res => {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="modal-box small" role="dialog" aria-modal="true"><p class="confirm-msg">${esc(msg)}</p>
      <div class="modal-foot"><button class="btn" data-r="0" type="button">${esc(cancelText)}</button><button class="btn primary" data-r="1" type="button">${esc(okText)}</button></div></div>`;
    document.body.appendChild(m);
    const done = v => { m.remove(); res(v); };
    m.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); else if (e.target === m) done(false); });
    m.querySelector('[data-r="1"]').focus();
  });
}
