# UnThreader

A cross-platform **desktop app** (Windows, Linux, macOS) that bulk-cleans **your own**
[Threads](https://www.threads.net) account:

- 🗑️ Delete **all your posts**
- 💬 Delete **all your replies**

It works by driving the real Threads **web** interface with your own logged-in session —
the same buttons you'd click by hand, done automatically — inside an embedded browser.

> **Note on follows/followers:** earlier versions also attempted to unfollow everyone
> and remove followers. Threads' web UI has no bulk/removal controls for these (there is
> no "Remove" action on the followers list at all), so those features were dropped rather
> than shipped half-working.

> [!WARNING]
> **Read this first.**
> - This automates threads.net, which is **against Meta's Terms of Service**. Aggressive
>   bulk actions can get an account rate-limited, temporarily blocked, or banned.
> - Use it **only on your own account**, and understand the risk.
> - Deletions on Threads are **permanent**. There is no undo. Export anything you want to
>   keep first (Instagram/Meta → *Your information and permissions → Download your information*).
> - Start with **Dry run** (the default) to preview exactly what would be removed.

## Download

Grab the installer for your OS from the [Releases](https://github.com/hiraethclub/UnThreader/releases)
page: `.exe` (Windows), `.AppImage` / `.deb` (Linux), `.dmg` (macOS).

> The binaries are **unsigned**, so the OS will warn on first launch:
> - **Windows:** SmartScreen → *More info → Run anyway*.
> - **macOS:** right-click the app → *Open* (or *System Settings → Privacy & Security → Open Anyway*).

## Why a desktop app instead of the official API?

Meta's official Threads API can delete posts/replies but is capped at **100 deletions per
24h** and requires App Review to ship. Driving the web UI with your own session removes the
cap and the approval step, and needs no server infrastructure.

## How it works

```
┌─────────────────────────┐     IPC      ┌───────────────────────────┐
│  Control panel (renderer)│◄────────────►│   Main process            │
│  settings · log · start  │              │   engine · rate limiter   │
└─────────────────────────┘              │   store (settings + log)  │
                                          └────────────┬──────────────┘
                                                       │ executeJavaScript + CDP mouse
                                          ┌────────────▼──────────────┐
                                          │  Threads <webview> (your  │
                                          │  logged-in session)       │
                                          └───────────────────────────┘
```

- The right pane is a live Threads session — **you log in there yourself**; no credentials
  ever touch the app.
- Each operation repeatedly acts on the **first item at the top of the list**, then waits
  for the list to reflow — this is robust against Threads' virtualized, infinite-scroll lists.
- A **rate limiter** paces actions with randomized human-like delays, an optional daily
  cap, and exponential backoff that **auto-pauses** when Threads shows a "try again later"
  wall. A **Limit per run** setting stops a run after N items (handy for a small test).

### Privacy

- The **activity log is not written to disk** by default — it lives only in memory for the
  session, and any existing log file is wiped at launch. Enable *Keep activity log on disk*
  if you want a persistent history.
- Your Threads login persists between launches for convenience. Turn off *Stay logged in
  between launches* to have it cleared on quit, or click *Log out of Threads now* to clear
  cookies and site data immediately.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/main/main.ts` | App entry, window, persistent Threads session partition |
| `src/main/ipc.ts` | IPC handlers between renderer and engine |
| `src/main/store.ts` | Settings + append-only action log (in Electron `userData`) |
| `src/main/session.ts` | Login detection + navigation |
| `src/main/automation/engine.ts` | Job runner: pause/resume/stop, pacing, backoff |
| `src/main/automation/rateLimiter.ts` | Delays, daily cap, backoff |
| `src/main/automation/cdpInput.ts` | Human-like mouse clicks via Chrome DevTools Protocol |
| `src/main/automation/injected.ts` | The in-page DOM library run inside Threads |
| **`src/main/automation/selectors.ts`** | **Every Threads DOM anchor — the one file to update when Threads changes its UI** |
| `src/main/automation/actions/` | The delete-posts / delete-replies operations |
| `src/renderer/` | Control-panel UI |

### When Threads changes its layout

The app finds buttons by ARIA labels and visible text, all defined in
**`src/main/automation/selectors.ts`**. If a redesign breaks it, update the text/labels
there — nothing else should need to change.

## Develop

```bash
npm install
npm run dev        # launch the app with hot reload
npm run typecheck  # type-check main + renderer
npm run build      # bundle to out/
```

## Package installers

```bash
npm run dist:win     # NSIS .exe  (build on Windows)
npm run dist:linux   # AppImage + .deb
npm run dist:mac     # .dmg       (build on macOS)
```

Cross-OS installers are also produced by the GitHub Actions workflow in
`.github/workflows/build.yml`.

## Recommended first run

1. `npm run dev`, then **log into your account** in the right pane.
2. Leave **Dry run ON**. Click *Run* on *Delete all posts* — the Activity log lists every
   post it *would* delete. Confirm the count looks right.
3. Turn **Dry run OFF**, keep the default pacing, and run again — type the confirmation
   word when prompted. Watch the first few deletions, and use **Stop** any time.

## License

MIT — see [LICENSE](./LICENSE).
