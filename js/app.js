import { $, $$, clamp, esc, num, fmtTime, parseTime, debounce, fmtDate, lsGet, lsSet, note, download, confirmBox } from './util.js';
import { DEFAULT_EMAIL, APP_VERSION } from './config.js';
import { sb, loginGate } from './supa.js';
import { S, DEV, prof, FONTS, WEIGHTS, PROFILE_META, DEF_SPS, MODES, save, saveNow, saveDevice, syncSettings, exportJSON, importJSON, resetBinds, resetProfile, fontOf } from './settings.js';
import { analyze, speedText, durationOf, spsForTarget, cleanText, P_COMMA, P_STOP, P_PARA, SAMPLE_SPEED_TEXT } from './text.js';
import * as D from './data.js';
import { wireBinds, renderBinds, wireGlobalInput, wireStageMouse, setHandler, pollPads, primePads, getPads, capturing } from './input.js';
import * as E from './engine.js';
import { V, startMic, stopMic, readLevel, tick as voiceTick, voiceSupported } from './voice.js';
import { createLink } from './link.js';

const ICON = {
  phone:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2" stroke-linecap="round"/></svg>',
  tablet:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2.2"/><path d="M11 18h2" stroke-linecap="round"/></svg>',
  desktop:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="10.5" rx="1.6"/><path d="M2 18.5h20" stroke-linecap="round"/></svg>',
  monitor:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="4" width="19" height="12.5" rx="1.6"/><path d="M9 20.5h6M12 16.5v4" stroke-linecap="round"/></svg>',
};
const SAMPLE = 'Merhaba, bu bir önizleme metnidir. Okunan kelimeler **harf harf** yavaşça griye döner ve solar; sıradaki kelimeler parlak kalır. Çağrı, şükür, ılık rüzgâr, İğneada, Ödül ve Ünal gibi Türkçe karakterler sorunsuz görünür.';
const ta = $('#ta');
let USER = null, LINK = null;

/* ================= Metin durumu ================= */
const CUR = { s: null, dirty: false, saving: false, err: false };
let LIB = [];
const blankScript = () => ({ id: null, title: '', body: '', folder: '', target_sec: null, last_char: 0, updated_at: null });
const curA = () => analyze(CUR.s ? CUR.s.body : '', S.g);

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
  if (!CUR.s || CUR.saving) return;
  if (!CUR.dirty) return;
  CUR.saving = true; CUR.dirty = false; setSaveState();
  const s = CUR.s;
  const fields = { title: s.title.trim() || 'Adsız metin', body: s.body, folder: s.folder.trim(), target_sec: s.target_sec || null };
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
    if (s.id) D.setDraft(s.id, {...fields, at: Date.now()});
    else lsSet('prompter.draft.new', {...fields, at: Date.now()});
  }
  CUR.saving = false; setSaveState(); updateFolders();
  if (CUR.dirty && !CUR.err) persistSoon();
}
const persistSoon = debounce(persist, 1200);
function markDirty(){
  CUR.dirty = true; setSaveState();
  if (CUR.s.id) D.setDraft(CUR.s.id, {title: CUR.s.title, body: CUR.s.body, folder: CUR.s.folder, target_sec: CUR.s.target_sec, at: Date.now()});
  else lsSet('prompter.draft.new', {title: CUR.s.title, body: CUR.s.body, folder: CUR.s.folder, at: Date.now()});
  persistSoon();
}
setInterval(() => { if (CUR.err && navigator.onLine) persist(); D.flushTakes().catch(() => {}); }, 15000);
window.addEventListener('online', () => { if (CUR.dirty) persist(); D.flushTakes().catch(() => {}); });

function loadIntoEditor(s){
  CUR.s = s; CUR.dirty = false; CUR.err = false;
  if (s.id) {
    const d = D.getDraft(s.id);
    if (d && (!s.updated_at || d.at > Date.parse(s.updated_at))) { Object.assign(s, {title: d.title, body: d.body, folder: d.folder, target_sec: d.target_sec ?? s.target_sec}); CUR.dirty = true; persistSoon(); }
    lsSet('prompter.current', s.id);
    D.touchScript(s.id);
  }
  ta.value = s.body; $('#titleIn').value = s.title === 'Adsız metin' && !s.body ? '' : s.title;
  $('#folderIn').value = s.folder || ''; $('#targetIn').value = s.target_sec ? fmtTime(s.target_sec) : '';
  setSaveState(); refreshText(); broadcastSetup();
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

/* ================= Ayar kontrolleri ================= */
const FMT = {
  anchor: v => '%' + Math.round(v), cropTop: v => '%' + num(v, 1), cropBottom: v => '%' + num(v, 1), cropSide: v => '%' + num(v, 1),
  size: v => Math.round(v) + ' pt', lineHeight: v => num(v, 2), letter: v => (v > 0 ? '+' : '') + num(v, 2) + ' em',
  margin: v => '%' + num(v, v % 1 ? 1 : 0),
  sps: v => speedText(v, curA().avgSyl), fadeWidth: v => Math.round(v) + ' harf',
  readTone: v => '%' + Math.round(v * 100), readOpacity: v => '%' + Math.round(v * 100),
  pauseScale: v => '×' + num(v, 2), lead: v => num(v, 2) + ' hece', focusStrength: v => '%' + Math.round(v * 100),
  boostMul: v => '×' + num(v, 1), gateDb: v => Math.round(v) + ' dB', gateHold: v => num(v, 1) + ' sn',
};
const MODE_HINT = {
  fixed: 'Metin seçtiğiniz hızda akar.',
  gate: 'Konuştuğunuz sürece akar, susunca durur. Mikrofon izni ister.',
  follow: 'Söylediğiniz kelimeleri tanıyıp akışı sesinize göre hızlandırır/yavaşlatır. Türkçe tanıma için Chrome veya Safari ve internet gerekir.',
};
function buildStaticUI(){
  $('#profiles').innerHTML = PROFILE_META.map(([id, n]) => `<button type="button" data-v="${id}">${ICON[id]}<span>${n}</span></button>`).join('');
  $('#fonts').innerHTML = FONTS.map(f => `<button type="button" data-v="${f.id}" style="font-family:${f.fam.replace(/"/g, "'")}"><b>${f.name}</b><small>Ağ Şiş İı Çö Ğü</small></button>`).join('');
  $('#weights').innerHTML = WEIGHTS.map(([w, n]) => `<button type="button" data-v="${w}">${n}</button>`).join('');
  $('#speedText').textContent = SAMPLE_SPEED_TEXT;
  $('#foot').textContent = `Aynalı Prompter ${APP_VERSION}`;
}
function syncControls(){
  const pr = prof();
  for (const el of $$('#setup input[data-g], #setup input[data-p]')) {
    const v = el.dataset.g ? S.g[el.dataset.g] : pr[el.dataset.p];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
  for (const el of $$('input[data-gc]')) el.value = S.g[el.dataset.gc];
  for (const seg of $$('#setup .seg[data-g], #setup .seg[data-p]')) {
    const v = seg.dataset.g ? S.g[seg.dataset.g] : pr[seg.dataset.p];
    for (const b of seg.querySelectorAll('button[data-v]')) b.classList.toggle('on', String(v).toLowerCase() === b.dataset.v.toLowerCase());
    const cp = seg.querySelector('.colorpick'); if (cp) cp.classList.toggle('on', !seg.querySelector('button.on'));
  }
  for (const b of $$('#profiles button')) b.classList.toggle('on', b.dataset.v === DEV.profile);
  for (const o of $$('output[data-o]')) {
    const k = o.dataset.o, v = (k in S.g) ? S.g[k] : pr[k];
    o.textContent = FMT[k] ? FMT[k](+v) : v;
  }
  $('#rotField').hidden = pr.orientation === 'auto';
  $('#pauseField').classList.toggle('off', !S.g.pauseOn);
  $('#focusField').classList.toggle('off', !S.g.focusOn);
  $('#voiceBox').hidden = S.g.mode === 'fixed';
  $('#modeHint').textContent = MODE_HINT[S.g.mode];
  $('#devName').value = DEV.name;
  for (const b of $$('#fonts button')) { b.style.fontStyle = S.g.italic ? 'italic' : 'normal'; b.querySelector('b').style.fontWeight = S.g.weight; }
  const k = S.g.pauseScale / S.g.sps;
  $('#pauseHint').textContent = `Bu hızda: virgül ≈ ${num(P_COMMA * k)} sn · nokta ≈ ${num(P_STOP * k)} sn · paragraf sonu ≈ ${num(P_PARA * k)} sn`;
  $('#personalInfo').textContent = S.g.personalSps ? ` · Ölçülen hızınız: ${num(S.g.personalSps)} hece/sn` : '';
  $('#micTh').style.left = clamp((S.g.gateDb + 70) / 60 * 100, 0, 100) + '%';
}
function onSettingsChanged(){ syncControls(); renderPreview(); updateEstimate(); save(); }
function wireControls(){
  for (const el of $$('#setup input[data-g], #setup input[data-p]')) {
    el.addEventListener('input', () => {
      const v = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
      if (el.dataset.g) S.g[el.dataset.g] = v; else prof()[el.dataset.p] = v;
      onSettingsChanged();
    });
  }
  for (const el of $$('input[data-gc]')) el.addEventListener('input', () => { S.g[el.dataset.gc] = el.value; onSettingsChanged(); });
  for (const seg of $$('#setup .seg[data-g], #setup .seg[data-p]')) {
    seg.addEventListener('click', e => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      let v = b.dataset.v; if (seg.hasAttribute('data-num')) v = parseFloat(v);
      if (seg.dataset.g) S.g[seg.dataset.g] = v; else prof()[seg.dataset.p] = v;
      if (seg.dataset.g === 'mode' && v !== 'fixed') {
        const sup = voiceSupported();
        if (v === 'follow' && !sup.speech) note('Bu tarayıcıda Türkçe konuşma tanıma yok; Chrome veya Safari kullanın.', 4000);
      }
      onSettingsChanged();
    });
  }
  $('#profiles').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    DEV.profile = b.dataset.v; saveDevice(); onSettingsChanged(); broadcastSetup();
  });
  $('#devName').addEventListener('input', debounce(() => { DEV.name = $('#devName').value.trim() || 'Cihaz'; saveDevice(); if (LINK) LINK.track({name: DEV.name}); }, 500));
  $('#resetProfile').addEventListener('click', () => { resetProfile(); onSettingsChanged(); note('Ekran tipi varsayılana döndü.'); });
  $('#resetSpeed').addEventListener('click', () => { S.g.sps = S.g.personalSps || DEF_SPS; onSettingsChanged(); });
  $('#resetBinds').addEventListener('click', () => { resetBinds(); renderBinds($('#binds')); note('Varsayılan tuşlar yüklendi.'); });
  $('#expBtn').addEventListener('click', () => download('prompter-ayarlar.json', exportJSON()));
  $('#impIn').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => { importJSON(t); syncControls(); renderBinds($('#binds')); renderPreview(); updateEstimate(); note('Ayarlar yüklendi.'); })
      .catch(err => note(err.message || 'Dosya okunamadı.'));
    e.target.value = '';
  });
  let micOn = false;
  $('#micTest').addEventListener('click', async () => {
    if (micOn) { stopMic(); micOn = false; $('#micTest').textContent = 'Mikrofonu test et'; return; }
    if (await startMic()) { micOn = true; $('#micTest').textContent = 'Testi durdur'; } else note(V.micErr || 'Mikrofon açılamadı.');
  });
  SETUP_TICK.push(() => {
    if (!micOn || E.P.on) return;
    const lv = readLevel();
    $('#micFill').style.width = clamp((lv + 70) / 60 * 100, 0, 100) + '%';
    $('#micFill').classList.toggle('hot', lv > S.g.gateDb);
  });
}

/* ================= Metin düzenleyici ================= */
function refreshText(){ renderPreview(); updateEstimate(); updateResume(); }
const refreshSoon = debounce(refreshText, 150);
function wireEditor(){
  ta.addEventListener('input', () => { CUR.s.body = ta.value; markDirty(); refreshSoon(); broadcastSetupSoon(); });
  ta.addEventListener('paste', () => {
    if (!S.g.autoClean) return;
    setTimeout(() => { const c = cleanText(ta.value); if (c !== ta.value) { ta.value = c; CUR.s.body = c; markDirty(); refreshText(); note('Biçim düzeltildi.'); } }, 0);
  });
  $('#titleIn').addEventListener('input', () => { CUR.s.title = $('#titleIn').value; markDirty(); broadcastSetupSoon(); });
  $('#folderIn').addEventListener('input', () => { CUR.s.folder = $('#folderIn').value; markDirty(); });
  $('#targetIn').addEventListener('input', () => { CUR.s.target_sec = parseTime($('#targetIn').value); markDirty(); updateEstimate(); });
  $('#targetApply').addEventListener('click', () => {
    const v = spsForTarget(curA(), CUR.s.target_sec); if (!v) return;
    S.g.sps = clamp(Math.round(v * 100) / 100, 1.5, 10); onSettingsChanged(); note('Hız hedef süreye göre ayarlandı.');
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
  $('#fileIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
}
function insertMark(kind){
  const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd, sel = v.slice(a, b);
  let ins, caret;
  const lineStart = v.lastIndexOf('\n', a - 1) + 1;
  switch (kind) {
    case 'em': ins = '**' + (sel || 'vurgu') + '**'; break;
    case 'dur': ins = (a && !/\s/.test(v[a - 1]) ? ' ' : '') + '[DUR 1]' + ' '; break;
    case 'br': ins = (a && !/\s/.test(v[a - 1]) ? ' ' : '') + '/ '; break;
    case 'h': case 'n': {
      const pre = kind === 'h' ? '# ' : '// ';
      if (sel) { ins = sel.split('\n').map(l => pre + l).join('\n'); break; }
      ta.setRangeText(pre, lineStart, lineStart, 'end'); caret = a + pre.length; ins = null; break;
    }
  }
  if (ins != null) ta.setRangeText(ins, a, b, 'end');
  if (caret != null) ta.setSelectionRange(caret, caret);
  ta.focus(); ta.dispatchEvent(new Event('input'));
}
async function importFile(f){
  try {
    let text;
    if (/\.docx$/i.test(f.name)) {
      if (!window.mammoth) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/mammoth.browser.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      const r = await window.mammoth.extractRawText({arrayBuffer: await f.arrayBuffer()});
      text = r.value;
    } else text = await f.text();
    text = cleanText(text);
    const title = f.name.replace(/\.(txt|md|docx)$/i, '');
    await newScript({title, body: text, folder: CUR.s ? CUR.s.folder : ''});
    note(`“${f.name}” yeni metin olarak eklendi.`);
  } catch (e) { note('Dosya okunamadı.'); }
}

/* ================= Önizleme / tahmin ================= */
function textStyle(el){
  const pr = prof();
  el.style.fontFamily = fontOf(S.g.font).fam + ', system-ui, sans-serif';
  el.style.fontWeight = S.g.weight; el.style.fontStyle = S.g.italic ? 'italic' : 'normal';
  el.style.lineHeight = pr.lineHeight; el.style.letterSpacing = pr.letter + 'em';
  el.style.textAlign = S.g.align; el.style.color = S.g.textColor;
  el.style.setProperty('--em', S.g.emphColor);
}
function renderPreview(){
  const pv = $('#pv'); textStyle(pv);
  const body = (ta.value.trim() ? ta.value : SAMPLE).slice(0, 700);
  const A = analyze(body, S.g);
  const lim = Math.min(A.chars, 260), head = lim * 0.42, fw = S.g.fadeWidth;
  const tone = Math.round(255 * S.g.readTone);
  const hex = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h); const v = m ? parseInt(m[1], 16) : 0xffffff; return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
  const base = [hex(S.g.textColor), hex(S.g.emphColor), [166,220,242], [226,170,44], [127,138,150]];
  pv.textContent = '';
  let ci = 0;
  for (const p of A.paras) {
    if (ci > lim) break;
    if (p.type === 'gap') { const g = document.createElement('div'); g.className = 'gap'; pv.appendChild(g); continue; }
    const d = document.createElement('div'); d.className = 'para' + (p.type === 'h' ? ' hd' : p.type === 'n' ? ' nt' : '');
    p.tokens.forEach((ti, k) => {
      const t = A.tokens[ti];
      if (k) d.appendChild(document.createTextNode(' '));
      const s = document.createElement('span'); s.className = 'tk' + (t.kind === 'hold' ? ' hold' : t.kind === 'b' ? ' br' : '');
      for (const ch of t.chars) {
        const e = document.createElement('span'); e.textContent = ch.ch;
        const c = t.kind !== 'w' ? 4 : p.type === 'h' ? 3 : p.type === 'n' ? 2 : ch.e ? 1 : 0;
        if (c === 1) e.className = 'em';
        const q = Math.min(1, Math.max(0, (head - ci) / fw));
        if (q > 0) { const b = base[c]; e.style.color = `rgb(${b.map(x => Math.round(x + (tone - x) * q)).join(',')})`; e.style.opacity = (1 + (S.g.readOpacity - 1) * q).toFixed(3); }
        s.appendChild(e); ci++;
      }
      d.appendChild(s);
    });
    pv.appendChild(d);
  }
}
function updateEstimate(){
  const A = curA(), secs = durationOf(A, S.g.sps);
  $('#meta').textContent = `${A.wc.toLocaleString('tr-TR')} kelime · ${Math.round(A.sylSum).toLocaleString('tr-TR')} hece · ${(CUR.s ? CUR.s.body.length : 0).toLocaleString('tr-TR')} karakter` + (A.sections.length ? ` · ${A.sections.length} bölüm` : '');
  const o = $('output[data-o="sps"]'); if (o) o.textContent = FMT.sps(S.g.sps);
  $('#est').innerHTML = A.wc
    ? `Tahmini süre <b>${fmtTime(secs)}</b> · ${speedText(S.g.sps, A.avgSyl)}<br><span class="small">${MODES.find(m => m[0] === S.g.mode)[1]} · Ctrl / ⌘ + Enter ile de başlar</span>`
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

/* ================= Kütüphane ================= */
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
  const rows = LIB.filter(s => (!libFolder || s.folder === libFolder) &&
    (!q || (s.title + ' ' + s.body).toLocaleLowerCase('tr-TR').includes(q)));
  $('#libList').innerHTML = rows.length ? rows.map(s => {
    const A = analyze(s.body, S.g);
    return `<li class="${CUR.s && CUR.s.id === s.id ? 'cur' : ''}" data-id="${s.id}">
      <div class="li-main" data-open="${s.id}"><b>${esc(s.title || 'Adsız metin')}</b>
        <small>${s.folder ? esc(s.folder) + ' · ' : ''}${A.wc} kelime · ≈ ${fmtTime(durationOf(A, S.g.sps))} · ${fmtDate(s.updated_at)}</small>
        <span class="li-pv">${esc(s.body.slice(0, 140))}</span></div>
      <div class="li-act"><button class="btn sm ghost" data-dup="${s.id}" type="button" title="Kopyala">Kopyala</button><button class="btn sm ghost danger" data-del="${s.id}" type="button" title="Sil">Sil</button></div></li>`;
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
      try { const row = await D.createScript({title: s.title + ' (kopya)', body: s.body, folder: s.folder, target_sec: s.target_sec}); LIB.unshift(row); renderLib(); note('Kopya oluşturuldu.'); } catch (x) { note('Kopyalanamadı.'); }
    } else if (de) {
      const s = LIB.find(x => x.id === de.dataset.del); if (!s) return;
      if (!await confirmBox(`“${s.title}” ve tüm sürümleri silinsin mi? Bu geri alınamaz.`, 'Sil')) return;
      try {
        await D.deleteScript(s.id); LIB = LIB.filter(x => x.id !== s.id); D.clearDraft(s.id);
        if (CUR.s && CUR.s.id === s.id) { if (LIB[0]) loadIntoEditor({...LIB[0]}); else loadIntoEditor(blankScript()); }
        renderLib(); note('Silindi.');
      } catch (x) { note('Silinemedi.'); }
    }
  });
}

/* ================= Sürümler ================= */
let VERS = [];
function wireVersions(){
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
        await persist();
        await D.snapshotVersion(CUR.s.id, CUR.s.title || 'Adsız metin', CUR.s.body);
        CUR.s.body = x.body; CUR.s.title = x.title; ta.value = x.body; $('#titleIn').value = x.title;
        CUR.dirty = true; await persist(); refreshText(); closeModal('verModal'); note('Sürüm geri yüklendi.');
      } catch (err) { note('Geri yüklenemedi.'); }
    } else if (v) {
      for (const li of $$('#verList li')) li.classList.toggle('on', li === v);
      const x = VERS.find(y => String(y.id) === v.dataset.v); $('#verPv').textContent = x ? x.body : '';
    }
  });
}
function renderVers(){
  $('#verList').innerHTML = VERS.length ? VERS.map(v => `<li data-v="${v.id}"><div><b>${fmtDate(v.created_at)}</b><small>${esc(v.title)} · ${v.body.length.toLocaleString('tr-TR')} karakter</small></div>
    <button class="btn sm" data-restore="${v.id}" type="button">Geri yükle</button></li>`).join('') : '<li class="muted">Henüz sürüm yok. Metni değiştirdikçe otomatik oluşur.</li>';
}

/* ================= Çekimler ================= */
let TAKES = [];
function wireTakes(){
  const load = async () => {
    const only = $('#takesOnly').checked && CUR.s && CUR.s.id;
    $('#takesBody').innerHTML = '<tr><td colspan="10" class="muted">Yükleniyor…</td></tr>';
    try { await D.flushTakes(); TAKES = await D.listTakes(only ? CUR.s.id : null); renderTakes(); } catch (e) { $('#takesBody').innerHTML = '<tr><td colspan="10" class="muted">Yüklenemedi.</td></tr>'; }
  };
  $('#takesBtn').addEventListener('click', () => { openModal('takesModal'); load(); });
  $('#takesOnly').addEventListener('change', load);
  $('#takesBody').addEventListener('click', async e => {
    const d = e.target.closest('[data-deltake]'); if (!d) return;
    try { await D.deleteTake(d.dataset.deltake); TAKES = TAKES.filter(t => String(t.id) !== d.dataset.deltake); renderTakes(); } catch (x) { note('Silinemedi.'); }
  });
  $('#takesStats').addEventListener('click', e => {
    const b = e.target.closest('[data-usesps]'); if (!b) return;
    S.g.sps = S.g.personalSps = +b.dataset.usesps; onSettingsChanged(); note('Varsayılan hızınız güncellendi.');
  });
}
const MODE_NAME = Object.fromEntries(MODES);
function renderTakes(){
  const avg = CUR.s ? curA().avgSyl : 2.8;
  $('#takesBody').innerHTML = TAKES.length ? TAKES.map(t => `<tr>
    <td>${fmtDate(t.started_at)}</td><td class="tt">${esc(t.script_title)}</td><td>${fmtTime(t.play_sec)}</td>
    <td>${t.completed ? '<span class="ok">✓ bitti</span>' : '%' + Math.round(t.progress * 100)}</td>
    <td>${t.actual_sps ? num(t.actual_sps) + ' hece/sn' : '—'}</td><td>${t.set_sps ? num(t.set_sps) : '—'}</td>
    <td>${MODE_NAME[t.mode] || t.mode}</td><td>${t.stops}</td><td>${t.rewinds}</td>
    <td><button class="btn sm ghost" data-deltake="${t.id}" type="button" title="Sil">×</button></td></tr>`).join('')
    : '<tr><td colspan="10" class="muted">Henüz çekim yok. Prompter ekranından her çıkışta otomatik kaydedilir.</td></tr>';
  const done = TAKES.filter(t => t.completed);
  const sp = TAKES.filter(t => t.actual_sps && t.play_sec > 20).slice(0, 10).map(t => t.actual_sps).sort((a, b) => a - b);
  const med = sp.length ? sp[sp.length >> 1] : null;
  $('#takesStats').innerHTML = `<div><b>${TAKES.length}</b><span>çekim</span></div><div><b>${done.length}</b><span>tamamlanan</span></div>
    <div><b>${done.length ? fmtTime(done.reduce((a, t) => a + t.play_sec, 0) / done.length) : '—'}</b><span>ortalama süre</span></div>
    <div><b>${med ? num(med) : '—'}</b><span>gerçek hızınız (hece/sn)${med ? ` ≈ ${Math.round(med * 60 / avg)} kelime/dk` : ''}</span></div>
    ${med ? `<div class="act"><button class="btn sm" data-usesps="${med.toFixed(2)}" type="button">Varsayılan hızım yap</button></div>` : ''}`;
}

/* ================= Hız ölçümü ================= */
function wireSpeedTest(){
  let t0 = 0, result = null;
  const go = $('#speedGo'), out = $('#speedOut'), use = $('#speedUse');
  $('#speedTestBtn').addEventListener('click', () => { t0 = 0; result = null; go.textContent = 'Başla'; out.textContent = ''; use.hidden = true; $('#speedText').classList.remove('live'); openModal('speedModal'); });
  const step = () => {
    if (!t0) { t0 = performance.now(); go.textContent = 'Bitti'; out.textContent = 'Okuyun…'; use.hidden = true; $('#speedText').classList.add('live'); return; }
    const secs = (performance.now() - t0) / 1000; t0 = 0; go.textContent = 'Tekrar'; $('#speedText').classList.remove('live');
    if (secs < 4) { out.textContent = 'Çok kısa sürdü, tekrar deneyin.'; return; }
    const A = analyze(SAMPLE_SPEED_TEXT, S.g);
    result = A.totalU / secs;
    out.innerHTML = `Süre ${num(secs, 1)} sn → <b>${speedText(result, A.avgSyl)}</b>`;
    use.hidden = false;
  };
  go.addEventListener('click', step);
  $('#speedModal').addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); step(); } });
  use.addEventListener('click', () => {
    if (!result) return;
    S.g.personalSps = S.g.sps = clamp(Math.round(result * 100) / 100, 1.5, 10);
    onSettingsChanged(); closeModal('speedModal'); note('Kişisel hızınız kaydedildi.');
  });
}

/* ================= Modallar ================= */
function openModal(id){ $('#' + id).hidden = false; }
function closeModal(id){ $('#' + id).hidden = true; }
document.addEventListener('click', e => {
  const c = e.target.closest('[data-close]'); if (c) { c.closest('.modal').hidden = true; return; }
  if (e.target.classList && e.target.classList.contains('modal') && e.target.id !== 'capModal') e.target.hidden = true;
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !E.P.on && !capturing()) for (const m of $$('.modal')) if (!m.hidden && m.id !== 'capModal') m.hidden = true;
});

/* ================= Başlat / bitir ================= */
async function startPrompter(resume = false){
  if (E.P.on) return;
  if (!CUR.s || !CUR.s.body.trim()) { note('Önce bir metin girin.'); ta.focus(); return; }
  for (const m of $$('.modal')) m.hidden = true;
  if (document.activeElement) document.activeElement.blur();
  persist();
  $('#setup').hidden = true;
  E.start({body: CUR.s.body, scriptId: CUR.s.id, title: CUR.s.title || 'Adsız metin', targetSec: CUR.s.target_sec, startChar: resume ? CUR.s.last_char : 0});
  primePads();
  if (LINK) LINK.track({role: 'stage'});
}
function onStageExit({take, lastChar, scriptId}){
  $('#setup').hidden = false;
  if (CUR.s && CUR.s.id === scriptId) CUR.s.last_char = lastChar;
  if (scriptId) D.touchScript(scriptId, {last_char: lastChar});
  if (take.play_sec >= 5) D.saveTake(take).catch(() => {});
  syncControls(); updateEstimate(); updateResume(); primePads();
  if (LINK) LINK.track({role: 'setup'});
  broadcastSetup();
}

/* ================= Kumanda bağlantısı ================= */
function ctlURL(){ return new URL('kontrol.html?to=' + encodeURIComponent(DEV.id), location.href).href; }
function renderQR(){
  try {
    const q = window.qrcode(0, 'M'); q.addData(ctlURL()); q.make();
    $('#qr').innerHTML = q.createSvgTag({cellSize: 4, margin: 2, scalable: true});
  } catch (e) { $('#qr').textContent = ''; }
}
function renderDevices(peers){
  const ROLE = {control: 'Kumanda / operatör', stage: 'Prompter (akışta)', setup: 'Prompter (hazırlık)'};
  $('#devList').innerHTML = peers.length ? peers.map(p => `<li><i class="dotc ${p.role}"></i><b>${esc(p.name || 'Cihaz')}</b><span class="muted">${ROLE[p.role] || p.role}</span></li>`).join('')
    : '<li class="muted">Başka bağlı cihaz yok.</li>';
}
function setLinkBadge(ok){
  const b = $('#linkBadge'), n = LINK ? LINK.peers.filter(p => p.role === 'control').length : 0;
  b.className = 'badge ' + (ok ? 'on' : 'err');
  b.querySelector('span').textContent = ok ? (n ? `${n} kumanda` : 'Bağlı') : 'Bağlantı yok';
}
let lastState = 0;
function broadcastState(force){
  if (!LINK || !LINK.ready) return;
  if (!LINK.peers.some(p => p.role === 'control')) return;
  const now = performance.now(); if (!force && now - lastState < 90) return; lastState = now;
  const st = E.P.on ? E.state() : {onStage: false, scriptId: CUR.s && CUR.s.id, title: CUR.s ? CUR.s.title || 'Adsız metin' : '', sps: S.g.sps, mode: S.g.mode, avgSyl: curA().avgSyl,
    resumeChar: CUR.s ? CUR.s.last_char : 0};
  st.name = DEV.name;
  LINK.send('state', st);
}
const broadcastSetup = () => broadcastState(true);
const broadcastSetupSoon = debounce(broadcastSetup, 400);
function sendScript(){
  if (!LINK) return;
  const body = E.P.on ? E.P.body : CUR.s ? CUR.s.body : '', title = E.P.on ? E.P.title : CUR.s ? CUR.s.title : '';
  LINK.send('script', {scriptId: E.P.on ? E.P.scriptId : CUR.s && CUR.s.id, title, body, rev: E.P.rev, onStage: E.P.on});
}
async function onRemote(cmd){
  switch (cmd.action) {
    case 'getScript': sendScript(); broadcastSetup(); return;
    case 'start':
      if (E.P.on) return;
      if (cmd.scriptId && (!CUR.s || CUR.s.id !== cmd.scriptId)) await openScript(cmd.scriptId);
      startPrompter(!!cmd.resume); return;
    case 'openScript': if (!E.P.on && cmd.scriptId) { await openScript(cmd.scriptId); sendScript(); } return;
    case 'edit':
      if (E.P.on) E.applyEdit(cmd.body, cmd.title);
      if (CUR.s && (!cmd.scriptId || cmd.scriptId === CUR.s.id)) {
        CUR.s.body = cmd.body; if (cmd.title != null) CUR.s.title = cmd.title;
        ta.value = CUR.s.body; $('#titleIn').value = CUR.s.title; markDirty(); refreshText();
      }
      sendScript(); return;
    case 'setSps': if (!E.P.on) { S.g.sps = clamp(+cmd.value, 1.5, 10); onSettingsChanged(); broadcastSetup(); return; } break;
    case 'mode': if (!E.P.on) { S.g.mode = cmd.value; onSettingsChanged(); broadcastSetup(); return; } break;
  }
  if (E.P.on) { E.remote(cmd); broadcastState(true); }
}
function startLink(){
  LINK = createLink({
    user: USER, deviceId: DEV.id, meta: {role: 'setup', name: DEV.name},
    onCmd: onRemote,
    onPresence: peers => { renderDevices(peers); setLinkBadge(LINK.ready); broadcastSetup(); },
    onStatus: ok => setLinkBadge(ok),
  });
}

/* ================= Döngü ================= */
const SETUP_TICK = [];
let lastT = performance.now(), lastBc = 0;
function frame(now){
  const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000)); lastT = now;
  pollPads(now, dt);
  voiceTick(now);
  E.tick(now, dt);
  if (E.P.on && now - lastBc > 250) { lastBc = now; broadcastState(); }
  if (!E.P.on) for (const f of SETUP_TICK) f(now);
  requestAnimationFrame(frame);
}
function updatePadBadge(){
  const pads = getPads(), el = $('#padBadge');
  el.className = 'badge ' + (pads.length ? 'on' : '');
  el.querySelector('span').textContent = pads.length ? pads[0].id.replace(/\(.*?\)/g, '').trim().slice(0, 28) : 'Kontrolcü yok';
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
  buildStaticUI();
  syncControls(); wireControls(); wireEditor(); wireLib(); wireVersions(); wireTakes(); wireSpeedTest();
  wireBinds($('#binds')); wireGlobalInput();
  E.initStage({ onExit: onStageExit, onChange: () => broadcastState(true),
    onProgress: c => { if (CUR.s && CUR.s.id === E.P.scriptId) { CUR.s.last_char = c; } } });
  wireStageMouse($('#stage'), '#ctl');
  setHandler({
    live: () => E.P.on,
    action: a => { E.action(a); broadcastState(true); },
    hold: (a, on) => E.hold(a, on),
    stick: (m, x, dt) => E.stick(m, x, dt),
    idleToggle: () => { if (!$('#setup').hidden && $$('.modal').every(m => m.hidden)) startPrompter(); },
    padChange: updatePadBadge,
  });
  window.addEventListener('keydown', e => { if (!E.P.on && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); startPrompter(); } });
  $('#startBtn').addEventListener('click', () => startPrompter(false));
  $('#resumeBtn').addEventListener('click', () => startPrompter(true));
  $('#logoutBtn').addEventListener('click', async () => {
    if (!await confirmBox('Bu cihazda Prompter oturumu kapatılsın mı?', 'Çıkış yap')) return;
    await persist(); await sb.auth.signOut(); location.reload();
  });
  $('#copyLink').addEventListener('click', () => { navigator.clipboard.writeText(ctlURL()).then(() => note('Bağlantı kopyalandı.'), () => note(ctlURL(), 6000)); });
  $('#openCtl').href = ctlURL();
  renderQR(); updatePadBadge();
  $('#setup').hidden = false;
  requestAnimationFrame(frame);

  // Bulut: ayarlar + metinler
  syncSettings().then(changed => { if (changed) { syncControls(); renderBinds($('#binds')); renderPreview(); updateEstimate(); } }).catch(() => {});
  try {
    LIB = await D.listScripts();
    const want = lsGet('prompter.current');
    const s = LIB.find(x => x.id === want) || LIB[0];
    const nd = lsGet('prompter.draft.new');
    if (nd && nd.body && (!s || nd.at > Date.parse(s.updated_at || 0))) { localStorage.removeItem('prompter.draft.new'); await newScript({title: nd.title || '', body: nd.body, folder: nd.folder || ''}); }
    else loadIntoEditor(s ? {...s} : blankScript());
  } catch (e) {
    const nd = lsGet('prompter.draft.new');
    loadIntoEditor({...blankScript(), ...(nd || {})});
    CUR.err = true; setSaveState();
    note(/schema/i.test(e.message || '') ? 'Veritabanı şeması erişilemiyor (Data API ayarı).' : 'Metinler yüklenemedi; bağlantıyı kontrol edin.', 5000);
  }
  updateFolders();
  startLink();
  D.flushTakes().catch(() => {});
  window.addEventListener('pagehide', () => { if (CUR.dirty) persist(); });
}
main();
