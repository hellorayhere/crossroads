# Crossroads — current round

## A. Spoiler actually works
- [x] Root cause: `sendMessage()` never put `attachment_spoiler` / `attachment_description` into the payload, so the server always stored `0`
- [x] Add both fields to the outgoing payload
- [x] Harden render: blur description/size/file-card too, block lightbox clicks before reveal, keyboard (Enter/Space) reveal, focus ring, `revealed` hides overlay
- [x] Verified live in browser: hidden state blurs image + description, click reveals, no lightbox opens

## B. Remove profile banner image/GIF
- [x] Account tab banner editor: added red "Remove" button, auto-hides when no banner is set, marks settings dirty
- [x] Own profile hero: added "Remove" button that clears `banner_url` immediately and repaints
- [x] Verified in browser: both buttons appear only with a banner and clear it correctly

## C. Ship
- [ ] Commit + push
- [ ] Deploy + poll until live
- [ ] Verify live assets
