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
