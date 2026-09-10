# Coffee Pub Browser

A standalone macOS app that wraps the FoundryVTT **Game** view and **Stream** view in
fixed-size Chromium windows so OBS can capture each one as its own source. It is built for
recording live Foundry sessions: the Game window shows the canvas, the Stream window shows the
chat stream. You can run one to five windows; two is the default.

- Borderless windows at the exact pixel size you configure (no title bar to crop in OBS).
- Stable window names (`Coffee Pub Browser - Game`, `Coffee Pub Browser - Stream`) so OBS
  Window Capture always finds them, even though Foundry keeps rewriting the page title.
- All windows share one login session. Log into Foundry once in the Game window.
- Rendering is never throttled when a window is behind other windows or unfocused, so the OBS
  source stays smooth.
- A control panel to set URL, size, position and audio mute per window, with auto-arrange and
  a live readout of the pixel size OBS will capture.
- A grip bar docked above each window for dragging it around and resizing it with the arrow
  keys. The grip is a separate window, so it never shows up in the OBS capture.
- An OBS connection that keeps your window-capture sources pointed at these windows after
  every launch, so you never have to re-pick a window in OBS, and creates sources for you.

## Requirements

- macOS 12 or newer (Apple Silicon or Intel).
- To build: [Node.js](https://nodejs.org) 18 or newer.
- OBS Studio 28 or newer (for the ScreenCaptureKit based Window Capture).

## Get the app

### Option A: download a release (easiest)

Go to the repository's **Releases** page and download the `.dmg` attached to the latest
release, then follow [First launch](#first-launch-unsigned-build) below.

Every push also runs the **Build macOS app** workflow on a macOS runner. If you need a build
from a branch that has not been released, open the **Actions** tab, pick the run, and download
the **Coffee-Pub-Browser-macOS** artifact (a zip containing the `.dmg`).

### Option B: build it yourself

```bash
npm install
npm run dist
```

This produces a universal (Apple Silicon + Intel) build in `dist/`:

- `dist/Coffee Pub Browser-1.0.0-universal.dmg`
- `dist/Coffee Pub Browser-1.0.0-universal-mac.zip`

Open the `.dmg` and drag **Coffee Pub Browser** into `Applications`.

For a faster, smaller build for just your machine's chip:

```bash
npm run dist:arm64   # Apple Silicon
npm run dist:x64     # Intel
```

To run from source without packaging:

```bash
npm start
```

### First launch (unsigned build)

The build is not code-signed, so macOS Gatekeeper blocks it the first time. Either
right-click the app in `Applications` and choose **Open**, then **Open** again in the dialog,
or clear the quarantine flag from a terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Coffee Pub Browser.app"
```

## Using it

1. Launch **Coffee Pub Browser**. The control panel opens and, by default, the windows open
   too.
2. In the Game window, log into Foundry as the user you want the recording to follow (a
   dedicated observer user works well). The other windows share the login.
3. In the control panel, set each window's **Width** and **Height** to the exact size you
   want. Changes apply live to open windows and are saved automatically.
4. The **Start** button on each card opens its window and turns into **Stop**; an ACTIVE tag
   shows while the window is open. **Reset window** centers it on its display and brings it to
   the front.
5. Move a window by dragging the **grip bar** docked above it. Click a grip and use the arrow
   keys to resize its window: Right/Left change the width and Down/Up change the height by
   1 px, or 10 px with Shift. The grip shows the current position and size. Double-click a
   grip to focus its window. **Cmd+G** hides or shows all grips.
   **Auto-arrange on display** lays the windows out left to right from the top-left corner of
   a display, wrapping to a new row when they no longer fit. You can also set **X** / **Y** by
   hand in the panel. When a window is flush with the top of the display, its grip overlaps
   the window's top edge instead; that only affects what you see on the desktop, not the OBS
   capture.
6. **Number of windows** in Layout & Startup adds or removes windows, from one to five. New
   windows start with no URL and show a placeholder until you enter one. Each window is
   listed in OBS by its label, so give every window a different label.
7. Closing the control panel hides it; the app keeps running so OBS keeps its sources. Reopen
   it with **Cmd+0** or by clicking the Dock icon. Quit with **Cmd+Q**.

### Add the windows to OBS

1. In OBS, click **+** under Sources and choose **macOS Screen Capture**.
2. Set **Method** to **Window Capture** and pick **Coffee Pub Browser - Game** from the
   **Window** list. Turn off **Show Cursor** if you do not want the pointer recorded.
3. Repeat for **Coffee Pub Browser - Stream**.
4. The first time, macOS asks to give OBS **Screen Recording** permission
   (System Settings > Privacy & Security > Screen Recording). Restart OBS after granting it.

The windows can sit behind other windows, but they must not be minimized (the app
disables minimizing) and they must be on a connected display.

### Let the app manage the OBS sources

macOS gives every window a new ID each time an app launches, and an OBS window-capture source
remembers that ID. That is why a source can come up empty after you restart the app until you
re-pick the window. The app fixes this by talking to OBS over its built-in WebSocket server.

1. In OBS, open **Tools > WebSocket Server Settings**, enable the server and set a password.
   Leave the port at 4455.
2. In the control panel's **OBS** section, enter the password, click **Save password**, and
   tick **Connect to OBS**. The section shows CONNECTED once it has connected, and reconnects
   on its own whenever OBS is running.
3. On every connection and every time one of the app's windows starts, the app points each
   linked OBS source at the window's current ID. If an OBS source already captures one of the
   windows it is linked automatically and listed under **OBS sources** on the window's card.
   Otherwise link it from the **Link existing source...** dropdown once, or click **Create in
   OBS** to add a new window-capture source named after the window to the current scene.

The password is stored encrypted with the macOS keychain, separate from the config file. The
app and OBS have to run on the same Mac, since OBS can only capture windows on its own machine.

### Retina displays

On a Retina display macOS renders 2 physical pixels per point, so a 1920 x 1080 window is
captured by OBS at 3840 x 2160. The control panel shows the exact **Captured pixels** for each
open window. Either scale the source in OBS (right-click the source > Transform > Edit
Transform) or configure half-size windows here. On a non-Retina display, or when the app
windows sit on a non-Retina external monitor, the sizes match 1:1.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Cmd+0 | Show the control panel |
| Cmd+G | Show or hide the grip bars |
| Cmd+1 to Cmd+5 | Open (or focus) window 1 to 5 |
| Cmd+Shift+1 to Cmd+Shift+5 | Reload window 1 to 5 |
| Cmd+R | Reload the focused window |
| Alt+Cmd+I | Toggle developer tools for the focused window |
| Cmd+Q | Quit |

## Configuration

Settings are stored as JSON at
`~/Library/Application Support/Coffee Pub Browser/config.json` (the control panel's
**Show config file** button reveals it in Finder).

```json
{
  "version": 3,
  "openOnLaunch": true,
  "showGrips": true,
  "obs": { "enabled": false, "host": "127.0.0.1", "port": 4455 },
  "views": [
    {
      "id": "game",
      "label": "Game",
      "url": "https://game.coffeepub.live/game",
      "width": 1920,
      "height": 1080,
      "x": null,
      "y": null,
      "muted": false,
      "enabled": true,
      "obsSources": ["GAME SCREEN"]
    },
    {
      "id": "stream",
      "label": "Stream",
      "url": "https://game.coffeepub.live/stream",
      "width": 600,
      "height": 1080,
      "x": null,
      "y": null,
      "muted": true,
      "enabled": true,
      "obsSources": []
    }
  ]
}
```

`views` holds one to five entries, in the order they appear in the panel and in the menu.

| Field | Meaning |
| --- | --- |
| `showGrips` | Show the grip bars above the windows. |
| `obs` | OBS WebSocket connection: `enabled`, `host`, `port`. The password lives in `obs-secret.bin` next to the config, encrypted. |
| `label` | Shown in the window title, so it is also the name OBS lists. |
| `url` | Page to load. Must be `http` or `https`; empty shows a placeholder. |
| `width`, `height` | Content size in points (100 to 7680). |
| `x`, `y` | Window position, written by the app when you move the window; `null` lets macOS place it. |
| `obsSources` | Names of OBS window-capture sources that follow this window. |
| `muted` | Mute the window's audio. Handy for the Stream window so chat sounds are not doubled. |
| `enabled` | Open this window when the app launches (when `openOnLaunch` is on). |

## Releasing a new version

1. Bump `version` in `package.json`, commit and push.
2. On GitHub, open **Actions > Build macOS app > Run workflow**, choose the branch, enter the
   new tag in **release_tag** (for example `v1.1.0`) and click **Run workflow**.
3. About five minutes later a GitHub Release named after the tag appears with the `.dmg`
   attached and auto-generated notes. The workflow creates the git tag for you.

Pushing a tag that starts with `v` from your machine triggers the same release build.

## Project layout

```
src/main.js            Electron main process: windows, menu, IPC, permissions
src/config.js          Config load/save/validation
src/grips.js           Grip bar windows that move their view when dragged
src/obs.js             OBS WebSocket bridge: keeps OBS sources pointed at the windows
src/preload.js         Bridge between the control panel page and the main process
src/grip-preload.js    Bridge between a grip page and the main process
src/control/           Control panel page (HTML, CSS, JS)
src/grip/              Grip bar page (HTML, CSS, JS); add future per-window controls here
build/icon.svg         App icon source; build/icon.png is generated from it
```

## Troubleshooting

- **A window shows a Chromium error page.** Check the URL in the control panel and press
  **Reload**. The Game window must be able to reach your Foundry server.
- **Foundry logged out unexpectedly.** Use **Sign out (clear cookies)** and log in again.
- **OBS shows a black or frozen source.** Make sure OBS has Screen Recording permission and
  that the window is on a connected display and not hidden with Cmd+H. If it happens after
  restarting the app, connect the app to OBS as described above so the source is re-pointed
  automatically, or open the source's properties and pick the window again.
- **The OBS section says the password was rejected or OBS is not running.** Check Tools >
  WebSocket Server Settings in OBS: the server must be enabled and the password must match.
- **Audio/video chat permissions.** The app allows microphone, camera and notification
  permission requests only from the configured Foundry origins.
