/* Metin çözümleme: hece bazlı zaman çizelgesi + işaretler
   İşaretler:
     # Başlık          → bölüm başlığı (okunmaz, atlanabilir)
     // not            → talimat satırı (okunmaz, farklı renkte)
     **vurgu**         → vurgulu kelime(ler)
     [DUR] / [DUR 2]   → elle durak (saniye, varsayılan 1)
     /                 → nefes işareti (kısa durak)
     [YAVAŞ]…[/YAVAŞ]  → okunuş işaretleri: [HIZLI] [SAKİN] [HEYECANLI] de var.
                         Hızı veya durakları etkilemez; akışta seçilen kısmın altında renkli çizgi gösterir.
*/
/* Okunuş işaretleri: [id, etiket, ad, ayar anahtarı, CSS değişkeni, varsayılan renk] */
export const TONES = [
  ['slow',    'YAVAŞ',     'Yavaş',     'toneSlow',    '--tn-slow',    '#ff5a5f'],
  ['fast',    'HIZLI',     'Hızlı',     'toneFast',    '--tn-fast',    '#4cd964'],
  ['calm',    'SAKİN',     'Sakin',     'toneCalm',    '--tn-calm',    '#b9a3f5'],
  ['excited', 'HEYECANLI', 'Heyecanlı', 'toneExcited', '--tn-excited', '#4aa3ff'],
];
export const TONE_VARS = TONES.map(t => [t[3], t[4]]);
const TONE_SRC = '\\[\\s*(\\/?)\\s*(YAVA[ŞSşs]|H[IİıiI]ZL[IİıiI]|SAK[İIiı]N|HEYECANL[IİıiI])\\s*\\]';
const toneId = w => { const x = w.toLocaleUpperCase('tr-TR').replace(/I/g, 'İ').replace(/S$/, 'Ş'); return x.startsWith('YAVA') ? 'slow' : x.startsWith('H') && x.length <= 5 ? 'fast' : x.startsWith('SAK') ? 'calm' : 'excited'; };
export const TONE_RE = new RegExp(TONE_SRC, 'giu');
export const P_COMMA = 1, P_STOP = 2, P_PARA = 3.5, P_BLANK = 1.5, P_BREATH = 1.2;
const CUE_LINE = 1.6, CUE_GAP = 0.6;
const VOW = /[aeıioöuüâîûAEIİOÖUÜÂÎÛ]/g, DIG = /\p{N}/gu, LET = /\p{L}/gu;
const TOKEN_RE = new RegExp('\\[\\s*DUR(?:\\s+(\\d+(?:[.,]\\d+)?))?\\s*\\]|' + TONE_SRC + '|(?:(?!\\[\\s*DUR|' + TONE_SRC + ')\\S)+', 'giu');

export function sylOf(tok){
  const v = (tok.match(VOW) || []).length, d = (tok.match(DIG) || []).length, l = (tok.match(LET) || []).length;
  if (!v && !d && !l) return 0.25;
  return Math.max(1, (v || l) + d * 1.5);
}
function punctPause(tok){
  const c = tok.replace(/[)"'”’»\]]+$/, '').slice(-1);
  if (/[.!?…]/.test(c)) return P_STOP;
  if (/[,;:—–-]/.test(c)) return P_COMMA;
  return 0;
}
function splitChars(raw, state){
  const chars = [];
  for (let i = 0; i < raw.length;) {
    if (raw.startsWith('**', i)) { state.e = !state.e; i += 2; continue; }
    const cp = raw.codePointAt(i), ch = String.fromCodePoint(cp);
    chars.push({ch, e: state.e}); i += ch.length;
  }
  return chars;
}

/* tokens: {kind:'w'|'b'|'hold', type:'p'|'h'|'n', chars:[{ch,e}], u0, dur, pause, c0, len, src, syl, para}
   paras:  {type:'p'|'h'|'n'|'gap', tokens:[idx]} */
export function analyze(text, o = {}){
  const follow = o.mode === 'follow';
  const pf = follow || o.pauseOn === false ? 0 : (o.pauseScale ?? 1);
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const tokens = [], paras = [], holds = [], sections = [];
  let u = 0, c = 0, sylSum = 0, wc = 0, holdSec = 0, off = 0, tone = null;
  for (const line of src.split('\n')) {
    const lineOff = off; off += line.length + 1;
    if (!line.trim()) { if (tokens.length) u += P_BLANK * pf; paras.push({type:'gap', tokens:[]}); continue; }
    let type = 'p', body = line, bOff = lineOff, m;
    if ((m = /^(\s*#{1,3}\s*)(.*)$/.exec(line))) { type = 'h'; body = m[2]; bOff = lineOff + m[1].length; }
    else if ((m = /^(\s*\/\/\s?)(.*)$/.exec(line))) { type = 'n'; body = m[2]; bOff = lineOff + m[1].length; }
    const para = {type, tokens: []}, pi = paras.length, state = {e: false}, lineTok = [];
    if (type === 'h') sections.push({title: body.replace(/\*\*/g, '').trim() || 'Bölüm', u, para: pi, src: lineOff});
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(body))) {
      const raw = m[0], t = {type, para: pi, src: bOff + m.index, u0: 0, dur: 0, pause: 0, c0: c, syl: 0};
      if (m[3]) { tone = m[2] ? null : toneId(m[3]); continue; }
      if (tone && type === 'p') t.tone = tone;
      if (/^\[/.test(raw) && /DUR/i.test(raw) && type === 'p') {
        t.kind = 'hold'; t.sec = m[1] ? parseFloat(m[1].replace(',', '.')) : 1;
        t.chars = [{ch: '‖', e: false}];
      } else if (raw === '/' && type === 'p') {
        t.kind = 'b'; t.chars = [{ch: '/', e: false}]; t.pause = follow ? 0 : P_BREATH;
      } else {
        t.kind = 'w'; t.chars = splitChars(raw, state);
        if (!t.chars.length) continue;
        const clean = t.chars.map(x => x.ch).join('');
        if (type === 'p') { t.syl = sylOf(clean); t.dur = t.syl; t.pause = punctPause(clean) * pf; if (t.syl >= 1) { sylSum += t.syl; wc++; } }
      }
      t.len = t.chars.length; c += t.len;
      lineTok.push(t);
    }
    if (type !== 'p') {
      const hidden = o.hide && o.hide[type];
      if (hidden) para.hidden = true;
      const n = lineTok.length || 1;
      lineTok.forEach(t => { t.dur = hidden ? 0 : CUE_LINE / n; t.pause = 0; });
      if (lineTok.length && !hidden) lineTok[lineTok.length - 1].pause = CUE_GAP;
    } else if (lineTok.length) {
      const last = lineTok[lineTok.length - 1];
      last.pause = Math.max(last.pause, P_PARA * pf);
    }
    for (const t of lineTok) {
      t.u0 = u;
      if (t.kind === 'hold') { holds.push({u, sec: t.sec}); holdSec += t.sec; }
      u += t.dur + t.pause;
      para.tokens.push(tokens.length); tokens.push(t);
    }
    paras.push(para);
  }
  return {tokens, paras, holds, sections, totalU: u, chars: c, wc, sylSum, holdSec,
          avgSyl: wc ? sylSum / wc : 2.8};
}

export const speedText = (sps, avg) => `${Math.round(sps * 60 / (avg || 2.8))} kelime/dk · ${(+sps).toFixed(2).replace('.', ',')} hece/sn`;
export const durationOf = (A, sps) => A.totalU / sps + A.holdSec;
/* Hedef süreye göre gereken hız */
export const spsForTarget = (A, sec) => { const t = sec - A.holdSec; return t > 1 ? A.totalU / t : null; };

/* Yapıştırılan metni düzeltme */
export function cleanText(t){
  t = String(t || '').replace(/\r\n?/g, '\n').replace(/[   ]/g, ' ').replace(/­/g, '').replace(/[ \t]+/g, ' ');
  t = t.replace(/([a-zçğıöşü])-\n\s*([a-zçğıöşü])/g, '$1$2');
  const lines = t.split('\n').map(l => l.trim()).filter(l => !/^\d{1,4}$/.test(l));
  const out = [];
  for (const l of lines) {
    const prev = out.length ? out[out.length - 1] : null;
    if (l && prev && !/^(#|\/\/)/.test(prev) && !/^(#|\/\/)/.test(l)
        && !/[.!?…:;]["”»)\]]*$/.test(prev) && /^[a-zçğıöşü0-9(,“"'’]/.test(l)) out[out.length - 1] = prev + ' ' + l;
    else out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/ +([,.;:!?…])/g, '$1').trim() + '\n';
}

/* Türkçe karşılaştırma için normalleştirme (sesle takip) */
export const normWord = w => String(w).toLocaleLowerCase('tr-TR').normalize('NFC')
  .replace(/[âà]/g, 'a').replace(/[îì]/g, 'i').replace(/[ûù]/g, 'u').replace(/[^\p{L}\p{N}]/gu, '');

/* Önizleme / operatör için HTML */
export function renderHTML(A, opts = {}){
  const out = [];
  A.paras.forEach((p, pi) => {
    if (p.type === 'gap') { out.push('<div class="gap"></div>'); return; }
    const cls = p.type === 'h' ? 'para hd' : p.type === 'n' ? 'para nt' : 'para';
    const parts = p.tokens.map(ti => {
      const t = A.tokens[ti];
      let inner = '', e = false, buf = '';
      const flush = () => { if (buf) { inner += e ? `<b class="em">${escH(buf)}</b>` : escH(buf); buf = ''; } };
      for (const ch of t.chars) { if (ch.e !== e) { flush(); e = ch.e; } buf += ch.ch; }
      flush();
      const k = (t.kind === 'hold' ? ' hold' : t.kind === 'b' ? ' br' : '') + (t.tone && opts.tones !== false ? ' tn tn-' + t.tone : '');
      return opts.ids ? `<span class="tk${k}" data-t="${ti}">${inner}</span>` : (k ? `<span class="tk${k}">${inner}</span>` : inner);
    });
    out.push(`<div class="${cls}" data-p="${pi}">${parts.join(' ')}</div>`);
  });
  return out.join('');
}
const escH = s => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

export const SAMPLE_SPEED_TEXT = `Merhaba, ben bu metni kendi doğal temponla okuyorum. Kameraya bakarken acele etmeden, nefesimi düzenli tutarak ve kelimeleri net söyleyerek konuşuyorum.
Bugün size klima bakımının neden önemli olduğunu, filtrelerin ne sıklıkla temizlenmesi gerektiğini ve küçük ihmallerin büyük arızalara nasıl yol açtığını anlatacağım.`;
