# Sofa — watch a movie together

This is the working version of the `Watch Together v3` design in `../project/`. Each room has its own link. In the room, the host pastes a direct video URL and everyone's player stays in sync. People can chat, send emoji reactions and see each other on camera. Nothing is stored anywhere: a room and its chat exist only in the server's memory and disappear when the last person leaves.

## How it works

- **Front end** (`src/`): React and Vite. It covers the four screens from the design: Home, Join, Room and Left.
- **Room server** (`server/index.js`): a single Node process. It serves the built front end and runs a WebSocket at `/ws`. The WebSocket passes along chat, reactions, play/pause/seek, control handovers, join and leave events, and WebRTC signalling. The first person into a room becomes the host. If the host leaves, the next person in the room takes over. A room holds at most 4 people.
- **Cameras and mics**: peer-to-peer WebRTC, with every person connected directly to every other person. Video and audio go straight between browsers and never reach the server.
- **Movie source**: the host either shares a direct link, or picks **Play a file from this computer**. With a file, only its name is shared and everyone opens their own copy, the way you would in VLC. Anyone can also switch to **their own copy** at any time (a file or a personal link), for example when the shared link is blocked on their network. Files never leave the browser.
- **Playback**: each browser loads the movie URL itself. Only the person in control sends play, pause and seek, plus a sync heartbeat every 4 seconds. The other players correct themselves when they drift more than 0.75 seconds. If a browser blocks autoplay, the viewer sees a "Tap to catch up" button.

## Run locally

```bash
npm install
npm run build && npm start       # http://localhost:8787
# or, while developing:
npm run dev                      # Vite on :5173, proxies /ws to the server on :8787
```

## Deploy

The app is one Node process that needs WebSocket support. It runs on any host that can run Node or a Docker container, such as Render, Fly.io or Railway. Serverless hosts like Vercel can't keep the WebSocket open, so they won't work.

- **Render**: create a new Web Service from this repo, set *Root Directory* to `app`, use the build command `npm install && npm run build` and the start command `npm start`.
- **Fly.io**: run `cd app && fly launch`. It uses the included `Dockerfile` and listens on `PORT` (8787 by default).

Run a **single instance**, because rooms live in that process's memory.

Browsers only allow camera access on HTTPS or `localhost`. The hosts above provide HTTPS automatically.

### TURN server (recommended)

STUN alone connects most home networks. Some people sit behind strict firewalls or mobile carrier networks, and their cameras will only connect through a TURN relay. You can get one from a provider such as Cloudflare Calls TURN, Metered or Twilio, or run your own coturn server. Then set:

```
TURN_URL=turn:turn.example.com:3478,turns:turn.example.com:5349
TURN_USERNAME=...
TURN_CREDENTIAL=...
```

## Known limits

- The movie link must point directly to a video file the browser can play: `.mp4`, `.webm`, `.mkv`, or `.m3u8` in Safari. YouTube pages, links from sites that block other sites from using them, and DRM-protected streams won't play.
- `.mkv` is a container, so whether a file plays depends on what's inside it:
  - **Plays in Chrome and Edge:** H.264, VP9 or AV1 video with AAC, Opus or MP3 audio. Safari can't open `.mkv` at all.
  - **HEVC (H.265) video:** most browsers play the sound with a black picture. The app detects this and says so.
  - **AC3 or DTS audio** (common in movie rips): the video plays silently. The app shows a "No sound?" notice.
  - To fix a file, convert it once with `ffmpeg -i in.mkv -c:v copy -c:a aac out.mp4`. If the video is HEVC, use `-c:v libx264` instead of `-c:v copy`.
- The full-mesh video setup works well for 2–4 people, which is why rooms are capped at 4.
