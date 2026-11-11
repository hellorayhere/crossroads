# Crossroads — Round 9 Task List

## 1. Pings / mentions / DMs: no toast, red Discord-style badges
- [x] Remove the toast when a DM arrives
- [x] Remove the toast when a mention or reply arrives
- [x] Add red unread counter on DM rows (`.unread-badge`)
- [x] Add red unread counter on channel rows for @mentions / replies
- [x] Add red aggregate badge on the server rail icon
- [x] Opening the DM / channel / notification clears its badge immediately

## 2. Settings: Save Changes no longer stuck disabled
- [x] Toggles (privacy / appearance / notifications / voice) now stage changes instead of silently PATCHing
- [x] Theme + background cards stage changes and preview live
- [x] Language + input volume stage changes
- [x] Footer Discard / Save Changes enable as soon as any option is clicked
- [x] "Unsaved changes" note appears with the buttons
- [x] Removed the duplicate inline Save buttons in Account and Profiles panels
- [x] Per-panel save routine is reset when switching sections (no stale saver)
- [x] Save writes profile + all staged preferences in one pass
- [x] Discard rolls preferences back to the snapshot taken when settings opened

## 3. Save / Discard popup when changing options
- [x] Switching sections while dirty shows the Save / Discard / Cancel dialog
- [x] Closing the modal or logging out while dirty shows the same dialog
- [x] Dialog Save persists then continues, Discard reverts then continues

## 4. Create a Server UI: more detail, less cartoony
- [x] Live preview card shows name, type, description and icon
- [x] Section headers (Basics / Style) for structure
- [x] Type buttons now carry icons and a description hint
- [x] Footer privacy hint ("Only people you invite can join")

## 5. Remove all toast UIs
- [x] `toast()` now renders an embedded `.notice` strip inside the chat column
- [x] Removed `#toast-wrap` markup and all toast CSS
- [x] Notices are flat, shadowless, dismissible and auto-expire

## 6. Test & deploy
- [x] Badges appear on DM + channel + rail, and clear when opened
- [x] Settings footer enables on option click; Save persists; Discard reverts
- [x] Unsaved dialog appears on section switch
- [x] Create a Server modal renders with icons, hints and live preview
- [x] Inline notice is `position: static`, no shadow, inside `#inline-notices`
- [x] Commit + push to main
- [x] Render deploy + verify live, data preserved
