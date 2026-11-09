/* Ortak ayar formları: Prompter, Ekran ve Kumanda panellerinde aynı formlar kullanılır.
   data-g = genel ayar, data-p = ekran tipine (profil) özgü ayar, data-show = ekranda görünenler */
import { $$, clamp, num, debounce } from './util.js';
import { S, prof, FONTS, WEIGHTS, PROFILE_META, SHOW_ITEMS, DEF_SPS, setG, setP, setShow, resetProfile, onSettings } from './settings.js';
import { speedText, analyze, P_COMMA, P_STOP, P_PARA, TONES } from './text.js';
import { V, startMic, stopMic, readLevel, voiceSupported } from './voice.js';
import { note } from './util.js';

export const ICON = {
  phone:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2" stroke-linecap="round"/></svg>',
  tablet:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2.2"/><path d="M11 18h2" stroke-linecap="round"/></svg>',
  desktop:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="10.5" rx="1.6"/><path d="M2 18.5h20" stroke-linecap="round"/></svg>',
  monitor:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="4" width="19" height="12.5" rx="1.6"/><path d="M9 20.5h6M12 16.5v4" stroke-linecap="round"/></svg>',
};
const R = (key, attr, label, min, max, step) => `<div class="field"><div class="fh"><label>${label}</label><output data-o="${key}"></output></div>
  <input type="range" ${attr}="${key}" min="${min}" max="${max}" step="${step}"></div>`;
const T = (key, attr, label, sub = '') => `<label class="tog"><input type="checkbox" ${attr}="${key}"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span></label>`;
const SEG = (key, attr, opts, extra = '') => `<div class="seg" ${attr}="${key}" ${extra}>${opts.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>`;

export function ekranHTML(){
  return `
  <div class="tgt-row" data-tgt hidden><label>Ayarlanan ekran</label><select class="txt tgt-sel"></select></div>
  <div class="field first"><div class="fh"><span>Ekran tipi</span></div>
    <div class="seg profiles" data-ptype>${PROFILE_META.map(([id, n]) => `<button type="button" data-v="${id}">${ICON[id]}<span>${n}</span></button>`).join('')}</div></div>
  <p class="hint">Boyut, aralık, kenar, görünüm, ayna, okuma çizgisi, görünür alan ve ekranda görünenler her ekran tipi için ayrı saklanır ve bağlı cihazlara anında aktarılır.</p>
  <div class="field"><div class="fh"><span>Görünüm</span></div>${SEG('orientation', 'data-p', [['auto','Otomatik'],['landscape','Yatay'],['portrait','Dikey']])}</div>
  <div class="field rot-field"><div class="fh"><span>Ekran tutulduğu gibi kalırsa döndürme yönü</span></div>${SEG('rotateDir', 'data-p', [['90','↻ Saat yönünde'],['-90','↺ Saat yönü tersine']], 'data-num')}</div>
  <div class="field"><div class="fh"><span>Ayna</span></div>${SEG('mirror', 'data-p', [['none','Düz'],['h','Ters (aynalı)']])}</div>
  ${T('flipV', 'data-p', 'Baş aşağı çevir', 'Ekran üstte, ters monte edildiyse')}
  <div class="subhead">Görünür alan (prompter camı)</div>
  ${R('cropTop', 'data-p', 'Üstten kırp', 0, 45, 0.5)}
  ${R('cropBottom', 'data-p', 'Alttan kırp', 0, 45, 0.5)}
  ${R('cropSide', 'data-p', 'Yanlardan kırp', 0, 35, 0.5)}
  <p class="hint">Yazı yalnızca camda görünen alanda akar. Ekran hazırda beklerken bu alanın çerçevesini gösterir; camdan bakarak ayarlayın.</p>
  <div class="subhead">Cam düzeltmesi</div>
  ${R('geoY', 'data-p', 'Uzunluk (harfleri yukarı-aşağı uzat)', 100, 160, 1)}
  ${R('geoX', 'data-p', 'Genişlik (harfleri sağa-sola aç)', 70, 130, 1)}
  ${R('geoK', 'data-p', 'Eğim (üst ve alt genişlik farkı)', -25, 25, 0.5)}
  ${R('bright', 'data-p', 'Parlaklık', 30, 100, 1)}
  ${T('calPattern', 'data-p', 'Kalibrasyon desenini göster', 'Bu ekran tipindeki bekleyen ekranlarda daire, kare ve ızgara görünür; buradan ayarlarken camdan bakın')}
  <div class="fh" style="gap:16px;justify-content:flex-start"><button class="linkbtn cal-here" type="button">Bu cihazda kalibrasyonu aç</button><button class="linkbtn geo-reset" type="button">Cam düzeltmesini sıfırla</button></div>
  <details class="calhelp"><summary>Kalibrasyon nasıl yapılır?</summary><ol>
    <li>Önce donanım: cam 45°, ekran düz, gözünüz objektif hizasında ve ortada.</li>
    <li><b>Eğim:</b> karenin sağ ve sol kenarları birbirine paralel olana kadar.</li>
    <li><b>Uzunluk:</b> daire, karenin dört kenarına aynı anda değene kadar.</li>
    <li><b>Genişlik:</b> yalnızca yazıyı daha geniş ya da dar istiyorsanız.</li>
    <li><b>Okuma çizgisi</b> (Ekranda Görünenler): artı işareti objektifin tam önüne gelene kadar.</li>
    <li>Ekrana bağlı klavyeyle: ↑↓ uzunluk, ←→ eğim, + / − genişlik, Esc kapat.</li></ol></details>
  <details class="calhelp"><summary>Kurulum kontrol listesi</summary><ul>
    <li>Kaplamalı prompter camı ya da nötr gümüş (%50 geçirgen) ayna film; düz camda çift görüntü olur.</li>
    <li>Yansıma sönükse cihazı 90° çevirip <b>Görünüm</b> ayarını değiştirin; ekran ışığı polarize olduğundan bir yön çok daha parlak görünür. Desendeki beyaz şeritle karşılaştırın.</li>
    <li>Cihazda otomatik parlaklık, gece ışığı ve True Tone kapalı.</li>
    <li>Işıklar cama değil size dönük; pencere ve tavan ışığı camda yansımasın.</li>
    <li>Parlaklığı okunabildiği en düşük düzeye indirin; parlama ve objektife düşen yansıma azalır. Gerekirse yazıyı büyütün.</li>
    <li>Okuma mesafesi: ekranın her inçi için en fazla ~30 cm (6,5" telefon ≈ 2 m, 11" tablet ≈ 3,3 m).</li></ul></details>
  <p class="hint">Okuma çizgisi yüksekliği ve ekranda görünenler <b>Ekranda Görünenler</b> bölümündedir.</p>
  <button class="linkbtn reset-prof" type="button">Bu ekran tipini varsayılana döndür</button>`;
}
const TONE_PRESETS = {
  toneSlow: [['#ff5a5f','Kırmızı'],['#ff8a65','Turuncu']],
  toneFast: [['#4cd964','Yeşil'],['#9be7a8','Açık yeşil']],
  toneCalm: [['#b9a3f5','Lavanta'],['#e2aa2c','Amber']],
  toneExcited: [['#4aa3ff','Mavi'],['#7fd6ff','Açık mavi']],
};
export function gorunenHTML(withTarget = true){
  return `
  ${withTarget ? '<div class="tgt-row" data-tgt hidden><label>Ayarlanan ekran</label><select class="txt tgt-sel"></select></div>' : ''}
  ${R('anchor', 'data-p', 'Okuma çizgisi yüksekliği (yukarıdan)', 15, 85, 1)}
  <p class="hint" style="margin-top:4px">Akış başladığında ilk satır bu hizada durur.</p>
  <div class="subhead">Ekranda görünenler</div>
  <p class="hint" style="margin-top:0">Yeşil tikli olanlar akışta ekranda görünür. Tiki kaldırılanlar yalnızca Prompter ve Kumanda'da görünür. Çizgi yüksekliği ve bu liste her ekran tipi için ayrı saklanır.</p>
  <div class="ticks">${SHOW_ITEMS.map(([k, l, s]) => `<button type="button" class="tick" data-show="${k}"><i></i><span>${l}${s ? `<small>${s}</small>` : ''}</span></button>`).join('')}</div>
  <div class="subhead">Okuma çizgisi</div>
  ${R('lineOpacity', 'data-g', 'Çizgi ve ok opaklığı', 0.1, 1, 0.05)}
  ${R('lineThick', 'data-g', 'Çizgi kalınlığı', 0.02, 0.16, 0.01)}
  ${R('lead', 'data-g', 'Alt satıra erken geçiş', 0, 3, 0.25)}
  <p class="hint" style="margin-top:4px">Çizgi okunan satırın altında onunla birlikte çıkar; son heceye bu kadar kala alt satıra geçer.</p>
  ${R('focusStrength', 'data-g', 'Odak karartma gücü', 0.1, 0.95, 0.05)}
  <div class="subhead">Başlangıç</div>
  ${T('countdown', 'data-g', '5-4-3-2-1 geri sayım')}
  ${T('fullscreen', 'data-g', 'Tam ekran aç', 'Ekran kilidi de otomatik engellenir')}`;
}
export function renklerHTML(){
  return `
  <div class="subhead" style="margin-top:0">Metin ve işaretler</div>
  <div class="field"><div class="fh"><span>Yazı rengi</span></div>
    <div class="seg colors" data-g="textColor">
      <button type="button" data-v="#ffffff"><i style="background:#fff"></i>Beyaz</button>
      <button type="button" data-v="#ffe08a"><i style="background:#ffe08a"></i>Sarı</button>
      <button type="button" data-v="#bfe9fb"><i style="background:#bfe9fb"></i>Buz mavisi</button>
      <label class="colorpick" title="Özel renk"><input type="color" data-gc="textColor"></label></div></div>
  <div class="field"><div class="fh"><span>Vurgu rengi (**vurgu**)</span></div>
    <div class="seg colors" data-g="emphColor">
      <button type="button" data-v="#f2c14e"><i style="background:#f2c14e"></i>Hardal</button>
      <button type="button" data-v="#ff8a65"><i style="background:#ff8a65"></i>Turuncu</button>
      <button type="button" data-v="#7fd6ff"><i style="background:#7fd6ff"></i>Mavi</button>
      <label class="colorpick" title="Özel renk"><input type="color" data-gc="emphColor"></label></div></div>
  <div class="field"><div class="fh"><span>Durak ‖, nefes / ve bölüm başlığı rengi</span></div>
    <div class="seg colors" data-g="markColor">
      <button type="button" data-v="#e2aa2c"><i style="background:#e2aa2c"></i>Hardal</button>
      <button type="button" data-v="#8d99a7"><i style="background:#8d99a7"></i>Gri</button>
      <button type="button" data-v="#ff8a65"><i style="background:#ff8a65"></i>Turuncu</button>
      <label class="colorpick" title="Özel renk"><input type="color" data-gc="markColor"></label></div></div>
  <div class="field"><div class="fh"><span>Not rengi (// not)</span></div>
    <div class="seg colors" data-g="noteColor">
      <button type="button" data-v="#a6dcf2"><i style="background:#a6dcf2"></i>Buz mavisi</button>
      <button type="button" data-v="#8d99a7"><i style="background:#8d99a7"></i>Gri</button>
      <button type="button" data-v="#9be7a8"><i style="background:#9be7a8"></i>Yeşil</button>
      <label class="colorpick" title="Özel renk"><input type="color" data-gc="noteColor"></label></div></div>
  <div class="subhead">Okunuş çizgileri</div>
  <p class="hint" style="margin-top:0">Metinde Okunuş düğmesiyle işaretlenen kısımların altında akışta görünür. Hızı ve durakları etkilemez.</p>
  ${TONES.map(t => `<div class="field"><div class="fh"><span>${t[2]}</span></div>
    <div class="seg colors" data-g="${t[3]}">${TONE_PRESETS[t[3]].map(([c, n]) => `<button type="button" data-v="${c}"><i style="background:${c}"></i>${n}</button>`).join('')}
      <label class="colorpick" title="Özel renk"><input type="color" data-gc="${t[3]}"></label></div></div>`).join('')}`;
}
export function yaziHTML(){
  return `
  <div class="fh"><span>Yazı tipi</span></div>
  <div class="seg fontgrid" data-g="font">${FONTS.map(f => `<button type="button" data-v="${f.id}" style="font-family:${f.fam.replace(/"/g, "'")}"><b>${f.name}</b><small>Ağ Şiş İı Çö Ğü</small></button>`).join('')}</div>
  <div class="field"><div class="fh"><span>Yazı şekli</span></div><div class="seg weights" data-g="weight" data-num>${WEIGHTS.map(([w, n]) => `<button type="button" data-v="${w}">${n}</button>`).join('')}</div></div>
  ${T('italic', 'data-g', 'İtalik')}
  <div class="field"><div class="fh"><span>Hizalama</span></div>${SEG('align', 'data-g', [['left','Sola'],['center','Ortaya']])}</div>
  <p class="hint">Aşağıdakiler ekran tipine özgüdür:</p>
  ${R('size', 'data-p', 'Metin boyutu', 14, 200, 1)}
  ${R('lineHeight', 'data-p', 'Satır aralığı', 0.9, 2.6, 0.05)}
  ${R('letter', 'data-p', 'Harf aralığı', -0.06, 0.4, 0.01)}
  ${R('margin', 'data-p', 'Kenar boşluğu (her iki yan)', 0, 30, 0.5)}`;
}
export function akisHTML(){
  return `
  <div class="fh"><span>Akış modu</span></div>
  ${SEG('mode', 'data-g', [['fixed','Sabit hız'],['gate','Ses kapısı'],['follow','Sesle takip']])}
  <p class="hint mode-hint"></p>
  <div class="follow-box">
    <div class="fh" style="margin-bottom:0"><span><b style="color:var(--ice)">Sesle takip</b></span></div>
    ${R('followLead', 'data-g', 'Öne alma (manuel)', -2, 5, 0.5)}
    <p class="hint" style="margin-top:4px">Sistem okuduğun kelimeyi algılayıp dur-kalk ve hızlanma/yavaşlamayı ona göre yapar; ekranda okuma noktası (solma ve alt çizgi) bu kadar kelime önde gösterilir. Akış sırasında kumandadan, ← / → veya E / Q tuşlarıyla değiştirilebilir.</p>
    ${T('followAuto', 'data-g', 'Otomatik gecikme telafisi', 'Konuşma tanımanın gecikmesini ölçer ve okuduğun yeri o kadar ileri tahmin eder; akış senin gerçek okuma hızına uyar')}
    <p class="hint follow-info"></p>
  </div>
  <div class="voice-box">
    <div class="fh"><span>Bu cihazın mikrofonu</span><button class="linkbtn mic-test" type="button">Mikrofonu test et</button></div>
    <div class="meter"><div class="meter-fill"></div><div class="meter-th"></div></div>
    ${R('gateDb', 'data-g', 'Konuşma eşiği', -70, -15, 1)}
    ${R('gateHold', 'data-g', 'Susunca durma süresi', 0.3, 3, 0.1)}
    <p class="hint">Ses kapısı ve sesle takip kararlarını her zaman <b>Prompter cihazının</b> mikrofonu verir. Ekran ve Kumanda kendi seviyelerini yalnızca bilgi için gösterir.</p>
  </div>
  <div class="field speed-follow"><div class="fh"><label>Akış hızı</label><output class="live-rate">sesinden ölçülür</output></div>
    <p class="hint" style="margin-top:0">Sesle takipte hız ayarı ve noktalama durakları kullanılmaz: akış hızını okuma hızın, durakları senin doğal duraklamaların belirler. Diğer modlara dönünce ayarların aynen geri gelir.</p></div>
  <div class="field speed-field"><div class="fh"><label>Akış hızı</label><output data-o="sps"></output></div>
    <input type="range" data-g="sps" min="2" max="9" step="0.05">
    <p class="hint">Hız hece bazlıdır: “ve” 1 hece, “müteahhitlerden” 6 hece sürer. Önerilen 4–5 hece/sn.
      <button class="linkbtn reset-speed" type="button">Önerilen hıza dön</button> · <button class="linkbtn speed-test" type="button">Hızımı ölç</button><span class="personal"></span></p></div>
  ${R('fadeWidth', 'data-g', 'Solma geçiş genişliği', 1, 30, 1)}
  ${R('readTone', 'data-g', 'Okunan yazının gri tonu', 0.1, 0.95, 0.01)}
  ${R('readOpacity', 'data-g', 'Okunan yazının solması (opaklık)', 0.15, 1, 0.01)}
  <div class="pause-sec"><div class="subhead">Noktalama duraklamaları</div>
  ${T('pauseOn', 'data-g', 'Noktalamada dur', 'Virgülde kısa, noktada daha uzun, paragraf sonunda en uzun; [DUR] durakları da uygulanır')}
  <div class="pause-field">${R('pauseScale', 'data-g', 'Durak uzunluğu', 0.25, 3, 0.05)}<p class="hint pause-hint"></p></div></div>
`;
}
export function sticksHTML(){
  return `<div class="stick-row">
    <div class="field first"><div class="fh"><span>Sol analog çubuk (yukarı/aşağı)</span></div>${SEG('stickL', 'data-g', [['speed','Hız'],['scrub','Sarma'],['off','Kapalı']])}</div>
    <div class="field first"><div class="fh"><span>Sağ analog çubuk (yukarı/aşağı)</span></div>${SEG('stickR', 'data-g', [['speed','Hız'],['scrub','Sarma'],['off','Kapalı']])}</div></div>
  ${R('boostMul', 'data-g', 'Basılı tutunca hızlı ileri/geri katsayısı', 1.5, 8, 0.5)}`;
}

const MODE_HINT = {
  fixed: 'Metin seçtiğiniz hızda akar.',
  gate: 'Prompter cihazının mikrofonu konuşmanızı duyduğu sürece akar, susunca durur.',
  follow: 'Prompter cihazı söylediğiniz kelimeleri tanır; akış sesinize göre hızlanır/yavaşlar. Prompter cihazında Chrome (veya Safari) ve internet gerekir.',
};
let avgSylFn = () => 2.8;
export const setAvgSylSource = fn => { avgSylFn = fn; };
const FMT = {
  anchor: v => '%' + Math.round(v), geoY: v => '%' + Math.round(v), geoX: v => '%' + Math.round(v), bright: v => '%' + Math.round(v),
  geoK: v => v === 0 ? 'düz' : (v > 0 ? 'üst geniş ' : 'alt geniş ') + '%' + num(Math.abs(v), 1), cropTop: v => '%' + num(v, 1), cropBottom: v => '%' + num(v, 1), cropSide: v => '%' + num(v, 1),
  size: v => Math.round(v) + ' pt', lineHeight: v => num(v, 2), letter: v => (v > 0 ? '+' : '') + num(v, 2) + ' em',
  margin: v => '%' + num(v, v % 1 ? 1 : 0),
  sps: v => speedText(v, avgSylFn()), fadeWidth: v => Math.round(v) + ' harf',
  readTone: v => '%' + Math.round(v * 100), readOpacity: v => '%' + Math.round(v * 100),
  pauseScale: v => '×' + num(v, 2), lead: v => num(v, 2) + ' hece', focusStrength: v => '%' + Math.round(v * 100),
  boostMul: v => '×' + num(v, 1), lineOpacity: v => '%' + Math.round(v * 100), lineThick: v => '%' + Math.round(v * 100) + ' (yazı boyutuna göre)', followLead: v => (v > 0 ? '+' : '') + num(v, 1) + ' kelime', gateDb: v => Math.round(v) + ' dB', gateHold: v => num(v, 1) + ' sn',
};

/* ctx: { type(): profil tipi, setType?(t): ekran tipini değiştir, onSpeedTest?() } */
const FORMS = new Set();
let micOwner = null;
export function bindForm(root, ctx){
  const f = {root, ctx};
  const type = () => ctx.type();
  const sync = () => {
    if (!root.isConnected) return;
    const pr = prof(type());
    for (const el of root.querySelectorAll('input[data-g], input[data-p]')) {
      if (el === document.activeElement && el.type === 'range') continue;
      const v = el.dataset.g ? S.g[el.dataset.g] : pr[el.dataset.p];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    }
    for (const el of root.querySelectorAll('input[data-gc]')) el.value = S.g[el.dataset.gc];
    for (const seg of root.querySelectorAll('.seg[data-g], .seg[data-p]')) {
      const v = seg.dataset.g ? S.g[seg.dataset.g] : pr[seg.dataset.p];
      for (const b of seg.querySelectorAll('button[data-v]')) b.classList.toggle('on', String(v).toLowerCase() === b.dataset.v.toLowerCase());
      const cp = seg.querySelector('.colorpick'); if (cp) cp.classList.toggle('on', !seg.querySelector('button.on'));
    }
    for (const b of root.querySelectorAll('[data-ptype] button')) b.classList.toggle('on', b.dataset.v === type());
    for (const b of root.querySelectorAll('button[data-show]')) b.classList.toggle('on', !!pr.show[b.dataset.show]);
    for (const o of root.querySelectorAll('output[data-o]')) {
      const k = o.dataset.o, v = (k in S.g) ? S.g[k] : pr[k];
      o.textContent = FMT[k] ? FMT[k](+v) : v;
    }
    const q = s => root.querySelector(s);
    if (q('.rot-field')) q('.rot-field').hidden = pr.orientation === 'auto';
    if (q('.pause-field')) q('.pause-field').classList.toggle('off', !S.g.pauseOn);
    if (q('.voice-box')) q('.voice-box').hidden = S.g.mode === 'fixed';
    const fol = S.g.mode === 'follow';
    if (q('.follow-box')) q('.follow-box').hidden = !fol;
    if (q('.speed-field')) q('.speed-field').hidden = fol;
    if (q('.speed-follow')) q('.speed-follow').hidden = !fol;
    if (q('.pause-sec')) q('.pause-sec').hidden = fol;
    for (const c of root.querySelectorAll('[data-showtog]')) c.checked = !!pr.show[c.dataset.showtog];
    if (q('.mode-hint')) q('.mode-hint').textContent = MODE_HINT[S.g.mode];
    if (q('.pause-hint')) { const k = S.g.pauseScale / S.g.sps; q('.pause-hint').textContent = `Bu hızda: virgül ≈ ${num(P_COMMA * k)} sn · nokta ≈ ${num(P_STOP * k)} sn · paragraf sonu ≈ ${num(P_PARA * k)} sn`; }
    if (q('.personal')) q('.personal').textContent = S.g.personalSps ? ` · Ölçülen hızınız: ${num(S.g.personalSps)} hece/sn` : '';
    if (q('.meter-th')) q('.meter-th').style.left = clamp((S.g.gateDb + 70) / 60 * 100, 0, 100) + '%';
    for (const b of root.querySelectorAll('.fontgrid button')) { b.style.fontStyle = S.g.italic ? 'italic' : 'normal'; b.querySelector('b').style.fontWeight = S.g.weight; }
    ctx.after && ctx.after();
  };
  f.sync = sync;
  const slider = new Map();
  for (const el of root.querySelectorAll('input[data-g], input[data-p]')) {
    el.addEventListener('input', () => {
      const v = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
      if (el.type === 'range') {          // kaydırıcılar: yerelde anında, ağa kısa aralıkla
        const o = root.querySelector(`output[data-o="${el.dataset.g || el.dataset.p}"]`);
        if (o) o.textContent = (FMT[el.dataset.g || el.dataset.p] || String)(v);
      }
      if (el.dataset.g) setG(el.dataset.g, v); else setP(type(), el.dataset.p, v);
    });
  }
  for (const el of root.querySelectorAll('input[data-gc]')) el.addEventListener('input', () => setG(el.dataset.gc, el.value));
  for (const el of root.querySelectorAll('input[data-showtog]')) el.addEventListener('change', () => setShow(type(), el.dataset.showtog, el.checked));
  for (const seg of root.querySelectorAll('.seg[data-g], .seg[data-p]')) {
    seg.addEventListener('click', e => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      let v = b.dataset.v; if (seg.hasAttribute('data-num')) v = parseFloat(v);
      if (seg.dataset.g === 'mode' && v === 'follow' && !voiceSupported().speech) note('Bu tarayıcıda Türkçe konuşma tanıma yok. Prompter cihazında Chrome kullanın.', 4000);
      if (seg.dataset.g) setG(seg.dataset.g, v); else setP(type(), seg.dataset.p, v);
    });
  }
  root.addEventListener('click', e => {
    const pt = e.target.closest('[data-ptype] button'); if (pt && ctx.setType) { ctx.setType(pt.dataset.v); sync(); return; }
    const sh = e.target.closest('button[data-show]'); if (sh) { setShow(type(), sh.dataset.show, !prof(type()).show[sh.dataset.show]); return; }
    if (e.target.closest('.cal-here')) { window.dispatchEvent(new CustomEvent('prompter:calhere')); return; }
    if (e.target.closest('.geo-reset')) { const t = type(); setP(t, 'geoY', 100); setP(t, 'geoX', 100); setP(t, 'geoK', 0); return; }
    if (e.target.closest('.reset-prof')) { resetProfile(type()); note('Ekran tipi varsayılana döndü.'); return; }
    if (e.target.closest('.reset-speed')) { setG('sps', S.g.personalSps || DEF_SPS); return; }
    if (e.target.closest('.speed-test')) { ctx.onSpeedTest && ctx.onSpeedTest(); return; }
    const mt = e.target.closest('.mic-test');
    if (mt) {
      if (micOwner === f) { if (!ctx.keepMic || !ctx.keepMic()) stopMic(); micOwner = null; mt.textContent = 'Mikrofonu test et'; return; }
      startMic().then(ok => { if (ok) { micOwner = f; mt.textContent = 'Testi durdur'; } else note(V.micErr || 'Mikrofon açılamadı.'); });
    }
  });
  FORMS.add(f);
  sync();
  return f;
}
onSettings(() => { for (const f of FORMS) { if (!f.root.isConnected) { FORMS.delete(f); continue; } f.sync(); } });
export const syncForms = () => { for (const f of FORMS) f.sync(); };

/* Mikrofon göstergeleri (her karede) */
export function tickMeters(levelFn){
  for (const f of FORMS) {
    const m = f.root.querySelector('.meter-fill'); if (!m || !m.offsetParent) continue;
    const lv = levelFn ? levelFn() : (micOwner ? readLevel() : -100);
    m.style.width = clamp((lv + 70) / 60 * 100, 0, 100) + '%';
    m.classList.toggle('hot', lv > S.g.gateDb);
  }
}
