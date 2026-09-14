# To do

Things agreed on but not built yet, roughly in order.

## Tavern

Bigger Tavern-side design work (multi-admin "who drives the stream," multiple simultaneous
asides with a director-style switch, per-room character settings, room types, the admin page's
editing moving to each user's own profile) lives in that repo's own TODO.md now, not here.

- ~~**Rooms, phase 2: pull aside.**~~ Done: an admin pulls one or more people in their current
  room into a private room together, everyone moves automatically, a "Back to the table" button
  returns them together to the room they were pulled from (not always the Lobby), and the room
  disappears on its own once everyone has left. The one-conversation rule is in too: everyone
  not in the admin's current room is "off stream" (or "aside" for those with the admin in a
  pull-aside room) -- a pull-aside room is private from the rest of the table, not from the
  recording, so while the admin is aside with someone that conversation is what's on stream,
  same as any other room they could be in.
- ~~**Room switching in Studio.**~~ Done as "Follow the admin" (on by default): the Tavern tab
  and the OBS sources both track whatever room the admin is actually in.

## Studio

- **Windows build.** Packaging is done: an NSIS target and a `windows-latest` job building and
  uploading the installer alongside the macOS dmg (also on tagged releases), plus a menu fix
  (Hide/Hide Others/Unhide are macOS-only roles now). Still open, and genuinely untestable
  without a Windows machine running OBS, so left alone rather than guessed at: the OBS side
  needs `window_capture` (window named by `Title:Class:Exe`) instead of macOS `screen_capture`
  with an integer window ID -- a different input kind, a different settings shape, and a
  different way of resolving "this app window" to "this OBS capture target". Also open: Windows
  display scaling in the captured-size readout, a colour tray icon at 16 and 32 px (the current
  one is a macOS template image), quit on close instead of living in the Dock, and a SmartScreen
  note in the README.
- **Release v0.1.9** once testing is green: bump `package.json`, run the Build macOS app
  workflow with the tag.
- **PR #1** merges once `main` is the default branch on GitHub.
