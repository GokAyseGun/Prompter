/* ================= Akış motoru (aynalı ekran) =================
   Konum birimi u = hece. Cihazlar arası konum her zaman harf sırası (c) ile aktarılır;
   böylece ekranlar arasında görünürlük farkı olsa da senkron bozulmaz.
   Lider ekran komutları işler; diğer ekranlar liderin durumunu izler. */
import { clamp, fmtTime, num, hexRgb, debounce } from './util.js';
import { S, DEV, prof, fontOf, MODES, setG, setP } from './settings.js';
import { analyze, speedText, TONE_VARS } from './text.js';

const el = {};
export const P = {
  on:false, cal:false, forcePat:false, A:null, chars:[], cls:null, applied:null, tokEls:[], lines:[], knots:[], KI:[], win:1, total:0, u:0,
  playing:false, ended:false, counting:false, countEnd:0, holdIdx:0, holdLeft:0,
  scroll:0, off:0, offV:0, W:0, H:0, anchor:0, fs:40, tone:115, base:[], lineH:50,
  boost:0, gain:1, lastH:0, mark:-1, lead:true, syncAdj:0, rateNow:0, fRate:null, jumpSeen:null,
  scriptId:null, title:'', body:'', targetSec:null, rev:0,
  playSec:0, activeSec:0, stops:0, rewinds:0, startedAt:0, uStart:0, maxU:0,
};
let H = { onExit(){}, onChange(){}, onProgress(){}, voice: () => null, level: () => -100 };

export function initStage(h){
  H = Object.assign(H, h);
  for (const id of ['stage','rot','mir','area','geo','calPat','calTxt','content','uline','arL','arR','fTop','fBot','frame','clock','vind','vlev','count','hud','stoast','prog','ctl','ctlPlay','ctlInfo','ctlMode','ctlLead'])
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
  el.calPat.addEventListener('click', e => { e.stopPropagation(); closePattern(); });
  // Kalibrasyon deseni açıkken klavye: ↑↓ uzunluk, ←→ eğim, + − genişlik, Esc kapat
  window.addEventListener('keydown', e => {
    if (!patternOn()) return;
    const pr = prof(), t = DEV.profile, step = e.shiftKey ? 5 : 1;
    const put = (k, v, lo, hi) => setP(t, k, Math.round(clamp(v, lo, hi) * 2) / 2);
    let used = true;
    if (e.key === 'ArrowUp') put('geoY', pr.geoY + step, 100, 160);
    else if (e.key === 'ArrowDown') put('geoY', pr.geoY - step, 100, 160);
    else if (e.key === 'ArrowRight') put('geoK', pr.geoK + step / 2, -25, 25);
    else if (e.key === 'ArrowLeft') put('geoK', pr.geoK - step / 2, -25, 25);
    else if (e.key === '+' || e.key === '=') put('geoX', pr.geoX + step, 70, 130);
    else if (e.key === '-' || e.key === '_') put('geoX', pr.geoX - step, 70, 130);
    else if (e.key === 'Escape') closePattern();
    else used = false;
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
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
      const tn = sh.tones && t.tone ? ' tn tn-' + t.tone : '';
      if (k) {
        const prev = A.tokens[p.tokens[k - 1]];
        if (tn && prev.tone === t.tone) { const sp = document.createElement('span'); sp.className = 'tn tn-' + t.tone; sp.textContent = ' '; d.appendChild(sp); }
        else d.appendChild(document.createTextNode(' '));
      }
      const s = document.createElement('span');
      s.className = 'tk' + (t.kind === 'hold' ? ' hold' : t.kind === 'b' ? ' br' : '') + (t.kind !== 'w' && !sh.marks ? ' hide' : '') + tn;
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
  P.base = [hexRgb(g.textColor), hexRgb(g.emphColor), hexRgb(g.noteColor), hexRgb(g.markColor), hexRgb(g.markColor)];
  el.content.style.setProperty('--mk', g.markColor); el.content.style.setProperty('--nt', g.noteColor);
  for (const [k, v] of TONE_VARS) el.content.style.setProperty(v, g[k]);
  el.uline.style.opacity = el.arL.style.opacity = el.arR.style.opacity = g.lineOpacity;
  el.uline.hidden = !sh.uline;
  el.arL.hidden = el.arR.hidden = !sh.arrows;
  el.fTop.hidden = el.fBot.hidden = !sh.focus;
  el.clock.hidden = !sh.clock || P.cal;
  el.prog.hidden = !sh.prog || P.cal;
  el.frame.hidden = !P.cal;
  el.geo.style.opacity = clamp((pr.bright ?? 100) / 100, 0.3, 1);
}

/* ---------- cam düzeltmesi ----------
   Prompter camı 45° dururken göz yansımaya açılı bakarsa harfler basık, cam/ekran eğikse yamuk görünür.
   Görüntü, okuma çizgisi yerinde kalacak şekilde uzatılır (uzunluk), açılır (genişlik) ve
   üst-alt genişliği farklılaştırılır (eğim: perspektif dönüşümü). Düzeltme aynalamanın içinde
   uygulandığından "üst/alt" camda okunan yöne göredir. */
const patternOn = () => P.on && P.cal && (P.forcePat || !!prof().calPattern);
function closePattern(){
  if (P.forcePat) { exit(); return; }
  setP(DEV.profile, 'calPattern', false);
}
function homography(src, dst){
  // 4 nokta eşlemesinden 3×3 izdüşüm matrisi (h33 = 1)
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let m = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
    [A[c], A[m]] = [A[m], A[c]]; [b[c], b[m]] = [b[m], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c]; if (!f) continue;
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
export function geoTransform(Wg, Hh, Wa, a, sX, sY, k){
  if (Math.abs(k) < 1e-4) return `matrix(${sX},0,0,${sY},${(Wa - sX * Wg) / 2},${a * (1 - sY)})`;
  const c = Wa / 2, hT = Wa / 2 * (1 + k), hB = Wa / 2 * (1 - k), yT = a - a * sY, yB = a + (Hh - a) * sY;
  const h = homography([[0, 0], [Wg, 0], [Wg, Hh], [0, Hh]], [[c - hT, yT], [c + hT, yT], [c + hB, yB], [c - hB, yB]]);
  // okuma çizgisi (orta noktası) tam yerinde kalsın
  const x = Wg / 2, w = h[6] * x + h[7] * a + 1, ym = (h[3] * x + h[4] * a + h[5]) / w, dy = a - ym;
  h[3] += dy * h[6]; h[4] += dy * h[7]; h[5] += dy;
  const f = v => +v.toFixed(9);
  return `matrix3d(${f(h[0])},${f(h[3])},0,${f(h[6])},${f(h[1])},${f(h[4])},0,${f(h[7])},0,0,1,0,${f(h[2])},${f(h[5])},0,1)`;
}
function drawPattern(){
  const on = patternOn(); el.calPat.hidden = el.calTxt.hidden = !on;
  if (!on) { el.calPat.textContent = ''; el.calTxt.textContent = ''; return; }
  // Desen (ızgara, daire, kare, artı) düzeltmeyle birlikte dönüşür; yazılar ve yön şeridi düzeltmeden bağımsız durur
  const W = P.W, Hh = P.H, a = P.anchor, cx = W / 2, pr = prof();
  const r = Math.max(30, Math.min(Hh * 0.3, W * 0.28)), g = r / 3;
  let grid = '';
  for (let x = cx % g; x < W; x += g) grid += `M${x.toFixed(1)} 0V${Hh}`;
  for (let y = a % g; y < Hh; y += g) grid += `M0 ${y.toFixed(1)}H${W}`;
  el.calPat.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" xmlns="http://www.w3.org/2000/svg">
    <path d="${grid}" stroke="rgba(166,220,242,.28)" stroke-width="1" fill="none"/>
    <path d="M0 ${a}H${W}" stroke="#e2aa2c" stroke-width="2" stroke-dasharray="10 8"/>
    <path d="M${cx} 0V${Hh}" stroke="rgba(166,220,242,.5)" stroke-width="1.5"/>
    <rect x="${cx - r}" y="${a - r}" width="${2 * r}" height="${2 * r}" fill="none" stroke="#a6dcf2" stroke-width="2.5"/>
    <circle cx="${cx}" cy="${a}" r="${r}" fill="none" stroke="#e2aa2c" stroke-width="3"/>
    <path d="M${cx - r * 0.18} ${a}H${cx + r * 0.18}M${cx} ${a - r * 0.18}V${a + r * 0.18}" stroke="#fff" stroke-width="3"/>
  </svg>`;
  const Wt = el.area.clientWidth || W, Ht = el.area.clientHeight || Hh, ct = Wt / 2;
  const fz = Math.max(13, Math.round(Math.min(Ht * 0.03, Wt * 0.02))), lh = Math.round(fz * 1.45);
  const sgn = v => (v > 0 ? '+' : '') + num(v, 1);
  const steps = ['1  Cam 45°, ekran düz, göz objektif hizasında', '2  Eğim: karenin yan kenarları paralel', '3  Uzunluk: daire karenin 4 kenarına değsin',
    '4  Genişlik: gerekiyorsa', '5  Okuma çizgisi: artı işareti objektifin önünde'];
  const txt = (x, y, t, o = '') => `<text x="${x}" y="${y}" ${o}>${t}</text>`;
  const bh = Math.max(8, fz * 0.8), by = Ht - fz * 0.9 - lh - bh, bw = Wt * 0.46;
  el.calTxt.innerHTML = `<svg viewBox="0 0 ${Wt} ${Ht}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" font-size="${fz}">
    <rect x="0" y="0" width="${fz * 25}" height="${fz * 1.6 + lh * 5.6}" fill="rgba(0,0,0,.72)"/>
    <rect x="${Wt - fz * 24}" y="0" width="${fz * 24}" height="${fz * 1.6 + lh * 1.6}" fill="rgba(0,0,0,.72)"/>
    <g fill="#e9f3f7">${txt(fz, fz * 1.6, 'KALİBRASYON', 'font-weight="700" letter-spacing="2"')}
      ${steps.map((t, i) => txt(fz, fz * 1.6 + lh * (i + 1), t, 'fill="#b9c8d3"')).join('')}
      ${txt(Wt - fz, fz * 1.6, `Uzunluk %${Math.round(pr.geoY)} · Genişlik %${Math.round(pr.geoX)} · Eğim ${sgn(pr.geoK)}`, 'text-anchor="end" fill="#e2aa2c"')}
      ${txt(Wt - fz, fz * 1.6 + lh, 'Kapatmak için dokunun · Esc', 'text-anchor="end" fill="#8a9aa6"')}</g>
    <rect x="${ct - bw / 2}" y="${by}" width="${bw}" height="${bh}" fill="#fff"/>
    ${txt(ct, by + bh + lh, 'Yön testi: cihazı 90° çevirip bu şeridin camdaki parlaklığını karşılaştırın', 'text-anchor="middle" fill="#8a9aa6"')}
  </svg>`;
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
  const Wa = W0 - 2 * side, sX = clamp((pr.geoX || 100) / 100, 0.5, 2), sY = clamp((pr.geoY || 100) / 100, 0.5, 2), gk = clamp((pr.geoK || 0) / 100, -0.4, 0.4);
  P.W = Math.round(Wa / sX); P.H = H0 - top - bot;
  el.geo.style.width = P.W + 'px'; el.geo.style.height = P.H + 'px';
  const fs = pr.size * 96 / 72, pad = Math.round(P.W * pr.margin / 100);
  P.fs = fs;
  el.content.style.fontSize = fs + 'px';
  P.anchor = Math.round(P.H * pr.anchor / 100);
  el.geo.style.transform = geoTransform(P.W, P.H, Wa, P.anchor, sX, sY, gk);
  // İlk satır baştan okuma çizgisi hizasında dursun (çizgi görünür olsun olmasın)
  const padTop = Math.max(Math.round(fs * 0.35), Math.round(P.anchor - fs * pr.lineHeight / 2));
  el.content.style.padding = `${padTop}px ${pad}px ${Math.round(P.H)}px`;
  // geri sayım ilk satırın üstündeki boşlukta görünsün, yazının üstüne binmesin
  const above = Math.max(0, P.anchor - fs * pr.lineHeight / 2);
  el.count.style.top = Math.round(above / 2) + 'px';
  el.count.style.fontSize = Math.round(Math.max(36, Math.min(Math.min(P.W, P.H) * 0.24, above * 0.8))) + 'px';
  const ar = Math.max(10, Math.round(fs * 0.22));
  for (const a of [el.arL, el.arR]) { a.style.borderTopWidth = a.style.borderBottomWidth = ar + 'px'; }
  el.arL.style.borderLeftWidth = el.arR.style.borderRightWidth = Math.round(ar * 1.3) + 'px';
  el.uline.style.height = Math.max(1, Math.round(fs * S.g.lineThick)) + 'px';
  const small = Math.max(13, Math.round(Math.min(fs * 0.3, P.H * 0.034)));
  el.clock.style.fontSize = small + 'px'; el.vind.style.fontSize = Math.round(small * 0.8) + 'px';
  measure();
  if (P.A) P.u = charToU(c0);
  P.off = 0; P.offV = 0; P.mark = -1;
  P.scroll = pathScroll(P.u);
  focusLayout();
  drawPattern();
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
  if (d < 0) rw();
  if (t < 0) seek(0); else if (t >= P.lines.length) seek(P.total); else seek(P.lines[t].uA);
}
function seekSection(d){
  const SE = P.A.sections;
  if (!SE.length) { toast('Metinde # bölüm başlığı yok'); return; }
  if (d > 0) { const s = SE.find(x => x.u > P.u + 0.01); if (s) { seek(s.u); toast(s.title); } else toast('Son bölümdesiniz'); }
  else {
    rw();
    let i = -1; for (let k = 0; k < SE.length; k++) if (SE[k].u < P.u - 0.01) i = k;
    if (i >= 0 && P.u - SE[i].u < S.g.sps * 1.5 && i > 0) i--;
    if (i >= 0) { seek(SE[i].u); toast(SE[i].title); } else { seek(0); toast('Başa dönüldü'); }
  }
}
/* Veriler: durma, geri sarma ve hız değişikliği noktaları (metindeki karakter konumuyla) */
function logEv(t){ if (!P.ev || P.ev.length >= 300 || !P.A) return; const k = tokAt(P.u), tk = k >= 0 ? P.A.tokens[k] : null; P.ev.push([t, tk ? tk.src : 0, +P.playSec.toFixed(1)]); }   // [tür, metindeki konum, okuma saniyesi]
function rw(){ P.rewinds++; logEv('r'); }
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
      else { P.playing = !P.playing; if (!P.playing) { P.stops++; logEv('s'); } }
      break;
    case 'play': if (!P.playing) action('toggle'); return;
    case 'pause': if (P.playing || P.counting) action('toggle'); return;
    case 'lineNext': seekLine(1); break;
    case 'linePrev': seekLine(-1); break;
    case 'sectionNext': seekSection(1); break;
    case 'sectionPrev': seekSection(-1); break;
    case 'faster': P.spdN++; logEv('+'); setSps(S.g.sps + 0.25); break;
    case 'slower': P.spdN++; logEv('-'); setSps(S.g.sps - 0.25); break;
    case 'restart': rw(); seek(0); toast('Başa dönüldü'); break;
    case 'modeCycle': { const i = MODES.findIndex(x => x[0] === S.g.mode); const m = MODES[(i + 1) % MODES.length]; setG('mode', m[0]); toast(m[1]); break; }
    case 'exit': exit(); return;
  }
  updateHud(); updateCtl(); H.onChange();
}
export function hold(a, on){
  if (!P.on || P.cal) return;
  const dir = a === 'boostFwd' || a === 'fwd' ? 1 : -1;
  if (on) { if (dir < 0 && P.boost >= 0) rw(); P.boost = dir; }
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
  P.gain = st.gain ?? 1; P.fRate = st.rate != null ? st.rate : null; P.holdLeft = st.holding ? Math.max(P.holdLeft, 0.05) : 0;
  const target = charToU(st.c) + (st.playing ? (P.fRate != null ? P.fRate : S.g.sps * P.gain) * 0.05 : 0);
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
  const fl = S.g.mode === 'follow'; for (const b of el.ctl.querySelectorAll('.leadbtn')) b.hidden = !fl;
  if (fl && el.ctlLead) el.ctlLead.textContent = num(S.g.followLead || 0, 1);
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
let vOpen = false, vLat = null;
function drawVoice(){
  if (S.g.mode === 'fixed' || !prof().show.voice || P.cal) { el.vind.hidden = true; return; }
  el.vind.hidden = false;
  el.vind.classList.toggle('on', vOpen);
  el.vind.dataset.m = S.g.mode === 'follow' ? `TAKİP · öne ${num(S.g.followLead || 0, 1)}` + (vLat != null && S.g.followAuto !== false ? ` · gecikme ≈${num(vLat, 1)} sn` : '') : 'SES';
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
export function start({body, scriptId = null, title = '', targetSec = null, startChar = 0, calibrate = false, lead = true, autoplay = true, pattern = false}){
  if (P.on) stopStage(true);
  if (!calibrate && S.g.fullscreen) requestFull();
  P.on = true; P.cal = calibrate; P.lead = lead; P.forcePat = calibrate && pattern;
  Object.assign(P, {jumpSeen: null, scriptId, title, body, targetSec, rev: P.rev + 1, u: 0, playing: false, ended: false, counting: false,
    scroll: 0, off: 0, offV: 0, boost: 0, gain: 1, holdIdx: 0, holdLeft: 0, lastH: 0, syncAdj: 0,
    playSec: 0, activeSec: 0, stops: 0, rewinds: 0, startedAt: Date.now(),
    ev: [], spdN: 0, holdSec: 0, boostSec: 0, vOpenSec: 0, toneSt: {}, sps0: S.g.sps, planSec: null});
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
      if (S.g.countdown) { P.counting = true; P.countEnd = performance.now() + 5000; el.count.hidden = false; el.count.textContent = '5'; }
      else P.playing = true;
    }
    if (!calibrate) P.planSec = +remainSec().toFixed(1);
    updateHud(); updateCtl(); H.onChange();
  };
  const fl = document.fonts && document.fonts.load ? document.fonts.load(`${S.g.italic ? 'italic ' : ''}${S.g.weight} 40px ${fontOf(S.g.font).fam}`, 'ĞğŞşİıÇçÖöÜü') : null;
  if (fl) Promise.race([fl, new Promise(r => setTimeout(r, 900))]).then(go, go); else go();
  H.onChange();
}
function stopStage(silent){
  P.on = false; P.playing = false; P.counting = false; P.boost = 0; P.cal = false; P.forcePat = false;
  el.calPat.hidden = el.calTxt.hidden = true; el.calPat.textContent = el.calTxt.textContent = '';
  el.count.hidden = true; el.hud.hidden = true; el.ctl.classList.remove('show'); el.vind.hidden = true;
  el.stage.hidden = true; document.body.classList.remove('stage-on');
  el.content.textContent = ''; P.chars = []; P.tokEls = []; P.lines = []; P.knots = [];
  if (!silent) {
    try { if (document.fullscreenElement && document.exitFullscreen && !H.keepFullscreen?.()) document.exitFullscreen().catch(() => {}); } catch (e) {}
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
    if (!H.keepAwake?.()) releaseWake();
  }
}
function takeExtra(){
  const pr = prof(), r1 = v => +(+v).toFixed(1), r3 = v => +(+v).toFixed(3);
  const tones = {}; for (const k in P.toneSt) { const b = P.toneSt[k]; if (b.s > 1) tones[k] = {u: r1(b.u), s: r1(b.s), sps: r3(b.u / b.s)}; }
  const wall = (Date.now() - P.startedAt) / 1000;
  return {
    v: 1, sps0: P.sps0, planSec: P.planSec, wallSec: r1(wall), pausedSec: r1(Math.max(0, wall - P.playSec)),
    holdSec: r1(P.holdSec), boostSec: r1(P.boostSec), voiceOpenSec: r1(P.vOpenSec), speedChanges: P.spdN,
    startChar: Math.floor(headChar(P.uStart)), endChar: Math.floor(headChar(P.maxU)), totalChars: P.chars ? P.chars.length : 0,
    syllablesTotal: r1(P.A.sylSum), avgSyl: r3(P.A.avgSyl), tones, ev: P.ev,
    cfg: {size: pr.size, lineHeight: pr.lineHeight, letter: pr.letter, margin: pr.margin, anchor: pr.anchor, geoY: pr.geoY, geoX: pr.geoX, geoK: pr.geoK, bright: pr.bright,
      font: S.g.font, weight: S.g.weight, pauseOn: S.g.pauseOn, pauseScale: S.g.pauseScale, lead: S.g.lead, followLead: S.g.followLead},
  };
}
export function exit(){
  if (!P.on) return;
  if (P.cal) { stopStage(false); return; }
  const take = {
    script_id: P.scriptId, script_title: P.title || '', started_at: new Date(P.startedAt).toISOString(), ended_at: new Date().toISOString(),
    play_sec: +P.playSec.toFixed(1), progress: P.total ? +(P.maxU / P.total).toFixed(4) : 0, completed: P.ended || P.maxU >= P.total - 0.01,
    syllables: +(P.A.sylSum * Math.max(0, P.maxU - P.uStart) / (P.total || 1)).toFixed(1), words: P.A.wc,
    actual_sps: P.activeSec > 3 ? +((P.maxU - P.uStart) / P.activeSec).toFixed(3) : null, set_sps: S.g.sps,
    mode: S.g.mode, stops: P.stops, rewinds: P.rewinds, profile: DEV.profile, device: DEV.name, target_sec: P.targetSec || null,
    extra: takeExtra(),
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
    gain: +P.gain.toFixed(3), rate: +(P.rateNow || 0).toFixed(3), sps: S.g.sps, avgSyl: P.A.avgSyl, mode: S.g.mode,
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
  const vf = H.voice();              // {open, targetC, rate, lat} — sadece lider kullanır
  vOpen = vf ? !!vf.open : false; vLat = vf && vf.lat != null ? vf.lat : null;
  if (P.lead) {
    if (P.boost) rate = P.boost * base * S.g.boostMul;
    else if (P.playing && !P.cal) {
      if (P.holdLeft > 0) P.holdLeft -= dt;
      else {
        let want = 1, fb = base;
        if (S.g.mode === 'gate' && vf) want = vf.open ? 1 : 0;
        if (S.g.mode === 'follow' && vf) {
          if (vf.targetC == null) want = vf.open ? 1 : 0;
          else {
            fb = clamp(vf.rate || base, 1.5, 10);                 // senin gerçek okuma hızın
            let diff = charToU(vf.targetC) - P.u;                  // tahmini okuduğun yer (+ öne alma) ile ekrandaki fark
            if (vf.jump != null && vf.jump !== P.jumpSeen) {          // okuyucu bilerek atladı (3+ kelime eşleşti): oraya git
              if (P.jumpSeen != null) { seek(charToU(vf.targetC)); diff = 0; }
              P.jumpSeen = vf.jump;
            }
            // gerideyken yumuşak yetiş, öndeyken sert fren: tahminin en fazla ~1 hece önüne geçer
            want = !vf.open ? 0 : diff >= 0 ? clamp(1 + diff / (fb * 0.9), 1, 2.2) : clamp(1 + diff / 1.2, 0, 1);
          }
        }
        const tau = want > P.gain ? 0.08 : (S.g.mode === 'follow' ? 0.12 : 0.22);
        P.gain += (want - P.gain) * (1 - Math.exp(-dt / tau));
        rate = fb * P.gain;
        // sesle takip: okuyucu durduysa ve ekran 1 kelimeden fazla öndeyse yavaşça okunan yere geri kay
        if (S.g.mode === 'follow' && vf && vf.targetC != null) {
          const back = charToU(vf.targetC) - P.u;
          if (back < -3.5) { P.backT = (P.backT || 0) + dt; if (P.backT > 0.6) rate = Math.max(-fb * 0.5, (back + 2) * 0.8); }
          else P.backT = 0;
        }
      }
    }
    P.rateNow = rate;
  } else if (P.playing && P.holdLeft <= 0) {
    rate = P.fRate != null ? P.fRate : base * P.gain;
    if (P.syncAdj) { const k = Math.min(1, dt * 3); P.u += P.syncAdj * k; P.syncAdj *= (1 - k); if (Math.abs(P.syncAdj) < 0.01) P.syncAdj = 0; }
  }
  if (P.playing || P.holdLeft > 0) P.playSec += dt;
  if (!P.cal) {
    if (P.holdLeft > 0 && P.playing) P.holdSec += dt;
    if (P.boost) P.boostSec += dt;
    if (vOpen && P.playing) P.vOpenSec += dt;
  }
  const u0 = P.u;
  if (rate !== 0) {
    let nu = P.u + rate * dt;
    if (rate > 0 && !P.boost) {
      const Hs = P.A.holds;
      if (P.lead && S.g.mode !== 'follow' && P.holdIdx < Hs.length && nu >= Hs[P.holdIdx].u) { nu = Hs[P.holdIdx].u; P.holdLeft = Hs[P.holdIdx].sec; P.holdIdx++; }
    } else if (rate < 0) { const Hs = P.A.holds; while (P.holdIdx > 0 && Hs[P.holdIdx - 1].u > nu) P.holdIdx--; }
    P.u = clamp(nu, 0, P.total);
    if (rate > 0.05 * base) {
      P.activeSec += dt;
      if (!P.boost && !P.cal && P.u > u0) {             // okunuş bölümüne göre gerçek hız
        const k = tokAt(P.u), tn = (k >= 0 && P.A.tokens[k].tone) || 'normal';
        const b = P.toneSt[tn] || (P.toneSt[tn] = {u: 0, s: 0});
        b.u += P.u - u0; b.s += dt;
      }
    }
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
