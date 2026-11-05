/* GG Prompter — rol tabanlı ana uygulama: Prompter · Ekran · Kumanda */
import { $, $$, clamp, esc, num, fmtTime, parseTime, debounce, fmtDate, lsGet, lsSet, note, download, confirmBox, hexRgb } from './util.js';
import { DEFAULT_EMAIL, APP_VERSION } from './config.js';
import { sb, loginGate } from './supa.js';
import { S, DEV, WIN, prof, PROFILE_META, PNAME, ROLES, ROLE_NAME, DEF_PROFILE, MODES, setG, saveDevice, syncSettings, exportJSON, importJSON,
         resetBinds, fontOf, onSettings, setCfgSender, applyPatch } from './settings.js';
import { analyze, speedText, durationOf, spsForTarget, cleanText, SAMPLE_SPEED_TEXT } from './text.js';
import * as D from './data.js';
import { wireBinds, renderBinds, wireGlobalInput, wireStageMouse, setHandler, pollPads, primePads, getPads, capturing } from './input.js';
import * as E from './engine.js';
import { V, startMic, stopMic, readLevel, tick as voiceTick, setMode as voiceSetMode, setScript as voiceSetScript, stopAll as voiceStopAll, micActive, estimate as voiceEstimate, resetFollow } from './voice.js';
import { createLink } from './link.js';
import { ekranHTML, yaziHTML, akisHTML, sticksHTML, bindForm, tickMeters, setAvgSylSource } from './forms.js';
import { mountRemote, mountDoc } from './remote.js';

const SAMPLE = 'Merhaba, bu bir önizleme metnidir. Okunan kelimeler **harf harf** yavaşça griye döner ve solar; sıradaki kelimeler parlak kalır. Çağrı, şükür, ılık rüzgâr, İğneada, Ödül ve Ünal gibi Türkçe karakterler sorunsuz görünür.';
const CAL_TEXT = `# Kalibrasyon
// Bu ekran hazır. Akış Prompter veya Kumanda'dan başlatılınca buraya gelir.
Camdan bakarak yazı boyutunu, kenar boşluklarını, görünür alanı ve okuma çizgisinin yüksekliğini ayarlayın. **Vurgulu kelimeler** böyle görünür. [DUR 1]
Okunan kısım harf harf griye döner; çizgi okunan satırın altında durur. / Çağrı, şükür, ılık rüzgâr, İğneada, Ödül ve Ünal.
Sıradaki satırlar parlak kalır ve metin ekranın tamamına yayılır. Kenar boşlukları ve kırpma ayarlarıyla yazıyı kameranın tam önüne getirin.
Bu satırlar yalnızca ayar içindir; gerçek metin akış başlayınca gelir.`;
const ta = $('#ta');
let USER = null, LINK = null, PEERS = [], LEAD = null, myStageAt = 0, PING = null;
let LS = null, LS_AT = 0;                  // lider ekranın son durumu
const VR = {open: false, tc: null, rate: null, lat: null, level: -100, at: 0};   // Prompter'dan gelen ses kararı
const VIEW = {};                            // rol görünümü yardımcıları
const isRole = r => DEV.role === r;
const prompterPeer = () => PEERS.find(p => p.role === 'prompter');
const ekranPeers = () => PEERS.filter(p => p.role === 'ekran');
const localStage = () => E.P.on && !E.P.cal;
const flowActive = () => localStage() || !!(LS && LS.onStage && performance.now() - LS_AT < 4000);
const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && !['range','checkbox','button','color','file'].includes(a.type))); };
const modalOpen = () => $$('.modal').some(m => !m.hidden);

/* ================= Lider ekran ================= */
function stageDevices(){
  const d = PEERS.filter(p => p.onStage).map(p => ({id: p.deviceId, at: p.stageAt || 0}));
  if (localStage()) d.push({id: DEV.id, at: myStageAt});
  return d;
}
function refreshLead(){
  const st = stageDevices();
  if (!st.length) LEAD = null;
  else if (!LEAD || !st.some(d => d.id === LEAD)) { st.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1)); LEAD = st[0].id; }
  if (localStage()) E.P.lead = LEAD === DEV.id || !LINK || !LINK.ready;
}
const amLead = () => localStage() && E.P.lead;

/* Akış komutlarını yönlendir: lider bu cihazsa uygula, değilse lidere gönder, akış yoksa başlat */
function flowCmd(action, extra = {}){
  if (amLead()) { E.remote({action, ...extra}); broadcastState(true); return; }
  if (LEAD && LEAD !== DEV.id && LINK) { LINK.cmd(LEAD, action, extra); return; }
  if (action === 'toggle' || action === 'play') requestStart(false);
}
function inputAction(a){
  if (a === 'faster' || a === 'slower') { const base = (LS && LS.sps) || S.g.sps; flowCmd('setSps', {value: clamp(Math.round((S.g.sps + (a === 'faster' ? 0.25 : -0.25)) * 100) / 100, 1.5, 10)}); return; }
  if (a === 'leadUp' || a === 'leadDown') {
    const v = clamp(Math.round(((S.g.followLead || 0) + (a === 'leadUp' ? 0.5 : -0.5)) * 2) / 2, 0, 5);
    setG('followLead', v); const msg = `Sesle takip öne alma: ${num(v, 1)} kelime`; if (localStage()) E.toast(msg); else note(msg); return;
  }
  if (a === 'modeCycle') { const i = MODES.findIndex(x => x[0] === S.g.mode); const m = MODES[(i + 1) % MODES.length]; setG('mode', m[0]); if (localStage()) E.toast(m[1]); else note(m[1]); return; }
  flowCmd(a);
}
let stickAcc = {x: 0, dt: 0, t: 0}, spsStickT = 0;
function inputStick(mode, x, dt){
  if (!flowActive()) return;
  if (mode === 'speed') {
    if (amLead()) { E.stick('speed', x, dt); return; }
    const now = performance.now(); S.g.sps = clamp(S.g.sps - x * 1.2 * dt, 1.5, 10);
    if (now - spsStickT > 120) { spsStickT = now; flowCmd('setSps', {value: Math.round(S.g.sps * 100) / 100}); }
    return;
  }
  if (amLead()) { E.stick(mode, x, dt); return; }
  stickAcc.x += x * dt; stickAcc.dt += dt;
  const now = performance.now();
  if (now - stickAcc.t > 66 && stickAcc.dt > 0) { flowCmd('stick', {mode, x: stickAcc.x / stickAcc.dt, dt: stickAcc.dt}); stickAcc = {x: 0, dt: 0, t: now}; }
}

/* ================= Bağlantı ================= */
function track(extra = {}){ if (LINK) LINK.track({role: DEV.role, name: DEV.name, profile: DEV.profile, onStage: localStage(), stageAt: myStageAt,
  w: window.innerWidth, h: window.innerHeight, ver: APP_VERSION, ...extra}); }
const trackSoon = debounce(() => track(), 400);
window.addEventListener('resize', trackSoon);

let lastSt = 0;
function broadcastState(force){
  if (!LINK || !LINK.ready || !amLead() || !PEERS.length) return;
  const now = performance.now(); if (!force && now - lastSt < 110) return; lastSt = now;
  LINK.send('state', {...E.state(), lead: DEV.id});
}
function sendScript(){
  if (!LINK) return;
  if (isRole('prompter') && CUR.s) LINK.send('script', {scriptId: CUR.s.id, title: CUR.s.title || 'Adsız metin', body: CUR.s.body});
  else if (localStage()) LINK.send('script', {scriptId: E.P.scriptId, title: E.P.title, body: E.P.body});
}
const sendScriptSoon = debounce(sendScript, 700);
function sendInfo(){
  if (!LINK || !isRole('prompter') || !CUR.s) return;
  LINK.send('info', {scriptId: CUR.s.id, title: CUR.s.title || 'Adsız metin', resumeChar: CUR.s.last_char || 0});
}

const ON = {
  cmd(p){
    const mine = p.to === DEV.id || p.to === '*' || (p.to === 'lead' && amLead()) || (p.to === 'prompter' && isRole('prompter')) || (p.to === 'ekran' && isRole('ekran'));
    if (!mine) return;
    switch (p.action) {
      case 'ping': LINK.cmd(p.from, 'pong', {t: p.t}); return;
      case 'pong': PING = Math.round(performance.now() - p.t); return;
      case 'setRole': if (ROLE_NAME[p.role]) setRole(p.role, false); return;
      case 'setDevice':
        if (p.profile && DEF_PROFILE[p.profile]) DEV.profile = p.profile;
        if (p.name) DEV.name = String(p.name).slice(0, 40);
        saveDevice(); track(); if (E.P.on) E.restyle(true); VIEW.deviceChanged && VIEW.deviceChanged(); return;
      case 'join':
        if (amLead()) LINK.send('start', {to: p.from, leadId: DEV.id, stageAt: myStageAt, autoplay: false, startChar: E.headChar(),
          body: E.P.body, title: E.P.title, scriptId: E.P.scriptId, targetSec: E.P.targetSec});
        return;
      case 'getScript': sendScript(); sendInfo(); if (amLead()) broadcastState(true); return;
      case 'start': if (isRole('prompter')) VIEW.remoteStart && VIEW.remoteStart(p); return;
      case 'openScript': if (isRole('prompter') && VIEW.openScript) VIEW.openScript(p.scriptId); return;
      case 'edit': handleEdit(p); return;
    }
    if (amLead()) { E.remote(p); broadcastState(true); }
  },
  state(p){
    if (V.on && LS && p.c != null && Math.abs(p.c - LS.c) > 400) resetFollow();
    if (p.lead && p.lead !== DEV.id) {
      LS = p; LS_AT = performance.now();
      if (LEAD !== p.lead && p.onStage) LEAD = p.lead;
      if (localStage() && !E.P.lead) E.follow(p);
      if (!localStage() && isRole('ekran') && p.onStage && !VIEW.settingsOpen) requestJoin(p.lead);
    }
    VIEW.onState && VIEW.onState(LS);
  },
  start(p){
    if (!(p.to === DEV.id || (p.to === 'ekran' && isRole('ekran')))) return;
    VIEW.onStart ? VIEW.onStart(p) : startStageFrom(p);
  },
  stop(p){
    if (localStage() && !amLead()) { E.stopSilently(); afterStageEnd(); }
    if (LS) LS = {...LS, onStage: false, ended: true};
    VIEW.onStop && VIEW.onStop(p);
  },
  script(p){ VIEW.onScript && VIEW.onScript(p); },
  info(p){ VIEW.onInfo && VIEW.onInfo(p); },
  cfg(p){ applyPatch(p.patch); },
  voice(p){ VR.open = !!p.open; VR.tc = p.tc; VR.rate = p.rate; VR.lat = p.lat; VR.level = p.level ?? -100; VR.at = performance.now(); },
  role(p){ if (p.role === 'prompter' && p.from !== DEV.id && (isRole('prompter') || DEV.roleAuto)) setRole('kumanda', true); },
};
let joinAt = 0;
function requestJoin(leadId){ const now = performance.now(); if (now - joinAt < 2500) return; joinAt = now; LINK.cmd(leadId, 'join'); }
function startStageFrom(p){
  LEAD = p.leadId || DEV.id;
  myStageAt = p.stageAt || Date.now();
  E.start({body: p.body, scriptId: p.scriptId, title: p.title, targetSec: p.targetSec, startChar: p.startChar || 0,
    lead: LEAD === DEV.id, autoplay: p.autoplay !== false});
  voiceSetScript(analyze(p.body, S.g));
  track(); refreshLead();
}
function handleEdit(p){
  if (isRole('prompter') && VIEW.applyEdit) { VIEW.applyEdit(p.body, p.title); return; }
  if (amLead()) {
    E.applyEdit(p.body, p.title);
    if (!prompterPeer() && E.P.scriptId) D.updateScript(E.P.scriptId, {body: p.body}).catch(() => {});
    sendScript();
  }
}
/* Kumanda/operatör düzenlemesi: Prompter varsa ona, yoksa lidere */
function sendEdit(body){
  if (isRole('prompter') && VIEW.applyEdit) { VIEW.applyEdit(body); return; }
  const pp = prompterPeer();
  if (pp) LINK.cmd(pp.deviceId, 'edit', {body});
  else if (LEAD) LINK.cmd(LEAD, 'edit', {body});
}
function requestStart(resume, scriptId){
  if (isRole('prompter') && VIEW.startFlow) { VIEW.startFlow(resume); return; }
  const pp = prompterPeer();
  if (pp) { LINK.cmd(pp.deviceId, 'start', {resume, scriptId}); return; }
  VIEW.startWithoutPrompter && VIEW.startWithoutPrompter(resume, scriptId);
}

/* Rol değiştir: cihazı kaydet, Prompter olduysa diğerlerine bildir, yeniden yükle */
function setRole(role, auto){
  if (DEV.role === role && !auto) return;
  DEV.role = role; DEV.roleAuto = !!auto; saveDevice();
  if (role === 'prompter' && LINK) LINK.send('role', {role});
  const u = new URL(location.href); u.searchParams.delete('role');
  setTimeout(() => location.replace(u.href), 250);
}
function renderRoleSw(el){
  if (!el) return;
  el.innerHTML = ROLES.map(([r, n]) => `<button type="button" data-role="${r}" class="${DEV.role === r ? 'on' : ''}">${n}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('[data-role]'); if (b && b.dataset.role !== DEV.role) setRole(b.dataset.role, false); };
}
function setLinkBadge(){
  const b = $('#linkBadge'); if (!b) return;
  const n = PEERS.length, waiting = LINK ? LINK.seen.filter(x => !PEERS.some(p => p.deviceId === x.deviceId)).length : 0;
  b.className = 'badge ' + (n ? 'on' : waiting ? 'err' : '');
  b.querySelector('span').textContent = n ? `WiFi · ${n} cihaz` + (waiting ? ` · ${waiting} bağlanamadı` : '') : waiting ? 'WiFi bağlantısı yok' : 'Tek cihaz';
  b.title = 'Cihazlar arası tüm iletişim aynı WiFi üzerinden doğrudan yapılır.';
}
function updatePadBadge(){
  const pads = getPads(), el = $('#padBadge');
  el.className = 'badge ' + (pads.length ? 'on' : '');
  el.querySelector('span').textContent = pads.length ? pads[0].id.replace(/\(.*?\)/g, '').trim().slice(0, 28) : 'Kontrolcü yok';
}

/* Cihaz listesi (rol atama) */
function renderDevList(el){
  if (!el) return;
  const me = {deviceId: DEV.id, name: DEV.name, role: DEV.role, profile: DEV.profile, onStage: localStage(), me: true};
  const conn = new Set(PEERS.map(p => p.deviceId));
  const others = LINK ? LINK.seen.filter(x => !conn.has(x.deviceId)).map(x => ({...x, off: true})) : [];
  const all = [me, ...PEERS, ...others];
  const st = p => {
    if (p.me) return 'bu cihaz';
    if (!p.off) { const r = LINK.info(p.deviceId).rtt; return `WiFi ✓${r != null ? ' · ' + r + ' ms' : ''}`; }
    return LINK.info(p.deviceId).state === 'connecting' ? 'WiFi ile bağlanıyor…' : '⚠ Aynı WiFi’de değil';
  };
  el.innerHTML = all.map(p => `<li class="${p.off ? 'off' : ''}"><i class="dotc ${p.role}"></i><div class="dv-main"><b>${esc(p.name || 'Cihaz')}</b>
      <small>${st(p)}${PNAME[p.profile] ? ' · ' + PNAME[p.profile] : ''}${p.onStage ? ' · akışta' : ''}</small></div>
      <select class="txt dv-role" data-dev="${p.deviceId}"${p.off ? ' disabled' : ''}>${ROLES.map(([r, n]) => `<option value="${r}"${p.role === r ? ' selected' : ''}>${n}</option>`).join('')}</select></li>`).join('');
  el.onchange = e => {
    const s = e.target.closest('.dv-role'); if (!s) return;
    if (s.dataset.dev === DEV.id) setRole(s.value, false);
    else { LINK.cmd(s.dataset.dev, 'setRole', {role: s.value}); note('Rol gönderildi.'); }
  };
}
setInterval(() => { renderDevList($('#devList')); renderDevList($('#kmDevList')); }, 3000);
/* Ayarlanan ekran seçimi (Ekran / Yazı / Önizleme formları için) */
const TGT = {id: null, type: DEV.profile};
const DIMS = {phone: [844, 390], tablet: [1180, 820], desktop: [1440, 900], monitor: [1920, 1080]};
function tgtOptions(){
  const o = [];
  for (const p of ekranPeers()) o.push({v: 'd:' + p.deviceId, l: `${p.name || 'Ekran'} — ekran (${PNAME[p.profile] || p.profile})`, id: p.deviceId, type: p.profile});
  if (isRole('prompter') || isRole('ekran')) o.push({v: 'd:' + DEV.id, l: `Bu cihaz (${DEV.name}) — ${isRole('ekran') ? 'ekran' : 'tek cihazla akış'}`, id: DEV.id, type: DEV.profile});
  for (const [t, n] of PROFILE_META) o.push({v: 't:' + t, l: `Ekran tipi: ${n}`, id: null, type: t});
  return o;
}
function pickDefaultTgt(){
  const o = tgtOptions();
  let pick = TGT.user ? o.find(x => (TGT.id && x.id === TGT.id) || (!TGT.id && x.v === 't:' + TGT.type)) : null;
  if (!pick) pick = o.find(x => x.id && x.id !== DEV.id) || o.find(x => x.id === DEV.id) || o[0];   // önce bağlı ekran
  TGT.id = pick.id; TGT.type = pick.type;
}
function renderTgtSelects(){
  pickDefaultTgt();
  const o = tgtOptions();
  for (const sel of $$('.tgt-sel')) {
    sel.innerHTML = o.map(x => `<option value="${x.v}">${esc(x.l)}</option>`).join('');
    sel.value = TGT.id ? 'd:' + TGT.id : 't:' + TGT.type;
    sel.closest('[data-tgt]').hidden = false;
    sel.onchange = () => { const x = o.find(y => y.v === sel.value); if (x) { TGT.id = x.id; TGT.type = x.type; TGT.user = true; renderTgtSelects(); syncAllForms(); VIEW.afterTgt && VIEW.afterTgt(); } };
  }
}
const tgtCtx = {
  type: () => { const p = TGT.id && TGT.id !== DEV.id ? PEERS.find(x => x.deviceId === TGT.id) : null; if (p && p.profile && DEF_PROFILE[p.profile]) TGT.type = p.profile; else if (TGT.id === DEV.id) TGT.type = DEV.profile; return TGT.type; },
  setType(t){
    if (TGT.id === DEV.id) { DEV.profile = t; saveDevice(); track(); if (E.P.on) E.restyle(true); }
    else if (TGT.id) LINK && LINK.cmd(TGT.id, 'setDevice', {profile: t});
    TGT.type = t; renderTgtSelects();
  },
  after: () => VIEW.afterTgt && VIEW.afterTgt(),
};
const FORMS = [];
const syncAllForms = () => FORMS.forEach(f => f.sync());
function tgtDims(){
  const p = TGT.id && TGT.id !== DEV.id ? PEERS.find(x => x.deviceId === TGT.id) : null;
  if (TGT.id === DEV.id) return [window.innerWidth, window.innerHeight];
  if (p && p.w && p.h) return [p.w, p.h];
  return DIMS[TGT.type] || DIMS.tablet;
}

/* ================= Küçük ekran önizlemesi ================= */
function renderMini(box, body, mirrored){
  if (!box || !box.offsetParent) return;
  const pr = prof(TGT.type), sh = pr.show, g = S.g;
  let [w, h] = tgtDims();
  if ((pr.orientation === 'portrait' && w > h) || (pr.orientation === 'landscape' && h > w)) [w, h] = [h, w];
  const maxW = box.parentElement.clientWidth, maxH = Math.min(440, window.innerHeight * 0.55);
  const sc = Math.min(maxW / w, maxH / h);
  const W = w * sc, H = h * sc;
  box.style.width = W + 'px'; box.style.height = H + 'px';
  const top = h * pr.cropTop / 100 * sc, bot = h * pr.cropBottom / 100 * sc, side = w * pr.cropSide / 100 * sc;
  const aW = W - 2 * side, aH = H - top - bot, fs = pr.size * 96 / 72 * sc, pad = aW * pr.margin / 100, anchor = aH * pr.anchor / 100;
  const A = analyze((body && body.trim() ? body : SAMPLE).slice(0, 1400), {...g, hide: {n: !sh.notes, h: !sh.heads}});
  const parts = [];
  A.paras.forEach(p => {
    if (p.hidden) return;
    if (p.type === 'gap') { parts.push('<div class="gap"></div>'); return; }
    const toks = p.tokens.map(ti => {
      const t = A.tokens[ti]; if (t.kind !== 'w' && !sh.marks) return '';
      const cls = t.kind === 'hold' ? ' hold' : t.kind === 'b' ? ' br' : '';
      return `<span class="tk${cls}" data-t="${ti}">${t.chars.map((c, k) => `<span data-c="${t.c0 + k}"${c.e && sh.emph && t.kind === 'w' && p.type === 'p' ? ' class="em"' : ''}>${esc(c.ch)}</span>`).join('')}</span>`;
    }).filter(Boolean);
    parts.push(`<div class="para${p.type === 'h' ? ' hd' : p.type === 'n' ? ' nt' : ''}">${toks.join(' ')}</div>`);
  });
  box.innerHTML = `<div class="m-mir"><div class="m-area" style="top:${top}px;bottom:${bot}px;left:${side}px;right:${side}px">
    <div class="m-content" style="font-size:${fs}px;padding:${fs * 0.35}px ${pad}px;font-family:${fontOf(g.font).fam.replace(/"/g, "'")},sans-serif;font-weight:${g.weight};font-style:${g.italic ? 'italic' : 'normal'};line-height:${pr.lineHeight};letter-spacing:${pr.letter}em;text-align:${g.align};color:${g.textColor};--em:${g.emphColor}">${parts.join('')}</div>
    <div class="m-ft"></div><div class="m-fb"></div><div class="m-ul"></div><div class="m-ar l"></div><div class="m-ar r"></div></div></div>`;
  const content = box.querySelector('.m-content'), area = box.querySelector('.m-area');
  const spans = [...content.querySelectorAll('.tk')];
  const lines = []; let cur = null;
  for (const s of spans) {
    const t = s.offsetTop, hh = s.offsetHeight;
    if (!cur || Math.abs(t - cur.top) > hh * 0.5) { cur = {top: t, h: hh, left: s.offsetLeft, right: s.offsetLeft + s.offsetWidth, spans: [s]}; lines.push(cur); }
    else { cur.spans.push(s); cur.right = Math.max(cur.right, s.offsetLeft + s.offsetWidth); cur.left = Math.min(cur.left, s.offsetLeft); cur.h = Math.max(cur.h, hh); }
  }
  if (!lines.length) return;
  const li = Math.min(lines.length - 1, Math.max(0, Math.round(anchor / (lines[1] ? lines[1].top - lines[0].top : fs * 1.3)) - 0) , 3);
  const L = lines[Math.min(li, lines.length - 1)];
  const mid = L.spans[Math.floor(L.spans.length / 2)], headC = +(mid.querySelector('[data-c]') || {dataset: {c: 0}}).dataset.c;
  const shift = Math.max(0, L.top + L.h / 2 - anchor);
  content.style.transform = `translateY(${-shift}px)`;
  const base = [hexRgb(g.textColor), hexRgb(g.emphColor)], tone = Math.round(255 * g.readTone);
  for (const c of content.querySelectorAll('[data-c]')) {
    const q = clamp((headC - +c.dataset.c) / g.fadeWidth, 0, 1); if (q <= 0) continue;
    const b = c.classList.contains('em') ? base[1] : c.closest('.hd') ? [226, 170, 44] : c.closest('.nt') ? [166, 220, 242] : base[0];
    c.style.color = `rgb(${b.map(x => Math.round(x + (tone - x) * q)).join(',')})`; c.style.opacity = (1 + (g.readOpacity - 1) * q).toFixed(3);
  }
  const ul = box.querySelector('.m-ul');
  ul.hidden = !sh.uline;
  ul.style.cssText += `;left:${L.left - fs * 0.06}px;width:${L.right - L.left + fs * 0.12}px;top:${L.top + L.h + fs * 0.03 - shift}px;height:${Math.max(1.5, fs * 0.05)}px`;
  for (const a of box.querySelectorAll('.m-ar')) { a.hidden = !sh.arrows; a.style.top = (L.top + L.h / 2 - shift) + 'px'; a.style.borderWidth = Math.max(4, fs * 0.22) + 'px'; }
  const lh = lines[1] ? lines[1].top - lines[0].top : fs * 1.3, k = g.focusStrength;
  const ft = box.querySelector('.m-ft'), fb = box.querySelector('.m-fb');
  ft.hidden = fb.hidden = !sh.focus;
  ft.style.cssText = `height:${Math.max(0, anchor - lh * 1.6)}px;background:linear-gradient(rgba(0,0,0,${k}),rgba(0,0,0,${k * 0.6}) 70%,rgba(0,0,0,0))`;
  fb.style.cssText = `top:${Math.min(aH, anchor + lh * 2.6)}px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,${k * 0.55}) 45%,rgba(0,0,0,${k}))`;
  box.querySelector('.m-mir').style.transform = `scale(${mirrored && pr.mirror === 'h' ? -1 : 1},${mirrored && pr.flipV ? -1 : 1})`;
}

/* ================= Ortak: modallar ================= */
function openModal(id){ $('#' + id).hidden = false; }
function closeModal(id){ $('#' + id).hidden = true; }
document.addEventListener('click', e => {
  const c = e.target.closest('[data-close]'); if (c) { c.closest('.modal').hidden = true; return; }
  if (e.target.classList && e.target.classList.contains('modal') && e.target.id !== 'capModal') e.target.hidden = true;
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !localStage() && !capturing()) for (const m of $$('.modal')) if (!m.hidden && m.id !== 'capModal') m.hidden = true;
});

/* ================= PROMPTER ================= */
const CUR = {s: null, dirty: false, saving: false, err: false};
let LIB = [];
const blankScript = () => ({id: null, title: '', body: '', folder: '', target_sec: null, last_char: 0, updated_at: null});
const curA = () => analyze(CUR.s ? CUR.s.body : '', S.g);
setAvgSylSource(() => (LS && LS.avgSyl) || (CUR.s ? curA().avgSyl : 2.8));

function setSaveState(){
  const el = $('#saveState'), b = $('#syncBadge');
  let txt, cls;
  if (CUR.saving) { txt = 'Kaydediliyor…'; cls = 'busy'; }
  else if (CUR.err) { txt = navigator.onLine ? 'Kaydedilemedi, tekrar denenecek' : 'Çevrimdışı · bu cihazda saklandı'; cls = 'err'; }
  else if (CUR.dirty) { txt = 'Değişiklik var'; cls = 'busy'; }
  else { txt = CUR.s && CUR.s.id ? 'Buluta kaydedildi ✓' : ''; cls = 'on'; }
  el.textContent = txt; el.className = cls;
  b.className = 'badge ' + cls; b.querySelector('span').textContent = cls === 'err' ? 'Kaydedilmedi' : cls === 'busy' ? 'Kaydediliyor' : 'Kayıtlı';
}
async function persist(){
  if (!CUR.s || CUR.saving || !CUR.dirty) return;
  CUR.saving = true; CUR.dirty = false; setSaveState();
  const s = CUR.s;
  const fields = {title: s.title.trim() || 'Adsız metin', body: s.body, folder: s.folder.trim(), target_sec: s.target_sec || null};
  try {
    if (!s.id) {
      const row = await D.createScript(fields);
      if (CUR.s === s) { s.id = row.id; s.updated_at = row.updated_at; lsSet('prompter.current', s.id); }
      LIB.unshift(row);
    } else {
      const r = await D.updateScript(s.id, fields);
      s.updated_at = r.updated_at;
      const li = LIB.find(x => x.id === s.id); if (li) Object.assign(li, fields, {updated_at: r.updated_at});
    }
    if (s.id) D.clearDraft(s.id);
    CUR.err = false;
  } catch (e) {
    CUR.err = true; CUR.dirty = true;
    if (s.id) D.setDraft(s.id, {...fields, at: Date.now()}); else lsSet('prompter.draft.new', {...fields, at: Date.now()});
  }
  CUR.saving = false; setSaveState(); updateFolders();
  if (CUR.dirty && !CUR.err) persistSoon();
}
const persistSoon = debounce(persist, 1200);
function markDirty(){
  CUR.dirty = true; setSaveState();
  const d = {title: CUR.s.title, body: CUR.s.body, folder: CUR.s.folder, target_sec: CUR.s.target_sec, at: Date.now()};
  if (CUR.s.id) D.setDraft(CUR.s.id, d); else lsSet('prompter.draft.new', d);
  persistSoon(); sendScriptSoon();
}
function loadIntoEditor(s){
  CUR.s = s; CUR.dirty = false; CUR.err = false;
  if (s.id) {
    const d = D.getDraft(s.id);
    if (d && (!s.updated_at || d.at > Date.parse(s.updated_at))) { Object.assign(s, {title: d.title, body: d.body, folder: d.folder, target_sec: d.target_sec ?? s.target_sec}); CUR.dirty = true; persistSoon(); }
    lsSet('prompter.current', s.id); D.touchScript(s.id);
  }
  ta.value = s.body; $('#titleIn').value = s.title === 'Adsız metin' && !s.body ? '' : s.title;
  $('#folderIn').value = s.folder || ''; $('#targetIn').value = s.target_sec ? fmtTime(s.target_sec) : '';
  setSaveState(); refreshText(); sendScript(); sendInfo();
}
async function openScript(id){
  await persist();
  const s = LIB.find(x => x.id === id) || await D.getScript(id).catch(() => null);
  if (!s) { note('Metin bulunamadı.'); return; }
  loadIntoEditor({...s});
}
async function newScript(fields = {}){
  await persist();
  loadIntoEditor({...blankScript(), ...fields});
  if (fields.body) { CUR.dirty = true; persist(); }
  $('#titleIn').focus();
}
function refreshText(){ renderPreviewSoon(); updateEstimate(); updateResume(); }
const refreshSoon = debounce(refreshText, 150);
const renderPreview = () => { if (isRole('prompter')) renderMini($('#mini'), CUR.s ? CUR.s.body : '', $('#miniMirror').checked); };
const renderPreviewSoon = debounce(renderPreview, 120);

function wireEditor(){
  ta.addEventListener('input', () => { CUR.s.body = ta.value; markDirty(); refreshSoon(); });
  ta.addEventListener('paste', () => {
    if (!$('#autoClean').checked) return;
    setTimeout(() => { const c = cleanText(ta.value); if (c !== ta.value) { ta.value = c; CUR.s.body = c; markDirty(); refreshText(); note('Biçim düzeltildi.'); } }, 0);
  });
  $('#autoClean').checked = !!S.g.autoClean;
  $('#autoClean').addEventListener('change', e => setG('autoClean', e.target.checked));
  $('#titleIn').addEventListener('input', () => { CUR.s.title = $('#titleIn').value; markDirty(); sendInfo(); });
  $('#folderIn').addEventListener('input', () => { CUR.s.folder = $('#folderIn').value; markDirty(); });
  $('#targetIn').addEventListener('input', () => { CUR.s.target_sec = parseTime($('#targetIn').value); markDirty(); updateEstimate(); });
  $('#targetApply').addEventListener('click', () => {
    const v = spsForTarget(curA(), CUR.s.target_sec); if (!v) return;
    setG('sps', clamp(Math.round(v * 100) / 100, 1.5, 10)); note('Hız hedef süreye göre ayarlandı.');
  });
  $('#cleanBtn').addEventListener('click', () => {
    const c = cleanText(ta.value);
    if (c === ta.value) { note('Düzeltilecek bir şey bulunamadı.'); return; }
    ta.value = c; CUR.s.body = c; markDirty(); refreshText(); note('Biçim düzeltildi.');
  });
  $('#clearBtn').addEventListener('click', async () => {
    if (ta.value && !await confirmBox('Metin kutusu boşaltılsın mı? Eski hâli sürüm geçmişinden geri alınabilir.', 'Boşalt')) return;
    ta.value = ''; CUR.s.body = ''; markDirty(); refreshText(); ta.focus();
  });
  for (const b of $$('[data-mk]')) b.addEventListener('click', () => insertMark(b.dataset.mk));
  $('#helpBtn').addEventListener('click', () => openModal('helpModal'));
  $('#fileIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
}
function insertMark(kind){
  const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd, sel = v.slice(a, b);
  const lineStart = v.lastIndexOf('\n', a - 1) + 1;
  let ins = null;
  switch (kind) {
    case 'em': ins = '**' + (sel || 'vurgu') + '**'; break;
    case 'dur': ins = (a && !/\s/.test(v[a - 1]) ? ' ' : '') + '[DUR 1] '; break;
    case 'br': ins = (a && !/\s/.test(v[a - 1]) ? ' ' : '') + '/ '; break;
    case 'h': case 'n': {
      const pre = kind === 'h' ? '# ' : '// ';
      if (sel) { ins = sel.split('\n').map(l => pre + l).join('\n'); break; }
      ta.setRangeText(pre, lineStart, lineStart, 'end'); ta.setSelectionRange(a + pre.length, a + pre.length); break;
    }
  }
  if (ins != null) ta.setRangeText(ins, a, b, 'end');
  ta.focus(); ta.dispatchEvent(new Event('input'));
}
async function importFile(f){
  try {
    let text;
    if (/\.docx$/i.test(f.name)) {
      if (!window.mammoth) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/mammoth.browser.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      text = (await window.mammoth.extractRawText({arrayBuffer: await f.arrayBuffer()})).value;
    } else text = await f.text();
    await newScript({title: f.name.replace(/\.(txt|md|docx)$/i, ''), body: cleanText(text), folder: CUR.s ? CUR.s.folder : ''});
    note(`“${f.name}” yeni metin olarak eklendi.`);
  } catch (e) { note('Dosya okunamadı.'); }
}
function updateEstimate(){
  if (!isRole('prompter')) return;
  const A = curA(), secs = durationOf(A, S.g.sps);
  $('#meta').textContent = `${A.wc.toLocaleString('tr-TR')} kelime · ${Math.round(A.sylSum).toLocaleString('tr-TR')} hece · ${(CUR.s ? CUR.s.body.length : 0).toLocaleString('tr-TR')} karakter` + (A.sections.length ? ` · ${A.sections.length} bölüm` : '');
  const eks = ekranPeers();
  $('#est').innerHTML = A.wc
    ? `Tahmini süre <b>${fmtTime(secs)}</b> · ${speedText(S.g.sps, A.avgSyl)}<br><span class="small">${MODES.find(m => m[0] === S.g.mode)[1]} · ${eks.length ? `akış ${eks.map(p => esc(p.name)).join(', ')} ekranında` : 'akış bu cihazda'}</span>`
    : 'Başlamak için metin girin';
  const t = CUR.s && CUR.s.target_sec, info = $('#targetInfo'), btn = $('#targetApply');
  if (t && A.wc) {
    const need = spsForTarget(A, t);
    if (need) { info.textContent = `Gereken hız: ${speedText(need, A.avgSyl)}`; btn.hidden = Math.abs(need - S.g.sps) < 0.02; }
    else { info.textContent = 'Hedef süre, metindeki duraklardan kısa.'; btn.hidden = true; }
  } else { info.textContent = t ? '' : 'Örn. 2:30 — bu sürede bitirmek için gereken hızı hesaplar'; btn.hidden = true; }
}
function updateResume(){
  const b = $('#resumeBtn'), s = CUR.s;
  if (!s || !s.last_char || !s.body.trim()) { b.hidden = true; return; }
  const A = curA(); if (s.last_char >= A.chars - 2) { b.hidden = true; return; }
  b.hidden = false; b.textContent = `Kaldığı yerden · %${Math.round(s.last_char / A.chars * 100)}`;
}
/* kütüphane */
function updateFolders(){
  const fs = [...new Set(LIB.map(s => s.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  $('#folderList').innerHTML = fs.map(f => `<option value="${esc(f)}">`).join('');
  return fs;
}
let libFolder = '';
function renderLib(){
  const q = $('#libSearch').value.trim().toLocaleLowerCase('tr-TR');
  const fs = updateFolders();
  $('#libFolders').innerHTML = fs.length ? ['', ...fs].map(f => `<button type="button" class="fchip${f === libFolder ? ' on' : ''}" data-f="${esc(f)}">${f ? esc(f) : 'Tümü'}</button>`).join('') : '';
  const rows = LIB.filter(s => (!libFolder || s.folder === libFolder) && (!q || (s.title + ' ' + s.body).toLocaleLowerCase('tr-TR').includes(q)));
  $('#libList').innerHTML = rows.length ? rows.map(s => {
    const A = analyze(s.body, S.g);
    return `<li class="${CUR.s && CUR.s.id === s.id ? 'cur' : ''}"><div class="li-main" data-open="${s.id}"><b>${esc(s.title || 'Adsız metin')}</b>
      <small>${s.folder ? esc(s.folder) + ' · ' : ''}${A.wc} kelime · ≈ ${fmtTime(durationOf(A, S.g.sps))} · ${fmtDate(s.updated_at)}</small>
      <span class="li-pv">${esc(s.body.slice(0, 140))}</span></div>
      <div class="li-act"><button class="btn sm ghost" data-dup="${s.id}" type="button">Kopyala</button><button class="btn sm ghost danger" data-del="${s.id}" type="button">Sil</button></div></li>`;
  }).join('') : `<li class="empty">${LIB.length ? 'Eşleşen metin yok.' : 'Henüz metin yok.'}</li>`;
}
function wireLib(){
  $('#libBtn').addEventListener('click', async () => { openModal('libModal'); renderLib(); $('#libSearch').focus(); try { LIB = await D.listScripts(); renderLib(); } catch (e) {} });
  $('#newBtn').addEventListener('click', () => newScript());
  $('#libSearch').addEventListener('input', renderLib);
  $('#libFolders').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { libFolder = b.dataset.f; renderLib(); } });
  $('#libList').addEventListener('click', async e => {
    const o = e.target.closest('[data-open]'), du = e.target.closest('[data-dup]'), de = e.target.closest('[data-del]');
    if (o) { await openScript(o.dataset.open); closeModal('libModal'); }
    else if (du) {
      const s = LIB.find(x => x.id === du.dataset.dup); if (!s) return;
      try { LIB.unshift(await D.createScript({title: s.title + ' (kopya)', body: s.body, folder: s.folder, target_sec: s.target_sec})); renderLib(); note('Kopya oluşturuldu.'); } catch (x) { note('Kopyalanamadı.'); }
    } else if (de) {
      const s = LIB.find(x => x.id === de.dataset.del); if (!s) return;
      if (!await confirmBox(`“${s.title}” ve tüm sürümleri silinsin mi? Bu geri alınamaz.`, 'Sil')) return;
      try {
        await D.deleteScript(s.id); LIB = LIB.filter(x => x.id !== s.id); D.clearDraft(s.id);
        if (CUR.s && CUR.s.id === s.id) loadIntoEditor(LIB[0] ? {...LIB[0]} : blankScript());
        renderLib(); note('Silindi.');
      } catch (x) { note('Silinemedi.'); }
    }
  });
}
/* sürümler */
let VERS = [];
function wireVersions(){
  const renderVers = () => {
    $('#verList').innerHTML = VERS.length ? VERS.map(v => `<li data-v="${v.id}"><div><b>${fmtDate(v.created_at)}</b><small>${esc(v.title)} · ${v.body.length.toLocaleString('tr-TR')} karakter</small></div>
      <button class="btn sm" data-restore="${v.id}" type="button">Geri yükle</button></li>`).join('') : '<li class="muted">Henüz sürüm yok. Metni değiştirdikçe otomatik oluşur.</li>';
  };
  $('#verBtn').addEventListener('click', async () => {
    if (!CUR.s || !CUR.s.id) { note('Metin henüz kaydedilmedi.'); return; }
    openModal('verModal'); $('#verList').innerHTML = '<li class="muted">Yükleniyor…</li>'; $('#verPv').textContent = 'Bir sürüm seçin.';
    try { VERS = await D.listVersions(CUR.s.id); renderVers(); } catch (e) { $('#verList').innerHTML = '<li class="muted">Yüklenemedi.</li>'; }
  });
  $('#snapBtn').addEventListener('click', async () => {
    await persist();
    try { await D.snapshotVersion(CUR.s.id, CUR.s.title || 'Adsız metin', CUR.s.body); VERS = await D.listVersions(CUR.s.id); renderVers(); note('Sürüm kaydedildi.'); } catch (e) { note('Kaydedilemedi.'); }
  });
  $('#verList').addEventListener('click', async e => {
    const r = e.target.closest('[data-restore]'), v = e.target.closest('[data-v]');
    if (r) {
      const x = VERS.find(y => String(y.id) === r.dataset.restore); if (!x) return;
      if (!await confirmBox('Bu sürüm geri yüklensin mi? Şimdiki hâl önce sürüm olarak kaydedilir.', 'Geri yükle')) return;
      try {
        await persist(); await D.snapshotVersion(CUR.s.id, CUR.s.title || 'Adsız metin', CUR.s.body);
        CUR.s.body = x.body; CUR.s.title = x.title; ta.value = x.body; $('#titleIn').value = x.title;
        CUR.dirty = true; await persist(); refreshText(); sendScript(); closeModal('verModal'); note('Sürüm geri yüklendi.');
      } catch (err) { note('Geri yüklenemedi.'); }
    } else if (v) {
      for (const li of $$('#verList li')) li.classList.toggle('on', li === v);
      const x = VERS.find(y => String(y.id) === v.dataset.v); $('#verPv').textContent = x ? x.body : '';
    }
  });
}
/* çekimler */
let TAKES = [];
const MODE_NAME = Object.fromEntries(MODES);
function wireTakes(){
  const load = async () => {
    const only = $('#takesOnly').checked && CUR.s && CUR.s.id;
    $('#takesBody').innerHTML = '<tr><td colspan="11" class="muted">Yükleniyor…</td></tr>';
    try { await D.flushTakes(); TAKES = await D.listTakes(only ? CUR.s.id : null); renderTakes(); } catch (e) { $('#takesBody').innerHTML = '<tr><td colspan="11" class="muted">Yüklenemedi.</td></tr>'; }
  };
  $('#takesBtn').addEventListener('click', () => { openModal('takesModal'); load(); });
  $('#takesOnly').addEventListener('change', load);
  $('#takesBody').addEventListener('click', async e => {
    const d = e.target.closest('[data-deltake]'); if (!d) return;
    try { await D.deleteTake(d.dataset.deltake); TAKES = TAKES.filter(t => String(t.id) !== d.dataset.deltake); renderTakes(); } catch (x) { note('Silinemedi.'); }
  });
  $('#takesStats').addEventListener('click', e => {
    const b = e.target.closest('[data-usesps]'); if (!b) return;
    setG('personalSps', +b.dataset.usesps); setG('sps', +b.dataset.usesps); note('Varsayılan hızınız güncellendi.');
  });
}
function renderTakes(){
  const avg = CUR.s ? curA().avgSyl : 2.8;
  $('#takesBody').innerHTML = TAKES.length ? TAKES.map(t => `<tr>
    <td>${fmtDate(t.started_at)}</td><td class="tt">${esc(t.script_title)}</td><td>${fmtTime(t.play_sec)}</td>
    <td>${t.completed ? '<span class="ok">✓ bitti</span>' : '%' + Math.round(t.progress * 100)}</td>
    <td>${t.actual_sps ? num(t.actual_sps) + ' hece/sn' : '—'}</td><td>${t.set_sps ? num(t.set_sps) : '—'}</td>
    <td>${MODE_NAME[t.mode] || t.mode}</td><td>${t.stops}</td><td>${t.rewinds}</td><td>${esc(t.device || '')}</td>
    <td><button class="btn sm ghost" data-deltake="${t.id}" type="button" title="Sil">×</button></td></tr>`).join('')
    : '<tr><td colspan="11" class="muted">Henüz çekim yok. Her akış bitişinde otomatik kaydedilir.</td></tr>';
  const done = TAKES.filter(t => t.completed);
  const sp = TAKES.filter(t => t.actual_sps && t.play_sec > 20).slice(0, 10).map(t => t.actual_sps).sort((a, b) => a - b);
  const med = sp.length ? sp[sp.length >> 1] : null;
  $('#takesStats').innerHTML = `<div><b>${TAKES.length}</b><span>çekim</span></div><div><b>${done.length}</b><span>tamamlanan</span></div>
    <div><b>${done.length ? fmtTime(done.reduce((a, t) => a + t.play_sec, 0) / done.length) : '—'}</b><span>ortalama süre</span></div>
    <div><b>${med ? num(med) : '—'}</b><span>gerçek hızınız (hece/sn)${med ? ` ≈ ${Math.round(med * 60 / avg)} kelime/dk` : ''}</span></div>
    ${med ? `<div class="act"><button class="btn sm" data-usesps="${med.toFixed(2)}" type="button">Varsayılan hızım yap</button></div>` : ''}`;
}
/* hız ölçümü */
function wireSpeedTest(){
  let t0 = 0, result = null;
  const go = $('#speedGo'), out = $('#speedOut'), use = $('#speedUse');
  $('#speedText').textContent = SAMPLE_SPEED_TEXT;
  VIEW.openSpeedTest = () => { t0 = 0; result = null; go.textContent = 'Başla'; out.textContent = ''; use.hidden = true; $('#speedText').classList.remove('live'); openModal('speedModal'); };
  const step = () => {
    if (!t0) { t0 = performance.now(); go.textContent = 'Bitti'; out.textContent = 'Okuyun…'; use.hidden = true; $('#speedText').classList.add('live'); return; }
    const secs = (performance.now() - t0) / 1000; t0 = 0; go.textContent = 'Tekrar'; $('#speedText').classList.remove('live');
    if (secs < 4) { out.textContent = 'Çok kısa sürdü, tekrar deneyin.'; return; }
    const A = analyze(SAMPLE_SPEED_TEXT, S.g); result = A.totalU / secs;
    out.innerHTML = `Süre ${num(secs, 1)} sn → <b>${speedText(result, A.avgSyl)}</b>`; use.hidden = false;
  };
  go.addEventListener('click', step);
  $('#speedModal').addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); step(); } });
  use.addEventListener('click', () => {
    if (!result) return; const v = clamp(Math.round(result * 100) / 100, 1.5, 10);
    setG('personalSps', v); setG('sps', v); closeModal('speedModal'); note('Kişisel hızınız kaydedildi.');
  });
}

/* Prompter: akışı başlat (ekran varsa ekranlarda, yoksa bu cihazda) */
function startFlow(resume){
  if (!CUR.s || !CUR.s.body.trim()) { note('Önce bir metin girin.'); ta.focus(); return; }
  if (flowActive()) { note('Akış zaten sürüyor.'); return; }
  for (const m of $$('.modal')) m.hidden = true;
  if (document.activeElement) document.activeElement.blur();
  persist();
  const payload = {body: CUR.s.body, scriptId: CUR.s.id, title: CUR.s.title || 'Adsız metin', targetSec: CUR.s.target_sec, startChar: resume ? CUR.s.last_char : 0};
  voiceSetScript(analyze(CUR.s.body, S.g));
  const offEk = LINK ? LINK.seen.filter(x => x.role === 'ekran' && !PEERS.some(p => p.deviceId === x.deviceId)) : [];
  if (offEk.length) note(`${offEk.map(x => x.name).join(', ')} aynı WiFi'de değil; akışa katılamaz.`, 5000);
  const eks = ekranPeers().map(p => p.deviceId).sort();
  if (eks.length && LINK && LINK.ready) {
    const stageAt = Date.now();
    LINK.send('start', {...payload, to: 'ekran', leadId: eks[0], stageAt});
    LEAD = eks[0];
    showLive(true);
    note(`Akış ${ekranPeers().map(p => p.name).join(', ')} ekranında başladı.`);
    return;
  }
  $('#vPrompter').hidden = true; $('#topbar').hidden = true;
  startStageFrom({...payload, leadId: DEV.id, stageAt: Date.now()});
  primePads();
}
function showLive(on){
  $('#live').hidden = !on;
  if (on) { $('#liveWhere').textContent = LEAD ? '· ' + ((PEERS.find(p => p.deviceId === LEAD) || {}).name || '') : ''; window.scrollTo({top: 0, behavior: 'smooth'}); }
  $('.startbar').hidden = on;
}
function mountPrompter(){
  $('#vPrompter').hidden = false;
  $('#foot').textContent = `GG Prompter ${APP_VERSION}`;
  $('#fEkran').innerHTML = ekranHTML();
  $('#fYazi').innerHTML = yaziHTML();
  $('#fAkis').innerHTML = akisHTML();
  $('#fSticks').innerHTML = sticksHTML();
  const after = () => { renderPreviewSoon(); updateEstimate(); $('#yaziTgt').textContent = `Boyut ve aralıklar: ${$('.tgt-sel') ? $('.tgt-sel').selectedOptions[0]?.textContent || '' : ''}`; };
  const ctx = {...tgtCtx, after, onSpeedTest: () => VIEW.openSpeedTest(), keepMic: () => V.on};
  FORMS.push(bindForm($('#fEkran'), ctx), bindForm($('#fYazi'), ctx), bindForm($('#fAkis'), ctx), bindForm($('#fSticks'), ctx));
  renderTgtSelects();
  wireEditor(); wireLib(); wireVersions(); wireTakes(); wireSpeedTest();
  wireBinds($('#binds'));
  $('#resetBinds').addEventListener('click', () => { resetBinds(); renderBinds($('#binds')); note('Varsayılan tuşlar yüklendi.'); });
  $('#miniMirror').addEventListener('change', renderPreview);
  window.addEventListener('resize', renderPreviewSoon);
  $('#startBtn').addEventListener('click', () => startFlow(false));
  $('#resumeBtn').addEventListener('click', () => startFlow(true));
  window.addEventListener('keydown', e => { if (!flowActive() && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); startFlow(false); } });
  $('#devName').value = DEV.name;
  $('#devName').addEventListener('input', debounce(() => { DEV.name = $('#devName').value.trim() || 'Cihaz'; saveDevice(); track(); }, 500));
  $('#expBtn').addEventListener('click', () => download('gg-prompter-ayarlar.json', exportJSON()));
  $('#impIn').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => { importJSON(t); renderBinds($('#binds')); note('Ayarlar yüklendi.'); }).catch(err => note(err.message || 'Dosya okunamadı.'));
    e.target.value = '';
  });
  const ctlURL = () => { const u = new URL('index.html', location.href); u.searchParams.set('role', 'kumanda'); return u.href; };
  try { const q = window.qrcode(0, 'M'); q.addData(ctlURL()); q.make(); $('#qr').innerHTML = q.createSvgTag({cellSize: 4, margin: 2, scalable: true}); } catch (e) {}
  $('#copyLink').addEventListener('click', () => navigator.clipboard.writeText(ctlURL()).then(() => note('Bağlantı kopyalandı.'), () => note(ctlURL(), 6000)));
  $('#ekWinBtn').addEventListener('click', openEkranWindow);

  /* canlı izleme */
  const liveR = mountRemote($('#liveRemote'), {cmd: (a, x) => flowCmd(a, x), setMode: m => setG('mode', m), lead: d => inputAction(d > 0 ? 'leadUp' : 'leadDown')});
  const liveD = mountDoc($('#liveDoc'), {cmd: (a, x) => flowCmd(a, x), edit: body => applyEditLocal(body)});
  $('#liveHide').addEventListener('click', () => { const d = $('#liveDoc'); d.hidden = !d.hidden; $('#liveHide').textContent = d.hidden ? 'Metni göster' : 'Metni gizle'; });
  $('#liveHide').textContent = 'Metni gizle';
  VIEW.onState = st => {
    const live = !!(st && st.onStage && st.lead !== DEV.id);
    if (live && $('#live').hidden) showLive(true);
    if (!live && !$('#live').hidden && !(st && st.onStage)) showLive(false);
    if (st) { liveR.update(st, {ekrans: ekranPeers().length, ping: PING, mode: S.g.mode, gateDb: S.g.gateDb, followLead: S.g.followLead, voice: {open: V.open, level: V.level, src: V.on, lat: V.lat}}); liveD.highlight(st.onStage ? st.c : -1); }
  };
  VIEW.onStop = p => {
    showLive(false);
    if (CUR.s && p.scriptId === CUR.s.id && p.lastChar != null) { CUR.s.last_char = p.lastChar; updateResume(); }
  };
  VIEW.remoteStart = async p => { if (p.scriptId && (!CUR.s || CUR.s.id !== p.scriptId)) await openScript(p.scriptId); startFlow(!!p.resume); };
  VIEW.openScript = id => openScript(id);
  VIEW.startFlow = startFlow;
  VIEW.applyEdit = (body, title) => applyEditLocal(body, title);
  VIEW.peersChanged = () => { renderTgtSelects(); renderDevList($('#devList')); updateEstimate(); renderPreviewSoon(); liveD.setScript({body: CUR.s ? CUR.s.body : '', title: CUR.s ? CUR.s.title : ''}); };
  VIEW.afterTgt = after;
  VIEW.afterStageEnd = () => { $('#vPrompter').hidden = false; $('#topbar').hidden = false; updateResume(); };
  VIEW.settingsChanged = () => { renderPreviewSoon(); updateEstimate(); };
  function applyEditLocal(body, title){
    if (!CUR.s) return;
    CUR.s.body = body; if (title != null) CUR.s.title = title;
    ta.value = body; $('#titleIn').value = CUR.s.title; markDirty(); refreshText();
    liveD.setScript({body, title: CUR.s.title}); voiceSetScript(analyze(body, S.g));
    if (localStage()) E.applyEdit(body, title); else if (LEAD && LEAD !== DEV.id) LINK.cmd(LEAD, 'edit', {body, title});
    sendScript();
  }
  setInterval(() => { if (CUR.err && navigator.onLine) persist(); D.flushTakes().catch(() => {}); }, 15000);
  window.addEventListener('online', () => { if (CUR.dirty) persist(); D.flushTakes().catch(() => {}); });
  window.addEventListener('pagehide', () => { if (CUR.dirty) persist(); });
  return async () => {
    try {
      LIB = await D.listScripts();
      const want = lsGet('prompter.current'), s = LIB.find(x => x.id === want) || LIB[0], nd = lsGet('prompter.draft.new');
      if (nd && nd.body && (!s || nd.at > Date.parse(s.updated_at || 0))) { localStorage.removeItem('prompter.draft.new'); await newScript({title: nd.title || '', body: nd.body, folder: nd.folder || ''}); }
      else loadIntoEditor(s ? {...s} : blankScript());
    } catch (e) {
      loadIntoEditor({...blankScript(), ...(lsGet('prompter.draft.new') || {})});
      CUR.err = true; setSaveState();
      note(/schema/i.test(e.message || '') ? 'Veritabanı şeması erişilemiyor (Data API ayarı).' : 'Metinler yüklenemedi; bağlantıyı kontrol edin.', 5000);
    }
    updateFolders(); liveD.setScript({body: CUR.s.body, title: CUR.s.title});
  };
}
async function openEkranWindow(){
  let feat = 'popup,width=1280,height=720';
  try {
    if ('getScreenDetails' in window) {
      const sd = await window.getScreenDetails();
      const other = sd.screens.find(s => s !== sd.currentScreen);
      if (other) feat = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
      else note('İkinci ekran bulunamadı; pencereyi monitöre sürükleyin.', 4000);
    }
  } catch (e) {}
  const u = new URL('index.html', location.href); u.searchParams.set('win', Math.random().toString(36).slice(2, 7));
  const w = window.open(u.href, 'ggekran', feat);
  if (!w) note('Tarayıcı açılır pencereyi engelledi; izin verin.', 4000);
}

/* ================= EKRAN ================= */
function mountEkran(){
  $('#stageTop').classList.add('show');
  $('#ekForm').innerHTML = ekranHTML();
  $('#ekYazi').innerHTML = yaziHTML();
  $('#ekMic').innerHTML = `<div class="fh"><span>Seviye</span><button class="linkbtn mic-test" type="button">Mikrofonu test et</button></div><div class="meter"><div class="meter-fill"></div><div class="meter-th"></div></div>`;
  const selfCtx = {type: () => DEV.profile, setType(t){ DEV.profile = t; saveDevice(); track(); }};
  FORMS.push(bindForm($('#ekForm'), selfCtx), bindForm($('#ekYazi'), selfCtx), bindForm($('#ekMic'), selfCtx));
  $('#ekName').value = DEV.name;
  $('#ekName').addEventListener('input', debounce(() => { DEV.name = $('#ekName').value.trim() || 'Ekran'; saveDevice(); track(); }, 500));
  const cal = () => { if (!localStage()) E.start({body: CAL_TEXT, calibrate: true, startChar: 150}); };
  const openSettings = () => { VIEW.settingsOpen = true; E.stopSilently(); $('#vEkran').hidden = false; $('#topbar').hidden = false; };
  const closeSettings = () => { VIEW.settingsOpen = false; $('#vEkran').hidden = true; $('#topbar').hidden = true; cal(); if (LS && LS.onStage) requestJoin(LS.lead); };
  $('#stGear').addEventListener('click', openSettings);
  $('#ekBack').addEventListener('click', closeSettings);
  $('#stFull').addEventListener('click', () => E.requestFull());
  $('#topbar').hidden = true;
  VIEW.onStart = p => { VIEW.settingsOpen = false; $('#vEkran').hidden = true; $('#topbar').hidden = true; startStageFrom(p); };
  VIEW.afterStageEnd = () => { if (!VIEW.settingsOpen) cal(); };
  VIEW.settingsChanged = () => {};
  VIEW.deviceChanged = () => { $('#ekName').value = DEV.name; syncAllForms(); };
  return () => cal();
}

/* ================= KUMANDA ================= */
function mountKumanda(){
  $('#vKumanda').hidden = false;
  const remote = mountRemote($('#kmRemote'), {cmd: (a, x) => flowCmd(a, x), setMode: m => setG('mode', m), lead: d => inputAction(d > 0 ? 'leadUp' : 'leadDown')});
  const doc = mountDoc($('#kmDoc'), {cmd: (a, x) => flowCmd(a, x), edit: sendEdit});
  $('#kmAkis').innerHTML = akisHTML();
  $('#kmEkran').innerHTML = ekranHTML() + `<div class="subhead">Önizleme</div><div class="mini-wrap"><div class="mini" id="kmMini"></div></div>`;
  $('#kmYazi').innerHTML = yaziHTML();
  $('#kmSticks').innerHTML = sticksHTML();
  const after = () => renderMini($('#kmMini'), doc.body, false);
  const ctx = {...tgtCtx, after, onSpeedTest: () => note('Hız ölçümü Prompter cihazındadır.')};
  FORMS.push(bindForm($('#kmAkis'), ctx), bindForm($('#kmEkran'), ctx), bindForm($('#kmYazi'), ctx), bindForm($('#kmSticks'), ctx));
  renderTgtSelects();
  wireBinds($('#kmBinds'));
  for (const b of $$('.km-tabs [data-kt]')) b.addEventListener('click', () => {
    for (const x of $$('.km-tabs [data-kt]')) x.classList.toggle('on', x === b);
    $('#kmRemote').hidden = b.dataset.kt !== 'remote'; $('#kmSettings').hidden = b.dataset.kt !== 'settings'; after();
  });
  $('.km-sub').addEventListener('click', e => {
    const b = e.target.closest('[data-ks]'); if (!b) return;
    for (const x of $$('.km-sub [data-ks]')) x.classList.toggle('on', x === b);
    for (const s of $$('[data-ksec]')) s.hidden = s.dataset.ksec !== b.dataset.ks;
    after();
  });
  // kilit
  let lockT = 0;
  $('#lockBtn').addEventListener('click', () => { $('#lockOv').hidden = false; });
  const ov = $('#lockOv');
  ov.addEventListener('pointerdown', () => { lockT = setTimeout(() => { ov.hidden = true; try { navigator.vibrate && navigator.vibrate(30); } catch (e) {} }, 1000); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) ov.addEventListener(ev, () => clearTimeout(lockT));
  // metinler
  let SCRIPTS = [], INFO = null;
  const loadScripts = async () => {
    try { SCRIPTS = await D.listScripts(); } catch (e) { return; }
    $('#kmScript').innerHTML = SCRIPTS.map(s => `<option value="${s.id}">${esc(s.title || 'Adsız metin')}${s.folder ? ' · ' + esc(s.folder) : ''}</option>`).join('');
    if (INFO && INFO.scriptId) $('#kmScript').value = INFO.scriptId;
  };
  $('#kmScript').addEventListener('change', e => {
    const pp = prompterPeer();
    if (pp) LINK.cmd(pp.deviceId, 'openScript', {scriptId: e.target.value});
    else { const s = SCRIPTS.find(x => x.id === e.target.value); if (s) doc.setScript({body: s.body, title: s.title}); }
  });
  $('#kmStart').addEventListener('click', () => requestStart(false, $('#kmScript').value || null));
  $('#kmResume').addEventListener('click', () => requestStart(true, $('#kmScript').value || null));
  $('#kmName').value = DEV.name;
  $('#kmName').addEventListener('input', debounce(() => { DEV.name = $('#kmName').value.trim() || 'Kumanda'; saveDevice(); track(); }, 500));
  VIEW.onState = st => {
    remote.update(st && st.onStage ? st : {...(st || {}), onStage: false, title: (INFO && INFO.title) || (st && st.title), sps: S.g.sps, avgSyl: (st && st.avgSyl) || 2.8, mode: S.g.mode},
      {ekrans: ekranPeers().length, ping: PING, mode: S.g.mode, gateDb: S.g.gateDb, followLead: S.g.followLead,
       voice: {open: VR.open, level: VR.level, src: performance.now() - VR.at < 1500, lat: VR.lat}});
    doc.highlight(st && st.onStage ? st.c : -1);
    if (st && st.onStage && !doc.body && !prompterPeer() && LEAD && performance.now() - askAt > 3000) { askAt = performance.now(); LINK.cmd(LEAD, 'getScript'); }
  };
  let askAt = 0;
  VIEW.onScript = p => { doc.setScript(p); after(); };
  VIEW.onInfo = p => { INFO = p; if ($('#kmScript').value !== p.scriptId) { if (!SCRIPTS.some(s => s.id === p.scriptId)) loadScripts(); else $('#kmScript').value = p.scriptId; } $('#kmResume').hidden = !p.resumeChar; };
  VIEW.onStop = () => VIEW.onState(LS);
  let askedFrom = null;
  VIEW.peersChanged = () => {
    renderTgtSelects(); renderDevList($('#kmDevList')); after();
    const pp = prompterPeer();
    if (pp && askedFrom !== pp.deviceId) { askedFrom = pp.deviceId; LINK.cmd(pp.deviceId, 'getScript'); loadScripts(); }
  };
  VIEW.afterTgt = after;
  VIEW.settingsChanged = () => { after(); VIEW.onState(LS); };
  VIEW.startWithoutPrompter = (resume, scriptId) => {
    const eks = ekranPeers().map(p => p.deviceId).sort();
    if (!eks.length) { note('Bağlı Ekran yok. Bir cihazı Ekran yapın.'); return; }
    const s = SCRIPTS.find(x => x.id === scriptId) || SCRIPTS[0];
    if (!s) { note('Metin yok.'); return; }
    LINK.send('start', {to: 'ekran', leadId: eks[0], stageAt: Date.now(), body: s.body, scriptId: s.id, title: s.title, targetSec: s.target_sec, startChar: resume ? s.last_char : 0});
    LEAD = eks[0];
  };
  setInterval(() => { const t = LEAD || (prompterPeer() || {}).deviceId; if (t && LINK) LINK.cmd(t, 'ping', {t: performance.now()}); }, 3000);
  setInterval(() => VIEW.onState(LS), 500);
  return () => { loadScripts(); const pp = prompterPeer(); if (pp) LINK.cmd(pp.deviceId, 'getScript'); VIEW.onState(LS); };
}

/* ================= Akış sonu ================= */
function afterStageEnd(){
  myStageAt = 0; track(); refreshLead();
  VIEW.afterStageEnd && VIEW.afterStageEnd();
  primePads();
}
function onStageExit({take, lastChar, scriptId, lead}){
  if (lead && LINK) LINK.send('stop', {scriptId, lastChar});
  if (lead) {
    if (scriptId) D.touchScript(scriptId, {last_char: lastChar});
    if (take.play_sec >= 5) D.saveTake(take).catch(() => {});
    if (isRole('prompter') && CUR.s && CUR.s.id === scriptId) CUR.s.last_char = lastChar;
  }
  LS = null;
  afterStageEnd();
}

/* ================= Ses (karar her zaman Prompter cihazında) ================= */
function voiceRole(){
  if (S.g.mode === 'fixed' || !flowActive()) return null;
  if (isRole('prompter')) return 'decide';
  if (amLead() && !prompterPeer()) return 'decide';          // Prompter yoksa lider ekran kendi mikrofonuyla karar verir
  if (localStage() && prof().show.voice) return 'meter';
  return null;
}
let voiceBusy = false;
async function reconcileVoice(){
  if (voiceBusy) return; voiceBusy = true;
  try {
    const want = voiceRole();
    if (want === 'decide') {
      if (!V.on || V.mode !== S.g.mode) {
        await voiceSetMode(S.g.mode, () => localStage() ? E.headChar() : (LS ? LS.c : 0));
        if (V.recErr) note(V.recErr, 4000);
      }
    } else {
      if (V.on) voiceStopAll();
      if (want === 'meter' && !micActive()) await startMic();
      if (!want && micActive() && !$$('.mic-test').some(b => b.textContent.includes('durdur'))) stopMic();
    }
  } finally { voiceBusy = false; }
}
let lastVoiceSend = 0;
function sendVoice(now){
  if (!V.on || !LINK || !LINK.ready || now - lastVoiceSend < 80) return;
  lastVoiceSend = now;
  const e = S.g.mode === 'follow' ? voiceEstimate() : null;
  LINK.send('voice', {open: V.open, tc: e ? +e.targetC.toFixed(2) : null, rate: e ? +e.rate.toFixed(3) : null, lat: e ? +e.lat.toFixed(2) : null, level: Math.round(V.level)});
}

/* ================= Döngü ================= */
let lastT = performance.now(), lastRec = 0, lastFI = 0;
function frame(now){
  const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000)); lastT = now;
  pollPads(now, dt);
  voiceTick(now);
  if (!V.on && micActive()) readLevel();
  E.tick(now, dt);
  if (amLead()) broadcastState();
  sendVoice(now);
  tickMeters(() => V.level);
  if (now - lastFI > 500) { lastFI = now; const src = V.on ? {lat: V.lat, rate: V.rate} : (now - VR.at < 1500 ? {lat: VR.lat, rate: VR.rate} : null);
    for (const el of $$('.follow-info')) el.textContent = src && src.lat != null ? `Ölçülen tanıma gecikmesi ≈ ${num(src.lat, 1)} sn${src.rate ? ` · okuma hızınız ≈ ${num(src.rate)} hece/sn` : ''}` : 'Ölçüm, sesle takip sırasında Prompter cihazında yapılır.'; }
  if (now - lastRec > 500) { lastRec = now; reconcileVoice(); }
  requestAnimationFrame(frame);
}

/* ================= Açılış ================= */
async function main(){
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing; if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) note('Yeni sürüm hazır — sayfayı yenileyin.', 6000); });
      });
    }).catch(() => {});
  }
  $('#boot').hidden = true;
  USER = await loginGate($('#login'), DEFAULT_EMAIL);
  $('#boot').hidden = false;

  E.initStage({
    onExit: onStageExit,
    onChange: () => broadcastState(true),
    onProgress: c => { if (isRole('prompter') && CUR.s && CUR.s.id === E.P.scriptId) CUR.s.last_char = c; },
    voice: () => {
      if (S.g.mode === 'fixed') return null;
      if (V.on) { const e = S.g.mode === 'follow' ? voiceEstimate() : null; return {open: V.open, targetC: e ? e.targetC : null, rate: e ? e.rate : null, lat: e ? e.lat : null}; }
      if (performance.now() - VR.at < 1500) return {open: VR.open, targetC: VR.tc, rate: VR.rate, lat: VR.lat};
      return null;
    },
    level: () => V.level,
    input: a => inputAction(a),
    inputHold: (a, on) => flowCmd('hold', {value: a, on}),
    keepFullscreen: () => isRole('ekran'),
    keepAwake: () => isRole('ekran'),
  });
  wireStageMouse($('#stage'), '#ctl, .stage-top');
  setHandler({
    live: () => flowActive() && !typing() && !capturing() && !$('#lockOv').offsetParent,
    action: a => inputAction(a),
    hold: (a, on) => flowCmd('hold', {value: a, on}),
    stick: (m, x, dt) => inputStick(m, x, dt),
    idleToggle: () => { if (!typing() && !modalOpen()) requestStart(false); },
    padChange: updatePadBadge,
  });
  wireGlobalInput();

  // bağlantı + rol kararı
  let firstSync = null;
  const synced = new Promise(r => { firstSync = r; });
  LINK = createLink({
    user: USER, deviceId: DEV.id, meta: {role: DEV.role || 'kumanda', name: DEV.name, profile: DEV.profile, onStage: false, w: innerWidth, h: innerHeight},
    on: ON,
    onPresence: peers => {
      PEERS = peers; refreshLead(); setLinkBadge(); if ((peers.length || LINK.seen.length) && firstSync) setTimeout(firstSync, 400);
      if (DEV.role === 'prompter' && DEV.roleAuto && peers.some(p => p.role === 'prompter')) { setRole('kumanda', true); return; }
      if (DEV.role) { VIEW.peersChanged && VIEW.peersChanged(); if (LEAD && !PEERS.some(p => p.deviceId === LEAD) && LEAD !== DEV.id) { LEAD = null; refreshLead(); } }
    },
    onStatus: () => { setLinkBadge(); firstSync && setTimeout(firstSync, 1500); },
  });
  setCfgSender(patch => LINK.send('cfg', {patch}));
  // yalnızca gerekince yeniden kur: görünürlük/duraklar → metni yeniden diz; görünüm → stili yenile
  const sigBuild = () => JSON.stringify([DEV.profile, prof().show, S.g.pauseOn, S.g.pauseScale]);
  const sigLook = () => JSON.stringify([prof(), S.g.font, S.g.weight, S.g.italic, S.g.align, S.g.textColor, S.g.emphColor, S.g.readTone, S.g.readOpacity, S.g.focusStrength]);
  let lastB = sigBuild(), lastL = sigLook();
  onSettings(() => {
    const b = sigBuild(), l = sigLook();
    if (E.P.on && (b !== lastB || l !== lastL)) E.restyle(b !== lastB);
    lastB = b; lastL = l;
    VIEW.settingsChanged && VIEW.settingsChanged();
  });
  await Promise.race([synced, new Promise(r => setTimeout(r, 1800))]);
  const otherPrompter = () => prompterPeer() || LINK.seen.find(p => p.role === 'prompter');
  if (!DEV.role) { DEV.role = otherPrompter() ? 'kumanda' : 'prompter'; DEV.roleAuto = true; saveDevice(); }
  if (DEV.role === 'prompter' && otherPrompter() && DEV.roleAuto) { DEV.role = 'kumanda'; saveDevice(); }
  if (DEV.role === 'prompter' && !DEV.roleAuto) LINK.send('role', {role: 'prompter'});
  document.body.dataset.role = DEV.role;
  document.title = `GG Prompter · ${ROLE_NAME[DEV.role]}`;

  $('#boot').hidden = true;
  $('#topbar').hidden = false;
  renderRoleSw($('#roleSw')); renderRoleSw($('#roleSw2'));
  $('#logoutBtn').addEventListener('click', async () => {
    if (!await confirmBox('Bu cihazda GG Prompter oturumu kapatılsın mı?', 'Çıkış yap')) return;
    if (CUR.dirty) await persist();
    await sb.auth.signOut(); location.reload();
  });
  for (const el of $$('[data-only]')) el.hidden = el.dataset.only !== DEV.role;
  const ready = DEV.role === 'prompter' ? mountPrompter() : DEV.role === 'ekran' ? mountEkran() : mountKumanda();
  track(); setLinkBadge(); updatePadBadge();
  syncSettings().catch(() => {});
  VIEW.peersChanged && VIEW.peersChanged();
  requestAnimationFrame(frame);
  await ready();
  D.flushTakes().catch(() => {});
}
main();
