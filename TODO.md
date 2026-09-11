# To do

Things agreed on but not built yet, roughly in order.

## Tavern

- **Rooms, phase 2: pull aside.** An admin pulls a player out of the Lobby into a room for a
  private word; both move to that room's own LiveKit room, the player gets a "Back to the
  table" button, the rest of the table keeps going, and OBS follows the person. Then the
  one-conversation rule: the stream hears the room the admin is in, everyone else is held
  back for the stream with "off stream" and "aside" badges on their tiles and sources.
- **Room switching in Studio.** The Tavern tab follows the room the admin is in.

## Studio

- **Windows build.** Electron already runs there; the work is the OBS side: drive the
  `window_capture` input (window named by `Title:Class:Exe`) instead of macOS `screen_capture`
  with a window ID, detect hand-made captures by title, Windows display scaling in the
  captured-size readout, a colour tray icon at 16 and 32 px, quit on close instead of living
  in the Dock, an NSIS or portable target plus a Windows runner in the build workflow, and a
  SmartScreen note in the README. Needs a Windows machine with OBS to confirm docking geometry
  and the capture string.
- **Release v0.1.9** once testing is green: bump `package.json`, run the Build macOS app
  workflow with the tag.
- **PR #1** merges once `main` is the default branch on GitHub.
