/* Ses kapısı (mikrofon seviyesi) ve sesle takip (Türkçe konuşma tanıma) */
import { S } from './settings.js';
import { normWord } from './text.js';

export const V = {
  on: false, mode: 'fixed', level: -100, open: false, speaking: false,
  targetC: null, lastHit: 0, lastResult: 0, recOk: false, recErr: '', micErr: '',
  lat: 0.9, rate: null,               // ölçülen tanıma gecikmesi (sn) ve konuşma hızı (hece/sn, duraklar dahil)
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
let lastTick = 0, wasOpen = false, closedAt = 0, openedAt = 0, speakSinceHit = 0, utterStart = null;
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
  if (!V.open && wasOpen) closedAt = now;
  wasOpen = V.open;
}

/* ---------- konuşma tanıma ---------- */
export function setScript(A){
  words = [];
  for (const t of A.tokens) if (t.kind === 'w' && t.type === 'p') {
    const n = normWord(t.chars.map(c => c.ch).join(''));
    if (n) words.push({n, c0: t.c0, end: t.c0 + t.len, u0: t.u0, u1: t.u0 + t.dur});
  }
  lastJ = -1; V.targetC = null; hits = []; utterStart = null;
}
let hits = [], hitLat = 0;
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
function align(transcript){
  const rw = transcript.split(/\s+/).map(normWord).filter(Boolean).slice(-6);
  if (!rw.length || !words.length) return;
  const shown = nearIndex(getC());
  if (lastJ >= 0 && Math.abs(shown - lastJ) > 40) lastJ = -1;          // akış elle çok uzağa götürüldüyse baştan ara
  const cur = lastJ >= 0 ? lastJ : shown, from = Math.max(0, cur - 6), to = Math.min(words.length - 1, cur + 40);
  let best = -1, bestS = 0;
  for (let j = from; j <= to; j++) {
    const s0 = sim(rw[rw.length - 1], words[j].n);
    if (s0 < 0.7) continue;
    let s = s0;
    for (let k = 1; k < rw.length && j - k >= 0; k++) { const x = sim(rw[rw.length - 1 - k], words[j - k].n); if (x >= 0.7) s += x * (1 - k * 0.1); }
    const back = lastJ >= 0 && j < lastJ - 1;
    if (back && s < 2.6) continue;
    const score = s - Math.abs(j - cur) * 0.01;
    if (score > bestS) { bestS = score; best = j; }
  }
  if (best < 0) return;
  if (bestS < 1.6 && rw.length >= 3 && Math.abs(best - cur) > 12) return;   // tek kelimeyle uzak sıçrama yapma
  if (best === lastJ) return;
  const now = performance.now();
  // konuşma hızı: son birkaç saniyedeki tanıma noktalarından (duraklar dahil hece/sn)
  hits.push({j: best, t: now}); hits = hits.filter(h => now - h.t < 6000).slice(-10);
  const h0 = hits[0];
  if (hits.length >= 3 && now - h0.t > 1500 && best > h0.j) {
    const r = (words[best].u1 - words[h0.j].u1) / ((now - h0.t) / 1000);
    if (r > 1 && r < 12) V.rate = V.rate ? V.rate * 0.6 + r * 0.4 : r;
  }
  // tanıma gecikmesi: konuşmaya başlama anı ile ilk kelimenin tanınması arasındaki fark
  if (utterStart && best >= utterStart.j && utterStart.j < words.length) {
    const rate = V.rate || S.g.sps;
    const spoken = (words[best].u1 - words[utterStart.j].u0) / rate;
    const lat = (now - utterStart.t) / 1000 - spoken;
    if (lat > 0.1 && lat < 3) V.lat = V.lat * 0.6 + lat * 0.4;
    utterStart = null;
  }
  // tanınan kelime söylendiğinde hâlâ konuşuluyor muydu? Sustuysan gecikme payı eklenmez
  hitLat = V.open ? V.lat : Math.max(0, V.lat - (now - closedAt) / 1000 - S.g.gateHold);
  speakSinceHit = 0;
  lastJ = best; V.targetC = words[best].end; V.lastHit = now;
}
/* Okuduğun yerin tahmini: tanınan kelime + (gecikme + o andan beri konuşulan süre) × hızın, üstüne "öne alma" kadar kelime.
   Dönüş: harf konumu (cihazlar arası ortak birim) */
export function estimate(){
  if (lastJ < 0 || !words.length) return null;
  const rate = clampN(V.rate || S.g.sps, 1.5, 10);
  const auto = S.g.followAuto !== false;
  const adv = auto ? Math.min(3.5, hitLat + speakSinceHit) * rate : 0;
  let u = words[lastJ].u1 + adv, j = lastJ + 1;
  while (j < words.length && words[j].u1 <= u) j++;
  let W;
  if (j >= words.length) W = words.length;
  else { const w = words[j]; W = j + clampN((u - w.u0) / Math.max(0.01, w.u1 - w.u0), 0, 1); }
  W += S.g.followLead || 0;
  const k = Math.min(words.length - 1, Math.floor(W)), f = W >= words.length ? 1 : W - Math.floor(W);
  const w = words[k];
  return {targetC: w.c0 + (w.end - w.c0) * f, rate, lat: V.lat, auto};
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
export function resetFollow(){ lastJ = -1; V.targetC = null; hits = []; utterStart = null; }
export const micActive = () => !!analyser;
