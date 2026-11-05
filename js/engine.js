/* ================= Akış motoru (aynalı ekran) =================
   Konum birimi u = hece. Cihazlar arası konum her zaman harf sırası (c) ile aktarılır;
   böylece ekranlar arasında görünürlük farkı olsa da senkron bozulmaz.
   Lider ekran komutları işler; diğer ekranlar liderin durumunu izler. */
import { clamp, fmtTime, num, hexRgb, debounce } from './util.js';
import { S, DEV, prof, fontOf, MODES, setG } from './settings.js';
import { analyze, speedText } from './text.js';

const el = {};
const NOTE_RGB = [166, 220, 242], HEAD_RGB = [226, 170, 44], CUE_RGB = [127, 138, 150];
export const P = {
  on:false, cal:false, A:null, chars:[], cls:null, applied:null, tokEls:[], lines:[], knots:[], KI:[], win:1, total:0, u:0,
  playing:false, ended:false, counting:false, countEnd:0, holdIdx:0, holdLeft:0,
  scroll:0, off:0, offV:0, W:0, H:0, anchor:0, fs:40, tone:115, base:[], lineH:50,
  boost:0, gain:1, lastH:0, mark:-1, lead:true, syncAdj:0,
  scriptId:null, title:'', body:'', targetSec:null, rev:0,
  playSec:0, activeSec:0, stops:0, rewinds:0, startedAt:0, uStart:0, maxU:0,
};
let H = { onExit(){}, onChange(){}, onProgress(){}, voice: () => null, level: () => -100 };

export function initStage(h){
  H = Object.assign(H, h);
  for (const id of ['stage','rot','mir','area','content','uline','arL','arR','fTop','fBot','frame','clock','vind','vlev','count','hud','stoast','prog','ctl','ctlPlay','ctlInfo','ctlMode'])
    el[id] = document.getElementById(id);
  el.ctl.addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    e.stopPropagation(); H.input ? H.input(b.dataset.a) : action(b.dataset.a); if (P.on) showCtl();
  });
  for (const b of el.ctl.querySelectorAll('button[data-hold]')) {
    const a = b.dataset.hold;
    const on = e => { e.preventDefault(); e.stopPropagation(); H.inputHold ? H.inputHold(a, true) : hold(a, true); };
    const off = () => { H.inputHold ? H.inputHold(a, false) : hold(a, false); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  }
  el.stage.addEventListener('pointerdown', e => {
    if (!P.on || P.cal || e.target.closest('#ctl') || e.target.closest('.stage-top')) return;
    if (e.pointerType !== 'mouse') { showCtl(); H.input ? H.input('toggle') : action('toggle'); }
  });
  el.stage.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') showCtl(); });
  el.ctl.addEventListener('pointerenter', () => { overCtl = true; });
  el.ctl.addEventListener('pointerleave', () => { overCtl = false; showCtl(); });
  let rT = 0;
  const re = () => { clearTimeout(rT); rT = setTimeout(() => { if (P.on) layout(); }, 80); };
  window.addEventListener('resize', re);
  window.addEventListener('orientationchange', re);
  document.addEventListener('fullscreenchange', re);
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', re);
  document.addEventListener('visibilitychange', () => { if (P.on && document.visibilityState === 'visible') lockWake(); });
}

/* ---------- kurulum ---------- */
function build(body){
  const sh = prof().show;
  const A = analyze(body, {...S.g, hide: {n: !sh.notes, h: !sh.heads}});
  const frag = document.createDocumentFragment(), chars = [], cls = [], tokEls = [];
  A.paras.forEach(p => {
    if (p.type === 'gap') { const g = document.createElement('div'); g.className = 'gap'; frag.appendChild(g); return; }
    const d = document.createElement('div'); d.className = 'para' + (p.type === 'h' ? ' hd' : p.type === 'n' ? ' nt' : '');
    if (p.hidden) d.hidden = true;
    p.tokens.forEach((ti, k) => {
      const t = A.tokens[ti];
      if (k) d.appendChild(document.createTextNode(' '));
      const s = document.createElement('span');
      s.className = 'tk' + (t.kind === 'hold' ? ' hold' : t.kind === 'b' ? ' br' : '') + (t.kind !== 'w' && !sh.marks ? ' hide' : '');
      for (const ch of t.chars) {
        const e = document.createElement('span'); e.textContent = ch.ch;
        let c = 0;
        if (t.kind !== 'w') c = 4; else if (p.type === 'h') c = 3; else if (p.type === 'n') c = 2; else if (ch.e && sh.emph) { c = 1; e.className = 'em'; }
        s.appendChild(e); chars.push(e); cls.push(c);
      }
      d.appendChild(s); tokEls[ti] = (p.hidden || (t.kind !== 'w' && !sh.marks)) ? null : s;
    });
    frag.appendChild(d);
  });
  el.content.textContent = '';
  el.content.appendChild(frag);
  P.A = A; P.chars = chars; P.cls = Uint8Array.from(cls); P.tokEls = tokEls; P.total = A.totalU;
  P.applied = new Float32Array(chars.length).fill(-1);
}
function applyStyle(){
  const pr = prof(), g = S.g, sh = pr.show;
  const c = el.content.style;
  c.fontFamily = fontOf(g.font).fam + ', system-ui, sans-serif';
  c.fontWeight = g.weight; c.fontStyle = g.italic ? 'italic' : 'normal';
  c.lineHeight = pr.lineHeight; c.letterSpacing = pr.letter + 'em';
  c.textAlign = g.align; c.color = g.textColor;
  el.content.style.setProperty('--em', g.emphColor);
  el.mir.style.transform = `scale(${pr.mirror === 'h' ? -1 : 1},${pr.flipV ? -1 : 1})`;
  P.tone = Math.round(255 * g.readTone);
  P.base = [hexRgb(g.textColor), hexRgb(g.emphColor), NOTE_RGB, HEAD_RGB, CUE_RGB];
  el.uline.hidden = !sh.uline;
  el.arL.hidden = el.arR.hidden = !sh.arrows;
  el.fTop.hidden = el.fBot.hidden = !sh.focus;
  el.clock.hidden = !sh.clock || P.cal;
  el.prog.hidden = !sh.prog || P.cal;
  el.frame.hidden = !P.cal;
}
function computeRotation(){
  const vw = window.innerWidth, vh = window.innerHeight, pr = prof();
  let r = 0;
  if (pr.orientation !== 'auto' && ((pr.orientation === 'landscape') !== (vw >= vh))) r = pr.rotateDir || 90;
  const W = r ? vh : vw, Hh = r ? vw : vh;
  el.rot.style.width = W + 'px'; el.rot.style.height = Hh + 'px';
  el.rot.style.transform = `translate(-50%,-50%) rotate(${r}deg)`;
  return [W, Hh];
}
function layout(){
  if (!P.on) return;
  const c0 = P.A ? headChar() : 0;
  const [W0, H0] = computeRotation(), pr = prof();
  const top = Math.round(H0 * pr.cropTop / 100), bot = Math.round(H0 * pr.cropBottom / 100), side = Math.round(W0 * pr.cropSide / 100);
  el.area.style.inset = `${top}px ${side}px ${bot}px ${side}px`;
  P.W = W0 - 2 * side; P.H = H0 - top - bot;
  const fs = pr.size * 96 / 72, pad = Math.round(P.W * pr.margin / 100);
  P.fs = fs;
  el.content.style.fontSize = fs + 'px';
  el.content.style.padding = `${Math.round(fs * 0.35)}px ${pad}px ${Math.round(P.H)}px`;
  P.anchor = Math.round(P.H * pr.anchor / 100);
  el.count.style.top = P.anchor + 'px';
  const ar = Math.max(10, Math.round(fs * 0.22));
  for (const a of [el.arL, el.arR]) { a.style.borderTopWidth = a.style.borderBottomWidth = ar + 'px'; }
  el.arL.style.borderLeftWidth = el.arR.style.borderRightWidth = Math.round(ar * 1.3) + 'px';
  el.uline.style.height = Math.max(2, Math.round(fs * 0.05)) + 'px';
  const small = Math.max(13, Math.round(Math.min(fs * 0.3, P.H * 0.034)));
  el.clock.style.fontSize = small + 'px'; el.vind.style.fontSize = Math.round(small * 0.8) + 'px';
  measure();
  if (P.A) P.u = charToU(c0);
  P.off = 0; P.offV = 0; P.mark = -1;
  P.scroll = pathScroll(P.u);
  focusLayout();
}
function measure(){
  const L = [], A = P.A;
  let cur = null;
  A.tokens.forEach((t, i) => {
    const s = P.tokEls[i]; if (!s) return;
    const top = s.offsetTop, h = s.offsetHeight || 1, left = s.offsetLeft, right = left + s.offsetWidth;
    if (!cur || Math.abs(top - cur.top) > h * 0.5) { cur = {top, h, left, right, uA: t.u0, uB: t.u0 + t.dur}; L.push(cur); }
    else { cur.uB = t.u0 + t.dur; cur.h = Math.max(cur.h, h); cur.left = Math.min(cur.left, left); cur.right = Math.max(cur.right, right); }
  });
  for (const l of L) l.center = l.top + l.h / 2;
  P.lines = L;
  const K = [];
  for (let i = 0; i < L.length; i++) {
    const y = i ? (L[i - 1].center + L[i].center) / 2 : L[0].center - ((L[1] ? L[1].center - L[0].center : L[0].h) / 2);
    K.push({x: L[i].uA, y});
  }
  if (L.length) {
    const l = L[L.length - 1], prev = L.length > 1 ? L[L.length - 2] : null;
    K.push({x: Math.max(P.total, l.uB) + 0.001, y: l.center + (prev ? (l.center - prev.center) / 2 : l.h / 2)});
  }
  for (let i = 1; i < K.length; i++) if (K[i].x <= K[i - 1].x) K[i].x = K[i - 1].x + 1e-3;
  P.knots = K;
  const I = [0];
  for (let i = 1; i < K.length; i++) I[i] = I[i - 1] + (K[i].x - K[i - 1].x) * (K[i].y + K[i - 1].y) / 2;
  P.KI = I;
  const d = []; for (let i = 1; i < K.length; i++) d.push(K[i].x - K[i - 1].x);
  d.sort((a, b) => a - b);
  P.win = Math.max(0.3, d.length ? 0.3 * d[d.length >> 1] : 1);
  const sp = []; for (let i = 1; i < L.length; i++) sp.push(L[i].center - L[i - 1].center);
  sp.sort((a, b) => a - b);
  P.lineH = sp.length ? sp[sp.length >> 1] : P.fs * 1.3;
}
function knotIndex(u){ const K = P.knots; let lo = 0, hi = K.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (K[m].x <= u) lo = m; else hi = m; } return lo; }
function readY(u){
  const K = P.knots, n = K.length; if (!n) return 0;
  if (u <= K[0].x) return K[0].y; if (u >= K[n - 1].x) return K[n - 1].y;
  const i = knotIndex(u), a = K[i], b = K[i + 1]; return a.y + (b.y - a.y) * (u - a.x) / (b.x - a.x);
}
function integ(u){
  const K = P.knots, n = K.length; if (!n) return 0;
  if (u <= K[0].x) return (u - K[0].x) * K[0].y;
  if (u >= K[n - 1].x) return P.KI[n - 1] + (u - K[n - 1].x) * K[n - 1].y;
  const i = knotIndex(u); return P.KI[i] + (u - K[i].x) * (K[i].y + readY(u)) / 2;
}
const pathScroll = u => Math.max(0, (integ(u + P.win) - integ(u - P.win)) / (2 * P.win) - P.anchor);

/* ---------- konum ---------- */
function tokAt(u){ const T = P.A.tokens; let lo = 0, hi = T.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m].u0 <= u) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
export function headChar(u = P.u){
  if (!P.A) return 0;
  const i = tokAt(u); if (i < 0) return 0;
  const t = P.A.tokens[i];
  return t.dur > 0 ? t.c0 + t.len * clamp((u - t.u0) / t.dur, 0, 1) : t.c0 + t.len;
}
export function charToU(c){
  const T = P.A.tokens; let lo = 0, hi = T.length - 1, r = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m].c0 <= c) { r = m; lo = m + 1; } else hi = m - 1; }
  const t = T[r]; if (!t) return 0;
  return t.u0 + (t.len ? t.dur * clamp((c - t.c0) / t.len, 0, 1) : 0);
}
function lineAt(u){ const L = P.lines; let lo = 0, hi = L.length - 1, r = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (L[m].uA <= u) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
function markerLine(u){
  const L = P.lines; if (!L.length) return 0;
  let i = lineAt(u);
  if (i < L.length - 1) {
    const l = L[i], end = Math.min(l.uB, L[i + 1].uA);
    if (u >= Math.max(l.uA + (end - l.uA) * 0.5, end - S.g.lead)) i++;
  }
  return i;
}

/* ---------- solma ---------- */
const charT = (i, h) => { const d = h - i; return d <= 0 ? 0 : Math.min(1, d / S.g.fadeWidth); };
function applyChar(i, t){
  const q = t >= 1 ? 1 : Math.round(t * 40) / 40;
  if (P.applied[i] === q) return;
  P.applied[i] = q;
  const st = P.chars[i].style;
  if (q <= 0) { st.color = ''; st.opacity = ''; return; }
  const b = P.base[P.cls[i]], g = P.tone;
  st.color = `rgb(${Math.round(b[0] + (g - b[0]) * q)},${Math.round(b[1] + (g - b[1]) * q)},${Math.round(b[2] + (g - b[2]) * q)})`;
  st.opacity = (1 + (S.g.readOpacity - 1) * q).toFixed(3);
}
function updateFades(){
  const h = headChar(), n = P.chars.length;
  if (h < P.lastH) {
    const a = Math.max(0, Math.floor(h - S.g.fadeWidth) - 1), b = Math.min(n - 1, Math.ceil(P.lastH) + 1);
    for (let i = a; i <= b; i++) applyChar(i, charT(i, h));
  }
  for (let i = Math.min(n - 1, Math.ceil(h)); i >= 0; i--) {
    const t = charT(i, h);
    if (t >= 1 && P.applied[i] === 1) break;
    applyChar(i, t);
  }
  P.lastH = h;
}
function fullRefresh(){ const h = headChar(); P.applied.fill(-1); for (let i = 0; i < P.chars.length; i++) applyChar(i, charT(i, h)); P.lastH = h; }

/* ---------- gezinme ---------- */
function seek(u, smooth = true){
  const before = P.scroll;
  P.u = clamp(u, 0, P.total);
  P.ended = P.u >= P.total;
  if (P.ended) P.playing = false;
  P.holdLeft = 0;
  const Hs = P.A.holds; let k = 0; while (k < Hs.length && Hs[k].u < P.u + 1e-6) k++; P.holdIdx = k;
  P.off = smooth ? before - pathScroll(P.u) : 0; P.offV = 0;
  fullRefresh(); updateHud(); H.onChange();
}
function seekLine(d){
  if (!P.lines.length) return;
  const t = lineAt(P.u) + d;
  if (d < 0) P.rewinds++;
  if (t < 0) seek(0); else if (t >= P.lines.length) seek(P.total); else seek(P.lines[t].uA);
}
function seekSection(d){
  const SE = P.A.sections;
  if (!SE.length) { toast('Metinde # bölüm başlığı yok'); return; }
  if (d > 0) { const s = SE.find(x => x.u > P.u + 0.01); if (s) { seek(s.u); toast(s.title); } else toast('Son bölümdesiniz'); }
  else {
    P.rewinds++;
    let i = -1; for (let k = 0; k < SE.length; k++) if (SE[k].u < P.u - 0.01) i = k;
    if (i >= 0 && P.u - SE[i].u < S.g.sps * 1.5 && i > 0) i--;
    if (i >= 0) { seek(SE[i].u); toast(SE[i].title); } else { seek(0); toast('Başa dönüldü'); }
  }
}
const setSpsSoon = debounce(v => setG('sps', v), 150);
function setSps(v, quiet){
  S.g.sps = clamp(Math.round(v * 100) / 100, 1.5, 10);
  setSpsSoon(S.g.sps);
  if (!quiet) toast(speedText(S.g.sps, P.A.avgSyl));
  updateCtl(); H.onChange();
}

/* Lider ekranda (veya tek cihazda) çalışan eylemler */
export function action(a){
  if (!P.on || P.cal) return;
  switch (a) {
    case 'toggle':
      if (P.counting) { P.counting = false; el.count.hidden = true; P.playing = true; }
      else if (P.ended) { seek(0); P.playing = true; }
      else { P.playing = !P.playing; if (!P.playing) P.stops++; }
      break;
    case 'play': if (!P.playing) action('toggle'); return;
    case 'pause': if (P.playing || P.counting) action('toggle'); return;
    case 'lineNext': seekLine(1); break;
    case 'linePrev': seekLine(-1); break;
    case 'sectionNext': seekSection(1); break;
    case 'sectionPrev': seekSection(-1); break;
    case 'faster': setSps(S.g.sps + 0.25); break;
    case 'slower': setSps(S.g.sps - 0.25); break;
    case 'restart': P.rewinds++; seek(0); toast('Başa dönüldü'); break;
    case 'modeCycle': { const i = MODES.findIndex(x => x[0] === S.g.mode); const m = MODES[(i + 1) % MODES.length]; setG('mode', m[0]); toast(m[1]); break; }
    case 'exit': exit(); return;
  }
  updateHud(); updateCtl(); H.onChange();
}
export function hold(a, on){
  if (!P.on || P.cal) return;
  const dir = a === 'boostFwd' || a === 'fwd' ? 1 : -1;
  if (on) { if (dir < 0 && P.boost >= 0) P.rewinds++; P.boost = dir; }
  else if (P.boost === dir) P.boost = 0;
}
let stickToast = 0;
export function stick(mode, x, dt){
  if (!P.on || P.cal) return;
  if (mode === 'speed') {
    setSps(S.g.sps - x * 1.2 * dt, true);
    const now = performance.now(); if (now - stickToast > 250) { stickToast = now; toast(speedText(S.g.sps, P.A.avgSyl)); }
  } else if (mode === 'scrub') {
    P.u = clamp(P.u + x * S.g.sps * 6 * dt, 0, P.total);
    P.ended = P.u >= P.total;
  }
}
export function remote(cmd){
  switch (cmd.action) {
    case 'setSps': setSps(+cmd.value); return;
    case 'seekChar': seek(charToU(+cmd.value)); return;
    case 'seekSection': { const s = P.A.sections[+cmd.value]; if (s) { seek(s.u); toast(s.title); } return; }
    case 'hold': hold(cmd.value, !!cmd.on); return;
    case 'stick': stick(cmd.mode, +cmd.x, +cmd.dt || 0.016); return;
    default: action(cmd.action);
  }
}

/* Canlı düzenleme: konumu koruyarak metni yenile */
export function applyEdit(body, title){
  if (!P.on || P.cal || typeof body !== 'string') return;
  const old = P.body, i = tokAt(P.u), t = i >= 0 ? P.A.tokens[i] : null;
  let src = t ? t.src : 0; const frac = t && t.dur ? (P.u - t.u0) / t.dur : 0;
  let pre = 0; const n = Math.min(old.length, body.length); while (pre < n && old[pre] === body[pre]) pre++;
  if (src >= pre) src = Math.max(pre, src + body.length - old.length);
  P.body = body; if (title != null) P.title = title; P.rev++;
  const wasPlaying = P.playing;
  build(body); applyStyle(); layout();
  const T = P.A.tokens; let k = T.findIndex(x => x.src >= src); if (k < 0) k = T.length - 1;
  seek(k >= 0 ? T[k].u0 + (T[k].src === src ? frac * T[k].dur : 0) : 0, false);
  P.playing = wasPlaying && !P.ended;
  toast('Metin güncellendi');
  H.onChange();
}
/* Ayar değişince (yerel veya başka cihazdan) görünümü yenile */
export function restyle(rebuild){
  if (!P.on) return;
  const c = headChar();
  if (rebuild) build(P.body);
  applyStyle(); layout();
  P.u = charToU(c); P.scroll = pathScroll(P.u); fullRefresh();
}

/* Takipçi ekran: liderin durumuna uy */
export function follow(st){
  if (!P.on || P.cal || P.lead || !st || !st.onStage) return;
  if (st.rev != null && st.body == null && st.scriptId !== P.scriptId) return;
  P.playing = !!st.playing; P.ended = !!st.ended;
  if (st.counting && !P.counting) { P.counting = true; P.countEnd = performance.now() + (st.countLeft || 0); el.count.hidden = false; }
  if (!st.counting && P.counting) { P.counting = false; el.count.hidden = true; }
  P.gain = st.gain ?? 1; P.holdLeft = st.holding ? Math.max(P.holdLeft, 0.05) : 0;
  const target = charToU(st.c) + (st.playing ? S.g.sps * P.gain * 0.12 : 0);
  const diff = target - P.u;
  if (Math.abs(diff) > S.g.sps * 2.5) seek(target); else P.syncAdj = diff;
  updateHud();
}

/* ---------- arayüz ---------- */
let toastT = 0;
export function toast(msg, ms = 1400){
  if (!el.stoast) return;
  el.stoast.textContent = msg; el.stoast.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.stoast.classList.remove('show'), ms);
}
function updateHud(){
  if (P.cal) { el.hud.hidden = false; el.hud.textContent = 'Hazır · ' + DEV.name; return; }
  if (P.counting || P.playing) { el.hud.hidden = true; return; }
  el.hud.hidden = false; el.hud.textContent = P.ended ? 'Bitti' : 'Duraklatıldı';
}
const PLAY_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4A.8.8 0 0 0 8 5.6z"/></svg>';
const PAUSE_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>';
let lastPlayIcon = null;
export const remainSec = () => {
  if (!P.A) return 0;
  let h = 0; for (let k = P.holdIdx; k < P.A.holds.length; k++) h += P.A.holds[k].sec;
  return (P.total - P.u) / S.g.sps + h + Math.max(0, P.holdLeft);
};
function updateCtl(){
  if (!P.A) return;
  const playing = P.playing || P.counting;
  if (playing !== lastPlayIcon) { el.ctlPlay.innerHTML = playing ? PAUSE_SVG : PLAY_SVG; lastPlayIcon = playing; }
  const pct = P.total ? Math.round(P.u / P.total * 100) : 0;
  el.ctlInfo.innerHTML = `<b>${Math.round(S.g.sps * 60 / P.A.avgSyl)}</b> kelime/dk · ${num(S.g.sps)} hece/sn<br>%${pct} · kalan ${fmtTime(remainSec())}`;
  el.ctlMode.textContent = (MODES.find(x => x[0] === S.g.mode) || MODES[0])[1];
}
let ctlT = 0, overCtl = false;
export function showCtl(){
  if (P.cal) return;
  el.ctl.classList.add('show'); el.stage.classList.remove('idle'); updateCtl();
  clearTimeout(ctlT);
  ctlT = setTimeout(() => { if (!overCtl) { el.ctl.classList.remove('show'); el.stage.classList.add('idle'); } }, 2800);
}
function focusLayout(){
  const k = S.g.focusStrength, lh = P.lineH || P.fs * 1.3;
  el.fTop.style.height = Math.max(0, P.anchor - lh * 1.6) + 'px';
  el.fTop.style.background = `linear-gradient(rgba(0,0,0,${k}), rgba(0,0,0,${(k * 0.6).toFixed(3)}) 70%, rgba(0,0,0,0))`;
  el.fBot.style.top = Math.min(P.H, P.anchor + lh * 2.6) + 'px';
  el.fBot.style.background = `linear-gradient(rgba(0,0,0,0), rgba(0,0,0,${(k * 0.55).toFixed(3)}) 45%, rgba(0,0,0,${k}))`;
}
function drawMarker(){
  const L = P.lines; if (!L.length) return;
  const i = markerLine(P.u), l = L[i]; if (!l) return;
  const pad = P.fs * 0.06;
  const y = l.top + l.h + Math.max(1, P.fs * 0.03) - P.scroll;
  el.uline.style.transform = `translate3d(${(l.left - pad).toFixed(1)}px,${y.toFixed(1)}px,0)`;
  if (P.mark !== i) { el.uline.style.width = (l.right - l.left + pad * 2).toFixed(1) + 'px'; P.mark = i; }
  const cy = l.center - P.scroll;
  el.arL.style.transform = el.arR.style.transform = `translate3d(0,${cy.toFixed(1)}px,0) translateY(-50%)`;
}
let lastClock = 0;
function drawClock(now){
  if (el.clock.hidden || now - lastClock < 250) return; lastClock = now;
  const rem = remainSec();
  let s = `${fmtTime(P.playSec)} <span>· kalan ${fmtTime(rem)}</span>`;
  if (P.targetSec) {
    const diff = P.playSec + rem - P.targetSec;
    const cls = Math.abs(diff) < 3 ? 'ok' : diff > 0 ? 'late' : 'early';
    s += `<br><i class="${cls}">hedef ${fmtTime(P.targetSec)} · ${diff > 0 ? '+' : ''}${fmtTime(diff)}</i>`;
  }
  el.clock.innerHTML = s;
}
let vOpen = false;
function drawVoice(){
  if (S.g.mode === 'fixed' || !prof().show.voice || P.cal) { el.vind.hidden = true; return; }
  el.vind.hidden = false;
  el.vind.classList.toggle('on', vOpen);
  el.vind.dataset.m = S.g.mode === 'follow' ? 'TAKİP' : 'SES';
  const lv = H.level(), pct = clamp((lv + 70) / 60, 0, 1);
  el.vlev.style.setProperty('--lv', (pct * 100).toFixed(1) + '%');
  el.vlev.style.setProperty('--th', (clamp((S.g.gateDb + 70) / 60, 0, 1) * 100).toFixed(1) + '%');
  el.vlev.classList.toggle('hot', lv > S.g.gateDb);
}

/* ---------- başlat / bitir ---------- */
let wakeLock = null;
export async function lockWake(){ try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {} }
function releaseWake(){ if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
function lockOrientation(){
  const o = prof().orientation;
  try { if (o !== 'auto' && screen.orientation && screen.orientation.lock) screen.orientation.lock(o).catch(() => {}); } catch (e) {}
}
export function requestFull(){
  if (document.fullscreenElement) return;
  const d = document.documentElement, req = d.requestFullscreen || d.webkitRequestFullscreen;
  if (req) { try { const pr = req.call(d); if (pr && pr.then) pr.then(lockOrientation).catch(() => {}); } catch (e) {} }
}
export function start({body, scriptId = null, title = '', targetSec = null, startChar = 0, calibrate = false, lead = true, autoplay = true}){
  if (P.on) stopStage(true);
  if (!calibrate && S.g.fullscreen) requestFull();
  P.on = true; P.cal = calibrate; P.lead = lead;
  Object.assign(P, {scriptId, title, body, targetSec, rev: P.rev + 1, u: 0, playing: false, ended: false, counting: false,
    scroll: 0, off: 0, offV: 0, boost: 0, gain: 1, holdIdx: 0, holdLeft: 0, lastH: 0, syncAdj: 0,
    playSec: 0, activeSec: 0, stops: 0, rewinds: 0, startedAt: Date.now()});
  document.body.classList.add('stage-on');
  el.stage.hidden = false;
  el.stage.classList.toggle('cal', calibrate);
  build(body); applyStyle(); layout();
  if (startChar > 0) seek(charToU(startChar), false); else fullRefresh();
  P.uStart = P.u; P.maxU = P.u;
  lockWake();
  el.hud.hidden = true; lastPlayIcon = null; updateCtl(); el.stage.classList.add('idle');
  updateHud();
  const go = () => {
    if (!P.on) return;
    layout(); if (startChar > 0) seek(charToU(startChar), false);
    if (!calibrate && lead && autoplay) {
      if (S.g.countdown) { P.counting = true; P.countEnd = performance.now() + 3000; el.count.hidden = false; el.count.textContent = '3'; }
      else P.playing = true;
    }
    updateHud(); updateCtl(); H.onChange();
  };
  const fl = document.fonts && document.fonts.load ? document.fonts.load(`${S.g.italic ? 'italic ' : ''}${S.g.weight} 40px ${fontOf(S.g.font).fam}`, 'ĞğŞşİıÇçÖöÜü') : null;
  if (fl) Promise.race([fl, new Promise(r => setTimeout(r, 900))]).then(go, go); else go();
  H.onChange();
}
function stopStage(silent){
  P.on = false; P.playing = false; P.counting = false; P.boost = 0; P.cal = false;
  el.count.hidden = true; el.hud.hidden = true; el.ctl.classList.remove('show'); el.vind.hidden = true;
  el.stage.hidden = true; document.body.classList.remove('stage-on');
  el.content.textContent = ''; P.chars = []; P.tokEls = []; P.lines = []; P.knots = [];
  if (!silent) {
    try { if (document.fullscreenElement && document.exitFullscreen && !H.keepFullscreen?.()) document.exitFullscreen().catch(() => {}); } catch (e) {}
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
    if (!H.keepAwake?.()) releaseWake();
  }
}
export function exit(){
  if (!P.on) return;
  if (P.cal) { stopStage(false); return; }
  const take = {
    script_id: P.scriptId, script_title: P.title || '', started_at: new Date(P.startedAt).toISOString(), ended_at: new Date().toISOString(),
    play_sec: +P.playSec.toFixed(1), progress: P.total ? +(P.maxU / P.total).toFixed(4) : 0, completed: P.ended || P.maxU >= P.total - 0.01,
    syllables: +(P.A.sylSum * Math.max(0, P.maxU - P.uStart) / (P.total || 1)).toFixed(1), words: P.A.wc,
    actual_sps: P.activeSec > 3 ? +((P.maxU - P.uStart) / P.activeSec).toFixed(3) : null, set_sps: S.g.sps,
    mode: S.g.mode, stops: P.stops, rewinds: P.rewinds, profile: DEV.profile, device: DEV.name,
  };
  const lastChar = P.ended ? 0 : Math.floor(headChar());
  const info = {take, lastChar, scriptId: P.scriptId, lead: P.lead};
  stopStage(false);
  H.onExit(info);
}
export const stopSilently = () => { if (P.on) stopStage(false); };

export function state(){
  if (!P.on || P.cal) return {onStage: false};
  return {onStage: true, scriptId: P.scriptId, title: P.title, rev: P.rev, c: +headChar().toFixed(2), u: P.u, total: P.total,
    playing: P.playing, counting: P.counting, countLeft: P.counting ? Math.max(0, P.countEnd - performance.now()) : 0, ended: P.ended,
    gain: +P.gain.toFixed(3), sps: S.g.sps, avgSyl: P.A.avgSyl, mode: S.g.mode,
    elapsed: P.playSec, remain: remainSec(), target: P.targetSec, voiceOpen: vOpen, holding: P.holdLeft > 0,
    sections: P.A.sections.map(s => s.title), pct: P.total ? P.u / P.total : 0};
}

/* ---------- kare döngüsü ---------- */
function smoothDamp(cur, target, vel, st, dt){
  const om = 2 / st, x = om * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const ch = cur - target, tmp = (vel + om * ch) * dt;
  return [target + (ch + tmp) * ex, (vel - om * tmp) * ex];
}
let lastInfo = 0, lastProg = 0;
export function tick(now, dt){
  if (!P.on) return;
  if (P.counting) {
    const r = P.countEnd - now;
    if (r <= 0) { P.counting = false; el.count.hidden = true; if (P.lead) P.playing = true; updateHud(); updateCtl(); H.onChange(); }
    else el.count.textContent = Math.ceil(r / 1000);
  }
  const base = S.g.sps;
  let rate = 0;
  const vf = H.voice();              // {open, targetC, lastHit} — sadece lider kullanır
  vOpen = vf ? !!vf.open : false;
  if (P.lead) {
    if (P.boost) rate = P.boost * base * S.g.boostMul;
    else if (P.playing && !P.cal) {
      if (P.holdLeft > 0) P.holdLeft -= dt;
      else {
        let want = 1;
        if (S.g.mode === 'gate' && vf) want = vf.open ? 1 : 0;
        if (S.g.mode === 'follow' && vf) {
          if (vf.targetC == null) want = vf.open ? 1 : 0;
          else {
            const diff = charToU(vf.targetC) + base * 0.45 - P.u;
            want = clamp(1 + diff / (base * 1.2), 0, 2.6);
            if (!vf.open && now - vf.lastHit > 1200) want = 0;
          }
        }
        const tau = want > P.gain ? 0.08 : 0.22;
        P.gain += (want - P.gain) * (1 - Math.exp(-dt / tau));
        rate = base * P.gain;
      }
    }
  } else if (P.playing && P.holdLeft <= 0) {
    rate = base * P.gain;
    if (P.syncAdj) { const k = Math.min(1, dt * 3); P.u += P.syncAdj * k; P.syncAdj *= (1 - k); if (Math.abs(P.syncAdj) < 0.01) P.syncAdj = 0; }
  }
  if (P.playing || P.holdLeft > 0) P.playSec += dt;
  if (rate !== 0) {
    let nu = P.u + rate * dt;
    if (rate > 0 && !P.boost) {
      const Hs = P.A.holds;
      if (P.lead && P.holdIdx < Hs.length && nu >= Hs[P.holdIdx].u) { nu = Hs[P.holdIdx].u; P.holdLeft = Hs[P.holdIdx].sec; P.holdIdx++; }
    } else if (rate < 0) { const Hs = P.A.holds; while (P.holdIdx > 0 && Hs[P.holdIdx - 1].u > nu) P.holdIdx--; }
    P.u = clamp(nu, 0, P.total);
    if (rate > 0.05 * base) P.activeSec += dt;
    if (P.u >= P.total && rate > 0) { P.u = P.total; P.playing = false; P.ended = true; updateHud(); updateCtl(); H.onChange(); }
    else if (P.ended && P.u < P.total) { P.ended = false; updateHud(); }
  }
  if (P.u > P.maxU) P.maxU = P.u;
  updateFades();
  if (P.off !== 0) {
    const r = smoothDamp(P.off, 0, P.offV, 0.35, dt);
    P.off = r[0]; P.offV = r[1];
    if (Math.abs(P.off) < 0.05 && Math.abs(P.offV) < 0.5) { P.off = 0; P.offV = 0; }
  }
  P.scroll = pathScroll(P.u) + P.off;
  el.content.style.transform = `translate3d(0,${(-P.scroll).toFixed(2)}px,0)`;
  drawMarker();
  el.prog.style.transform = `scaleX(${P.total ? (P.u / P.total).toFixed(4) : 0})`;
  drawClock(now); drawVoice();
  if (now - lastInfo > 300 && el.ctl.classList.contains('show')) { lastInfo = now; updateCtl(); }
  if (P.lead && !P.cal && now - lastProg > 5000) { lastProg = now; H.onProgress(Math.floor(headChar())); }
}
