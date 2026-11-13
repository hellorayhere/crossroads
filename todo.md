# Crossroads — current round

## A. Fix "Request failed" on send (root cause)
- [x] Diagnose: both message routes used `attachment_spoiler`/`attachment_description` in the INSERT without destructuring them from `req.body` -> ReferenceError -> 500 HTML -> generic "Request failed"
- [x] Add the two fields to the channel + DM destructures
- [x] Add startup schema self-heal in server.js (additive only)
- [x] Add JSON error handler so API failures return a real message
- [x] Wrap admin broadcast `io.emit` in try/catch
- [x] Local E2E test: plain message, attachment message, DM attachment message all 200

## B. Attachment options UI polish
- [x] Rebuild `renderAttachmentPreview` markup: file header + quick actions + options panel
- [x] Spoiler as a real site toggle switch with icon tile + description
- [x] Description as a styled inline field with icon + helper text
- [x] Preview + remove icon buttons with hover/danger states
- [x] Responsive grid (stacks under 720px), light/dark theme tokens
- [x] Visual verification in browser (2-col grid, 40px toggle, no overflow)

## C. Ship
- [x] Commit + push to main
- [x] Trigger Render deploy, poll until live (dep-dbrajmk9v7es73c1cek0)
- [x] Verify live site loads and CSS/JS contain new rules
