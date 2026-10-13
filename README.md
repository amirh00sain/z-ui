# z-ui

Self-hosted Xray proxy management for small teams. Push configs over SSH, detect config drift, and generate multi-format subscriptions from one embedded Go binary.

[中文文档](./README.zh-CN.md)

## Features

- Node lifecycle management for Xray Reality deployments
- Config drift detection with scheduled SHA256 comparisons
- User and group management for subscription access control
- Subscription generation with health-aware node selection
- SSH-based sync with atomic uploads and remote service reloads
- Single-binary deployment with the frontend embedded via `go:embed`
- Runtime system settings managed from the web UI and persisted in the database

## Screenshots

Place screenshots in [`docs/screenshots/`](./docs/screenshots/) with the following naming convention:

- `01-login.png`
- `02-dashboard.png`
- `03-users.png`
- `04-profiles.png`
- `05-settings.png`
- `06-subscribe.png`

Recommended capture order:

1. Login screen
2. Dashboard overview
3. User management
4. Protocol configuration
5. System settings
6. Subscription portal

> The admin UI is English throughout. `README.zh-CN.md` stays available as a Chinese companion for operators who prefer it.

### Login

![Login](./docs/screenshots/01-login.png)

Secure access to the control panel with a lightweight sign-in screen, theme toggle, GitHub link, and clear operator-facing branding.

### Dashboard

![Dashboard](./docs/screenshots/02-dashboard.png)

The dashboard highlights node health, active users, subscription delivery, recent operations, and the current control-plane status in a single view.

### User Management

![Users](./docs/screenshots/03-users.png)

Manage subscription users, copy subscription links, open QR codes, assign groups, control expiration, and toggle access with consistent confirmation flows.

### Protocol Configuration

![Profiles](./docs/screenshots/04-profiles.png)

Define protocol templates, attach node-specific key material, and keep shared settings separate from node overrides for clearer operations.

### System Settings

![Settings](./docs/screenshots/05-settings.png)

Inspect runtime diagnostics, review deployment hints, and manage database-backed system settings without editing config files manually.

### Subscription Portal

![Subscribe](./docs/screenshots/06-subscribe.png)

Render a browser-friendly subscription page with QR import, node-level copy actions, theme support, and smart fallback links while keeping client access on the same `/sub/{token}` endpoint.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | Go 1.26.1+, Gin, GORM, Zap |
| Database | SQLite by default, PostgreSQL optional |
| Auth | JWT bearer tokens, bcrypt |
| Crypto | AES-GCM for secrets at rest, SHA256 for drift checks |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4 |

## Installation

### One-line install

Linux `amd64` and `arm64` hosts can install the latest release with:

```bash
curl -fsSL https://raw.githubusercontent.com/amirh00sain/z-ui/main/install.sh | sudo bash
```

The installer will:

- detect `amd64` or `arm64`
- download the latest GitHub Release
- verify `checksums.txt`
- install `z-ui` to `/usr/local/bin/z-ui`
- create `/etc/z-ui/config.yaml`
- create `/etc/z-ui/ssh/` for service-managed SSH keys
- create and start the `z-ui.service` systemd unit
- generate a random admin password, JWT secret, and crypto master key

### Manual install

| Platform | Archive |
| --- | --- |
| Linux amd64 | `z-ui_<version>_linux_amd64.tar.gz` |
| Linux arm64 | `z-ui_<version>_arm64.tar.gz` |
| macOS amd64 | `z-ui_<version>_darwin_amd64.tar.gz` |
| macOS arm64 | `z-ui_<version>_darwin_arm64.tar.gz` |

Manual installation steps:

1. Download the matching archive and `checksums.txt` from the latest [GitHub Release](https://github.com/amirh00sain/z-ui/releases).
2. Verify the archive with `sha256sum -c checksums.txt --ignore-missing`.
3. Extract the binary and place it in your preferred location.
4. Copy [`config.yaml.example`](./config.yaml.example) to `config.yaml` and adjust the values.
5. Start the service with `./z-ui`.

### Node bootstrap

For fresh nodes, use [`scripts/node-bootstrap.sh`](./scripts/node-bootstrap.sh) to prepare SSH access, install Xray, and optionally enable BBR before adding the node to the panel.

Typical flow:

```bash
curl -fsSL https://raw.githubusercontent.com/amirh00sain/z-ui/main/scripts/node-bootstrap.sh | sudo bash
```

The script supports interactive public-key input, or you can provide `AUTHORIZED_KEYS` up front for non-interactive usage:

```bash
curl -fsSL https://raw.githubusercontent.com/amirh00sain/z-ui/main/scripts/node-bootstrap.sh | \
sudo AUTHORIZED_KEYS=$'ssh-ed25519 AAAA... admin@main\nssh-ed25519 AAAA... root@main' bash
```

The script creates a timestamped backup of `sshd_config` before changing `PermitRootLogin`.

#### Auto-onboarding mode (v0.4.0+, recommended)

If you already run a panel, open the "One-click install" dialog in the node list; it generates a curl command that wires the panel SSH pubkey, installs Xray, and posts the node back to the panel — no need to paste pubkeys or manually add the node afterwards.

```bash
curl -fsSL https://raw.githubusercontent.com/amirh00sain/z-ui/main/scripts/node-bootstrap.sh | \
  sudo PANEL_URL=https://your-panel INSTALL_TOKEN=abc123... bash
```

`PANEL_URL` and `INSTALL_TOKEN` come from the dialog. Tokens default to 10-minute TTL, are single-use, and are bound to the first source IP that fetches the panel pubkey. The script falls back to the interactive flow when these variables are absent.

## Upgrade

Existing Linux installations can be upgraded by re-running the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/amirh00sain/z-ui/main/install.sh | sudo bash
```

The upgrade process will:

- replace `/usr/local/bin/z-ui` with the latest release binary
- keep the existing `/etc/z-ui/config.yaml`
- keep the existing `/etc/z-ui/ssh/` key directory
- keep the existing SQLite database or external database settings
- reload and restart `z-ui.service`

After the upgrade, you can confirm the running version with:

```bash
journalctl -u z-ui -n 20 --no-pager
```

## Quick Start From Source

**Prerequisites:** Go 1.26.1+, Node.js 24+

```bash
git clone https://github.com/amirh00sain/z-ui.git
cd z-ui

make build

cp config.yaml.example config.yaml
# edit jwt.secret and crypto.master_key before first production run

./z-ui
```

Open `http://localhost:8080` and sign in with the administrator account defined in `config.yaml`.

## Docker & Railway

The repository ships a multi-stage `Dockerfile`: the first stage builds the React
frontend, the second compiles the Go binary with the frontend embedded via
`go:embed`, and the final stage runs a single static binary as a non-root user.

```bash
docker build -t z-ui .
docker run --rm -p 8080:8080 \
  -v z-ui-data:/data \
  -e Z_UI_JWT_SECRET="$(openssl rand -hex 32)" \
  -e Z_UI_MASTER_KEY="$(openssl rand -hex 32)" \
  z-ui
```

The panel always listens on **port 8080** inside the container (`EXPOSE 8080`).
Everything is configured through `Z_UI_*` environment variables — every
setting in `config.yaml` maps to `Z_UI_` plus the dotted path with `.`
replaced by `_` (for example `server.port` → `Z_UI_SERVER_PORT`).

### Deploying on Railway

1. Push the repository to GitHub and create a new Railway service from it.
   Railway detects the root `Dockerfile` and builds the image.
2. In **Settings → Networking**, expose the service on port `8080`. Railway's
   proxy must target the same port the panel binds to.
3. Create a volume and mount it at `/data`. The SQLite database, backups,
   `known_hosts` and the SSH key all live there; without a volume the database
   is lost on every redeploy.
4. Set these variables in **Variables**:
   - `Z_UI_JWT_SECRET` — a long random string (sessions survive restarts)
   - `Z_UI_MASTER_KEY` — a 32-byte hex key used to encrypt node private keys
     at rest. **Back it up**: without it, encrypted Reality keys cannot be decrypted.
5. The first boot seeds `admin` / `admin` when no `admins` section is configured, so
   sign in immediately and change the password under Settings → Admins.
6. Optional: mount your SSH private key at `/data/ssh/id_ed25519` (the default
   `ssh.default_key_path` inside the image) so one-click node provisioning works.

Useful variables:

| Variable | Purpose |
| --- | --- |
| `Z_UI_SERVER_PORT` | Override the listen port (default `8080`) |
| `Z_UI_DATABASE_DRIVER` | `sqlite` (default) or `postgres` |
| `Z_UI_DATABASE_DSN` | Database DSN (default `/data/z-ui.db`) |
| `Z_UI_JWT_SECRET` | JWT signing secret |
| `Z_UI_MASTER_KEY` | 32-byte hex key for secrets at rest |
| `Z_UI_SUBSCRIPTION_BASE_URL` | Public URL used to build subscription links |
| `Z_UI_SSH_DEFAULT_KEY_PATH` | Private key used to reach nodes |
| `Z_UI_SSH_KNOWN_HOSTS_PATH` | known_hosts file (default `/data/known_hosts`) |

## Configuration

Copy [`config.yaml.example`](./config.yaml.example) to `config.yaml`.

```yaml
server:
  port: 8080
  mode: release

database:
  driver: sqlite
  dsn: z-ui.db

jwt:
  secret: "change-me-use-a-long-random-string"
  expire: 24

crypto:
  master_key: ""

ssh:
  default_port: 22
  default_user: "root"
  default_key_path: "/etc/z-ui/ssh/id_ed25519"
  known_hosts_path: "/var/lib/z-ui/known_hosts"

admins:
  - username: admin
    password: "change-me-now"
```

For Linux service deployments, the recommended SSH key location is `/etc/z-ui/ssh/id_ed25519`. The service-owned known_hosts file is stored at `/var/lib/z-ui/known_hosts`.

Runtime settings such as scheduler intervals, SSH defaults, subscription formatting, and Xray log options are stored in the database-backed system settings table and managed from the web UI.

Admin accounts live in the database since v0.5.0. The `admins` section only seeds the table on first start (the first entry becomes the super admin); afterwards manage accounts from **Settings → Admin accounts**.

Environment variable override:

```bash
Z_UI_MASTER_KEY=<hex-key> ./z-ui
```

Priority order:

1. `Z_UI_MASTER_KEY`
2. `config.yaml -> crypto.master_key`
3. auto-generated key on first start

## Development

```bash
# backend
make dev-backend

# frontend
make dev-frontend
```

The frontend dev server proxies API requests to `http://localhost:8080`.

## Release Automation

Pushing a tag named `v*` triggers GitHub Actions to:

1. build the frontend with Node 24
2. compile release binaries with Go 1.26
3. package `tar.gz` archives for Linux and macOS on `amd64` and `arm64`
4. generate `checksums.txt`
5. publish a GitHub Release with all artifacts attached

## License

MIT. See [LICENSE](./LICENSE).
