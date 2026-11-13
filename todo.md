# Crossroads — Round 4

## A. Direct-message call UI revamp
- [x] New incoming-call card (avatar ring, kicker, name, meta, Accept/Decline)
- [x] New in-call bar (avatar, kicker, name, sub, meta, timer, 4 buttons)
- [x] Mute / Deafen / Settings / End wired and state-synced (labels + icons + `.off`)
- [x] Fixed `ensureDmCallMic` using the `{stream}` wrapper instead of the MediaStream (every DM call threw)
- [x] Reset mute/deafen on new/answered call

## B. Ringtone
- [x] `/sounds/ringtone.mp3` served (200, 481 KB)
- [x] Shared looping `<audio>` used by start/stop ring, respects notifSounds

## C. "started a call" in chat
- [x] `messages.kind` additive column + migrations
- [x] Server inserts call event on `dm_call_start`, broadcasts `dm_message`/`dm_notify`
- [x] Client `callEventNode` renders "X started a call" + Call back
- [x] Grouping guard so call rows never group with text

## D. Maintenance banner
- [x] Removed the `!` marker (and its CSS); zero SVG icons
- [x] Reworded footer to "Thanks for your patience — messages, calls and files keep working normally."

## E. Profile UI
- [x] Red "Remove Banner Image" button beside "Change Avatar" (visible only with a banner)
- [x] Other-user profile enlarged (1000px, 208px banner, 120px avatar, 30px name)

## F. Network errors
- [x] Mic wrapper bug fixed
- [x] No failed resource requests / no JS errors across DM, server, channel, settings, profile flows

## G. Ship
- [x] Commit + push
- [x] Deploy + poll until live
- [x] Verify live version
