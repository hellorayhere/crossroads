# Crossroads — Round 10 Task List

## 1. Direct messages: most recent conversations on top
- [x] `/api/dms` orders by last message activity (falls back to DM creation time)
- [x] `last_activity` returned with each DM
- [x] DM list renders in that order automatically

## 2. @everyone / @here pings for owners + admins
- [x] Parse `@everyone` and `@here` in channel messages
- [x] Only the server owner and admins can broadcast (members are ignored)
- [x] Gated by the server's "Allow @everyone / @here" setting
- [x] `@here` only notifies members who are currently online
- [x] Notifications use the same red badge system (channel + rail) and the bell panel
- [x] Notification text/icon for `everyone` / `here` types

## 3. Server Settings: toggles now match real behaviour
- [x] Explicit Content Filter actually blocks explicit messages / attachment names
- [x] "Allow @everyone / @here" actually gates broadcasts
- [x] Descriptions rewritten to describe the real behaviour

## 4. Channel right-click editing (owner + admins)
- [x] Edit Channel modal: name, topic, category, slow mode
- [x] Rename / edit topic / move up / move down / delete retained
- [x] New Text / New Voice / New Category shortcuts in the channel menu
- [x] Category header right-click: create channel here, rename, delete

## 5. Channel categories + drag between them (visible to everyone)
- [x] `channel_categories` table + `channels.category_id` + `channels.slow_mode` (additive migration)
- [x] Category CRUD endpoints (owner/admin gated)
- [x] Channel create / edit / order accept `category_id`
- [x] Collapsible category headers rendered for ALL members
- [x] Uncategorised channels float above the first category
- [x] Drag channels onto other channels or category headers to move between categories
- [x] Order persists as `{ id, category_id }` entries
- [x] Deleting a category keeps its channels (they move to the top)

## 6. Reduce website delays
- [x] `openServer` no longer blocks the channel list on a second voice round-trip
- [x] Voice occupancy loads in the background after the server paints
- [x] Boot still loads servers / friends / DMs / notifications in parallel

## 7. Test & deploy
- [x] Server API tests: categories, order, edit, explicit filter, @everyone/@here gating, DM sort, category delete
- [x] Browser test: categories visible to non-admin, admin menus, edit modal, drag persistence
- [x] Commit + push to main
- [x] Render deploy + verify live, data preserved
