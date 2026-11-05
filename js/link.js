/* Cihazlar arası bağlantı — yalnızca aynı WiFi (yerel ağ) üzerinden.
   Supabase yalnızca cihazların birbirini bulması (presence) ve el sıkışma (WebRTC sinyali) için kullanılır.
   Akış, kumanda, ses, ayar ve metin trafiğinin tamamı WebRTC veri kanallarıyla doğrudan cihazdan cihaza gider.
   ICE sunucusu verilmez: yalnızca yerel ağ adayları kullanılır, farklı ağdaki cihazlar bağlanamaz. */
import { sb } from './supa.js';

const FAST = new Set(['state', 'voice', '_ping', '_pong']);   // sırasız, yeniden gönderimsiz kanal
const OPEN_TIMEOUT = 12000, RETRY_MS = 4000, NOWIFI_RETRY_MS = 20000;

export function createLink({ user, deviceId, meta, on = {}, onPresence, onStatus }){
  let ch = null, subscribed = false, current = {...meta}, closed = false, retryT = 0;
  const conns = new Map();          // id -> {pc, rel, fast, meta, state, rtt, timer}
  const noWifi = new Set();
  let seen = new Map();             // Supabase presence: id -> meta (yalnızca keşif için)
  const L = {
    get ready(){ return true; },
    get online(){ return subscribed; },
    peers: [],                      // WiFi üzerinden bağlı cihazlar
    get seen(){ return [...seen.values()]; },
    info(id){ const c = conns.get(id); return c ? {state: c.state, rtt: c.rtt} : {state: 'none', rtt: null}; },
    send(ev, payload = {}){ const msg = pack(ev, payload); for (const c of conns.values()) out(c, ev, msg); },
    cmd(to, action, extra = {}){
      const ev = 'cmd', msg = pack(ev, {...extra, to, action});
      const c = conns.get(to);
      if (c) out(c, ev, msg); else for (const x of conns.values()) out(x, ev, msg);
    },
    track(m){
      current = {...current, ...m};
      const msg = pack('_meta', current); for (const c of conns.values()) out(c, '_meta', msg);
      presenceTrack();
    },
    get meta(){ return current; },
    close(){ closed = true; clearTimeout(retryT); for (const id of [...conns.keys()]) drop(id); if (ch) sb.removeChannel(ch); },
  };
  const pack = (ev, p) => JSON.stringify({ev, p: {...p, from: deviceId}});
  function out(c, ev, msg){
    const dc = FAST.has(ev) && c.fast && c.fast.readyState === 'open' ? c.fast : c.rel;
    if (dc && dc.readyState === 'open') { try { dc.send(msg); } catch (e) {} }
  }
  function emitPeers(){
    L.peers = [...conns.values()].filter(c => c.state === 'open' && c.meta).map(c => ({...c.meta, deviceId: c.id, link: 'wifi', rtt: c.rtt}));
    onPresence && onPresence(L.peers);
  }
  function onMessage(c, data){
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || !m.ev) return;
    if (m.ev === '_meta') { c.meta = m.p; emitPeers(); return; }
    if (m.ev === '_ping') { out(c, '_pong', pack('_pong', {t: m.p.t})); return; }
    if (m.ev === '_pong') { c.rtt = Math.round(performance.now() - m.p.t); return; }
    const h = on[m.ev]; if (h) { try { h(m.p || {}); } catch (e) { console.error(e); } }
  }

  /* ---------- WebRTC ---------- */
  function wireDc(c, dc){
    if (dc.label === 'fast') c.fast = dc; else c.rel = dc;
    dc.onmessage = e => onMessage(c, e.data);
    dc.onopen = () => {
      if (c.rel && c.rel.readyState === 'open') {
        c.state = 'open'; clearTimeout(c.timer); noWifi.delete(c.id);
        out(c, '_meta', pack('_meta', current)); emitPeers(); status();
      }
    };
    dc.onclose = () => { if (c.state === 'open') { drop(c.id); scheduleRetry(c.id, RETRY_MS); } };
  }
  function makeConn(id){
    drop(id);
    const pc = new RTCPeerConnection({iceServers: []});
    const c = {id, pc, rel: null, fast: null, meta: seen.get(id) || null, state: 'connecting', rtt: null};
    conns.set(id, c);
    pc.onicecandidate = e => { if (e.candidate) signal(id, 'ice', e.candidate.toJSON ? e.candidate.toJSON() : e.candidate); };
    pc.ondatachannel = e => wireDc(c, e.channel);
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed') { const was = c.state; drop(id); scheduleRetry(id, was === 'open' ? RETRY_MS : NOWIFI_RETRY_MS, was !== 'open'); }
      if (s === 'disconnected') setTimeout(() => { if (pc.connectionState === 'disconnected') { drop(id); scheduleRetry(id, RETRY_MS); } }, 5000);
    };
    c.timer = setTimeout(() => { if (c.state !== 'open') { drop(id); markNoWifi(id); scheduleRetry(id, NOWIFI_RETRY_MS, true); } }, OPEN_TIMEOUT);
    status();
    return c;
  }
  function markNoWifi(id){ noWifi.add(id); status(); emitPeers(); }
  L.noWifi = id => noWifi.has(id);
  function drop(id){
    const c = conns.get(id); if (!c) return;
    conns.delete(id); clearTimeout(c.timer);
    try { c.rel && c.rel.close(); } catch (e) {}
    try { c.fast && c.fast.close(); } catch (e) {}
    try { c.pc.close(); } catch (e) {}
    if (c.state === 'open') emitPeers();
    status();
  }
  const retryTimers = new Map();
  function scheduleRetry(id, ms, nowifi){
    if (nowifi) noWifi.add(id);
    clearTimeout(retryTimers.get(id));
    retryTimers.set(id, setTimeout(() => { retryTimers.delete(id); if (!conns.has(id) && seen.has(id)) initiate(id, true); }, ms));
  }
  async function initiate(id, force){
    if (closed || conns.has(id)) return;
    if (!force && !(deviceId < id)) return;          // aynı anda iki teklif olmasın: küçük kimlik başlatır
    if (!(deviceId < id)) { signal(id, 'hello'); return; }   // karşı taraftan teklif iste
    const c = makeConn(id);
    wireDc(c, c.pc.createDataChannel('rel', {ordered: true}));
    wireDc(c, c.pc.createDataChannel('fast', {ordered: false, maxRetransmits: 0}));
    try {
      await c.pc.setLocalDescription(await c.pc.createOffer());
      signal(id, 'offer', c.pc.localDescription);
    } catch (e) { drop(id); }
  }
  async function onSignal(p){
    if (p.to !== deviceId || !p.from) return;
    const id = p.from;
    try {
      if (p.kind === 'hello') { if (deviceId < id && (!conns.has(id) || conns.get(id).state !== 'open')) { drop(id); initiate(id, true); } return; }
      if (p.kind === 'offer') {
        const c = makeConn(id);
        await c.pc.setRemoteDescription(p.data);
        await c.pc.setLocalDescription(await c.pc.createAnswer());
        signal(id, 'answer', c.pc.localDescription);
        for (const x of c.pending || []) await c.pc.addIceCandidate(x).catch(() => {});
        return;
      }
      const c = conns.get(id); if (!c) return;
      if (p.kind === 'answer') {
        if (c.pc.signalingState === 'have-local-offer') await c.pc.setRemoteDescription(p.data);
        for (const x of c.pending || []) await c.pc.addIceCandidate(x).catch(() => {});
        c.pending = [];
      }
      if (p.kind === 'ice') {
        if (c.pc.remoteDescription) await c.pc.addIceCandidate(p.data).catch(() => {});
        else (c.pending ||= []).push(p.data);
      }
    } catch (e) { drop(id); }
  }
  function signal(to, kind, data){
    if (!ch || !subscribed) return;
    const d = data && data.toJSON ? data.toJSON() : data;
    ch.send({type: 'broadcast', event: 'sig', payload: {to, from: deviceId, kind, data: d}}).catch(() => {});
  }
  // canlı bağlantıların gecikmesini ölç
  setInterval(() => { for (const c of conns.values()) if (c.state === 'open') out(c, '_ping', pack('_ping', {t: performance.now()})); }, 2000);

  /* ---------- Supabase: yalnızca keşif + el sıkışma ---------- */
  let ptT = 0;
  function presenceTrack(){
    clearTimeout(ptT);
    ptT = setTimeout(() => { if (ch && subscribed) ch.track({deviceId, name: current.name, role: current.role, at: Date.now()}).catch(() => {}); }, 300);
  }
  function status(){ onStatus && onStatus({online: subscribed, wifi: L.peers.length, connecting: [...conns.values()].filter(c => c.state !== 'open').length}); }
  async function connect(){
    if (closed) return;
    try { await sb.realtime.setAuth(); } catch (e) {}
    ch = sb.channel('prompter:' + user.id, { config: { private: true, broadcast: { self: false }, presence: { key: deviceId } } });
    ch.on('broadcast', {event: 'sig'}, ({payload}) => onSignal(payload || {}));
    ch.on('presence', {event: 'sync'}, () => {
      const st = ch.presenceState(), next = new Map();
      for (const k in st) { const m = st[k][st[k].length - 1]; if (m && m.deviceId && m.deviceId !== deviceId) next.set(m.deviceId, m); }
      seen = next;
      for (const id of seen.keys()) if (!conns.has(id) && !retryTimers.has(id)) initiate(id, false);
      // Bağlantı kurulmamış ve artık görünmeyen cihazların bekleyen denemelerini bırak (kurulu WiFi bağlantıları internet gitse de sürer)
      for (const [id, t] of retryTimers) if (!seen.has(id)) { clearTimeout(t); retryTimers.delete(id); }
      emitPeers(); status();
    });
    ch.subscribe(s => {
      if (s === 'SUBSCRIBED') { subscribed = true; presenceTrack(); }
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
        subscribed = false;
        if (!closed && s !== 'CLOSED') { sb.removeChannel(ch); retryT = setTimeout(connect, 5000); }
      }
      status();
    });
  }
  connect();
  return L;
}
