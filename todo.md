# Round 16 — Replies, media playback, fullscreen, maintenance UI

Deploy target: https://crossroadsv2.onrender.com/app.html (repo hellorayhere/crossroads, Render service crossroadsv2).
Hard rule: never wipe/delete data. Additive changes only. Do not touch DATA_DIR / GH_DATA_REPO / GH_DATA_TOKEN.

## 1. Reply to another user (E2E leak)
- [x] Reply preview must never show the raw `\u0001E2E1:{...}` envelope (server returns encrypted:true, content:null)
- [x] Decrypt `reply_to` and repaint the reply reference in place (socket + history + optimistic send)
- [x] Reply bar shows plaintext / "Encrypted message", never ciphertext
- [x] Notification + desktop-notification previews never show ciphertext

## 2. Remove "Decrypting…"
- [x] Replace the word with a neutral skeleton placeholder that resolves in place
- [x] Sender sees their own message instantly (optimistic append, dedupe vs socket echo)

## 3. Media / video playback bug + delay
- [x] Video player always has a clickable poster area before metadata loads
- [x] Play() retries on canplay / muted fallback; never silently fails
- [x] Availability retry no longer resets src mid-playback (was stalling playback)
- [x] Server: async upload backup (no event-loop freeze on big files)
- [x] Server: derive file extension from MIME when the name has none + long-lived cache headers

## 4. Fullscreen blown out of proportion
- [x] Split vendor fullscreen selectors into separate rules (invalid selector was dropping the whole rule)
- [x] Enforce object-fit: contain + centred layout for wrapper and element fullscreen
- [x] Same for lightbox video and embed video

## 5. Maintenance UI revamp
- [x] Polished maintenance card (icon, title, message, status, dismiss, animation)
- [x] Auto-dismiss when maintenance ends (poll)

## 6. Verify & deploy
- [x] Local smoke test (reply, video, fullscreen, maintenance)
- [ ] Commit + push to main
- [ ] Render deploy + verify live, data preserved
