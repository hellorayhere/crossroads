# Crossroads — UI/UX Revamp Task List

## 1. Status icons from uploaded images ✅
- [x] online.png / idle.png / dnd.png placed in public/img/ (status-online/idle/dnd.png)
- [x] CSS wired for avatar dots, mini status, profile pills

## 2. Auth UI revamp (less cartoony, no emojis/SVG icons) ✅
- [x] Redesign public/index.html (clean, professional)
- [x] Rewrite public/css/auth.css
- [x] Keep all element IDs so auth.js still works
- [x] Verify locally with screenshot

## 3. Navigation animation on server/DM click ✅
- [x] view-enter + navPop animations wired on server/DM/channel/friends open

## 4. DM right-click dropdown (Close, Unfriend, Block, etc.) ✅
- [x] Context menu verified (Mark As Read, Close DM, Copy User ID, Unfriend, Block)

## 5. Friends: include tag number (test#6842) ✅
- [x] Live search + tag display verified via API

## 6. Performance / lag fixes ✅
- [x] Parallel init, debounced rerenders, lazy images

## 7. Pinned messages system ✅
- [x] Pin/unpin + panel verified via API + UI

## 8. Settings fixes ✅
- [x] Language applies, desktop notifications, friend-request toggle
- [x] Remove Change Password SVG icon
- [x] Save button, single white Log Out with confirm

## 9. Profile pic/banner scale control ✅
- [x] Image editor zoom slider + drag verified

## 10. Deploy
- [ ] Commit + push to GitHub main
- [ ] Verify Render redeploy + live site
- [ ] Confirm data preserved (never wipe)
