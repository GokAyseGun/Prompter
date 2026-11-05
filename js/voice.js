/* Ses kapısı (mikrofon seviyesi) ve sesle takip (Türkçe konuşma tanıma) */
import { S } from './settings.js';
import { normWord } from './text.js';

export const V = {
  on: false, mode: 'fixed', level: -100, open: false, speaking: false,
  targetC: null, lastHit: 0, lastResult: 0, recOk: false, recErr: '', micErr: '',
  lat: 0.6, rate: null,               // ölçülen tanıma gecikmesi (sn) ve konuşma hızı (hece/sn, duraklar dahil)
};
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
let stream = null, ctx = null, analyser = null, buf = null, lastLoud = 0, loudSince = 0;
let rec = null, recWanted = false, words = [], lastJ = -1, onStatus = () => {};
export const voiceSupported = () => ({ mic: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  speech: !!(window.SpeechRecognition || window.webkitSpeechRecognition) });

export function setStatusListener(fn){ onStatus = fn; }

/* ---------- mikrofon seviyesi ---------- */
export async function startMic(){
  if (stream) return true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true}});
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.2;
    buf = new Float32Array(analyser.fftSize);
    src.connect(analyser);
    V.micErr = '';
    return true;
  } catch (e) {
    V.micErr = e && e.name === 'NotAllowedError' ? 'Mikrofon izni verilmedi.' : 'Mikrofon açılamadı.';
    stopMic(); return false;
  }
}
export function stopMic(){
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (ctx) ctx.close().catch(() => {});
  stream = ctx = analyser = null; V.level = -100;
}
export function readLevel(){
  if (!analyser) return V.level;
  analyser.getFloatTimeDomainData(buf);
  let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  const db = 10 * Math.log10(s / buf.length + 1e-12);
  V.level = V.level < db ? db : V.level * 0.85 + db * 0.15;   // hızlı yükselme, yumuşak düşüş
  return V.level;
}

/* Her karede çağrılır: konuşma var mı? */
let lastTick = 0, wasOpen = false, closedAt = 0, openedAt = 0, speakSinceHit = 0, utterStart = null, speechEnd = 0;
export function tick(now){
  const dt = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 0; lastTick = now;
  if (!V.on) return;
  let loud = false;
  if (analyser) {
    readLevel();
    if (V.level > S.g.gateDb) { if (!loudSince) loudSince = now; if (now - loudSince > 70) { loud = true; lastLoud = now; } }
    else loudSince = 0;
  } else if (V.mode === 'follow') {
    if (now - V.lastResult < 900) { loud = true; lastLoud = now; }
  }
  V.open = loud || (now - lastLoud) < S.g.gateHold * 1000;
  V.speaking = V.open;
  if (V.open) speakSinceHit += dt;
  if (V.open && !wasOpen) {
    // sessizlikten sonra konuşma başladı: gecikme ölçümü için başlangıcı not et
    if (analyser && now - closedAt > 700) utterStart = {t: now - 70, j: lastJ + 1};
    openedAt = now;
  }
  if (!V.open && wasOpen) { closedAt = now; speechEnd = lastLoud; }
  wasOpen = V.open;
}

/* ---------- konuşma tanıma ---------- */
export function setScript(A){
  words = [];
  for (const t of A.tokens) if (t.kind === 'w' && t.type === 'p') {
    const n = normWord(t.chars.map(c => c.ch).join(''));
    if (n) words.push({n, c0: t.c0, end: t.c0 + t.len, u0: t.u0, u1: t.u0 + t.dur});
  }
  avgW = words.length > 1 ? (words[words.length - 1].u1 - words[0].u0) / words.length : 2.8;
  lastJ = -1; lastFrac = 1; V.targetC = null; hits = []; utterStart = null;
}
let hits = [], hitLat = 0, avgW = 2.8, jumpId = 0, lastRun = 0, lastFrac = 1, rateAtHit = null;
function sim(a, b){
  if (a === b) return 1;
  if (!a || !b) return 0;
  const p = Math.min(a.length, b.length, 5);
  if (p >= 4 && a.slice(0, p) === b.slice(0, p)) return 0.85;
  const m = a.length, n = b.length; if (Math.abs(m - n) > 4) return 0;
  let prev = Array.from({length: n + 1}, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
function nearIndex(c){
  let lo = 0, hi = words.length - 1, r = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (words[mid].c0 <= c) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r;
}
let getC = () => 0;

/* ---------- tanılama kaydı (sesle takip ayarını gerçek veriyle iyileştirmek için) ---------- */
export const LOG = {on: false, t0: 0, hits: [], samples: []};
export function logStart(){ LOG.on = true; LOG.t0 = performance.now(); LOG.hits = []; LOG.samples = []; }
export function logStop(){ LOG.on = false; return {hits: LOG.hits, samples: LOG.samples}; }
const lt = () => Math.round(performance.now() - LOG.t0);
export function logSample(shownC){
  if (!LOG.on || LOG.samples.length > 4000) return;
  const e = estimate();
  LOG.samples.push([lt(), V.open ? 1 : 0, lastJ, e ? +wordAt(e.targetC).toFixed(2) : null, shownC != null ? +wordAt(shownC).toFixed(2) : null,
    +V.lat.toFixed(2), V.rate ? +V.rate.toFixed(2) : null, Math.round(V.level)]);
}
function wordAt(c){ const j = nearIndex(c), w = words[j]; return w ? j + clampN((c - w.c0) / Math.max(1, w.end - w.c0), 0, 1) : 0; }

/* Tanınan son kelimeleri metne hizala.
   Yalnızca makul ilerideki kelimeler kabul edilir; uzak sıçrama için en az 3 kelimelik dizi eşleşmesi gerekir.
   "ve, bu, da" gibi kısa kelimeler tek başına konum belirlemez. */
function align(transcript){
  const rw = transcript.split(/\s+/).map(normWord).filter(Boolean).slice(-6);
  if (!rw.length || !words.length) return;
  const now = performance.now();
  const shown = nearIndex(getC());
  if (lastJ >= 0 && Math.abs(shown - lastJ) > 60) lastJ = -1;           // akış elle çok uzağa götürüldü: yeniden bul
  const rate = clampN(V.rate || S.g.sps, 2, 8);
  const score = j => {
    const s0 = sim(rw[rw.length - 1], words[j].n);
    if (s0 < 0.72) return null;
    let s = s0, run = 1;
    for (let k = 1; k < rw.length && j - k >= 0; k++) { const x = sim(rw[rw.length - 1 - k], words[j - k].n); if (x >= 0.72) { s += x; run++; } else break; }
    if (words[j].n.length <= 2 && run < 2) return null;                 // kısa kelime tek başına yetmez
    return {s, run};
  };
  let best = -1, bestS = 0, bestRun = 0, jump = false;
  if (lastJ < 0) {
    for (let j = Math.max(0, shown - 8); j <= Math.min(words.length - 1, shown + 30); j++) {
      const r = score(j); if (!r || r.s < (rw.length >= 2 ? 1.6 : 0.9)) continue;
      const v = r.s - Math.abs(j - shown) * 0.02; if (v > bestS) { bestS = v; best = j; bestRun = r.run; }
    }
  } else {
    // o andan bu yana makul okunabilecek kelime sayısı
    const since = (now - V.lastHit) / 1000;
    const ahead = Math.ceil((Math.min(since, 6) + 1.2) * rate / avgW) + 2;
    const backOk = lastRun >= 2 ? 2 : 8;                                  // önceki eşleşme zayıfsa geri düzeltmeye izin ver
    for (let j = Math.max(0, lastJ - backOk); j <= Math.min(words.length - 1, lastJ + ahead); j++) {
      const r = score(j); if (!r) continue;
      if (r.run < 2 && (j < lastJ || j > lastJ + 2)) continue;             // tek kelime: yalnızca sıradaki 1–2 kelime
      if (j < lastJ && lastRun >= 2 && r.s < 2.6) continue;               // güçlü konumdan geri gitmek için güçlü eşleşme
      const v = r.s - Math.abs(j - (lastJ + 1)) * 0.03;
      if (v > bestS) { bestS = v; best = j; bestRun = r.run; }
    }
    if (best < 0 || bestS < 0.8) {
      // yakında bulunamadı: okuyucu atladıysa yalnızca 3+ kelimelik dizi eşleşmesi; eşitlikte en yakın aday
      for (let j = Math.max(0, lastJ - 40); j <= Math.min(words.length - 1, lastJ + 60); j++) {
        if (j >= lastJ - backOk && j <= lastJ + ahead) continue;
        const r = score(j); if (!r || r.run < 3 || r.s < 2.7) continue;
        const v = r.s - Math.abs(j - lastJ) * 0.01;
        if (v > bestS) { bestS = v; best = j; bestRun = r.run; jump = true; }
      }
    }
  }
  if (best < 0) return;
  // tanınan son kelime yarımsa ("göğs" → "göğsünün") konum kelimenin içindedir
  const lastRw = rw[rw.length - 1], full = words[best].n;
  const frac = lastRw.length < full.length && full.startsWith(lastRw.slice(0, Math.min(lastRw.length, 4))) ? clampN(lastRw.length / full.length, 0.2, 1) : 1;
  if (best === lastJ && frac <= lastFrac) return;
  const posU = j => words[j].u0 + (words[j].u1 - words[j].u0) * (j === best ? frac : 1);
  if (LOG.on && LOG.hits.length < 3000) LOG.hits.push([lt(), best, rw.slice(-3).join(' '), +bestS.toFixed(2), jump ? 1 : 0, +frac.toFixed(2)]);
  if (jump) { jumpId++; hits = []; }
  // konuşma hızı: son ~3,5 sn'deki tanımalardan; yavaşlamaya daha hızlı uyar
  hits.push({u: posU(best), t: now}); hits = hits.filter(h => now - h.t < 2200).slice(-12);
  const h0 = hits[0];
  if (hits.length >= 3 && now - h0.t > 800) {
    const r = (posU(best) - h0.u) / ((now - h0.t) / 1000);
    if (r > 1.2 && r < 10) { const w = V.rate && r < V.rate ? 0.6 : 0.4; V.rate = clampN(V.rate ? V.rate * (1 - w) + r * w : r, 2, 9); }
  }
  // tanıma gecikmesi (1): konuşmaya başlama anı → ilk kelimelerin tanınması
  if (utterStart && best >= utterStart.j && best - utterStart.j <= 4 && utterStart.j < words.length) {
    const lat = (now - utterStart.t) / 1000 - (posU(best) - words[utterStart.j].u0) / rate;
    if (lat > 0.15 && lat < 2) V.lat = clampN(V.lat * 0.7 + lat * 0.3, 0.2, 1.4);
    utterStart = null;
  } else if (utterStart && now - utterStart.t > 4000) utterStart = null;
  // tanıma gecikmesi (2): konuşma bittikten sonra gelen son tam kelime
  if (!V.open && speechEnd && frac === 1 && now - speechEnd < 2500 && now > speechEnd) {
    const lat = (now - speechEnd) / 1000;
    if (lat > 0.15 && lat < 2) V.lat = clampN(V.lat * 0.7 + lat * 0.3, 0.2, 1.4);
    speechEnd = 0;
  }
  hitLat = V.open ? V.lat : Math.max(0, V.lat - (now - closedAt) / 1000 - S.g.gateHold);
  speakSinceHit = 0;
  rateAtHit = V.rate;
  lastJ = best; lastRun = bestRun; lastFrac = frac; V.targetC = words[best].c0 + (words[best].end - words[best].c0) * frac; V.lastHit = now;
}
/* Okuduğun yerin tahmini: tanınan kelime + (gecikme + o andan beri konuşulan süre) × hızın, üstüne "öne alma" kadar kelime.
   Tanıma uzun süre yeni kelime vermezse tahmin en fazla ~1,5 sn ileri gider (kaçmayı önler). Dönüş: harf konumu. */
export function estimate(){
  if (lastJ < 0 || !words.length) return null;
  const now = performance.now();
  const rate = clampN(V.rate || S.g.sps, 2, 9);
  const auto = S.g.followAuto !== false;
  const gap = avgW / rate;                                   // bir kelimenin ortalama süresi (sn)
  const gapHit = avgW / clampN(rateAtHit || rate, 2, 9);    // son tanımadaki hıza göre (metin dışı algısı için sabit)
  const sinceHit = (now - V.lastHit) / 1000;
  const quiet = Math.max(1.1, gapHit * 2.5);                    // bu kadar süre metindeki bir kelime tanınmazsa: metin dışı konuşma
  const keep = clampN(1 - (sinceHit - quiet) / 0.5, 0, 1);
  // yavaşladıysan (beklenenden uzun süredir yeni kelime yok) hızı o an düşür
  if (sinceHit > gapHit * 2.0 && V.rate) V.rate = clampN(Math.min(V.rate, avgW / sinceHit * 1.3), 2, 9);
  const adv = auto ? (hitLat + Math.min(speakSinceHit, gap * 1.1)) * rate * keep : 0;
  const w0 = words[lastJ];
  let u = w0.u0 + (w0.u1 - w0.u0) * lastFrac + adv, j = lastJ;
  while (j < words.length && words[j].u1 <= u) j++;
  let W;
  if (j >= words.length) W = words.length;
  else { const w = words[j]; W = j + clampN((u - w.u0) / Math.max(0.01, w.u1 - w.u0), 0, 1); }
  W = Math.max(0, W + (S.g.followLead || 0));
  const k = Math.min(words.length - 1, Math.floor(W)), f = W >= words.length ? 1 : W - Math.floor(W);
  const w = words[k];
  return {targetC: w.c0 + (w.end - w.c0) * f, rate, lat: V.lat, auto, jump: jumpId, offScript: keep < 1};
}
function makeRec(){
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) return null;
  const r = new R();
  r.lang = 'tr-TR'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  r.onresult = e => {
    V.lastResult = performance.now(); V.recOk = true;
    const res = e.results[e.results.length - 1];
    if (res && res[0]) align(res[0].transcript);
  };
  r.onerror = e => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (e.error === 'audio-capture' && stream) { stopMic(); V.recErr = ''; return; }   // mikrofon çakışması: seviyeyi tanımadan al
    V.recErr = e.error === 'not-allowed' ? 'Mikrofon / konuşma tanıma izni verilmedi.'
      : e.error === 'network' ? 'Konuşma tanıma için internet bağlantısı gerekiyor.' : 'Konuşma tanıma hatası: ' + e.error;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') recWanted = false;
    onStatus();
  };
  r.onend = () => { if (recWanted) setTimeout(() => { if (recWanted) try { r.start(); } catch (x) {} }, 250); };
  return r;
}

/* Modu başlat/durdur. cGetter: okuma ucunun şu anki harf konumu */
export async function setMode(mode, cGetter){
  if (cGetter) getC = cGetter;
  V.mode = mode; V.recErr = '';
  if (mode === 'fixed') { stopAll(); return; }
  V.on = true;
  const okMic = await startMic();
  if (mode === 'follow') {
    if (!rec) rec = makeRec();
    if (!rec) { V.recErr = 'Bu tarayıcı Türkçe konuşma tanımayı desteklemiyor (Chrome veya Safari gerekli).'; }
    else { recWanted = true; try { rec.start(); } catch (e) {} }
  } else stopRec();
  if (!okMic && mode === 'gate') V.recErr = V.micErr;
  onStatus();
}
function stopRec(){ recWanted = false; if (rec) try { rec.abort(); } catch (e) {} }
export function stopAll(){ V.on = false; V.open = false; V.mode = 'fixed'; stopRec(); stopMic(); V.targetC = null; }
export function resetFollow(){ lastJ = -1; lastFrac = 1; V.targetC = null; hits = []; utterStart = null; V.rate = null; }
export const micActive = () => !!analyser;
