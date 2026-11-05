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
];
export const fontOf = id => FONTS.find(f => f.id === id) || FONTS[0];
export const WEIGHTS = [[100,'İnce'],[300,'Hafif'],[400,'Normal'],[500,'Orta'],[700,'Kalın'],[900,'Ekstra kalın']];
export const PROFILE_META = [['phone','Telefon'],['tablet','Tablet'],['desktop','Bilgisayar'],['monitor','Monitör / TV']];
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
  pauseOn:true, pauseScale:1,
  lead:1, markerStyle:'both', focusOn:true, focusStrength:0.55, clockOn:true,
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
  ['restart','Başa dön',''],
  ['exit','Ana ekrana dön',''],
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
  restart:    [K('Home','Home'), {type:'pad',button:3}],
  exit:       [K('Escape','Escape'), {type:'pad',button:9}],
};
export const MODES = [['fixed','Sabit hız'],['gate','Ses kapısı'],['follow','Sesle takip']];

const LS_S = 'prompter.settings', LS_D = 'prompter.device';
function guessProfile(){
  const w = Math.min(screen.width, screen.height), touch = matchMedia('(pointer:coarse)').matches;
  if (touch && w < 600) return 'phone';
  if (touch) return 'tablet';
  return Math.max(screen.width, screen.height) >= 2400 ? 'monitor' : 'desktop';
}
const PNAME = {phone:'Telefon', tablet:'Tablet', desktop:'Bilgisayar', monitor:'Monitör'};

function normalize(d){
  d = d || {};
  const g = Object.assign({}, DEF_G, d.g || {});
  if (!FONTS.some(f => f.id === g.font)) g.font = DEF_G.font;
  if (!MODES.some(m => m[0] === g.mode)) g.mode = 'fixed';
  const profiles = {};
  for (const k in DEF_PROFILE) profiles[k] = Object.assign({}, DEF_PROFILE[k], (d.profiles || {})[k] || {});
  const binds = {};
  for (const [a] of ACTIONS) binds[a] = (d.binds && Array.isArray(d.binds[a])) ? d.binds[a] : DEF_BINDS[a].map(b => ({...b}));
  return {g, profiles, binds};
}

const local = lsGet(LS_S, {});
export const S = normalize(local);
S.stamp = local.stamp || 0;          // son yerel değişiklik zamanı
S.synced = local.synced || 0;        // buluttan alınan/gönderilen son zaman
export const DEV = Object.assign({id: 'd-' + rid(8), profile: guessProfile(), name: ''}, lsGet(LS_D, {}));
if (!DEF_PROFILE[DEV.profile]) DEV.profile = guessProfile();
if (!DEV.name) DEV.name = PNAME[DEV.profile];
lsSet(LS_D, DEV);

export const prof = () => S.profiles[DEV.profile];
export const saveDevice = () => lsSet(LS_D, DEV);
const writeLocal = () => lsSet(LS_S, {g:S.g, profiles:S.profiles, binds:S.binds, stamp:S.stamp, synced:S.synced});

let cloudOn = false;
const pushCloud = debounce(async () => {
  if (!cloudOn) return;
  const data = {g:S.g, profiles:S.profiles, binds:S.binds};
  const {data: u} = await sb.auth.getUser();
  if (!u?.user) return;
  const at = new Date().toISOString();
  const {error} = await sb.from('settings').upsert({owner: u.user.id, data, updated_at: at});
  if (!error) { S.synced = Date.parse(at); writeLocal(); }
}, 2000);

export function save(){ S.stamp = Date.now(); writeLocal(); pushCloud(); }
export function saveNow(){ S.stamp = Date.now(); writeLocal(); pushCloud.flush(); }

/* Girişten sonra: buluttaki ayarlar yereldekinden yeniyse onları al, değilse yereli gönder */
export async function syncSettings(){
  cloudOn = true;
  const {data, error} = await sb.from('settings').select('data, updated_at').maybeSingle();
  if (error) return false;
  const cloudAt = data ? Date.parse(data.updated_at) : 0;
  if (data && cloudAt > S.stamp) {
    const n = normalize(data.data);
    S.g = n.g; S.profiles = n.profiles; S.binds = n.binds;
    S.stamp = cloudAt; S.synced = cloudAt; writeLocal();
    return true;
  }
  if (!data || S.stamp > S.synced) pushCloud.flush();
  return false;
}

export function exportJSON(){ return JSON.stringify({app:'prompter', v:2, g:S.g, profiles:S.profiles, binds:S.binds}, null, 2); }
export function importJSON(txt){
  const d = JSON.parse(txt);
  if (!d || d.app !== 'prompter') throw new Error('Bu dosya bir Prompter ayar dosyası değil.');
  const n = normalize(d);
  S.g = n.g; S.profiles = n.profiles; S.binds = n.binds;
  saveNow();
}
export function resetBinds(){ for (const [a] of ACTIONS) S.binds[a] = DEF_BINDS[a].map(b => ({...b})); save(); }
export function resetProfile(){ S.profiles[DEV.profile] = {...DEF_PROFILE[DEV.profile]}; save(); }
