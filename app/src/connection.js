// Opens the room WebSocket and resolves once the server has admitted us.
// Messages that arrive before the room screen attaches its handler are queued.
export function connectRoom({ code, name, micOn, camOn }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    const queue = [];
    let handler = null;
    let onLost = null;
    let admitted = false;
    const send = msg => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
    const sock = {
      send,
      listen(fn, lost) { handler = fn; onLost = lost; queue.splice(0).forEach(fn); },
      close() { onLost = null; ws.close(); }
    };
    ws.onopen = () => send({ type: 'join', code, name, micOn, camOn });
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!admitted) {
        if (msg.type === 'welcome') { admitted = true; resolve({ sock, welcome: msg }); }
        else if (msg.type === 'error') { ws.close(); reject(new Error(msg.reason)); }
        return;
      }
      if (handler) handler(msg); else queue.push(msg);
    };
    ws.onclose = () => {
      if (!admitted) reject(new Error('network'));
      else if (onLost) onLost();
    };
  });
}
