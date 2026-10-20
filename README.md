# Sofa

Watch a movie together. Create a room, share the link, and paste a direct video URL. Everyone's player stays in sync, and you can chat, send emoji reactions and see each other on camera. Nothing is saved: rooms and chats disappear when everyone leaves.

- `app/`: the app, a React front end plus a Node WebSocket server. See [`app/README.md`](app/README.md) for how it works, how to run it locally, and TURN setup.
- `render.yaml`: the Render Blueprint. In Render, go to **New → Blueprint** and pick this repo.
- `design/`: the original Claude Design prototypes and chat transcript.

## Quick start

```bash
cd app
npm install
npm run build && npm start   # http://localhost:8787
```
