import { lsGet, lsSet, rid, debounce } from './util.js';
import { sb } from './supa.js';

export const FONTS = [
  {id:'inter',        name:'Inter',        fam:'"P Inter"'},
  {id:'roboto',       name:'Roboto',       fam:'"P Roboto"'},
  {id:'montserrat',   name:'Montserrat',   fam:'"P Montserrat"'},
  {id:'raleway',      name:'Raleway',      fam:'"P Raleway"'},
  {id:'work-sans',    name:'Work Sans',    fam:'"P Work Sans"'},
  {id:'exo-2',        name:'Exo 2',        fam:'"P Exo 2"'},
  {id:'noto-serif',   name:'Noto Serif',   fam:'"P Noto Serif"'},
  {id:'josefin-sans', name:'Josefin Sans', fam:'"P Josefin Sans"'},
  {id:'lexend',       name:'Lexend',       fam:'"P Lexend"'},
  {id:'nunito',       name:'Nunito',       fam:'"P Nunito"'},
];
export const fontOf = id => FONTS.find(f => f.id === id) || FONTS[0];
export const WEIGHTS = [[100,'İnce'],[300,'Hafif'],[400,'Normal'],[500,'Orta'],[700,'Kalın'],[900,'Ekstra kalın']];
export const PROFILE_META = [['phone','Telefon'],['tablet','Tablet'],['desktop','Bilgisayar'],['monitor','Monitör / TV']];
export const PNAME = {phone:'Telefon', tablet:'Tablet', desktop:'Bilgisayar', monitor:'Monitör'};
export const ROLES = [['prompter','Prompter'],['ekran','Ekran'],['kumanda','Kumanda']];
export const ROLE_NAME = Object.fromEntries(ROLES);
/* Ekranda görünenler (yeşil tik) */
export const SHOW_ITEMS = [
  ['notes','Notlar', '// ile başlayan satırlar'],
  ['heads','Bölüm başlıkları', '# ile başlayan satırlar'],
  ['emph','Vurgu rengi', '**vurgu** kapalıysa normal yazı gibi görünür'],
  ['marks','Durak ‖ ve nefes / işaretleri', 'kapalıyken duraklar yine uygulanır'],
  ['uline','Okuma alt çizgisi', ''],
  ['arrows','Okuma okları', ''],
  ['focus','Odak karartması', ''],
  ['clock','Süre göstergesi', 'geçen, kalan ve hedef farkı'],
  ['prog','İlerleme çubuğu', ''],
  ['voice','Ses göstergesi', 'mod, kapı durumu ve mikrofon seviyesi'],
];
const SHOW0 = Object.fromEntries(SHOW_ITEMS.map(([k]) => [k, true]));
const P0 = {lineHeight:1.3, letter:0, orientation:'auto', rotateDir:90, mirror:'h', flipV:false, anchor:45, cropTop:0, cropBottom:0, cropSide:0};
export const DEF_PROFILE = {
  phone:   {...P0, size:30, margin:4},
  tablet:  {...P0, size:46, margin:6},
  desktop: {...P0, size:60, margin:10, lineHeight:1.35},
  monitor: {...P0, size:84, margin:12, lineHeight:1.35},
};
export const DEF_SPS = 4.5;
export const DEF_G = {
  font:'inter', weight:500, italic:false, align:'left', textColor:'#ffffff', emphColor:'#f2c14e',
  sps:DEF_SPS, personalSps:null, mode:'fixed',
  fadeWidth:6, readTone:0.45, readOpacity:0.6,
  pauseOn:true, pauseScale:1, lead:1, focusStrength:0.55,
  followLead:1, followAuto:true,
  countdown:true, fullscreen:true, boostMul:3,
  gateDb:-45, gateHold:0.9, stickL:'speed', stickR:'scrub', autoClean:false,
};
export const ACTIONS = [
  ['toggle','Başlat / Durdur',''],
  ['lineNext','Satır ileri',''],
  ['linePrev','Satır geri',''],
  ['sectionNext','Sonraki bölüm','# başlıklar'],
  ['sectionPrev','Önceki bölüm',''],
  ['faster','Hız artır','+0,25 hece/sn'],
  ['slower','Hız azalt','−0,25 hece/sn'],
  ['boostFwd','Basılı tut: hızlı ileri','bırakınca normale döner'],
  ['boostBack','Basılı tut: hızlı geri',''],
  ['modeCycle','Akış modunu değiştir','Sabit → Ses kapısı → Sesle takip'],
  ['leadUp','Sesle takip: öne al','+0,5 kelime'],
  ['leadDown','Sesle takip: geri al','−0,5 kelime'],
  ['restart','Başa dön',''],
  ['exit','Akışı bitir',''],
];
export const REPEAT = new Set(['lineNext','linePrev','faster','slower']);
export const HOLD = new Set(['boostFwd','boostBack']);
const K = (code, key) => ({type:'key', code, key});
export const DEF_BINDS = {
  toggle:     [K('Space',' '), {type:'mouse',button:0}, {type:'pad',button:0}],
  lineNext:   [K('ArrowDown','ArrowDown'), {type:'pad',button:13}],
  linePrev:   [K('ArrowUp','ArrowUp'), {type:'pad',button:12}],
  sectionNext:[K('PageDown','PageDown'), {type:'pad',button:1}],
  sectionPrev:[K('PageUp','PageUp'), {type:'pad',button:2}],
  faster:     [K('ArrowRight','ArrowRight'), {type:'pad',button:5}],
  slower:     [K('ArrowLeft','ArrowLeft'), {type:'pad',button:4}],
  boostFwd:   [K('KeyD','d'), {type:'pad',button:7}],
  boostBack:  [K('KeyA','a'), {type:'pad',button:6}],
  modeCycle:  [K('KeyM','m'), {type:'pad',button:17}],
  leadUp:     [K('KeyE','e')],
  leadDown:   [K('KeyQ','q')],
  restart:    [K('Home','Home'), {type:'pad',button:3}],
  exit:       [K('Escape','Escape'), {type:'pad',button:9}],
};
export const MODES = [['fixed','Sabit hız'],['gate','Ses kapısı'],['follow','Sesle takip']];

/* ---------- bu cihaz ---------- */
const params = new URLSearchParams(location.search);
export const WIN = params.get('win');                 // ayrı "ekran penceresi" (ör. harici monitör)
const devStore = WIN ? sessionStorage : localStorage;
function guessProfile(){
  const w = Math.min(screen.width, screen.height), touch = matchMedia('(pointer:coarse)').matches;
  if (touch && w < 600) return 'phone';
  if (touch) return 'tablet';
  return Math.max(screen.width, screen.height) >= 2400 ? 'monitor' : 'desktop';
}
let dv = {};
try { dv = JSON.parse(devStore.getItem('prompter.device')) || {}; } catch (e) {}
export const DEV = Object.assign(
  WIN ? {id: 'w-' + rid(8), profile: 'monitor', name: 'Monitör penceresi', role: 'ekran', roleAuto: false}
      : {id: 'd-' + rid(8), profile: guessProfile(), name: '', role: null, roleAuto: true}, dv);
if (!DEF_PROFILE[DEV.profile]) DEV.profile = guessProfile();
if (!DEV.name) DEV.name = PNAME[DEV.profile];
const qr = params.get('role');
if (qr && ROLE_NAME[qr]) { DEV.role = qr; DEV.roleAuto = false; }
export const saveDevice = () => { try { devStore.setItem('prompter.device', JSON.stringify(DEV)); } catch (e) {} };
saveDevice();

/* ---------- ortak ayarlar (hesapla eşitlenir, cihazlar arası canlı aktarılır) ---------- */
function normProfile(k, saved = {}){
  return Object.assign({}, DEF_PROFILE[k], saved, {show: Object.assign({}, SHOW0, saved.show || {})});
}
function normalize(d){
  d = d || {};
  const g = Object.assign({}, DEF_G, d.g || {});
  if (!FONTS.some(f => f.id === g.font)) g.font = DEF_G.font;
  if (!MODES.some(m => m[0] === g.mode)) g.mode = 'fixed';
  const profiles = {};
  for (const k in DEF_PROFILE) profiles[k] = normProfile(k, (d.profiles || {})[k]);
  const binds = {};
  for (const [a] of ACTIONS) binds[a] = (d.binds && Array.isArray(d.binds[a])) ? d.binds[a] : DEF_BINDS[a].map(b => ({...b}));
  return {g, profiles, binds};
}
const LS_S = 'prompter.settings';
const local = lsGet(LS_S, {});
export const S = normalize(local);
S.stamp = local.stamp || 0; S.synced = local.synced || 0;
export const prof = (type = DEV.profile) => S.profiles[type];
const writeLocal = () => lsSet(LS_S, {g:S.g, profiles:S.profiles, binds:S.binds, stamp:S.stamp, synced:S.synced});

let cloudOn = false;
const pushCloud = debounce(async () => {
  if (!cloudOn) return;
  const {data: u} = await sb.auth.getUser();
  if (!u?.user) return;
  const at = new Date().toISOString();
  const {error} = await sb.from('settings').upsert({owner: u.user.id, data: {g:S.g, profiles:S.profiles, binds:S.binds}, updated_at: at});
  if (!error) { S.synced = Date.parse(at); writeLocal(); }
}, 2000);
export function save(){ S.stamp = Date.now(); writeLocal(); pushCloud(); }

/* canlı aktarım */
let sender = null, pend = {};
const listeners = new Set();
export const onSettings = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = src => listeners.forEach(f => { try { f(src); } catch (e) { console.error(e); } });
const flushPatch = debounce(() => { if (sender && Object.keys(pend).length) sender(pend); pend = {}; }, 120);
export const setCfgSender = fn => { sender = fn; };
export function setG(k, v){ S.g[k] = v; (pend.g ||= {})[k] = v; save(); flushPatch(); emit('local'); }
export function setP(type, k, v){ S.profiles[type][k] = v; ((pend.profiles ||= {})[type] ||= {})[k] = v; save(); flushPatch(); emit('local'); }
export function setShow(type, k, v){ setP(type, 'show', {...S.profiles[type].show, [k]: v}); }
export function bindsChanged(){ pend.binds = S.binds; save(); flushPatch(); emit('local'); }
export function applyPatch(p){
  if (!p) return;
  if (p.g) Object.assign(S.g, p.g);
  if (p.profiles) for (const t in p.profiles) if (S.profiles[t]) Object.assign(S.profiles[t], p.profiles[t]);
  if (p.binds) S.binds = p.binds;
  S.stamp = Date.now(); writeLocal(); emit('remote');
}
export const fullPatch = () => ({g:S.g, profiles:S.profiles, binds:S.binds});

export async function syncSettings(){
  cloudOn = true;
  const {data, error} = await sb.from('settings').select('data, updated_at').maybeSingle();
  if (error) return false;
  const cloudAt = data ? Date.parse(data.updated_at) : 0;
  if (data && cloudAt > S.stamp) {
    const n = normalize(data.data);
    S.g = n.g; S.profiles = n.profiles; S.binds = n.binds;
    S.stamp = cloudAt; S.synced = cloudAt; writeLocal(); emit('remote');
    return true;
  }
  if (!data || S.stamp > S.synced) pushCloud.flush();
  return false;
}
export function exportJSON(){ return JSON.stringify({app:'gg-prompter', v:3, g:S.g, profiles:S.profiles, binds:S.binds}, null, 2); }
export function importJSON(txt){
  const d = JSON.parse(txt);
  if (!d || !/prompter/.test(d.app || '')) throw new Error('Bu dosya bir GG Prompter ayar dosyası değil.');
  const n = normalize(d);
  S.g = n.g; S.profiles = n.profiles; S.binds = n.binds;
  pend = fullPatch(); save(); flushPatch(); emit('local');
}
export function resetBinds(){ for (const [a] of ACTIONS) S.binds[a] = DEF_BINDS[a].map(b => ({...b})); bindsChanged(); }
export function resetProfile(type){
  const d = normProfile(type);
  for (const k in d) S.profiles[type][k] = d[k];
  ((pend.profiles ||= {})[type] = {...S.profiles[type]}); save(); flushPatch(); emit('local');
}
