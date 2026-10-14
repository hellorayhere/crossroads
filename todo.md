# Crossroads — Data Persistence + Favicon  ✅ DONE

## Problem
- Render service `crossroadsv2` is on the FREE plan → NO persistent disk → filesystem is
  EPHEMERAL. Every deploy/restart wipes `data/crossroads.db` and `uploads/`.
- That is why users "keep" and "test" no longer existed.
- Render disks require payment info (API: "Payment information is required").

## Solution: free durable persistence via a private GitHub repo
- [x] Add persist.js: restore DB+uploads on boot, backup on interval + SIGTERM
- [x] db.js: restore from remote BEFORE opening the DB (sync child process)
- [x] server.js: start auto-backup + back up new uploads
- [x] Verify GitHub token works (repo scope)
- [x] Create private repo `hellorayhere/crossroads-data`
- [x] Commit + push code changes (persist.js, db.js, server.js, favicon, html)
- [x] Set Render env vars (GH_DATA_TOKEN, GH_DATA_REPO, GH_DATA_BRANCH, JWT_SECRET)
- [x] Deploy / trigger redeploy (live @ 0c9f9b0)
- [x] Confirm durable storage active (DB pushed to data repo every 20s on change)
- [x] Harden: skip no-op DB backups via SHA-256 hash (no repo bloat)

## Favicon
- [x] Convert uploaded image to favicon.png / favicon.ico / apple-touch-icon.png
- [x] Update index.html + app.html <link rel="icon">
- [x] Verify served on live site (image/png 192x192, image/x-icon multi-size)

## Preserve users "keep" and "test"
- [x] Created keep#2198 and test#2485
- [x] Triggered TWO redeploys → both users SURVIVED (proves persistence works)
- [x] Confirmed present in durable store db/crossroads.db
