/* Ses kapısı (mikrofon seviyesi) ve sesle takip (Türkçe konuşma tanıma) */
import { S } from './settings.js';
import { normWord } from './text.js';

export const V = {
  on: false, mode: 'fixed', level: -100, open: false, speaking: false,
  targetC: null, lastHit: 0, lastResult: 0, recOk: false, recErr: '', micErr: '',
};
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
export function tick(now){
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
}

/* ---------- konuşma tanıma ---------- */
export function setScript(A){
  words = [];
  for (const t of A.tokens) if (t.kind === 'w' && t.type === 'p') {
    const n = normWord(t.chars.map(c => c.ch).join(''));
    if (n) words.push({n, c0: t.c0, end: t.c0 + t.len});
  }
  lastJ = -1; V.targetC = null;
}
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
  const cur = nearIndex(getC()), from = Math.max(0, cur - 4), to = Math.min(words.length - 1, cur + 40);
  let best = -1, bestS = 0;
  for (let j = from; j <= to; j++) {
    const s0 = sim(rw[rw.length - 1], words[j].n);
    if (s0 < 0.7) continue;
    let s = s0;
    for (let k = 1; k < rw.length && j - k >= 0; k++) { const x = sim(rw[rw.length - 1 - k], words[j - k].n); if (x >= 0.7) s += x * (1 - k * 0.1); }
    const back = j < lastJ - 2;
    if (back && s < 2.6) continue;
    const score = s - Math.abs(j - cur) * 0.01;
    if (score > bestS) { bestS = score; best = j; }
  }
  if (best < 0) return;
  if (bestS < 1.6 && rw.length >= 3 && Math.abs(best - cur) > 12) return;   // tek kelimeyle uzak sıçrama yapma
  lastJ = best; V.targetC = words[best].end; V.lastHit = performance.now();
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
export function resetFollow(){ lastJ = -1; V.targetC = null; }
export const micActive = () => !!analyser;
