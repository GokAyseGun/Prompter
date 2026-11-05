import { $, $$, clamp, esc, num, fmtTime, note, lsSet, lsGet, rid } from './util.js';
import { DEFAULT_EMAIL } from './config.js';
import { loginGate } from './supa.js';
import { S, DEV } from './settings.js';
import { analyze, renderHTML, speedText } from './text.js';
import { createLink } from './link.js';
import { listScripts } from './data.js';
import { setHandler, wireGlobalInput, pollPads, primePads } from './input.js';

// Kumanda kendi cihaz kimliğini kullanır (aynı cihazda prompter sekmesiyle çakışmasın)
const CID = lsGet('prompter.ctlId') || ('c-' + rid(8)); lsSet('prompter.ctlId', CID);
const want = new URLSearchParams(location.search).get('to');
let LINK = null, target = null, ST = null, DOC = {scriptId: null, rev: -1, body: '', A: null}, cur = -1, editing = false, userScrollAt = 0;
let SCRIPTS = [];

function peersPrompters(){ return (LINK ? LINK.peers : []).filter(p => p.role === 'setup' || p.role === 'stage'); }
function renderTargets(){
  const ps = peersPrompters(), sel = $('#target');
  if (target && !ps.some(p => p.deviceId === target)) target = null;
  if (!target) target = (ps.find(p => p.deviceId === want) || ps.find(p => p.role === 'stage') || ps[0] || {}).deviceId || null;
  sel.innerHTML = ps.map(p => `<option value="${p.deviceId}"${p.deviceId === target ? ' selected' : ''}>${esc(p.name || 'Prompter')} — ${p.role === 'stage' ? 'akışta' : 'hazırlık'}</option>`).join('');
  sel.hidden = !ps.length;
  $('#noTarget').hidden = !!ps.length;
  if (!ps.length) { $('#livePanel').hidden = $('#setupPanel').hidden = true; ST = null; }
  const b = $('#linkBadge'); b.className = 'badge ' + (LINK && LINK.ready ? 'on' : 'err');
  b.querySelector('span').textContent = LINK && LINK.ready ? (ps.length ? 'Bağlı' : 'Bekleniyor') : 'Bağlantı yok';
}
const cmd = (action, extra = {}) => { if (target && LINK) LINK.cmd(target, action, extra); };

function onState(st){
  if (st.from !== target) return;
  ST = st;
  $('#livePanel').hidden = !st.onStage; $('#setupPanel').hidden = st.onStage;
  if (st.scriptId !== DOC.scriptId || (st.onStage && st.rev !== DOC.rev && !editing)) { if (!editing) cmd('getScript'); }
  if (st.onStage) {
    $('#kPlay').textContent = st.playing || st.counting ? '❚❚' : '▶';
    $('#kTitle').textContent = st.title || '';
    $('#kTime').innerHTML = `${fmtTime(st.elapsed)} · kalan <b>${fmtTime(st.remain)}</b>${st.target ? ` · hedef ${fmtTime(st.target)}` : ''}${st.ended ? ' · <b>bitti</b>' : st.holding ? ' · durak' : ''}`;
    $('#kProg').style.width = (st.total ? st.u / st.total * 100 : 0).toFixed(1) + '%';
    $('#kSps').textContent = num(st.sps) + ' hece/sn';
    $('#kWpm').textContent = Math.round(st.sps * 60 / (st.avgSyl || 2.8)) + ' kelime/dk';
    if (document.activeElement !== $('#kSpsR')) $('#kSpsR').value = st.sps;
    for (const b of $$('#kMode button')) b.classList.toggle('on', b.dataset.v === st.mode);
    const secs = st.sections || [];
    const key = secs.join('\u0001');
    const box = $('#kSections');
    if (box.dataset.k !== key) { box.dataset.k = key; box.innerHTML = secs.map((t, i) => `<button type="button" data-sec="${i}">${esc(t)}</button>`).join(''); }
    highlight(st.c);
  } else {
    $('#spTitle').textContent = st.title || '';
    if (st.scriptId) $('#scriptSel').value = st.scriptId;
    $('#resumeBtn').hidden = !st.resumeChar;
    highlight(-1);
  }
}
function onScript(p){
  if (p.from !== target || editing) return;
  DOC = {scriptId: p.scriptId, rev: p.rev, body: p.body || '', title: p.title || ''};
  DOC.A = analyze(DOC.body, {});
  $('#docTitle').textContent = DOC.title || 'Metin';
  $('#doc').innerHTML = DOC.body.trim() ? renderHTML(DOC.A, {ids: true}) : '<div class="k-empty">Metin boş.</div>';
  cur = -1; if (ST && ST.onStage) highlight(ST.c);
}
function tokenAtChar(c){
  const T = DOC.A ? DOC.A.tokens : []; let lo = 0, hi = T.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m].c0 <= c) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
function highlight(c){
  if (!DOC.A) return;
  const i = c < 0 ? -1 : tokenAtChar(c);
  if (i === cur) return;
  const doc = $('#doc'), lo = Math.min(i, cur), hi = Math.max(i, cur);
  if (cur >= 0) { const o = doc.querySelector(`[data-t="${cur}"]`); if (o) o.classList.remove('cur'); }
  if (Math.abs(i - cur) > 400 || cur < 0 || i < 0) {
    for (const e of doc.querySelectorAll('.tk[data-t]')) e.classList.toggle('read', +e.dataset.t < i);
  } else for (let k = Math.max(0, lo); k <= hi; k++) { const e = doc.querySelector(`[data-t="${k}"]`); if (e) e.classList.toggle('read', k < i); }
  cur = i;
  const el = i >= 0 ? doc.querySelector(`[data-t="${i}"]`) : null;
  if (el) {
    el.classList.add('cur');
    if ($('#follow').checked && performance.now() - userScrollAt > 4000) {
      const top = el.offsetTop - doc.clientHeight * 0.35;
      if (Math.abs(doc.scrollTop - top) > 30) doc.scrollTo({top, behavior: 'smooth'});
    }
  }
}

function wire(){
  $('#target').addEventListener('change', e => { target = e.target.value; DOC = {scriptId: null, rev: -1}; cmd('getScript'); });
  for (const t of $$('.k-tabs button')) t.addEventListener('click', () => {
    $('#kwrap').dataset.tab = t.dataset.tab; for (const x of $$('.k-tabs button')) x.classList.toggle('on', x === t); if (t.dataset.tab === 'text') cur = -1;
  });
  $('#livePanel').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (b) { cmd(b.dataset.a); if (navigator.vibrate) navigator.vibrate(12); return; }
    const m = e.target.closest('#kMode button'); if (m) { cmd('mode', {value: m.dataset.v}); return; }
    const s = e.target.closest('[data-sec]'); if (s) cmd('seekSection', {value: +s.dataset.sec});
  });
  for (const b of $$('[data-hold]')) {
    const on = e => { e.preventDefault(); cmd('hold', {value: b.dataset.hold, on: true}); };
    const off = () => cmd('hold', {value: b.dataset.hold, on: false});
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
  let spT = 0;
  $('#kSpsR').addEventListener('input', e => { clearTimeout(spT); spT = setTimeout(() => cmd('setSps', {value: +e.target.value}), 60); });
  $('#doc').addEventListener('click', e => {
    const t = e.target.closest('.tk[data-t]'); if (!t || !DOC.A) return;
    const tok = DOC.A.tokens[+t.dataset.t]; if (tok) { cmd('seekChar', {value: tok.c0}); userScrollAt = 0; }
  });
  for (const ev of ['wheel', 'touchmove']) $('#doc').addEventListener(ev, () => { userScrollAt = performance.now(); }, {passive: true});
  $('#editBtn').addEventListener('click', () => {
    editing = true; $('#editTa').value = DOC.body || ''; $('#editTa').hidden = false; $('#doc').hidden = true;
    $('#editBtn').hidden = true; $('#applyBtn').hidden = $('#cancelBtn').hidden = false; $('#editTa').focus();
  });
  const endEdit = () => { editing = false; $('#editTa').hidden = true; $('#doc').hidden = false; $('#editBtn').hidden = false; $('#applyBtn').hidden = $('#cancelBtn').hidden = true; };
  $('#cancelBtn').addEventListener('click', () => { endEdit(); cmd('getScript'); });
  $('#applyBtn').addEventListener('click', () => { cmd('edit', {body: $('#editTa').value, scriptId: DOC.scriptId}); endEdit(); note('Gönderildi.'); });
  $('#startBtn').addEventListener('click', () => cmd('start', {scriptId: $('#scriptSel').value || null}));
  $('#resumeBtn').addEventListener('click', () => cmd('start', {scriptId: $('#scriptSel').value || null, resume: true}));
  $('#scriptSel').addEventListener('change', e => cmd('openScript', {scriptId: e.target.value}));
}
async function loadScripts(){
  try {
    SCRIPTS = await listScripts();
    $('#scriptSel').innerHTML = SCRIPTS.map(s => `<option value="${s.id}">${esc(s.title || 'Adsız metin')}${s.folder ? ' · ' + esc(s.folder) : ''}</option>`).join('');
    if (ST && ST.scriptId) $('#scriptSel').value = ST.scriptId;
  } catch (e) {}
}

let lastT = performance.now();
function frame(now){ const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now; pollPads(now, dt); requestAnimationFrame(frame); }

async function main(){
  $('#boot').hidden = true;
  const user = await loginGate($('#login'), DEFAULT_EMAIL);
  $('#app').hidden = false;
  wire();
  LINK = createLink({
    user, deviceId: CID, meta: {role: 'control', name: (DEV.name || 'Cihaz') + ' · kumanda'},
    onState, onScript,
    onPresence: () => { const before = target; renderTargets(); if (target && target !== before) cmd('getScript'); },
    onStatus: ok => { renderTargets(); if (ok && target) cmd('getScript'); },
  });
  // Bu cihaza bağlı klavye / kontrolcü de kumandayı yönetir
  setHandler({
    live: () => !!(ST && ST.onStage) && !editing && document.activeElement?.tagName !== 'TEXTAREA',
    action: a => cmd(a),
    hold: (a, on) => cmd('hold', {value: a, on}),
    stick: (m, x) => { if (m === 'speed' && ST) cmd('setSps', {value: clamp(ST.sps - x * 0.05, 1.5, 10)}); },
    idleToggle: () => { if (ST && !ST.onStage) cmd('start', {scriptId: $('#scriptSel').value || null}); },
  });
  wireGlobalInput(); primePads();
  requestAnimationFrame(frame);
  loadScripts();
  setInterval(() => { if (target && ST && ST.onStage === false) loadScripts(); }, 30000);
}
main();
