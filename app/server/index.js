// Sofa room server: serves the built front end and relays room events over WebSocket.
// Everything lives in memory; a room is deleted the moment its last person leaves.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const MAX_PEOPLE = 4;
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const COLORS = ['#c2410c', '#0f766e', '#7e22ce', '#b45309'];

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
if (process.env.TURN_URL) {
  ICE_SERVERS.push({
    urls: process.env.TURN_URL.split(','),
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webm': 'video/webm', '.mp4': 'video/mp4' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200); res.end('ok'); return; }
  let file = path.join(DIST, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found — run `npm run build` first.'); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    });
    res.end(data);
  });
});

/** @type {Map<string, {code: string, host: string, controller: string, url: string, playback: {playing: boolean, time: number, at: number}, members: Map<string, any>, colorIdx: number}>} */
const rooms = new Map();

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const broadcast = (room, msg, exceptId) => { for (const m of room.members.values()) if (m.id !== exceptId) send(m.ws, msg); };
const publicMember = m => ({ id: m.id, name: m.name, color: m.color, micOn: m.micOn, camOn: m.camOn });
const playbackNow = room => {
  const p = room.playback;
  return { playing: p.playing, time: p.playing ? p.time + (Date.now() - p.at) / 1000 : p.time };
};
const roomState = room => ({
  host: room.host, controller: room.controller, url: room.url,
  members: [...room.members.values()].map(publicMember)
});
const sys = (room, text, extra) => broadcast(room, { type: 'event', ...extra, text });

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', ws => {
  let room = null;
  let me = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const leave = () => {
    if (!room || !me) return;
    room.members.delete(me.id);
    if (room.members.size === 0) { rooms.delete(room.code); room = null; return; }
    if (room.host === me.id) room.host = room.members.keys().next().value;
    if (room.controller === me.id) room.controller = room.host;
    broadcast(room, { type: 'left', id: me.id, state: roomState(room) });
    room = null;
  };

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      if (room) return;
      const code = String(msg.code || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
      const name = String(msg.name || '').trim().slice(0, 40) || 'Guest';
      if (!code) { send(ws, { type: 'error', reason: 'bad-code' }); return; }
      let r = rooms.get(code);
      if (r && r.members.size >= MAX_PEOPLE) { send(ws, { type: 'error', reason: 'full' }); return; }
      if (!r) {
        r = { code, host: '', controller: '', url: '', playback: { playing: false, time: 0, at: Date.now() }, members: new Map(), colorIdx: 0 };
        rooms.set(code, r);
      }
      room = r;
      me = { id: randomUUID(), name, ws, color: COLORS[r.colorIdx++ % COLORS.length], micOn: !!msg.micOn, camOn: !!msg.camOn };
      const created = r.members.size === 0;
      if (created) { r.host = me.id; r.controller = me.id; }
      r.members.set(me.id, me);
      send(ws, { type: 'welcome', id: me.id, created, iceServers: ICE_SERVERS, state: roomState(r), playback: playbackNow(r) });
      broadcast(r, { type: 'joined', member: publicMember(me), state: roomState(r) }, me.id);
      return;
    }

    if (!room || !me) return;
    const isController = room.controller === me.id;
    const isHost = room.host === me.id;

    switch (msg.type) {
      case 'chat': {
        const text = String(msg.text || '').trim().slice(0, 2000);
        if (text) broadcast(room, { type: 'chat', from: me.id, name: me.name, text });
        break;
      }
      case 'react': {
        const emoji = String(msg.emoji || '').slice(0, 8);
        if (emoji) broadcast(room, { type: 'react', from: me.id, emoji });
        break;
      }
      case 'media': {
        me.micOn = !!msg.micOn; me.camOn = !!msg.camOn;
        broadcast(room, { type: 'media', id: me.id, micOn: me.micOn, camOn: me.camOn }, me.id);
        break;
      }
      case 'setUrl': {
        if (!isHost) break;
        room.url = String(msg.url || '').trim().slice(0, 4096);
        room.playback = { playing: false, time: 0, at: Date.now() };
        broadcast(room, { type: 'url', url: room.url, by: me.id });
        break;
      }
      case 'playback': {
        if (!isController) break;
        const time = Math.max(0, Number(msg.time) || 0);
        room.playback = { playing: !!msg.playing, time, at: Date.now() };
        broadcast(room, { type: 'playback', playing: room.playback.playing, time, action: msg.action, by: me.id }, me.id);
        break;
      }
      case 'askControl': {
        if (isController) break;
        const host = room.members.get(room.host);
        if (host) send(host.ws, { type: 'request', from: me.id });
        break;
      }
      case 'answerRequest': {
        if (!isHost || !room.members.has(msg.to)) break;
        const target = room.members.get(msg.to);
        if (msg.allow) {
          room.controller = msg.to;
          broadcast(room, { type: 'control', state: roomState(room), by: me.id, to: msg.to, how: 'gave' });
        } else {
          send(target.ws, { type: 'declined', by: me.id });
        }
        break;
      }
      case 'giveControl': {
        if (!isHost || !room.members.has(msg.to)) break;
        room.controller = msg.to;
        broadcast(room, { type: 'control', state: roomState(room), by: me.id, to: msg.to, how: 'gave' });
        break;
      }
      case 'takeBack': {
        if (!isHost) break;
        room.controller = me.id;
        broadcast(room, { type: 'control', state: roomState(room), by: me.id, to: me.id, how: 'took' });
        break;
      }
      case 'signal': {
        const target = room.members.get(msg.to);
        if (target) send(target.ws, { type: 'signal', from: me.id, data: msg.data });
        break;
      }
      case 'leave':
        leave();
        break;
    }
  });

  ws.on('close', leave);
});

// Drop connections that stopped answering pings so their rooms empty out.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`Sofa listening on http://localhost:${PORT}`));
