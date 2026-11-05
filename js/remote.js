/* Kumanda arayüzü (dokunmatik alan + yön tuşları) ve canlı metin görünümü.
   Kumanda ekranında ve Prompter'ın canlı izleme görünümünde kullanılır. */
import { $$, clamp, esc, num, fmtTime, note } from './util.js';
import { MODES } from './settings.js';
import { analyze, renderHTML } from './text.js';

const buzz = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

export function remoteHTML(){
  return `<div class="rm">
    <div class="rm-status"><b class="rm-title">—</b><span class="rm-conn"></span></div>
    <div class="rm-time"><span class="rm-el">0:00</span><span class="rm-tg"></span><span class="rm-rem">kalan —</span></div>
    <div class="rm-prog"><i></i></div>
    <div class="rm-pad" title="Dokun: başlat/durdur · Yukarı kaydır: satır ileri · Aşağı kaydır: satır geri · Basılı tut + sürükle: hızlı ileri/geri">
      <span class="rm-pad-state">—</span>
      <small>dokun: başlat / durdur<br>↑ kaydır: ileri · ↓ kaydır: geri<br>basılı tut + sürükle: hızlı</small>
    </div>
    <div class="rm-dpad">
      <button type="button" class="up" data-a="linePrev" title="Satır geri">▲</button>
      <button type="button" class="left" data-a="slower" title="Hız azalt">−</button>
      <button type="button" class="ok" data-a="toggle" title="Başlat / Durdur">▶</button>
      <button type="button" class="right" data-a="faster" title="Hız artır">+</button>
      <button type="button" class="down" data-a="lineNext" title="Satır ileri">▼</button>
    </div>
    <div class="rm-row">
      <button type="button" data-hold="boostBack">«<small>basılı geri</small></button>
      <button type="button" data-a="sectionPrev">⇞<small>önceki bölüm</small></button>
      <button type="button" data-a="sectionNext">⇟<small>sonraki bölüm</small></button>
      <button type="button" data-hold="boostFwd">»<small>basılı ileri</small></button>
    </div>
    <div class="rm-speed"><b class="rm-sps">—</b><small class="rm-wpm"></small></div>
    <input type="range" class="rm-spsr" min="2" max="9" step="0.05">
    <div class="seg rm-mode">${MODES.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="rm-lead" hidden><span>Takip öne alma</span><button type="button" data-lead="-1">−</button><b class="rm-leadv">1 kelime</b><button type="button" data-lead="1">+</button></div>
    <div class="rm-voice" hidden><span class="rm-vdot"></span><span class="rm-vtxt">Prompter mikrofonu</span><div class="meter"><div class="meter-fill"></div><div class="meter-th"></div></div></div>
    <div class="rm-sections"></div>
    <div class="rm-row two">
      <button type="button" data-a="restart">⏮<small>başa dön</small></button>
      <button type="button" data-a="exit">■<small>akışı bitir</small></button>
    </div>
  </div>`;
}

export function mountRemote(root, api){
  root.innerHTML = remoteHTML();
  const q = s => root.querySelector(s);
  let st = null, spsSent = null, spsAt = 0;
  const sendSps = v => { spsSent = clamp(Math.round(v * 100) / 100, 1.5, 10); spsAt = performance.now(); api.cmd('setSps', {value: spsSent}); };
  const curSps = () => (spsSent != null && performance.now() - spsAt < 1500) ? spsSent : (st ? st.sps : 4.5);
  root.addEventListener('click', e => {
    const b = e.target.closest('button[data-a]');
    if (b) {
      buzz();
      const a = b.dataset.a;
      const fol = st && st.mode === 'follow';
      if (fol && (a === 'faster' || a === 'slower')) { api.lead && api.lead(a === 'faster' ? 1 : -1); return; }
      if (a === 'faster') sendSps(curSps() + 0.25);
      else if (a === 'slower') sendSps(curSps() - 0.25);
      else api.cmd(a);
      return;
    }
    const m = e.target.closest('.rm-mode button'); if (m) { buzz(); api.setMode(m.dataset.v); return; }
    const ld = e.target.closest('[data-lead]'); if (ld) { buzz(); api.lead && api.lead(+ld.dataset.lead); return; }
    const s = e.target.closest('[data-sec]'); if (s) { buzz(); api.cmd('seekSection', {value: +s.dataset.sec}); }
  });
  for (const b of root.querySelectorAll('[data-hold]')) {
    const on = e => { e.preventDefault(); buzz(); api.cmd('hold', {value: b.dataset.hold, on: true}); };
    const off = () => api.cmd('hold', {value: b.dataset.hold, on: false});
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
  let spT = 0;
  q('.rm-spsr').addEventListener('input', e => { clearTimeout(spT); const v = +e.target.value; spT = setTimeout(() => sendSps(v), 60); });

  /* dokunmatik alan */
  const pad = q('.rm-pad');
  let g = null;
  pad.addEventListener('pointerdown', e => {
    e.preventDefault(); pad.setPointerCapture(e.pointerId);
    g = {y0: e.clientY, t0: performance.now(), hold: null, moved: 0};
    g.timer = setTimeout(() => { if (g && Math.abs(g.moved) < 14) { g.hold = 'wait'; buzz(25); pad.classList.add('holding'); } }, 380);
  });
  pad.addEventListener('pointermove', e => {
    if (!g) return;
    g.moved = e.clientY - g.y0;
    if (g.hold && Math.abs(g.moved) > 16) {
      const dir = g.moved < 0 ? 'boostFwd' : 'boostBack';
      if (g.hold !== dir) { if (g.hold !== 'wait') api.cmd('hold', {value: g.hold, on: false}); api.cmd('hold', {value: dir, on: true}); g.hold = dir; }
    }
  });
  const end = () => {
    if (!g) return;
    clearTimeout(g.timer); pad.classList.remove('holding');
    if (g.hold) { if (g.hold !== 'wait') api.cmd('hold', {value: g.hold, on: false}); }
    else if (Math.abs(g.moved) > 28) {
      const n = clamp(Math.round(Math.abs(g.moved) / 70), 1, 6);
      for (let i = 0; i < n; i++) api.cmd(g.moved < 0 ? 'lineNext' : 'linePrev');
      buzz();
    } else if (performance.now() - g.t0 < 380) { api.cmd('toggle'); buzz(); }
    g = null;
  };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);

  return {
    update(s, meta = {}){
      st = s;
      const live = !!(s && s.onStage);
      root.classList.toggle('idle', !live);
      q('.rm-title').textContent = s && s.title ? s.title : '—';
      q('.rm-conn').innerHTML = `${meta.ekrans != null ? `${meta.ekrans} ekran` : ''}${meta.ping != null ? ` · ${meta.ping} ms` : ''}`;
      if (!live) { q('.rm-pad-state').textContent = s && s.ended ? 'Bitti' : 'Akış başlamadı'; q('.ok').textContent = '▶'; }
      else {
        q('.rm-pad-state').textContent = s.counting ? 'Geri sayım…' : s.ended ? 'Bitti' : s.holding ? 'Durak' : s.playing ? 'Akıyor' : 'Duraklatıldı';
        q('.ok').textContent = s.playing || s.counting ? '❚❚' : '▶';
        q('.rm-el').textContent = fmtTime(s.elapsed);
        q('.rm-rem').textContent = 'kalan ' + fmtTime(s.remain);
        if (s.target) { const d = s.elapsed + s.remain - s.target; q('.rm-tg').innerHTML = `hedef ${fmtTime(s.target)} <i class="${Math.abs(d) < 3 ? 'ok' : d > 0 ? 'late' : 'early'}">${d > 0 ? '+' : ''}${fmtTime(d)}</i>`; }
        else q('.rm-tg').textContent = '';
        q('.rm-prog i').style.width = ((s.pct || 0) * 100).toFixed(1) + '%';
        const secs = s.sections || [], key = secs.join('\u0001'), box = q('.rm-sections');
        if (box.dataset.k !== key) { box.dataset.k = key; box.innerHTML = secs.map((t, i) => `<button type="button" data-sec="${i}">${esc(t)}</button>`).join(''); }
      }
      const mode = (s && s.mode) || meta.mode;
      const fol = mode === 'follow';
      q('.rm-spsr').hidden = fol;
      q('.left').title = fol ? 'Takip geri al' : 'Hız azalt'; q('.right').title = fol ? 'Takip öne al' : 'Hız artır';
      if (fol) {
        const r = s && s.onStage && s.rate > 0.1 ? s.rate : null;
        q('.rm-sps').textContent = r ? num(r) + ' hece/sn' : 'sesinden';
        q('.rm-wpm').textContent = 'hız okuma hızından ölçülür · −/+ öne alma';
      } else if (s && s.sps) {
        q('.rm-sps').textContent = num(s.sps) + ' hece/sn';
        q('.rm-wpm').textContent = Math.round(s.sps * 60 / (s.avgSyl || 2.8)) + ' kelime/dk';
        if (document.activeElement !== q('.rm-spsr')) q('.rm-spsr').value = s.sps;
      }
      for (const b of root.querySelectorAll('.rm-mode button')) b.classList.toggle('on', b.dataset.v === mode);
      const lb = q('.rm-lead'); lb.hidden = mode !== 'follow';
      if (!lb.hidden && meta.followLead != null) q('.rm-leadv').textContent = num(meta.followLead, 1) + ' kelime';
      const vb = q('.rm-voice'); vb.hidden = !mode || mode === 'fixed';
      if (!vb.hidden && meta.voice) {
        vb.classList.toggle('on', !!meta.voice.open);
        q('.rm-vtxt').textContent = meta.voice.src ? 'Prompter mikrofonu' + (meta.voice.open ? ' · ses var' : ' · sessiz') + (mode === 'follow' && meta.voice.lat != null ? ` · gecikme ≈${num(meta.voice.lat, 1)} sn` : '') : 'Prompter mikrofonu bekleniyor';
            vb.querySelector('.meter-fill').style.width = clamp((meta.voice.level + 70) / 60 * 100, 0, 100) + '%';
        vb.querySelector('.meter-fill').classList.toggle('hot', !!meta.voice.open);
        if (meta.gateDb != null) vb.querySelector('.meter-th').style.left = clamp((meta.gateDb + 70) / 60 * 100, 0, 100) + '%';
      }
    },
  };
}

/* ---------- canlı metin (dokunarak atla, düzenle) ---------- */
export function docHTML(){
  return `<div class="k-text-h"><b class="doc-title">Metin</b>
      <div class="actions">
        <label class="tog small inline"><input type="checkbox" class="doc-follow" checked><span>Okunan yeri takip et</span></label>
        <button class="btn sm doc-edit" type="button">Düzenle</button>
        <button class="btn sm primary doc-apply" type="button" hidden>Uygula</button>
        <button class="btn sm ghost doc-cancel" type="button" hidden>Vazgeç</button>
      </div></div>
    <div class="k-doc"><div class="k-empty">Metin bekleniyor…</div></div>
    <textarea class="k-edit" spellcheck="false" hidden></textarea>
    <p class="hint" style="margin:0">Bir kelimeye dokunarak akışı oraya götürün. Düzenlemeler akış sürerken konum korunarak ekrana yansır ve kaydedilir. Ekranda gizli olan notlar burada görünür.</p>`;
}
export function mountDoc(root, api){
  root.innerHTML = docHTML();
  const q = s => root.querySelector(s), doc = q('.k-doc'), ta = q('.k-edit');
  let D = {body: '', A: null}, cur = -1, editing = false, userAt = 0;
  doc.addEventListener('click', e => {
    const t = e.target.closest('.tk[data-t]'); if (!t || !D.A) return;
    const tok = D.A.tokens[+t.dataset.t]; if (tok) { api.cmd('seekChar', {value: tok.c0}); userAt = 0; buzz(); }
  });
  for (const ev of ['wheel', 'touchmove']) doc.addEventListener(ev, () => { userAt = performance.now(); }, {passive: true});
  const endEdit = () => { editing = false; ta.hidden = true; doc.hidden = false; q('.doc-edit').hidden = false; q('.doc-apply').hidden = q('.doc-cancel').hidden = true; };
  q('.doc-edit').addEventListener('click', () => {
    editing = true; ta.value = D.body; ta.hidden = false; doc.hidden = true;
    q('.doc-edit').hidden = true; q('.doc-apply').hidden = q('.doc-cancel').hidden = false; ta.focus();
  });
  q('.doc-cancel').addEventListener('click', endEdit);
  q('.doc-apply').addEventListener('click', () => { api.edit(ta.value); D.body = ta.value; endEdit(); render(); note('Gönderildi.'); });
  function render(){
    D.A = analyze(D.body, {});
    doc.innerHTML = D.body.trim() ? renderHTML(D.A, {ids: true}) : '<div class="k-empty">Metin boş.</div>';
    cur = -1;
  }
  function highlight(c){
    if (!D.A) return;
    const T = D.A.tokens; let lo = 0, hi = T.length - 1, i = -1;
    if (c >= 0) while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m].c0 <= c) { i = m; lo = m + 1; } else hi = m - 1; }
    if (i === cur) return;
    const a = Math.min(i, cur), b = Math.max(i, cur);
    if (cur >= 0) { const o = doc.querySelector(`[data-t="${cur}"]`); if (o) o.classList.remove('cur'); }
    if (Math.abs(i - cur) > 400 || cur < 0 || i < 0) { for (const e of doc.querySelectorAll('.tk[data-t]')) e.classList.toggle('read', +e.dataset.t < i); }
    else for (let k = Math.max(0, a); k <= b; k++) { const e = doc.querySelector(`[data-t="${k}"]`); if (e) e.classList.toggle('read', k < i); }
    cur = i;
    const el = i >= 0 ? doc.querySelector(`[data-t="${i}"]`) : null;
    if (el) {
      el.classList.add('cur');
      if (q('.doc-follow').checked && performance.now() - userAt > 4000 && doc.offsetParent) {
        const top = el.offsetTop - doc.clientHeight * 0.35;
        if (Math.abs(doc.scrollTop - top) > 30) doc.scrollTo({top, behavior: 'smooth'});
      }
    }
  }
  return {
    setScript({body, title}){ if (editing) return; if (body === D.body && D.A) { q('.doc-title').textContent = title || 'Metin'; return; } D.body = body || ''; q('.doc-title').textContent = title || 'Metin'; render(); },
    highlight, get editing(){ return editing; }, get body(){ return D.body; },
  };
}
