/* Tuş atama: klavye, fare (düğme + tekerlek), kontrolcü (tuş + eksen + analog çubuk) */
import { $, esc, note } from './util.js';
import { S, ACTIONS, REPEAT, HOLD, save } from './settings.js';

const MOUSE = ['Sol tık','Orta tık','Sağ tık','Yan tuş (geri)','Yan tuş (ileri)'];
const PAD_BTN = ['✕ Çarpı','○ Daire','□ Kare','△ Üçgen','L1','R1','L2','R2','Share / Create','Options','L3 (sol çubuk bas)','R3 (sağ çubuk bas)','Yön ↑','Yön ↓','Yön ←','Yön →','PS tuşu','Dokunmatik yüzey'];
const PAD_AXIS = [['Sol çubuk ←','Sol çubuk →'],['Sol çubuk ↑','Sol çubuk ↓'],['Sağ çubuk ←','Sağ çubuk →'],['Sağ çubuk ↑','Sağ çubuk ↓']];
export const actionName = id => (ACTIONS.find(a => a[0] === id) || ['', id])[1];

export function sameB(a, b){
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'key':   return (a.code && b.code) ? a.code === b.code : a.key === b.key;
    case 'mouse': return a.button === b.button;
    case 'wheel': return a.dir === b.dir;
    case 'pad':   return a.button === b.button;
    case 'axis':  return a.axis === b.axis && a.dir === b.dir;
  }
  return false;
}
function keyName(b){
  if (b.code === 'Space') return 'Boşluk';
  const map = {ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Escape:'Esc',Enter:'Enter',Backspace:'Geri sil',Delete:'Delete',
    Tab:'Tab',PageUp:'Page Up',PageDown:'Page Down',Home:'Home',End:'End',Shift:'Shift',Control:'Ctrl',Alt:'Alt',AltGraph:'Alt Gr',
    Meta:'⌘ / Win',CapsLock:'Caps Lock',Insert:'Insert',ContextMenu:'Menü',MediaPlayPause:'Oynat/Duraklat',MediaTrackNext:'Sonraki',
    MediaTrackPrevious:'Önceki',AudioVolumeUp:'Ses +',AudioVolumeDown:'Ses −'};
  let k = b.key;
  if (map[k]) k = map[k];
  else if (k && k.length === 1) k = k.toLocaleUpperCase('tr');
  else if (!k || k === 'Unidentified') k = b.code || '?';
  if (b.code && b.code.startsWith('Numpad')) k = 'Num ' + k;
  return k;
}
export function bLabel(b){
  switch (b.type) {
    case 'key':   return ['Klavye', keyName(b)];
    case 'mouse': return ['Fare', MOUSE[b.button] || ('Düğme ' + b.button)];
    case 'wheel': return ['Fare', b.dir === 'up' ? 'Tekerlek yukarı' : 'Tekerlek aşağı'];
    case 'pad':   return ['Kontrolcü', PAD_BTN[b.button] || ('Tuş ' + b.button)];
    case 'axis':  return ['Kontrolcü', PAD_AXIS[b.axis] ? PAD_AXIS[b.axis][b.dir > 0 ? 1 : 0] : `Eksen ${b.axis} ${b.dir > 0 ? '+' : '−'}`];
  }
  return ['', '?'];
}
export function findAction(desc){
  for (const [id] of ACTIONS) for (const b of S.binds[id]) if (sameB(b, desc)) return id;
  return null;
}

/* ---------- Dağıtıcı ---------- */
let H = { live: () => false, action(){}, hold(){}, idleToggle(){}, stick(){} };
export function setHandler(h){ H = Object.assign(H, h); }
function fire(a, phase){              // phase: 'down' | 'repeat' | 'up'
  if (HOLD.has(a)) { if (phase !== 'repeat') H.hold(a, phase === 'down'); return; }
  if (phase === 'up') return;
  if (phase === 'repeat' && !REPEAT.has(a)) return;
  H.action(a);
}

/* ---------- Tuş yakalama ---------- */
let CAP = null, lastCapAt = 0, onBindsChanged = () => {};
export const capturing = () => !!CAP;
export function renderBinds(el){
  el.innerHTML = ACTIONS.map(([id, name, sub]) => {
    const chips = S.binds[id].map((b, i) => { const [t, l] = bLabel(b);
      return `<span class="chip"><em>${t}</em>${esc(l)}<button type="button" data-rm="${id}:${i}" title="Kaldır" aria-label="Kaldır">×</button></span>`; }).join('');
    return `<div class="bind-row"><div class="bind-name">${name}${sub ? `<small>${sub}</small>` : ''}</div>
      <div class="chips">${chips || '<span class="none">Atanmış tuş yok</span>'}</div>
      <button class="btn" type="button" data-add="${id}">+ Tuş ata</button></div>`;
  }).join('');
}
export function wireBinds(el){
  onBindsChanged = () => renderBinds(el);
  renderBinds(el);
  el.addEventListener('click', e => {
    const add = e.target.closest('[data-add]'); if (add) { openCapture(add.dataset.add); return; }
    const rm = e.target.closest('[data-rm]');
    if (rm) { const [id, i] = rm.dataset.rm.split(':'); S.binds[id].splice(+i, 1); save(); renderBinds(el); }
  });
  const z = $('#capZone');
  z.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') return; e.preventDefault(); assign({type:'mouse', button:e.button}); });
  z.addEventListener('wheel', e => { e.preventDefault(); if (Math.abs(e.deltaY) < 1) return; assign({type:'wheel', dir: e.deltaY < 0 ? 'up' : 'down'}); }, {passive:false});
  $('#capCancel').addEventListener('click', closeCapture);
}
function openCapture(action){
  CAP = {action, base: padSnapshot()};
  $('#capTitle').textContent = '“' + actionName(action) + '”';
  updateCapPad();
  $('#capModal').hidden = false;
  $('#capZone').focus();
}
function closeCapture(){
  CAP = null; lastCapAt = performance.now();
  $('#capModal').hidden = true;
  if (document.activeElement) document.activeElement.blur();
  primePads();
}
function assign(b){
  if (!CAP) return;
  const target = CAP.action, moved = [];
  for (const [id] of ACTIONS) {
    const arr = S.binds[id];
    for (let i = arr.length - 1; i >= 0; i--) if (sameB(arr[i], b)) { if (id !== target) moved.push(actionName(id)); arr.splice(i, 1); }
  }
  S.binds[target].push(b);
  save(); onBindsChanged(); closeCapture();
  const l = bLabel(b)[1];
  note(moved.length ? `“${l}” artık ${actionName(target)} için. ${moved.join(', ')} atamasından kaldırıldı.` : `“${l}” → ${actionName(target)}`);
}
function updateCapPad(){
  const n = getPads().length, el = $('#capPad'); if (!el) return;
  el.textContent = n ? `${n} kontrolcü algılandı.` : 'Kontrolcü algılanmadı. Bağlıysa üzerinde herhangi bir tuşa basın.';
}

/* ---------- Kontrolcü ---------- */
export const getPads = () => { try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean); } catch (e) { return []; } };
function padSnapshot(){
  const snap = {};
  for (const gp of getPads()) {
    gp.buttons.forEach((b, i) => snap[gp.index + ':b' + i] = b.pressed || b.value > 0.5);
    gp.axes.forEach((v, i) => snap[gp.index + ':a' + i] = Math.abs(v) > 0.35);
  }
  return snap;
}
const padState = {};
export function primePads(){
  for (const gp of getPads()) {
    gp.buttons.forEach((b, i) => { padState[gp.index + ':b' + i] = {down: b.pressed || b.value > 0.5, act:null, next:0}; });
    gp.axes.forEach((v, i) => { padState[gp.index + ':a' + i + '-'] = {down: v < -0.6, act:null, next:0}; padState[gp.index + ':a' + i + '+'] = {down: v > 0.6, act:null, next:0}; });
  }
}
function padInput(key, down, desc, now){
  const st = padState[key] || (padState[key] = {down:false, act:null, next:0});
  if (down && !st.down) {
    st.down = true;
    const a = findAction(desc); st.act = a;
    if (!a) return;
    if (H.live()) { fire(a, 'down'); st.next = now + 420; }
    else if (a === 'toggle' && !CAP) H.idleToggle();
  } else if (down && st.act && H.live() && REPEAT.has(st.act) && now >= st.next) {
    fire(st.act, 'repeat'); st.next = now + 110;
  } else if (!down && st.down) {
    st.down = false;
    if (st.act && H.live()) fire(st.act, 'up');
  }
}
const stickAxis = {L: 1, R: 3};
export function pollPads(now, dt){
  const pads = getPads(); if (!pads.length) return;
  if (CAP) {
    for (const gp of pads) {
      for (let i = 0; i < gp.buttons.length; i++) {
        const k = gp.index + ':b' + i, d = gp.buttons[i].pressed || gp.buttons[i].value > 0.5;
        if (d && !CAP.base[k]) { assign({type:'pad', button:i}); return; }
        if (!d) CAP.base[k] = false;
      }
      for (let i = 0; i < gp.axes.length; i++) {
        const k = gp.index + ':a' + i, v = gp.axes[i];
        if (Math.abs(v) > 0.7 && !CAP.base[k]) { assign({type:'axis', axis:i, dir: v > 0 ? 1 : -1}); return; }
        if (Math.abs(v) < 0.3) CAP.base[k] = false;
      }
    }
    return;
  }
  const analog = new Set();
  if (S.g.stickL !== 'off') analog.add(stickAxis.L);
  if (S.g.stickR !== 'off') analog.add(stickAxis.R);
  for (const gp of pads) {
    gp.buttons.forEach((b, i) => padInput(gp.index + ':b' + i, b.pressed || b.value > 0.5, {type:'pad', button:i}, now));
    gp.axes.forEach((v, i) => {
      if (analog.has(i)) return;
      padInput(gp.index + ':a' + i + '-', v < -0.6, {type:'axis', axis:i, dir:-1}, now);
      padInput(gp.index + ':a' + i + '+', v >  0.6, {type:'axis', axis:i, dir: 1}, now);
    });
    if (H.live()) for (const side of ['L', 'R']) {
      const mode = side === 'L' ? S.g.stickL : S.g.stickR; if (mode === 'off') continue;
      const v = gp.axes[stickAxis[side]] || 0, dz = 0.18;
      if (Math.abs(v) < dz) continue;
      const x = Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz)) ** 2;
      H.stick(mode, x, dt);
    }
  }
}

/* ---------- Klavye / fare ---------- */
export function wireGlobalInput(){
  window.addEventListener('keydown', e => {
    if (CAP) { e.preventDefault(); e.stopPropagation(); assign({type:'key', code:e.code, key:e.key}); return; }
    if (!H.live()) return;
    const a = findAction({type:'key', code:e.code, key:e.key});
    if (!a) return;
    e.preventDefault();
    fire(a, e.repeat ? 'repeat' : 'down');
  }, true);
  window.addEventListener('keyup', e => {
    if (CAP || !H.live()) return;
    const a = findAction({type:'key', code:e.code, key:e.key});
    if (a) { e.preventDefault(); fire(a, 'up'); }
  }, true);
  const blockNav = e => { if ((H.live() || CAP || performance.now() - lastCapAt < 600) && (e.button === 3 || e.button === 4)) e.preventDefault(); };
  window.addEventListener('mouseup', blockNav, true);
  window.addEventListener('auxclick', blockNav, true);
  window.addEventListener('contextmenu', e => { if (H.live() || CAP || performance.now() - lastCapAt < 600) e.preventDefault(); }, true);
  window.addEventListener('gamepadconnected', () => { primePads(); updateCapPad(); H.padChange && H.padChange(); });
  window.addEventListener('gamepaddisconnected', () => { updateCapPad(); H.padChange && H.padChange(); });
}
/* Sahnede fare düğmeleri ve tekerlek */
export function wireStageMouse(stage, skipSel){
  const held = new Map();
  stage.addEventListener('pointerdown', e => {
    if (!H.live() || e.pointerType !== 'mouse' || e.target.closest(skipSel)) return;
    const a = findAction({type:'mouse', button:e.button});
    if (a) { e.preventDefault(); held.set(e.button, a); fire(a, 'down'); }
  });
  window.addEventListener('pointerup', e => {
    if (e.pointerType !== 'mouse') return;
    const a = held.get(e.button); if (a) { held.delete(e.button); fire(a, 'up'); }
  });
  let wAcc = 0, wLast = 0;
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    if (!H.live()) return;
    const now = performance.now();
    if (now - wLast > 300) wAcc = 0;
    wLast = now;
    wAcc += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (Math.abs(wAcc) >= 50) {
      const a = findAction({type:'wheel', dir: wAcc < 0 ? 'up' : 'down'});
      wAcc = 0;
      if (a) fire(a, 'down');
    }
  }, {passive:false});
}
