import { useCallback, useEffect, useRef, useState } from 'react';
import { connectRoom } from './connection.js';
import Room from './Room.jsx';
import { SelfVideo } from './media.jsx';
import { CamIcon, LinkIcon, MicIcon, PlayIcon } from './icons.jsx';

const roomFromHash = () => ((location.hash || '').match(/room-([a-z0-9-]+)/i) || [])[1]?.toLowerCase() || '';
const setHash = h => { try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch { /* ignore */ } };
const newCode = () => {
  const a = 'abcdefghjkmnpqrstuvwxyz';
  const p = n => Array.from({ length: n }, () => a[Math.floor(Math.random() * a.length)]).join('');
  return `${p(3)}-${p(4)}-${p(3)}`;
};
const JOIN_ERRORS = {
  full: 'This room is full — up to 4 people can watch together.',
  network: "Couldn't reach the room. Check your connection and try again.",
  'bad-code': "That room link doesn't look right."
};

function Brand({ note }) {
  return (
    <header className="brand">
      <div className="brand-mark"><PlayIcon /></div>
      <span className="brand-name">Sofa</span>
      {note && <span className="brand-note">{note}</span>}
    </header>
  );
}

export default function App() {
  const initialCode = roomFromHash();
  const [screen, setScreen] = useState(initialCode ? 'join' : 'home');
  const [code, setCode] = useState(initialCode);
  const [isCreator, setIsCreator] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinErr, setJoinErr] = useState('');
  const [endReason, setEndReason] = useState('left');
  const [session, setSession] = useState(null);

  // Local camera/mic, shared by the join preview and the room.
  const [stream, setStream] = useState(null);
  const streamRef = useRef(null);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [camErr, setCamErr] = useState('');

  useEffect(() => {
    const onHash = () => {
      const c = roomFromHash();
      if (c && screen === 'home') { setCode(c); setIsCreator(false); setScreen('join'); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [screen]);

  const ensureStream = async () => {
    if (streamRef.current) return streamRef.current;
    let s;
    try { s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
    catch {
      try { s = await navigator.mediaDevices.getUserMedia({ video: true }); }
      catch { setCamErr('Camera blocked by the browser — you can still join and watch.'); return null; }
    }
    s.getTracks().forEach(t => { t.enabled = false; });
    streamRef.current = s;
    setStream(s);
    return s;
  };
  const toggleCam = async () => {
    const s = camOn ? streamRef.current : await ensureStream();
    if (!s) return;
    s.getVideoTracks().forEach(t => { t.enabled = !camOn; });
    setCamOn(!camOn); setCamErr('');
  };
  const toggleMic = async () => {
    const s = micOn ? streamRef.current : await ensureStream();
    if (!s) return;
    const tracks = s.getAudioTracks();
    if (!tracks.length) { setCamErr('No microphone available.'); return; }
    tracks.forEach(t => { t.enabled = !micOn; });
    setMicOn(!micOn); setCamErr('');
  };
  const stopMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setStream(null); setCamOn(false); setMicOn(false);
  }, []);
  useEffect(() => stopMedia, [stopMedia]);

  const create = () => { const c = newCode(); setHash('room-' + c); setCode(c); setIsCreator(true); setJoinErr(''); setScreen('join'); };
  const joinExisting = () => {
    const raw = joinCode.trim(); if (!raw) return;
    const m = raw.match(/room-([a-z0-9-]+)/i) || raw.match(/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
    const c = (m ? m[1] : raw).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!c) return;
    setHash('room-' + c); setCode(c); setJoinCode(''); setIsCreator(false); setJoinErr(''); setScreen('join');
  };
  const goHome = () => { setHash(''); setScreen('home'); };

  const enter = async () => {
    if (joining) return;
    setJoining(true); setJoinErr('');
    try {
      const s = await connectRoom({ code, name: name.trim() || 'Guest', micOn, camOn });
      setSession(s);
      setScreen('room');
    } catch (err) {
      setJoinErr(JOIN_ERRORS[err.message] || JOIN_ERRORS.network);
    } finally {
      setJoining(false);
    }
  };
  const onLeft = useCallback(reason => {
    stopMedia();
    setSession(null);
    setEndReason(reason);
    setScreen('ended');
  }, [stopMedia]);
  const rejoin = () => { setHash('room-' + code); setJoinErr(''); setScreen('join'); };

  const displayName = name.trim() || 'Guest';
  const initial = displayName[0].toUpperCase();

  if (screen === 'room' && session) {
    return (
      <Room
        session={session} code={code} name={displayName} initial={initial}
        stream={stream} camOn={camOn} micOn={micOn} toggleCam={toggleCam} toggleMic={toggleMic}
        onLeft={onLeft}
      />
    );
  }

  if (screen === 'join') {
    return (
      <div className="page">
        <Brand />
        <main className="join-main">
          <div className="preview">
            {camOn
              ? <SelfVideo stream={stream} className="self-video" />
              : <div className="preview-off"><span className="preview-avatar">{initial}</span><span>Camera is off</span></div>}
            <div className="preview-controls">
              <button onClick={toggleMic} title={micOn ? 'Turn off microphone' : 'Turn on microphone'} className={micOn ? 'round-ghost' : 'round-red'}><MicIcon size={22} off={!micOn} /></button>
              <button onClick={toggleCam} title={camOn ? 'Turn off camera' : 'Turn on camera'} className={camOn ? 'round-ghost' : 'round-red'}><CamIcon size={22} off={!camOn} /></button>
            </div>
          </div>
          <div className="join-form">
            <div>
              <div className="join-kicker">{isCreator ? 'Your new room is ready' : "You've been invited"}</div>
              <h1>Ready to join?</h1>
              <div className="join-room">Room <b>{code}</b></div>
            </div>
            <input className="name-input" placeholder="Your name" value={name} maxLength={40} autoFocus
              onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enter(); }} />
            <button className="btn-primary" onClick={enter} disabled={joining}>{joining ? 'Joining…' : 'Join now'}</button>
            {camErr && <p className="error">{camErr}</p>}
            {joinErr && <p className="error">{joinErr}</p>}
            <p className="fine">Camera and mic are optional. Nothing is recorded or saved.</p>
          </div>
        </main>
      </div>
    );
  }

  if (screen === 'ended') {
    return (
      <div className="ended">
        <h1>{endReason === 'lost' ? 'You were disconnected' : 'You left the room'}</h1>
        <div className="ended-actions">
          <button className="btn-outline" onClick={rejoin}>Rejoin</button>
          <button className="btn-primary" onClick={goHome}>Return to home</button>
        </div>
        <p className="fine">Nothing was saved — chat, movie link and camera are cleared.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <Brand note="No account needed" />
      <main className="home-main">
        <div className="home-copy">
          <h1>Movie night, together — wherever you are.</h1>
          <p className="home-lede">Create a room, share the link and paste any video URL. Watch in sync, chat, and see each other.</p>
          <div className="home-actions">
            <button className="btn-primary" onClick={create}><CamIcon size={18} />New room</button>
            <div className="join-row">
              <div className="join-field">
                <LinkIcon stroke="#5c6068" />
                <input placeholder="Enter a code or link" value={joinCode} onChange={e => setJoinCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') joinExisting(); }} />
              </div>
              <button className="btn-text" onClick={joinExisting} disabled={!joinCode.trim()}>Join</button>
            </div>
          </div>
          <div className="rule" />
          <p className="fine">Nothing is saved — rooms and chats disappear when everyone leaves. <span title="App version">· build {__BUILD__}</span></p>
        </div>
        <div className="steps">
          {[
            ['Create a room', 'You get a private link to send to friends.'],
            ['Paste a movie link', 'Any direct video URL — like opening a network stream. No uploads.'],
            ['Watch, chat, see faces', 'The host controls playback and can hand it over.']
          ].map(([title, text], i) => (
            <div className="step" key={title}>
              <span className="step-num">{i + 1}</span>
              <div><div className="step-title">{title}</div><div className="step-text">{text}</div></div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
