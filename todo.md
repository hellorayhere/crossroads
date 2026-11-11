# Crossroads — Round 7 Task List

## 1. User banner "split in half" fix
- [x] Fix `.oprofile-banner` background shorthand resetting background-size to auto/repeat
- [x] Fix `.mini-banner` same shorthand bug
- [x] Ensure banner always renders the whole uploaded image as one piece (cover, no-repeat, center)

## 2. Presence logic
- [x] Tab hidden for 3 minutes -> show offline; return restores chosen status
- [x] Idle (no activity) -> show idle; activity restores chosen status
- [x] Server: transient presence override (in-memory, not persisted) + set_presence socket event
- [x] Client: visibilitychange + idle timers, chosen-status tracking

## 3. Server sidebar banner taller
- [x] Increase `.sidebar-banner` height

## 4. Remove "deleted" breadcrumb/toast UI
- [x] Remove the "Message deleted" toast on message delete

## 5. De-cartoon / embed UIs
- [x] Tone down heavy rounding, gradients and floaty shadows so panels feel embedded

## 6. Create a Server modal redesign
- [x] More detail (description, visibility, preview) + flatter, embedded styling

## 7. Edit Message
- [x] Server: PATCH /api/messages/:id (author only, sets edited_at, broadcasts message_updated)
- [x] Client: "Edit Message" in 3-dot menu + inline edit UI + edited indicator

## 8. Delete Server verification
- [x] Require typing the server name before delete (owner-only already enforced server-side)

## 9. First-load flash fix
- [x] Inline auth redirect before paint when no token
- [x] Boot gate overlay until init() resolves; redirect on invalid token

## 10. Test & deploy
- [x] Test locally on isolated data (port 3210)
- [x] Commit + push to main
- [x] Render deploy + verify live, data preserved
