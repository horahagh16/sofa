// Full-mesh WebRTC for 2–4 people. The newcomer offers to everyone already in the room;
// each connection carries one audio and one video transceiver from the start, so turning
// the camera or mic on later only swaps tracks (replaceTrack) and never renegotiates.

export class PeerMesh {
  constructor({ iceServers, signal, onStream, onGone }) {
    this.iceServers = iceServers;
    this.signal = signal;
    this.onStream = onStream;
    this.onGone = onGone;
    this.peers = new Map();
    this.tracks = { audio: null, video: null };
  }

  create(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { pc, initiator, pending: [], stream: new MediaStream() };
    this.peers.set(id, peer);
    pc.onicecandidate = e => { if (e.candidate) this.signal(id, { candidate: e.candidate }); };
    pc.ontrack = e => {
      if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
      this.onStream(id, peer.stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && initiator) pc.restartIce();
    };
    if (initiator) {
      for (const kind of ['audio', 'video']) pc.addTransceiver(this.tracks[kind] || kind, { direction: 'sendrecv' });
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription();
          this.signal(id, { description: pc.localDescription });
        } catch (err) { console.warn('offer failed', err); }
      };
    }
    return peer;
  }

  connect(id) { if (!this.peers.has(id)) this.create(id, true); }

  async handle(from, data) {
    const peer = this.peers.get(from) || this.create(from, false);
    const { pc } = peer;
    try {
      if (data.description) {
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          for (const t of pc.getTransceivers()) {
            const kind = t.receiver.track.kind;
            t.direction = 'sendrecv';
            await t.sender.replaceTrack(this.tracks[kind]);
          }
          await pc.setLocalDescription();
          this.signal(from, { description: pc.localDescription });
        }
        for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.pending.push(data.candidate);
      }
    } catch (err) {
      console.warn('signal failed', err);
    }
  }

  setTracks(stream) {
    this.tracks = { audio: stream?.getAudioTracks()[0] || null, video: stream?.getVideoTracks()[0] || null };
    for (const { pc } of this.peers.values()) {
      for (const t of pc.getTransceivers()) {
        const kind = t.receiver.track.kind;
        if (t.sender.track !== this.tracks[kind]) t.sender.replaceTrack(this.tracks[kind]).catch(() => {});
      }
    }
  }

  drop(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(id);
    this.onGone(id);
  }

  close() { for (const id of [...this.peers.keys()]) this.drop(id); }
}
