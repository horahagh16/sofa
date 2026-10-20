import { useEffect, useReducer, useRef, useState } from 'react';
import { PeerMesh } from './peers.js';
import { SelfVideo, StreamAudio, StreamVideo } from './media.jsx';
import {
  CamIcon, ChatIcon, CloseIcon, CopyIcon, FullscreenIcon, HandIcon, HangUpIcon, LayoutIcon,
  LinkIcon, MicIcon, MutedBadgeIcon, PauseIcon, PeopleIcon, PlayIcon, SendIcon, SmileIcon
} from './icons.jsx';

const EMOJI = ['😂', '😮', '😍', '😱', '👏', '🔥'];
const SAMPLE = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
const SELF_COLOR = '#5b6ee1';
const HEARTBEAT_MS = 4000;
const DRIFT_S = 0.75;

const fmt = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
};
const now = () => { const d = new Date(); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
let uid = 0;

export default function Room({ session, code, name, initial, stream, camOn, micOn, toggleCam, toggleMic, onLeft }) {
  const { sock, welcome } = session;
  const meId = welcome.id;

  // Room membership and roles live in a ref so socket handlers always see the latest values.
  const room = useRef(null);
  if (!room.current) {
    room.current = {
      host: welcome.state.host,
      controller: welcome.state.controller,
      members: new Map(welcome.state.members.map(m => [m.id, m])),
      names: new Map(welcome.state.members.map(m => [m.id, m.name]))
    };
  }
  const [, rerender] = useReducer(n => n + 1, 0);
  const R = room.current;

  const [url, setUrl] = useState(welcome.state.url);
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [vidErr, setVidErr] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [needsTap, setNeedsTap] = useState(false);

  const [msgs, setMsgs] = useState(() => [{
    id: ++uid, sys: true, time: now(),
    text: welcome.created ? 'You created the room — you are the host' : `You joined. ${welcome.state.members.find(m => m.id === welcome.state.host)?.name || 'Someone'} is the host`
  }]);
  const [draft, setDraft] = useState('');
  const [panel, setPanelState] = useState('chat');
  const [seenCount, setSeenCount] = useState(1);
  const [tiles, setTiles] = useState('side');
  const [requests, setRequests] = useState([]);
  const [askPending, setAskPending] = useState(false);
  const [reactions, setReactions] = useState([]);
  const [reactOpen, setReactOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState(now());
  const [remoteStreams, setRemoteStreams] = useState({});

  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const chatRef = useRef(null);
  const meshRef = useRef(null);
  const timers = useRef([]);
  const seekTimer = useRef(null);
  // Last known shared playback position: { playing, time, at } where `at` is the local receive time.
  const pb = useRef({ ...welcome.playback, at: Date.now() });

  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };
  const nameOf = id => (id === meId ? 'You' : R.names.get(id) || 'Someone');
  const push = (text, sys, who) => setMsgs(m => [...m, { id: ++uid, text, sys, who, time: now() }]);
  const iControl = () => R.controller === meId;

  const applyShared = () => {
    const v = videoRef.current;
    if (!v || iControl() || v.readyState < 1) return;
    const p = pb.current;
    const target = p.time + (p.playing ? (Date.now() - p.at) / 1000 : 0);
    if (Math.abs(v.currentTime - target) > DRIFT_S) v.currentTime = target;
    if (p.playing && v.paused) v.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));
    else if (!p.playing && !v.paused) v.pause();
    if (!p.playing) setNeedsTap(false);
  };

  const share = (action, time) => {
    const v = videoRef.current;
    if (!v || !iControl()) return;
    const t = time ?? v.currentTime;
    pb.current = { playing: !v.paused, time: t, at: Date.now() };
    sock.send({ type: 'playback', playing: !v.paused, time: t, action });
  };

  const handle = msg => {
    switch (msg.type) {
      case 'joined':
        R.members.set(msg.member.id, msg.member);
        R.names.set(msg.member.id, msg.member.name);
        push(`${msg.member.name} joined`, true);
        break;
      case 'left': {
        const wasHost = R.host;
        R.members.delete(msg.id);
        R.host = msg.state.host; R.controller = msg.state.controller;
        meshRef.current?.drop(msg.id);
        setRequests(r => r.filter(x => x !== msg.id));
        push(`${nameOf(msg.id)} left`, true);
        if (wasHost !== R.host) {
          setAskPending(false);
          push(R.host === meId ? 'You are now the host' : `${nameOf(R.host)} is now the host`, true);
        }
        break;
      }
      case 'media': {
        const m = R.members.get(msg.id);
        if (m) R.members.set(msg.id, { ...m, micOn: msg.micOn, camOn: msg.camOn });
        break;
      }
      case 'chat':
        push(msg.text, false, msg.from === meId ? 'You' : msg.name);
        break;
      case 'react': {
        const id = ++uid;
        setReactions(r => [...r, { id, e: msg.emoji, who: nameOf(msg.from), x: 8 + Math.random() * 78 }]);
        later(() => setReactions(r => r.filter(x => x.id !== id)), 2700);
        break;
      }
      case 'url':
        pb.current = { playing: false, time: 0, at: Date.now() };
        setUrl(msg.url); setEditingUrl(false); setVidErr(false); setPlaying(false); setCur(0); setDur(0); setNeedsTap(false);
        push(msg.by === meId ? 'You loaded the movie for everyone' : `${nameOf(msg.by)} loaded the movie`, true);
        break;
      case 'playback':
        pb.current = { playing: msg.playing, time: msg.time, at: Date.now() };
        applyShared();
        if (msg.action === 'play') push(`${nameOf(msg.by)} played at ${fmt(msg.time)}`, true);
        else if (msg.action === 'pause') push(`${nameOf(msg.by)} paused at ${fmt(msg.time)}`, true);
        else if (msg.action === 'seek') push(`${nameOf(msg.by)} jumped to ${fmt(msg.time)}`, true);
        break;
      case 'request':
        setRequests(r => (r.includes(msg.from) ? r : [...r, msg.from]));
        break;
      case 'declined':
        setAskPending(false);
        push(`${nameOf(msg.by)} said not now`, true);
        break;
      case 'control': {
        R.host = msg.state.host; R.controller = msg.state.controller;
        setRequests(r => r.filter(x => x !== msg.to));
        if (msg.to === meId) setAskPending(false);
        if (msg.how === 'took') push(msg.by === meId ? 'You took back control' : `${nameOf(msg.by)} took back control`, true);
        else if (msg.by === meId) push(`You gave control to ${nameOf(msg.to)}`, true);
        else if (msg.to === meId) push(`${nameOf(msg.by)} gave you control`, true);
        else push(`${nameOf(msg.by)} gave control to ${nameOf(msg.to)}`, true);
        if (R.controller !== meId) applyShared();
        break;
      }
      case 'signal':
        meshRef.current?.handle(msg.from, msg.data);
        break;
    }
    rerender();
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;

  // Connect: socket handler, peer mesh, clock and the controller's sync heartbeat.
  useEffect(() => {
    const mesh = new PeerMesh({
      iceServers: welcome.iceServers,
      signal: (to, data) => sock.send({ type: 'signal', to, data }),
      onStream: (id, s) => setRemoteStreams(r => ({ ...r, [id]: s })),
      onGone: id => setRemoteStreams(r => { const n = { ...r }; delete n[id]; return n; })
    });
    meshRef.current = mesh;
    sock.listen(m => handleRef.current(m), () => { mesh.close(); onLeft('lost'); });
    for (const m of welcome.state.members) if (m.id !== meId) mesh.connect(m.id);

    const clockTimer = setInterval(() => setClock(now()), 15000);
    const beat = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused && R.controller === meId) share('sync');
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(clockTimer); clearInterval(beat); clearTimeout(seekTimer.current);
      timers.current.forEach(clearTimeout);
      mesh.close();
      sock.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { meshRef.current?.setTracks(stream); }, [stream]);
  const firstMedia = useRef(true);
  useEffect(() => {
    if (firstMedia.current) { firstMedia.current = false; return; }
    sock.send({ type: 'media', micOn, camOn });
  }, [micOn, camOn, sock]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [msgs.length, panel]);

  // ----- Actions -----
  const iAmHost = R.host === meId;
  const mine = R.controller === meId;

  const setMovie = e => {
    e?.preventDefault();
    const u = urlInput.trim(); if (!u) return;
    sock.send({ type: 'setUrl', url: u });
  };
  const useSample = () => { setUrlInput(SAMPLE); sock.send({ type: 'setUrl', url: SAMPLE }); };
  const changeUrl = () => { setUrlInput(url); setEditingUrl(true); };

  const togglePlay = () => {
    const v = videoRef.current; if (!v) return;
    if (!mine) { if (needsTap) applyShared(); return; }
    if (v.paused) v.play().catch(() => {}); else v.pause();
  };
  const onPlay = () => {
    setPlaying(true);
    if (!iControl()) return;
    push(`You played at ${fmt(videoRef.current?.currentTime)} — synced for everyone`, true);
    share('play');
  };
  const onPause = () => {
    setPlaying(false);
    if (!iControl()) return;
    push(`You paused at ${fmt(videoRef.current?.currentTime)}`, true);
    share('pause');
  };
  const seek = e => {
    if (!mine) return;
    const t = +e.target.value;
    const v = videoRef.current; if (v) v.currentTime = t;
    setCur(t);
    clearTimeout(seekTimer.current);
    seekTimer.current = setTimeout(() => { push(`You jumped to ${fmt(t)}`, true); share('seek', t); }, 250);
  };
  const fullscreen = () => {
    const el = playerRef.current, v = videoRef.current;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen();
  };

  const giveControl = id => sock.send({ type: 'giveControl', to: id });
  const answer = (id, allow) => {
    sock.send({ type: 'answerRequest', to: id, allow });
    setRequests(r => r.filter(x => x !== id));
    if (!allow) push(`You declined ${nameOf(id)}'s request`, true);
  };
  const takeBack = () => sock.send({ type: 'takeBack' });
  const askControl = () => {
    setAskPending(true);
    push(`You asked ${nameOf(R.host)} for control`, true);
    sock.send({ type: 'askControl' });
  };
  const react = e => sock.send({ type: 'react', emoji: e });

  const copyLink = () => {
    const link = location.href.split('#')[0] + '#room-' + code;
    try { navigator.clipboard.writeText(link).catch(() => {}); } catch { /* ignore */ }
    setCopied(true); later(() => setCopied(false), 1600);
  };
  const send = () => {
    const t = draft.trim(); if (!t) return;
    setDraft('');
    sock.send({ type: 'chat', text: t });
  };
  const leave = () => {
    sock.send({ type: 'leave' });
    onLeft('left');
  };
  const setPanel = p => {
    const next = panel === p ? null : p;
    if (next === 'chat' || panel === 'chat') setSeenCount(msgs.length);
    setPanelState(next);
  };
  const closePanel = () => { setPanelState(null); setSeenCount(msgs.length); };

  // ----- Derived view values -----
  const others = [...R.members.values()].filter(m => m.id !== meId);
  const role = id => [R.host === id ? 'Host' : '', R.controller === id ? 'In control' : ''].filter(Boolean).join(' · ');
  const suffix = id => (R.controller === id ? ' · in control' : R.host === id ? ' · host' : '');
  const chatOpen = panel === 'chat';
  const unread = chatOpen ? 0 : Math.max(0, msgs.length - seenCount);
  const showPaste = iAmHost && (!url || editingUrl);
  const showWaiting = !url && !iAmHost;
  const hasUrl = !!url && !showPaste;
  const showBigPlay = !vidErr && ((mine && !playing && cur === 0) || (!mine && needsTap));
  const tilesSide = tiles === 'side' && !panel;
  const count = others.length + 1;

  const tileList = (
    <>
      <div className="tile">
        {camOn && stream
          ? <SelfVideo stream={stream} className="mirror" />
          : <span className="avatar tile-avatar" style={{ background: SELF_COLOR }}>{initial}</span>}
        <span className="tile-name">You{suffix(meId)}</span>
        {!micOn && <span className="tile-muted"><MutedBadgeIcon /></span>}
      </div>
      {others.map(p => (
        <div className="tile" key={p.id}>
          {p.camOn && remoteStreams[p.id]
            ? <StreamVideo stream={remoteStreams[p.id]} />
            : <span className="avatar tile-avatar" style={{ background: p.color }}>{(p.name[0] || '?').toUpperCase()}</span>}
          <span className="tile-name">{p.name}{suffix(p.id)}</span>
          {!p.micOn && <span className="tile-muted"><MutedBadgeIcon /></span>}
        </div>
      ))}
    </>
  );

  return (
    <div className="room">
      {others.map(p => remoteStreams[p.id] && <StreamAudio key={p.id} stream={remoteStreams[p.id]} />)}
      <div className="stage">
        <div className="stage-main">
          <div className="player" ref={playerRef}>
            {showPaste && (
              <form className="paste" onSubmit={setMovie}>
                <div className="paste-kicker">You're the host</div>
                <h2>Paste a movie link to start watching.</h2>
                <div className="paste-row">
                  <input placeholder="https://…/movie.mp4" value={urlInput} onChange={e => setUrlInput(e.target.value)} />
                  <button type="submit" className="btn-light">Load for everyone</button>
                </div>
                <div className="paste-hint">
                  <span>Direct links (.mp4, .webm) work best.</span>
                  <button type="button" className="link-light" onClick={useSample}>Try a sample movie</button>
                  {editingUrl && url && <button type="button" className="link-light" onClick={() => setEditingUrl(false)}>Keep current movie</button>}
                </div>
              </form>
            )}
            {showWaiting && (
              <div className="overlay-msg">
                <h2>{nameOf(R.host)} is picking the movie</h2>
                <p>It will start here for you automatically.</p>
              </div>
            )}
            {hasUrl && (
              <>
                <video
                  key={url} ref={videoRef} className="movie" src={url} playsInline preload="auto"
                  onClick={togglePlay} onPlay={onPlay} onPause={onPause}
                  onTimeUpdate={e => setCur(e.target.currentTime)}
                  onLoadedMetadata={e => { setDur(e.target.duration || 0); applyShared(); }}
                  onError={() => setVidErr(true)}
                />
                {showBigPlay && (
                  <>
                    <button className="big-play" onClick={togglePlay} title={mine ? 'Play for everyone' : 'Start playback'}><PlayIcon size={32} /></button>
                    {!mine && <span className="big-play-label">Tap to catch up with {nameOf(R.controller)}</span>}
                  </>
                )}
                {vidErr && (
                  <div className="overlay-msg err">
                    <h3>This link can't be played</h3>
                    <p>Make sure it points straight to a video file (.mp4 or .webm), not a web page.</p>
                    {iAmHost && <button className="btn-light" onClick={changeUrl}>Try another link</button>}
                  </div>
                )}
                <div className="controls">
                  <button className="icon-btn" onClick={togglePlay} disabled={!mine} title="Play / pause">
                    {playing ? <PauseIcon /> : <PlayIcon size={20} />}
                  </button>
                  <span className="time">{fmt(cur)} / {fmt(dur)}</span>
                  <input className="scrub" type="range" min="0" max={dur || 0} step="0.1" value={cur} onChange={seek} disabled={!mine} aria-label="Seek" />
                  <span className={'chip' + (mine ? ' on' : '')}>{mine ? "You're in control" : `${nameOf(R.controller)} is in control`}</span>
                  {iAmHost && <button className="icon-btn" onClick={changeUrl} title="Change link"><LinkIcon /></button>}
                  <button className="icon-btn" onClick={fullscreen} title="Full screen"><FullscreenIcon /></button>
                </div>
              </>
            )}
            <div className="reactions">
              {reactions.map(r => (
                <div key={r.id} className="reaction" style={{ left: r.x + '%' }}>
                  <span className="reaction-emoji">{r.e}</span>
                  <span className="reaction-who">{r.who}</span>
                </div>
              ))}
            </div>
            {requests.length > 0 && (
              <div className="requests">
                {requests.map(id => {
                  const p = R.members.get(id);
                  if (!p) return null;
                  return (
                    <div className="request" key={id}>
                      <div className="request-head">
                        <span className="avatar" style={{ width: 36, height: 36, background: p.color }}>{(p.name[0] || '?').toUpperCase()}</span>
                        <span><strong>{p.name}</strong> wants to control the movie</span>
                      </div>
                      <div className="request-actions">
                        <button className="btn-ghost-light" onClick={() => answer(id, false)}>Not now</button>
                        <button className="btn-light" onClick={() => answer(id, true)}>Give control</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {!tilesSide && <div className="tiles-below">{tileList}</div>}
        </div>
        {tilesSide && <div className="tiles-side">{tileList}</div>}
        {panel && (
          <aside className="panel">
            <div className="panel-head">
              <span className="panel-title">{chatOpen ? 'In-room messages' : 'People'}</span>
              <button className="panel-close" onClick={closePanel} title="Close"><CloseIcon /></button>
            </div>
            {panel === 'people' && (
              <div className="people-list">
                <div className="people-heading">IN THE ROOM · {count}</div>
                <div className="person">
                  <span className="avatar" style={{ background: SELF_COLOR }}>{initial}</span>
                  <div className="person-body"><div className="person-name">{name} (you)</div>{role(meId) && <div className="person-role">{role(meId)}</div>}</div>
                </div>
                {others.map(p => (
                  <div className="person other" key={p.id}>
                    <span className="avatar" style={{ background: p.color }}>{(p.name[0] || '?').toUpperCase()}</span>
                    <div className="person-body"><div className="person-name">{p.name}</div>{role(p.id) && <div className="person-role">{role(p.id)}</div>}</div>
                    {iAmHost && R.controller !== p.id && <button className="btn-give" onClick={() => giveControl(p.id)}>Give control</button>}
                  </div>
                ))}
              </div>
            )}
            {chatOpen && (
              <>
                <div className="chat-note">Messages are only visible to people in the room and are deleted when it closes.</div>
                <div className="chat-log" ref={chatRef}>
                  {msgs.map(m => (m.sys
                    ? <div key={m.id} className="chat-sys">{m.text}</div>
                    : (
                      <div key={m.id} className="chat-msg">
                        <div className="chat-meta"><strong>{m.who}</strong><span>{m.time}</span></div>
                        <div className="chat-text">{m.text}</div>
                      </div>
                    )))}
                </div>
                <div className="composer-wrap">
                  <div className="composer">
                    <input placeholder="Send a message" value={draft} maxLength={2000} onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} />
                    <button onClick={send} title="Send"><SendIcon /></button>
                  </div>
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      <div className="bar">
        <div className="bar-left">
          <span>{clock}</span><span className="bar-sep" />
          <span className="bar-code">{code}</span>
          <button className="btn-copy" onClick={copyLink} title="Copy room link"><CopyIcon />{copied ? 'Copied' : 'Copy link'}</button>
        </div>
        <div className="bar-center">
          <button onClick={toggleMic} title={micOn ? 'Turn off microphone' : 'Turn on microphone'} className={'cbtn ' + (micOn ? 'hov' : 'red')}><MicIcon off={!micOn} /></button>
          <button onClick={toggleCam} title={camOn ? 'Turn off camera' : 'Turn on camera'} className={'cbtn ' + (camOn ? 'hov' : 'red')}><CamIcon off={!camOn} /></button>
          <button onClick={() => setReactOpen(!reactOpen)} title="Send a reaction" className={'cbtn' + (reactOpen ? ' on' : '')}><SmileIcon /></button>
          {!iAmHost && !mine && !askPending && <button className="pill" onClick={askControl}><HandIcon />Ask for control</button>}
          {askPending && <span className="pill-wait">Asking {nameOf(R.host)}…</span>}
          {iAmHost && !mine && <button className="pill" onClick={takeBack}>Take back control</button>}
          <button onClick={leave} title="Leave room" className="cbtn red leave"><HangUpIcon /></button>
          {reactOpen && (
            <div className="emoji-pop">
              {EMOJI.map(e => <button key={e} onClick={() => react(e)}>{e}</button>)}
            </div>
          )}
        </div>
        <div className="bar-right">
          <button onClick={() => setTiles(tiles === 'side' ? 'below' : 'side')} title={tiles === 'side' ? 'Show cameras below the movie' : 'Show cameras beside the movie'} className="cbtn ghost"><LayoutIcon /></button>
          <button onClick={() => setPanel('people')} title="People" className={'cbtn' + (panel === 'people' ? ' on' : '')}>
            <PeopleIcon />
            <span className="badge">{count}</span>
          </button>
          <button onClick={() => setPanel('chat')} title="Chat" className={'cbtn' + (chatOpen ? ' on' : '')}>
            <ChatIcon />
            {unread > 0 && <span className="badge unread">{unread}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
