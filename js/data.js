import { sb } from './supa.js';
import { lsGet, lsSet } from './util.js';

const COLS = 'id,title,body,folder,favorite,target_sec,last_char,opened_at,created_at,updated_at';
const must = ({data, error}) => { if (error) throw error; return data; };

export const listScripts = async () => must(await sb.from('scripts').select(COLS).order('updated_at', {ascending:false}));
export const getScript = async id => must(await sb.from('scripts').select(COLS).eq('id', id).maybeSingle());
export const createScript = async (fields = {}) =>
  must(await sb.from('scripts').insert({title:'Adsız metin', body:'', folder:'', ...fields}).select(COLS).single());
export const updateScript = async (id, fields) =>
  must(await sb.from('scripts').update(fields).eq('id', id).select('id,updated_at').single());
export const setScriptMeta = async (id, fields) => must(await sb.from('scripts').update(fields).eq('id', id).select('id').single());
export const renameFolder = async (from, to) => must(await sb.from('scripts').update({folder: to}).eq('folder', from).select('id'));
export const deleteScript = async id => must(await sb.from('scripts').delete().eq('id', id));
export const touchScript = (id, fields = {}) =>
  sb.from('scripts').update({opened_at: new Date().toISOString(), ...fields}).eq('id', id).then(() => {}, () => {});

export const listVersions = async id =>
  must(await sb.from('script_versions').select('id,title,body,created_at').eq('script_id', id).order('created_at', {ascending:false}).limit(60));
export const snapshotVersion = async (id, title, body) =>
  must(await sb.from('script_versions').insert({script_id:id, title, body}));

export const listTakes = async (scriptId, limit = 200) => {
  let q = sb.from('takes').select('*').order('started_at', {ascending:false}).limit(limit);
  if (scriptId) q = q.eq('script_id', scriptId);
  return must(await q);
};
export const deleteTake = async id => must(await sb.from('takes').delete().eq('id', id));

/* Çekim kaydı: bağlantı yoksa kuyruğa al, sonra gönder */
const QK = 'prompter.takeQueue';
export async function saveTake(t){
  const q = lsGet(QK, []); q.push(t); lsSet(QK, q);
  await flushTakes();
}
export async function flushTakes(){
  const q = lsGet(QK, []); if (!q.length) return;
  const { error } = await sb.from('takes').insert(q);
  if (!error) lsSet(QK, []);
}

/* Yerel taslak (kaydedilemeyen değişiklikler) */
export const draftKey = id => 'prompter.draft.' + id;
export const getDraft = id => lsGet(draftKey(id));
export const setDraft = (id, d) => lsSet(draftKey(id), d);
export const clearDraft = id => { try { localStorage.removeItem(draftKey(id)); } catch (e) {} };

export const saveFollowLog = async (row) => { const { error } = await sb.from('follow_logs').insert(row); if (error) throw error; };
