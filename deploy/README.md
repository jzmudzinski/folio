# Folio Cloud deploy

Deploy `folio cloud serve` as a systemd service on an existing VPS, no docker.

## Why bare-metal

Folio's binary is standalone (`bun build --compile` ships a single executable
with no runtime deps). systemd hardening (`ProtectSystem=strict`, dedicated
`folio` user, `ReadWritePaths=/var/lib/folio-cloud`) gives blast radius
comparable to a container without the docker daemon overhead.

Folio-cloud doesn't execute agent HTML on the server — it stores and serves
it for a sandboxed iframe in the reader's browser. Container vs bare doesn't
change the threat model for what runs in someone's browser.

## Build the release tarball (dev machine)

```bash
# Cross-compile from darwin-arm64 or linux-x64 to linux-x64:
bun build --compile --target=bun-linux-x64 ./bin/folio.ts --outfile dist/folio-linux-x64

# Pack everything install.sh needs:
tar czf folio-cloud-deploy.tar.gz \
  dist/folio-linux-x64 \
  themes/ \
  templates/ \
  deploy/folio-cloud.service \
  deploy/install.sh \
  deploy/update.sh \
  deploy/reverse-proxy.caddy.example \
  deploy/README.md
```

## First-time install on VPS

```bash
scp folio-cloud-deploy.tar.gz vps:/tmp/
ssh vps
cd /tmp && mkdir folio-deploy && tar xzf folio-cloud-deploy.tar.gz -C folio-deploy
cd folio-deploy
sudo ./deploy/install.sh
```

`install.sh`:
1. Creates `folio` system user (no login shell)
2. Installs binary to `/opt/folio/folio`, themes/templates alongside
3. Creates `/var/lib/folio-cloud/` (owned by `folio`)
4. Drops `folio-cloud.service`, reloads systemd, `enable --now`

## Set public URL

```bash
sudo systemctl edit folio-cloud
# Add:
#   [Service]
#   Environment=FOLIO_CLOUD_PUBLIC_URL=https://cloud.example.com
sudo systemctl restart folio-cloud
```

## Wire reverse proxy

Caddy example in `reverse-proxy.caddy.example`. Replace `cloud.example.com`
with your subdomain. Folio-cloud binds `127.0.0.1:8081` by default — never
expose it directly to the internet; always reach it through your TLS-
terminating proxy.

## Onboard a device

```bash
sudo -u folio /opt/folio/folio cloud pair-code
# → prints a 6-digit code, 10 min TTL
```

On the client device:

```bash
curl -X POST https://cloud.example.com/v1/auth/pair \
  -d '{"code":"482910","device_name":"laptop"}'
# → {"device_id":"...","token":"..."}
```

Stash the token somewhere safe (keychain, password manager). It's the only
copy — server stores only its hash. Lost = pair a new device.

## Update to a newer release

```bash
scp folio-cloud-deploy.tar.gz vps:/tmp/
ssh vps
cd /tmp && rm -rf folio-deploy && mkdir folio-deploy && tar xzf folio-cloud-deploy.tar.gz -C folio-deploy
cd folio-deploy
sudo ./deploy/update.sh
```

`update.sh` overwrites `/opt/folio/folio` + themes/templates + restarts the
service. Data in `/var/lib/folio-cloud/` is untouched.

## Operational notes

- **Logs:** `journalctl -u folio-cloud -f`
- **Status:** `systemctl status folio-cloud`
- **Stop:** `sudo systemctl stop folio-cloud` (resumable: `start`)
- **Disable autostart:** `sudo systemctl disable folio-cloud`
- **Memory cap:** unit sets `MemoryMax=512M`. Adjust via drop-in if you run
  larger payloads.
- **Backup:** `/var/lib/folio-cloud/` holds the cloud SQLite + assets blob
  tree. Ensure your VPS snapshot policy covers it, or add Litestream to
  replicate to S3/R2.
- **Port:** internal `:8081`. Conflicts with litellm only if litellm is also
  on `:8081` — by default it's `:8080`, so the two coexist.
