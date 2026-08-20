# bboxai-desktop — Debian/Ubuntu installer

Builds `bboxai-desktop_<version>_all.deb`, a self-contained Debian package
for bboxAI's local-desktop product (`bbox-api` + `bbox-web`). No Node.js and
no separate `git clone` needed by the end user — `bbox-web` is pre-built once
at package-build time, and the package bundles everything else it needs.

**Download the latest build:** [GitHub Releases](https://github.com/zainalabidin85/bboxAI/releases) (tag `bboxai-desktop-v<version>`).

## Architecture

This keeps the same proven architecture as `bboxai-desktop/install.sh`
(PostgreSQL + nginx) rather than the simplified SQLite/no-nginx approach the
[Windows installer](../windows/README.md) uses — Postgres-via-apt and nginx
are both native, low-friction choices on Linux, so there was no reason to
deviate.

| | |
|---|---|
| Database | PostgreSQL, role/db `bboxai`, random password saved to `/var/lib/bboxai-desktop/.db_password` |
| Web serving | nginx on port `8321`, reverse-proxying nothing — serves the pre-built static UI directly; `bbox-api` runs separately on `127.0.0.1:8000` |
| Background service | systemd (`bboxai-api.service`) |
| Runs as | dedicated system user `bboxai` (not whoever ran `apt install`) |
| App code (read-only) | `/opt/bboxai-desktop` |
| Runtime data (db password, venv, storage, weights) | `/var/lib/bboxai-desktop` (owned by `bboxai`) |
| Hostname | `bboxai` → `/etc/hosts` |

## Files in this directory

| File | Purpose |
|---|---|
| `build.sh` | Run on Linux. Pre-builds `bbox-web`, assembles the package tree, and runs `dpkg-deb --build`. |
| `control` | Package metadata and `Depends` (templated — `build.sh` substitutes the version). |
| `postinst` | Runs as root after files are unpacked. Creates the `bboxai` user, provisions Postgres, sets up the venv, writes `.env`, downloads the default weight, installs the systemd unit and nginx site, adds the `bboxai` hosts entry. Idempotent — safe to re-run on upgrade (dpkg always calls `postinst configure` on every install). |
| `prerm` | Stops and disables the systemd service before removal. |
| `postrm` | Removes the systemd unit and nginx site always; on **purge** only (not plain `remove`), also drops the Postgres role/db, deletes `/var/lib/bboxai-desktop` and `/var/www/bboxai-desktop`, removes the `bboxai` system user, and removes the hosts entry. |

`bboxai-api.service` and `bboxai-desktop.nginx.conf` (one directory up, in
`bboxai-desktop/packaging/`, shared with the Windows/general packaging
tooling) are the systemd unit and nginx site templates `postinst` installs.
`bboxai-enable-remote` (same parent directory) is the packaged equivalent of
`enable-remote.sh` — installed as a normal `/usr/bin` command, sets up
`bbox-agent` as a systemd service for away-from-home access via the shared
relay.

## Building it yourself

```bash
git clone https://github.com/zainalabidin85/bboxAI.git
cd bboxAI/bboxai-desktop/packaging/deb
./build.sh 1.0.0
# → out/bboxai-desktop_1.0.0_all.deb
```

Needs `dpkg-deb`, `rsync`, and Node.js (for the one-time `bbox-web` build) on
whatever machine you build on — none of these are needed on the *install*
target, only here.

## Installing

```bash
sudo apt install ./bboxai-desktop_1.0.0_all.deb
```

Using `apt install` (not `dpkg -i`) matters — it resolves and installs the
`Depends` list (`postgresql`, `nginx`, `libgl1`, etc.) automatically, which
`dpkg -i` alone won't do.

On first install `postinst` will, in order: create the `bboxai` system user,
make sure Postgres is actually running (not just installed) and provision
the `bboxai` role/db, build a venv and install `bbox-api`'s dependencies
(GPU-detected — pulls the CUDA 12.4 `torch` build if `nvidia-smi` is
present), write `.env` with a random `SECRET_KEY`, download the default
`yolo11n.pt` weight, install and start the systemd service, configure nginx,
and add `127.0.0.1 bboxai` to `/etc/hosts`.

When it's done: **`http://bboxai:8321`**. Register an account, then
optionally run `sudo bboxai-enable-remote` for away-from-home access.

## Uninstalling

```bash
sudo apt remove bboxai-desktop     # keeps your data
sudo apt purge bboxai-desktop      # also deletes the database, storage, and weights
```

Verified via a full install → smoke-test → purge cycle in a clean
`jrei/systemd-ubuntu:22.04` Docker container (register/login round-trip over
real Postgres, service/nginx/hosts-file/Postgres-role cleanup all checked
directly, not just assumed from the script).

## Troubleshooting / gotchas found while building this

These cost real debugging time in a clean container — worth reading before
re-deriving them:

- **Postgres wasn't running when `postinst` tried to provision the role/db.**
  `postgresql` being in `Depends` gets it *installed*, but doesn't guarantee
  it's *started* in every environment (it wasn't in the test container, due
  to a `policy-rc.d` init-script guard some minimal images ship with).
  `postinst` now explicitly runs `systemctl enable --now postgresql` before
  trying to connect, rather than assuming apt handled it.
- **`opencv-python-headless` still needs `libgl1`/`libglib2.0-0`** at import
  time despite the "headless" name — a very common gotcha with this package
  on minimal Linux images. `bbox-api` needs `cv2` for video frame
  extraction, so both are explicit `Depends` in `control`; without them the
  service installs fine and then crash-loops on startup with
  `ImportError: libGL.so.1: cannot open shared object file`.
- **Removing the `/etc/hosts` entry on purge via `sed -i` fails with
  `Device or resource busy`** when `/etc/hosts` is a bind mount, which it is
  inside a Docker container (and possibly other containerized/sandboxed
  environments). `sed -i` works by renaming a temp file over the original,
  which isn't possible on a bind-mounted inode. `postrm` rewrites the file
  in place instead (`grep -v ... > tmp && cat tmp > /etc/hosts`), which
  works because it never tries to replace the inode itself.

All three were caught by actually running the install → test → purge cycle
in a container, not by reading the scripts. If you change `postinst`/
`postrm`, re-test the same way — several of these looked completely correct
until they were actually run.
