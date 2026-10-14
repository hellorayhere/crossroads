# Crossroads — Data Persistence + Favicon

## Problem
- Render service `crossroadsv2` is on the FREE plan → NO persistent disk → filesystem is
  EPHEMERAL. Every deploy/restart wipes `data/crossroads.db` and `uploads/`.
- That is why users "keep" and "test" no longer exist.
- Render disks require payment info (API: "Payment information is required").

## Solution: free durable persistence via a private GitHub repo
- [x] Add persist.js: restore DB+uploads on boot, backup on interval + SIGTERM
- [x] db.js: restore from remote BEFORE opening the DB (sync child process)
- [x] server.js: start auto-backup + back up new uploads
- [x] Verify GitHub token works (repo scope)
- [x] Create private repo `hellorayhere/crossroads-data`
- [x] Commit + push code changes (persist.js, db.js, server.js, favicon, html)
- [x] Set Render env vars (GH_DATA_TOKEN, GH_DATA_REPO, GH_DATA_BRANCH, JWT_SECRET)
- [x] Deploy / trigger redeploy (dep-db7emf5g1s2s73a8gvh0 @ cd8eb66)
- [ ] Confirm boot logs show durable storage active + restore

## Favicon
- [x] Convert uploaded image to favicon.png / favicon.ico / apple-touch-icon.png
- [x] Update index.html + app.html <link rel="icon">
- [ ] Verify served on live site after deploy

## Preserve users "keep" and "test"
- [ ] Create them after deploy
- [ ] Trigger a redeploy and confirm they SURVIVE (proves persistence works)
