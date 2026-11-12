# Crossroads — Round 11 Task List

Goal: stop the Render free instance from sleeping, so visitors never hit the
"incoming HTTP request" cold start, and make a cold start graceful if it happens.

## 1. Server: health endpoint
- [x] `GET /health` returns tiny JSON (ok, uptime, ts) with `Cache-Control: no-store`
- [x] `GET /ping` returns plain `pong`
- [x] Both touch no database and need no auth, so polling is cheap

## 2. Server: in-process self keep-alive
- [x] Self-ping the service's own public URL every 10 minutes (configurable)
- [x] Auto-detects `RENDER_EXTERNAL_URL`; `KEEPALIVE_URL` overrides it
- [x] `KEEPALIVE_DISABLED=1` turns it off for local development
- [x] Aborts slow requests, logs failures, never crashes the process
- [x] Timers are `unref`'d so they never block shutdown

## 3. External keep-alive (optional backup)
- [x] `ops/github-keepalive.yml` ready to copy to `.github/workflows/keepalive.yml`
- [x] Pings `/health` every 10 minutes with 5 retries so a sleeping instance wakes
- [x] `workflow_dispatch` for manual runs
- [x] Documented that any free monitor (cron-job.org / UptimeRobot) works too
- [ ] Enable it with a token that has the `workflow` scope (current PAT cannot
      push workflow files, so the server-side self-ping is the active mechanism)

## 4. Client: graceful cold start
- [x] `api()` supports `retries` with backoff for network errors and 502/503/504
- [x] Boot calls (`/api/me`, settings, servers, DMs, friends, notifications) retry
- [x] After 4s the boot gate says "Waking up the server… this can take up to a minute."
- [x] If the instance never answers, the page reloads instead of dumping the user on login
- [x] Landing page fires `/health` on load so the instance wakes while the user types

## 5. Test & deploy
- [x] `/health` and `/ping` return 200 locally
- [x] Self-ping fires on schedule; failure path logs and continues
- [x] Retry logic recovers from simulated 503s (2 retries, ~3.6s)
- [x] Wake hint text/class toggles correctly
- [x] App still boots normally with the new `api()` signature
- [x] Commit + push to main
- [x] Render deploy + verify live, data preserved

## Round 11b — observable keep-alive stats
- [x] Add `keepAliveStats` counters to `server.js`
- [x] Expose `keepAlive` object on `/health` (enabled, intervalSeconds, selfPings, selfPingFails, lastSelfPingAt, lastSelfPingStatus)
- [x] Verify locally: `selfPings: 1`, `lastSelfPingStatus: 200`
- [x] Commit, push, redeploy to Render, verify in production

---

# Crossroads — Round 12 Task List

Goal: the 15 requested UI/UX, security and feature updates, deployed to
https://crossroadsv2.onrender.com/app.html **without wiping any data**
(additive DB migrations only; never touch DATA_DIR / GH_DATA_REPO / GH_DATA_TOKEN).

## 1. Two-Step reset custom UI
- [x] Dedicated modal (not generic promptDialog) for "Reset your two-step code?"
- [x] Requires the account password (server already verifies via bcrypt)
- [x] Invalidates the previous code/secret (server regenerates secret, disables 2FA)

## 2. Server banner longer
- [x] Increase `.ss-banner` height in app.css

## 3. Server Overview scale tools
- [x] Banner zoom + position (x/y) controls in Overview tab
- [x] Persist `banner_scale` / `banner_position` (additive DB columns + PATCH)

## 4. Banner Color bug
- [x] Make Banner Color actually apply everywhere it should

## 5. Avatar/banner flash fix
- [x] Remove blurple fallback flash + lazy-load delay

## 6. E2E hardening
- [x] Stronger key derivation/binding without breaking existing messages

## 7. Copy usernames + server ID
- [x] Click display/username to copy
- [x] Copy Server ID option in server rail context menu

## 8. Uploads
- [x] Remove file-type block ("not allowed for security reasons")
- [x] Raise limit to 250 MB (server + client hints)

## 9. Close DM toast
- [x] Close DM only dismisses the "Conversation closed" toast UI

## 10. Username cooldown
- [x] 24h cooldown after a username change (DB column + server + UI countdown)

## 11. Profiles revamp
- [x] Full revamp of Profiles settings panel with more details/options

## 12. Languages
- [x] Ensure all language options work

## 13. Accent #000000
- [x] Pure black accent displays correctly (fix saturation/brightness clamps)

## 14. Fade animations
- [x] Smooth fade in/out for Join a Server, User Settings, Voice Settings

## 15. Edit Channel UI
- [x] Wider modal + more important options

## 16. Test & deploy
- [x] Local smoke test
- [x] Commit + push
- [x] Render deploy + verify live, data preserved

# Round 13 — Two-step code fixes
- [x] Setup no longer regenerates the secret (code stays stable)
- [x] `/api/2fa/code` works during setup so the live code refreshes
- [x] Test account has a fixed, always-valid code: 343815
- [x] Custom "Reset your two-step code?" UI reachable even when two-step is off
- [x] Reset requires password + invalidates the old code

# Round 14 — Chat polish
- [x] Remove green end-to-end encrypted lock badge (E2E itself unchanged)
- [x] Server banner taller (230px → 340px)
- [x] Video fullscreen works for every video (vendor fallbacks, dblclick, CSS)
- [x] Space out server rail icons (gap 8px → 12px)
- [x] Drag to reorder server icons when in more than one server (persisted per user)
- [x] Invite codes (gg/xxxx) render as blue clickable links that open the join flow
- [x] Fix "Unable to decrypt this message": device keyring + cross-account keys + retry + graceful label
- [x] Ensure channel messages encrypt for every server member (fresh member fetch)
- [x] Syntax checks, local smoke test, commit + push, Render deploy, verify live, data preserved
