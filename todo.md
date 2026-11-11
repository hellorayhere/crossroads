# Crossroads — Round 8 Task List

## 1. Presence status not updating (reported bug)
- [x] REST responses now return the *effective* status (offline/idle override) instead of the stored status
- [x] `/api/me` still returns the status the user actually chose
- [x] Users with no live socket now report `offline` everywhere
- [x] Replace the single long `setTimeout` (throttled/frozen in hidden tabs) with a 10s timestamp tick
- [x] Idle clears itself when activity resumes, even if an event was missed
- [x] Re-assert presence after reconnect and once a minute

## 2. Remove toast UIs from uploads / edits / media
- [x] Composer upload now shows inline progress in the attachment bar (no toast)
- [x] Remove "Message edited" toast
- [x] Remove avatar / banner / server icon / server banner "ready — remember to save" toasts

## 3. Settings Discard / Save system
- [x] Footer gets Discard + Save Changes buttons, disabled until something changes
- [x] "Unsaved changes" indicator
- [x] Discard reverts fields and pending uploads to the saved profile

## 4. Embed all toast UIs
- [x] Toasts anchored bottom-right inside the app shell, flat surface, hairline border, no drop shadow
- [x] Mobile full-width variant

## 5. Test & deploy
- [x] Verified presence via socket + REST (online / idle / offline / disconnect)
- [x] Verified presence timers in a real browser (idle, away >3 min, return)
- [x] Verified settings footer + discard behaviour
- [x] Verified inline upload progress and toast styling
- [ ] Commit + push to main
- [ ] Render deploy + verify live, data preserved
