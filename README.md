# Coffee Pub Browser

A standalone macOS app that wraps the FoundryVTT **Game** view and **Stream** view in two
fixed-size Chromium windows so OBS can capture each one as its own source. It is built for
recording live Foundry sessions: the Game window shows the canvas, the Stream window shows the
chat stream.

- Two borderless windows at the exact pixel size you configure (no title bar to crop in OBS).
- Stable window names (`Coffee Pub Browser - Game`, `Coffee Pub Browser - Stream`) so OBS
  Window Capture always finds them, even though Foundry keeps rewriting the page title.
- Both windows share one login session. Log into Foundry once in the Game window.
- Rendering is never throttled when a window is behind other windows or unfocused, so the OBS
  source stays smooth.
- A control panel to set URL, size, position, zoom and audio mute per window, with
  auto-arrange and a live readout of the pixel size OBS will capture.

## Requirements

- macOS 12 or newer (Apple Silicon or Intel).
- To build: [Node.js](https://nodejs.org) 18 or newer.
- OBS Studio 28 or newer (for the ScreenCaptureKit based Window Capture).

## Build the app

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

1. Launch **Coffee Pub Browser**. The control panel opens and, by default, both windows open
   too.
2. In the Game window, log into Foundry as the user you want the recording to follow (a
   dedicated observer user works well). The Stream window shares the login.
3. In the control panel, set each window's **Width** and **Height** to the exact size you
   want. Changes apply live to open windows and are saved automatically.
4. Use **Auto-arrange on display** to put the Game window at the top-left of a display with
   the Stream window beside it, or set **X** / **Y** by hand. The windows have no title bar,
   so they are positioned from the panel rather than dragged.
5. Closing the control panel hides it; the app keeps running so OBS keeps its sources. Reopen
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
| Cmd+1 / Cmd+2 | Open (or focus) the Game / Stream window |
| Cmd+Shift+1 / Cmd+Shift+2 | Reload the Game / Stream window |
| Cmd+R | Reload the focused window |
| Alt+Cmd+I | Toggle developer tools for the focused window |
| Cmd+Q | Quit |

## Configuration

Settings are stored as JSON at
`~/Library/Application Support/Coffee Pub Browser/config.json` (the control panel's
**Show config file** button reveals it in Finder).

```json
{
  "version": 1,
  "openOnLaunch": true,
  "views": [
    {
      "id": "game",
      "label": "Game",
      "url": "https://game.coffeepub.live/game",
      "width": 1920,
      "height": 1080,
      "x": null,
      "y": null,
      "zoom": 1,
      "muted": false,
      "enabled": true
    },
    {
      "id": "stream",
      "label": "Stream",
      "url": "https://game.coffeepub.live/stream",
      "width": 600,
      "height": 1080,
      "x": null,
      "y": null,
      "zoom": 1,
      "muted": true,
      "enabled": true
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `label` | Shown in the window title, so it is also the name OBS lists. |
| `url` | Page to load. Must be `http` or `https`. |
| `width`, `height` | Content size in points (100 to 7680). |
| `x`, `y` | Window position, or `null` to let macOS place it. |
| `zoom` | Page zoom factor (0.25 to 5). |
| `muted` | Mute the window's audio. Handy for the Stream window so chat sounds are not doubled. |
| `enabled` | Open this window when the app launches (when `openOnLaunch` is on). |

## Project layout

```
src/main.js            Electron main process: windows, menu, IPC, permissions
src/config.js          Config load/save/validation
src/preload.js         Bridge between the control panel page and the main process
src/control/           Control panel page (HTML, CSS, JS)
build/icon.svg         App icon source; build/icon.png is generated from it
```

## Troubleshooting

- **A window shows a Chromium error page.** Check the URL in the control panel and press
  **Reload**. The Game window must be able to reach your Foundry server.
- **Foundry logged out unexpectedly.** Use **Sign out (clear cookies)** and log in again.
- **OBS shows a black or frozen source.** Make sure OBS has Screen Recording permission and
  that the window is on a connected display and not hidden with Cmd+H.
- **Audio/video chat permissions.** The app allows microphone, camera and notification
  permission requests only from the configured Foundry origins.
