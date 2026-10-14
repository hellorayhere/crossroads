# Crossroads — Round 4 Task List

## 0. Recon & local setup
- [x] Clone crossroads + crossroads-data repos
- [x] Read auth flow, app.js, server.js, db.js, CSS
- [x] Set up local instance (DB copy + npm install + run)
- [x] Identify "shiny part" = blue glow (box-shadow) on .rail-item.active

## 1. Fix sign-in flash bug
- [x] Add synchronous redirect in index.html <head> when token exists (no auth-page flash)

## 2. Fix bottom-left user panel popup bug
- [x] Exclude .mini-profile / #user-panel-me from global click-to-close handler

## 3. Remove "shiny part" on servers
- [x] Remove .rail-item.active box-shadow glow (both rules)

## 4. Video embed redesign
- [x] Sent video shows thumbnail + centered play button (per screenshot 1)
- [x] Clicking play shows custom player w/ controls (per screenshot 2)
- [x] CSS for video player

## 5. Channel reordering (server owners/admins)
- [x] Server: endpoint to persist channel order (PATCH /api/servers/:id/channels/order)
- [x] Client: drag up/down reordering UI + context menu move up/down
- [x] Socket sync to everyone (channels_update already wired)

## 6. Search system
- [x] Server: search endpoint (messages in channel/server/DMs)
- [x] Client: search UI (replace "Search is not available yet")

## 7. Voice channels
- [x] Server: voice signaling over socket.io (join/leave/state/webrtc relay)
- [x] Client: voice channel join UI, mute/unmute/deafen, smooth layout

## 8. Test & deploy
- [ ] Test locally (all features)
- [ ] Commit + push to GitHub (hellorayhere/crossroads)
- [ ] Trigger Render deploy + confirm live, data preserved
