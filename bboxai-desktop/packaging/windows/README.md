# bboxai-desktop — Windows installer

Builds `bboxai-desktop-setup-<version>.exe`, a self-contained Windows installer
for bboxAI's local-desktop product (`bbox-api` + `bbox-web`). No Node.js and
no separate `git clone` needed by the end user — `bbox-web` is pre-built once
at package-build time, and the installer bundles everything it installs.

**Download the latest build:** [GitHub Releases](https://github.com/zainalabidin85/bboxAI/releases) (tag `bboxai-desktop-v<version>`).

## Architecture

Windows has no systemd, no PostgreSQL-via-apt, and nginx isn't a natural fit —
so this is deliberately a **simpler architecture than the Linux `.deb`**, not
a straight port of it:

| | Linux (`.deb`) | Windows (`.exe`) |
|---|---|---|
| Database | PostgreSQL | **SQLite** (single file, no server process) |
| Web serving | nginx, separate port from the API | **`bbox-api` serves the built UI directly**, one process, one port (`8080`) — see `WEB_DIST_PATH` in `bbox-api/config.py` / `main.py` |
| Background service | systemd | **[NSSM](https://nssm.cc/)**, wraps `uvicorn` as a real Windows service |
| App code | `/opt/bboxai-desktop` | `%ProgramFiles%\bboxai-desktop` |
| Runtime data (db, storage, weights, venv) | `/var/lib/bboxai-desktop` | `%ProgramData%\bboxai-desktop` |
| Hostname | `bboxai` → `/etc/hosts` | `bboxai` → `%SystemRoot%\System32\drivers\etc\hosts` |

Both the SQLite support and the built-in static-file serving live in
`bbox-api` itself (not Windows-specific code) — see `bbox-api/database.py`
and the `WEB_DIST_DIR` block in `bbox-api/main.py`. They're additive: the
Linux install still uses Postgres + nginx exactly as before.

## Files in this directory

| File | Purpose |
|---|---|
| `build.ps1` | Run on Windows. Pre-builds `bbox-web`, downloads `nssm.exe`, stages everything, and invokes Inno Setup (`ISCC.exe`) to produce the `.exe`. |
| `bboxai-desktop.iss` | The Inno Setup script — what gets installed where, and which scripts run on install/uninstall. |
| `install.ps1` | Runs elevated, once, right after Inno Setup copies files. Sets up Python/venv/dependencies, SQLite `.env`, the default YOLO weight, the NSSM service, and the hosts entry. Idempotent — safe to re-run (e.g. on a version upgrade). |
| `enable-remote.ps1` | **Not run automatically** — the user runs this manually (elevated) after registering an account, same pattern as the `.deb`'s `bboxai-enable-remote`. Validates the login against the local `bbox-api`, sets up a `bbox-agent` venv, and registers/starts a `bboxai-agent` service (via NSSM) tunneling to the shared `bbox-relay`, enabling `https://bboxai-remote.unitani.com` access for that account. |
| `uninstall.ps1` | Runs elevated during uninstall. Stops/removes both services (`bboxai-api` and, if present, `bboxai-agent`), removes the hosts entry, and cleans up files `install.ps1`/`enable-remote.ps1` created at runtime that Inno Setup's own manifest doesn't know about (see "Known limitation" below). Data is **preserved** unless `-Purge` is passed. |

## Building it yourself

Must run **on Windows** (needs `ISCC.exe`; `build.ps1` will look for it at
its default install path, or pass `-IsccPath`).

Prerequisites (all installable via `winget`):
```powershell
winget install --id JRSoftware.InnoSetup -e
winget install --id NSSM.NSSM -e   # only needed if you want nssm on PATH for manual testing; build.ps1 downloads its own copy
```
Also needs Node.js (for the one-time `bbox-web` build) and `git`.

```powershell
git clone https://github.com/zainalabidin85/bboxAI.git
cd bboxAI\bboxai-desktop\packaging\windows
powershell -ExecutionPolicy Bypass -File build.ps1
# → out\bboxai-desktop-setup-1.0.0.exe
```

`build.ps1` bakes `VITE_API_BASE_URL=http://bboxai:8080` into the `bbox-web`
build (same-origin with the API, matching the single-process architecture
above) — if you change the port `install.ps1` uses, update both.

## Installing

Run the `.exe`, approve the UAC admin prompt (it needs to install a service
and edit the hosts file), and follow the wizard — or install silently:

```powershell
bboxai-desktop-setup-1.0.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

On first run it will, in order:
1. Look for a real Python 3.11+ (see the WindowsApps gotcha below); install one via `winget` if none is found.
2. Create a venv under `%ProgramData%\bboxai-desktop\venv` and install `bbox-api`'s dependencies (GPU-detected — pulls the CUDA 12.4 `torch` build automatically if `nvidia-smi` is present, otherwise CPU).
3. Write `%ProgramFiles%\bboxai-desktop\bbox-api\.env` with a random `SECRET_KEY` and a SQLite `DATABASE_URL`.
4. Download the default `yolo11n.pt` base weight.
5. Register and start `bboxai-api` as a Windows service via NSSM.
6. Add `127.0.0.1 bboxai` to the hosts file.

Takes a few minutes (mostly step 2 — `torch`/`opencv`/`ultralytics` aren't
small) and needs internet access throughout. When it's done: **`http://bboxai:8080`**.

### Enabling remote access (away from home)

The installer only sets up the local `bbox-api`/`bbox-web` pair — it does
**not** register a device with the shared relay, so a freshly-registered
account can't yet log into `https://bboxai-remote.unitani.com`. After
registering an account through `http://bboxai:8080`, run this once
(elevated):

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Program Files\bboxai-desktop\enable-remote.ps1" -AppDir "C:\Program Files\bboxai-desktop" -DataDir "C:\ProgramData\bboxai-desktop"
```

It prompts for the bboxAI username/password (or reads `$env:BBOXAI_USERNAME`
/ `$env:BBOXAI_PASSWORD` if already set), validates the login against the
local `bbox-api`, and registers/starts a `bboxai-agent` service tunneling to
the shared relay. Once it reports the tunnel connected, the same account
works at `bboxai-remote.unitani.com` from anywhere. Logs go to
`%ProgramData%\bboxai-desktop\agent.log`.

## Uninstalling

Use "Add or Remove Programs", or run `unins000.exe` from the install
directory. Stops and removes the service, removes the hosts entry. **Your
data (SQLite db, storage, weights) is kept** at
`%ProgramData%\bboxai-desktop` — delete that folder manually if you want a
completely clean slate. (`uninstall.ps1` supports a `-Purge` switch that does
this automatically, but it isn't wired up to the uninstaller UI yet — nothing
currently passes that flag.)

## Known limitation

Inno Setup's uninstaller only removes files it explicitly installed. Two
things get created at runtime instead — `bbox-api\.env` (by `install.ps1`)
and `bbox-api\**\__pycache__\*.pyc` (by Python itself, the first time each
module gets imported) — so `uninstall.ps1` deletes both explicitly before
Inno's own cleanup runs, otherwise a near-empty `bbox-api\` folder is left
behind after uninstall.

## Troubleshooting / gotchas found while building this

These cost real debugging time against a live Windows 10 machine — worth
reading before re-deriving them:

- **"file cannot be accessed by the system" from `nssm start`.** On a stock
  Windows install, `python`/`py` commonly resolve to the **Windows Store
  "app execution alias" stub**
  (`%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe`). It works fine
  interactively but is completely inaccessible to a `LocalSystem` service —
  a venv built from it can never actually launch as a service, and the error
  NSSM gives back is nowhere near obvious about why. `install.ps1`'s
  `Get-RealPython311` explicitly detects and rejects `WindowsApps` matches
  and resolves to a real, absolute interpreter path, falling back to
  installing Python 3.11 via `winget` if nothing else qualifies.
- **`psycopg2-binary` fails to build** ("`pg_config` executable not found")
  on newer Python versions that don't have a prebuilt wheel for it yet. It's
  a Postgres driver — completely unneeded on Windows since this uses SQLite
  — so `install.ps1` filters it out of `requirements.txt` before installing,
  rather than trying to satisfy a dependency nothing here needs.
- **`nssm.exe stop`/`remove` looks like it crashes the script** on a first
  install (before the service exists), even though the call is wrapped in
  `2>$null`. PowerShell's `$ErrorActionPreference = "Stop"` turns a native
  command's stderr output into a *terminating* error independent of stream
  redirection — the fix is temporarily relaxing `$ErrorActionPreference`
  around those specific idempotent-cleanup calls, not just suppressing the
  stream.
- **`ArchitecturesAllowed=x64`** is deprecated by newer Inno Setup versions
  in favor of `x64compatible` — cosmetic (just a compiler warning), already
  fixed in `bboxai-desktop.iss`, noted here in case it resurfaces after an
  Inno Setup upgrade.
- **The installer never registered a device with the relay at all** — the
  original release only set up `bbox-api`/`bbox-web`, with no Windows
  equivalent of `enable-remote.sh`/`bboxai-enable-remote`. A freshly
  registered account worked fine locally but had no way to reach
  `bboxai-remote.unitani.com`, since nothing ever told the relay which
  device that username lived on. Fixed by bundling `bbox-agent` and adding
  `enable-remote.ps1` (see "Enabling remote access" above).
- **`bboxai-agent`'s log file stayed empty even while the service was
  working correctly.** NSSM was launching it as plain `python agent.py`;
  Python block-buffers stdout when it isn't attached to a terminal (which a
  service's redirected-to-file stdout isn't), so `print()` output could sit
  in the buffer indefinitely. Switched to `python -u agent.py`
  (`enable-remote.ps1`'s `AppParameters`) for unbuffered output, so
  `agent.log` actually reflects what's happening.

All of the above were caught by actually installing, exercising (register/
login round-trip over the running service, and for the agent — a real POST
to `bboxai-relay.unitani.com/login` round-tripping through the tunnel to a
live account), and uninstalling this on a real Windows 10 machine — not
just reasoned about from the script text. If you change `install.ps1`/
`enable-remote.ps1`/`uninstall.ps1`, re-test the same way rather than
trusting a read-through; several of these bugs looked completely correct
until they were actually run.
