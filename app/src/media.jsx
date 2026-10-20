import { useEffect, useRef } from 'react';

function useSrcObject(stream) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  return ref;
}

export function SelfVideo({ stream, className }) {
  return <video ref={useSrcObject(stream)} className={className} autoPlay muted playsInline />;
}

// Remote video stays muted; each peer's sound plays through StreamAudio so it keeps going when their camera is off.
export function StreamVideo({ stream }) {
  return <video ref={useSrcObject(stream)} autoPlay muted playsInline />;
}

export function StreamAudio({ stream }) {
  return <audio ref={useSrcObject(stream)} autoPlay />;
}
