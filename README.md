# Coffee Pub Browser

A standalone macOS app that wraps the FoundryVTT **Game** view and **Stream** view in
fixed-size Chromium windows so OBS can capture each one as its own source. It is built for
recording live Foundry sessions: the Game window shows the canvas, the Stream window shows the
chat stream. You can run one to five windows; two is the default.

- Borderless windows with a slim bar of the app's own at the top for dragging and resizing,
  and the page at the exact pixel size you configure below it. Linked OBS sources get a crop
  that removes the bar, so OBS sees only the page.
- Stable window names (`Coffee Pub Browser - Game`, `Coffee Pub Browser - Stream`) so OBS
  Window Capture always finds them, even though Foundry keeps rewriting the page title.
- All windows share one login session. Log into Foundry once in the Game window.
- Rendering is never throttled when a window is behind other windows or unfocused, so the OBS
  source stays smooth.
- A control panel to set URL, size, position and audio mute per window, with auto-arrange and
  a live readout of the pixel size OBS will capture.
- An OBS connection that keeps your window-capture sources pointed at these windows after
  every launch, so you never have to re-pick a window in OBS, and creates sources for you.
- Named regions: mark part of a window, by drawing a rectangle on a snapshot or by naming a
  CSS selector, and the app creates a cropped OBS source for it and keeps the crop current.
- Session groups: windows in the same group share a Foundry login, windows in different
  groups do not.
- An edge dock: a slim strip at the left or right edge of the screen. Park windows under it
  to get them out of the way while OBS keeps capturing them; hover it for a thumbnail of each
  window, click to bring one back, plus Start, Stop and Sync shortcuts. An optional menu bar
  icon offers the same commands.

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
   too. The panel has a **Session** tab (layout, the edge dock, OBS and login), one tab per
   window with its regions, and a **+** tab that adds a window (up to five). Each window tab
   has a **Remove window** button.
2. In the Game window, log into Foundry as the user you want the recording to follow (a
   dedicated observer user works well). Windows in the same **Session group** share that
   login; give a window a different group name to give it its own cookies, for a different
   Foundry user or a different site. Any number of windows can share a group. The change
   applies the next time the window starts.
3. In the control panel, set each window's **Width** and **Height** to the exact size you
   want. Changes apply live to open windows and are saved automatically.
4. The **Start** button on each card opens its window and turns into **Stop**; an ACTIVE tag
   shows while the window is open. **Reset window** centers it on its display and brings it to
   the front.
5. Move a window by dragging the **bar** at its top. Click the bar and use the arrow keys to
   resize the page: Right/Left change the width and Down/Up change the height by 1 px, or
   10 px with Shift. The bar shows the current position and page size. Double-click it to
   focus the page for typing. **Auto-arrange on display** lays the windows out left to right
   from the top-left corner of a display, wrapping to a new row when they no longer fit.
6. New windows start with no URL and show a placeholder until you enter one. Each window is
   listed in OBS by its label, so give every window a different label.
7. The **edge dock** is a small rounded pill on the right (or left) edge of the display chosen
   on the Session tab, with a dot per window and a blinking red dot while OBS records. Hover
   it to expand it: REC and LIVE timers, the current OBS scene, and one card per window with
   its state, OBS source and a thumbnail taken when it was docked. Click a card to dock that
   window (slide it off screen) or bring it back; **Dock Windows** and **Undock Windows** do
   it for every window, as does Cmd+Shift+C. A docked window keeps a 6 pt sliver on screen
   under a thin dark line, so OBS keeps capturing it, whereas hiding or minimizing a window
   stops the capture. Windows dock on the display they are on, toward an edge that has no
   other monitor beyond it (the dock's side when free, otherwise the opposite side, then the
   bottom), so a docked window never slides onto another screen or changes its captured size.
   Turn the dock off on the Session tab if you do not want it.
8. The optional **menu bar icon** (Session tab) offers Start, Stop, Dock, Sync OBS and Quit,
   and can hide the Dock icon so the app behaves like a utility.
9. Closing the control panel hides it; the app keeps running so OBS keeps its sources. Reopen
   it with **Cmd+0** or by clicking the Dock icon. Quit with **Cmd+Q**.

### Add the windows to OBS

The easy way is the OBS connection described below: the app creates the sources and keeps
them cropped and pointed at the windows. By hand:

1. In OBS, click **+** under Sources and choose **macOS Screen Capture**.
2. Set **Method** to **Window Capture** and pick **Coffee Pub Browser - Game** from the
   **Window** list. Turn off **Show Cursor** if you do not want the pointer recorded.
3. Crop the top of the source by the amount shown on the window's tab under **Window bar**
   (28 px, or 56 px on a Retina display) so the app's bar is not recorded: right-click the
   source, Transform, Edit Transform, and set the top crop.
4. Repeat for **Coffee Pub Browser - Stream**.
5. The first time, macOS asks to give OBS **Screen Recording** permission
   (System Settings > Privacy & Security > Screen Recording). Restart OBS after granting it.

The windows can sit behind other windows, but they must not be minimized (the app
disables minimizing) and they must be on a connected display.

### Let the app manage the OBS sources

macOS gives every window a new ID each time an app launches, and an OBS window-capture source
remembers that ID. That is why a source can come up empty after you restart the app until you
re-pick the window. The app fixes this by talking to OBS over its built-in WebSocket server.

1. In OBS, open **Tools > WebSocket Server Settings**, enable the server and set a password.
   Leave the port at 4455.
2. In the **OBS** section of the Session tab, enter the password, click **Save password**, then
   **Connect**. The tab shows CONNECTED once it has connected. Tick **Connect automatically**
   to connect at launch and reconnect whenever the link drops; **Disconnect** pauses that
   until you connect again.
3. On every connection and every time one of the app's windows starts, the app points each
   linked OBS source at the window's current ID and keeps a `Coffee Pub Crop` filter on it
   that removes the app's bar. If an OBS source already captures one of the
   windows it is linked automatically and listed under **OBS sources** on the window's card.
   Otherwise link it from the **Link existing source...** dropdown once, or click **Create in
   OBS** to add a new window-capture source named after the window to the current scene.

The password is stored encrypted with the macOS keychain, separate from the config file. The
app and OBS have to run on the same Mac, since OBS can only capture windows on its own machine.

### Regions: part of a window as its own OBS source

If a window shows several things you want as separate OBS sources, for example a scoreboard
and a status panel pinned inside the Stream view, define a **region** for each.

1. With the window started, click **Add region** on its tab. A region card appears with a
   name, an enabled checkbox, and its settings. Changes save as you type.
2. Click **Pick on snapshot** and drag a rectangle on the snapshot of the page, or type X, Y,
   Width and Height in page points.
3. For an element your own module renders, pick **CSS selector** instead, enter the selector
   (for example `#scoreboard`, or a plain list of class names) and click **Measure**. The app
   reads the element's position from the page, and re-measures it on every OBS sync so the
   crop follows the element.
4. Click **Add to OBS**. The app adds a window-capture source named
   after the window and region, such as `Stream - Scoreboard`, with a **Crop/Pad** filter
   called `Coffee Pub Crop` that isolates the region. Drop that source into any scene.

While connected, the app knows whether each source still exists in OBS. A region whose source
you deleted in OBS offers **Add to OBS** again, which re-creates it under the same name;
**Remove from OBS** deletes the source from OBS. The checkbox in front of a region disables
it: the app stops maintaining it and hides it in every OBS scene until you enable it again.
**Delete** removes the region itself.

On every sync the app re-points the region's source at the window and updates the crop
values, including the Retina factor, so resizing the window or editing the region keeps the
OBS source correct. Removing a region in the app leaves the source in OBS; delete it there if
you no longer need it. Only elements that stay in a fixed place work well; a chat message that
scrolls away cannot be followed by a crop.

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
| Cmd+Shift+C | Dock all windows (slide them off screen), or undock them |
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
  "version": 8,
  "openOnLaunch": true,
  "showGrips": true,
  "obs": { "autoConnect": false, "host": "127.0.0.1", "port": 4455 },
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
      "session": "Main",
      "obsSources": ["GAME SCREEN"],
      "regions": []
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
      "session": "Main",
      "obsSources": ["CHAT CAPTURE"],
      "regions": [
        {
          "id": "region1",
          "name": "Scoreboard",
          "mode": "selector",
          "selector": "#scoreboard",
          "x": 0,
          "y": 0,
          "width": 600,
          "height": 200,
          "obsSource": "Stream - Scoreboard"
        }
      ]
    }
  ]
}
```

`views` holds one to five entries, in the order they appear in the panel and in the menu.

| Field | Meaning |
| --- | --- |
| `menuBarIcon`, `hideDockIcon` | Show the menu bar icon; optionally hide the Dock icon while it is shown. |
| `dock` | The edge dock: `enabled`, `side` (`right` or `left`) and `overlap`, the points of a docked window left on screen (0 slides it fully off). It lives on the display chosen for auto-arrange. |
| `obs` | OBS WebSocket connection: `autoConnect`, `host`, `port`. The password lives in `obs-secret.bin` next to the config, encrypted. |
| `label` | Shown in the window title, so it is also the name OBS lists. |
| `url` | Page to load. Must be `http` or `https`; empty shows a placeholder. |
| `width`, `height` | Content size in points (100 to 7680). |
| `x`, `y` | Window position, written by the app when you move the window; `null` lets macOS place it. |
| `obsSources` | Names of OBS window-capture sources that follow this window. |
| `regions` | Named parts of the window. `mode` is `rect` or `selector`; `x`, `y`, `width`, `height` are in window points and are re-measured from `selector` when set; `obsSource` names the cropped OBS source the app maintains; `enabled` false hides it in OBS and stops maintenance. |
| `muted` | Mute the window's audio. Handy for the Stream window so chat sounds are not doubled. |
| `enabled` | Open this window when the app launches (when `openOnLaunch` is on). |
| `session` | Session group name (default `Main`). Windows with the same name share cookies and storage. |

## Releasing a new version

1. Bump `version` in `package.json`, commit and push.
2. On GitHub, open **Actions > Build macOS app > Run workflow**, choose the branch, enter the
   new tag in **release_tag** (for example `v1.1.0`) and click **Run workflow**.
3. About five minutes later a GitHub Release named after the tag appears with the `.dmg`
   attached and auto-generated notes. The workflow creates the git tag for you.

Pushing a tag that starts with `v` from your machine triggers the same release build.

## Setting up a Mac for development

`scripts/mac-dev-setup.sh` installs Homebrew, git, fnm with Node 22, GitHub Desktop and
VS Code, creates `~/Developer`, clones every Coffee Pub repository into it and runs
`npm install` for this app. It is safe to re-run; each step skips what is already done.

```bash
curl -fsSL https://raw.githubusercontent.com/Drowbe/coffee-pub-browser/main/scripts/mac-dev-setup.sh -o ~/mac-dev-setup.sh
bash ~/mac-dev-setup.sh
```

Afterwards, run the app from source with:

```bash
cd ~/Developer/coffee-pub-browser
git pull
npm start
```

## Project layout

```
src/main.js            Electron main process: windows, menu, IPC, permissions
src/config.js          Config load/save/validation
src/obs.js             OBS WebSocket bridge: keeps OBS sources pointed at the windows
src/preload.js         Bridge between the control panel page and the main process
src/bar-preload.js     Bridge between a window's bar page and the main process
src/control/           Control panel page (HTML, CSS, JS)
src/dock/              Edge dock page (HTML, CSS, JS); src/dock-preload.js bridges it
src/parking.js         Geometry for parking windows off a free display edge
src/bar/               The bar at the top of each window (HTML, CSS, JS); add per-window controls here
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
