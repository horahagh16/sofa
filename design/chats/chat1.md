# Shared movie watching platform

_Started 2026-10-20 14:59 UTC_

---

## User

i want a simple and user friendly site for watching a movie together. every one can create a room with an individual link and in each link they can paste the movie URL, chat to each other and share their video to see each other face-to-face. there is no need to upload the movie i want something like Oplayer Lite Play URL or VLC open network stream. at the end nothing should be save. ask me if something is not clear.

## Assistant



## User

Answered — Asked for follow-up questions; screens: Home (create room), Join screen (enter name, camera check), Room (movie + chat + cams), Room — mobile layout, Room ended / left screen; control: Host by default, can hand over control; url_change: Host only; cams_layout: Let me switch between layouts; room_size: 2–4; chat_extras: Emoji reactions over the video, Join/leave notices; identity: Just type a name; ephemeral: Subtle footnote only; fidelity: Clickable flow with fake chat, cams and player; variations: 2 layouts

## Assistant



## Assistant

_[tool: ask_user]_

_[tool: list_files]_

_[tool: grep]_

_[tool: read_file]_

_[tool: dc_write]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

_[tool: ask_user]_

_[tool: ask_user]_

I've added a few more questions to the form: how control gets handed over, which two room layouts to compare, and which emoji reactions to offer. Once you answer them, I'll update the prototype with everything from the first round as well.

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

## User

Found issues — fixing…

## Assistant

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

## User

Answered — handover: Both; two_layouts: Theater (big movie, collapsible chat) vs. split (movie + chat side by side); reactions: 4–6 fixed emoji

## Assistant

_[tool: read_file]_

_[tool: dc_write]_

_[tool: ready_for_verification]_

## User

Found issues — fixing…

## Assistant

_[tool: run_script]_

_[tool: ready_for_verification]_

## User

Found issues — fixing…

## Assistant

_[tool: run_script]_

_[tool: grep]_

_[tool: str_replace_edit]_

_[tool: ready_for_verification]_

## User

Found issues — fixing…

## Assistant

_[tool: dc_write]_

_[tool: ready_for_verification]_

## User

change the design system to something like Google meet

## Assistant

_[tool: dc_write]_

_[tool: ready_for_verification]_

## User

Found issues — fixing…

## Assistant

_[tool: run_script]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

## User

now how can Claude implement this and deploy it on its own hosts?

## Assistant

I can't host or deploy anything from here. What I've built is a clickable design prototype, and the friends, their cameras and their chat replies are faked in the browser. Turning it into a real site takes these steps:

**What a real version needs**
1. **The front end.** This design rebuilt as a small web app, for example React or plain JS.
2. **A live connection for each room.** This passes chat messages, play/pause/seek, control handovers and join/leave events between everyone in the room. Keeping all of it only in memory gives you "nothing saved", because the room is gone when the last person leaves.
3. **Face-to-face video.** Use WebRTC, either directly between browsers for 2–4 people or through a hosted service such as LiveKit or Daily. You'll also need a relay server (called a TURN server) for people whose networks block direct connections.
4. **Playback.** Everyone's browser loads the same movie URL. Only the play/pause/seek commands are shared, so no movie is uploaded.

**Simple hosting options**
- Front end: Vercel, Netlify or Cloudflare Pages (free tiers).
- Room connections: Cloudflare Durable Objects, PartyKit, or a small Node server on Fly.io or Render.
- Video: LiveKit Cloud or Daily, which handle the relay for you.

**Known limit:** Many movie links won't play in a browser. Pages like YouTube, links that block other sites, and DRM-protected streams don't work; only direct .mp4/.webm (and sometimes .m3u8) links do.

**Next step:** I can create a handoff package for Claude Code, a coding tool that can write the real app and help you deploy it to your own Vercel or Cloudflare account. The package would include the design, the screen states and a build spec covering the room server, video and sync. Want me to make it?

