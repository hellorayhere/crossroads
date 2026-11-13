# Round 18 — UI/UX overhaul (additive only, no data loss)

## Core fixes
- [x] GIF avatars animate only on message hover / profile click
- [x] Space server rail icons when user has >1 server
- [x] Admin Console "CR" icon -> favicon image
- [x] Site-wide lag/delay reductions (batched GIF poster observer, waiter map)
- [x] Revamp Appearance -> Scale UI (grouped controls, 3x3 alignment pad, slider fill)
- [x] Custom Status inline beside avatar/name (Discord-style)
- [x] Server banner taller (340 -> 440px)
- [x] Upload options: spoiler + description tools
- [x] Notifications use live avatars/GIFs in real time
- [x] Admin "Manage": new tab with platform controls, live broadcast, storage health, bulk maintenance
- [x] Maintenance UI: remove ONLY the "Live" pill
- [x] GIF support for server icons/banners (50 MB)
- [x] Profile avatar/GIF click -> zoom
- [x] Emoji board: all 1724 emojis across 9 categories
- [x] Fix aspect-ratio distortion for all images/GIFs (flex-shrink squash + lightbox clamp)

## Ship
- [ ] Commit + push to main
- [ ] Trigger Render deploy + verify live
