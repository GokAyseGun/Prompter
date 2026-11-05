/* Cihazlar arası anlık bağlantı (Supabase Realtime, özel kanal "prompter:<uid>")
   Olaylar: cmd, state, script, cfg, start, stop, voice, role */
import { sb } from './supa.js';

export function createLink({ user, deviceId, meta, on = {}, onPresence, onStatus }){
  let ch = null, ready = false, current = {...meta}, closed = false, retryT = 0;
  const L = {
    get ready(){ return ready; },
    peers: [],
    send(event, payload = {}){ if (ready) ch.send({type: 'broadcast', event, payload: {...payload, from: deviceId}}).catch(() => {}); },
    cmd(to, action, extra = {}){ L.send('cmd', {...extra, to, action}); },
    track(m){ current = {...current, ...m}; if (ready) ch.track({...current, deviceId, at: Date.now()}).catch(() => {}); },
    get meta(){ return current; },
    close(){ closed = true; clearTimeout(retryT); if (ch) sb.removeChannel(ch); ch = null; ready = false; },
  };
  async function connect(){
    if (closed) return;
    try { await sb.realtime.setAuth(); } catch (e) {}
    ch = sb.channel('prompter:' + user.id, { config: { private: true, broadcast: { self: false }, presence: { key: deviceId } } });
    for (const ev of Object.keys(on)) ch.on('broadcast', { event: ev }, ({ payload }) => { try { on[ev](payload || {}); } catch (e) { console.error(e); } });
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState(), peers = [];
      for (const k in st) { const m = st[k][st[k].length - 1]; if (m && m.deviceId !== deviceId) peers.push(m); }
      L.peers = peers; onPresence && onPresence(peers);
    });
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') { ready = true; ch.track({...current, deviceId, at: Date.now()}).catch(() => {}); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        ready = false;
        if (!closed && status !== 'CLOSED') { sb.removeChannel(ch); retryT = setTimeout(connect, 4000); }
      }
      onStatus && onStatus(ready, status);
    });
  }
  connect();
  return L;
}
