# Deploying max-ammon.com on a VPS

The site runs as a **Docker container** on the VPS, reached through **Apache**
(reverse proxy + HTTPS via Let's Encrypt). The domain is pointed at the VPS with
an **IONOS DNS** record, and a **cron job** keeps the deployment in sync with the
git repo.

```
Visitor ──HTTPS──> Apache (:443) ──HTTP──> Docker container (127.0.0.1:3000)
                     │
              Let's Encrypt cert
```

Assumes a Debian/Ubuntu VPS with `sudo`. Replace these placeholders as you go:

| Placeholder | Meaning | Example |
|---|---|---|
| `YOUR_VPS_IP` | the server's public IPv4 | `203.0.113.10` |
| `max-ammon.com` | your domain (already correct below) | — |
| `/opt/max-ammon-site` | where the repo is cloned | — |

> **Order matters:** do sections **1 → 5** in order. DNS (3) must resolve to the
> VPS **before** you run Certbot (5), or the certificate request fails.

---

## 0. Install the tools (once)

```bash
# Docker + the compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"     # so you can run docker without sudo
# log out and back in (or: newgrp docker) for the group change to take effect

# Apache + the modules we need
sudo apt update
sudo apt install -y apache2
sudo a2enmod proxy proxy_http headers ssl rewrite
sudo systemctl restart apache2

# Certbot (Let's Encrypt) with the Apache plugin
sudo apt install -y certbot python3-certbot-apache

# Open the web ports (and NOT 3000 — the app stays on loopback)
sudo ufw allow 'Apache Full'   # opens 80 + 443; skip if you don't use ufw
```

---

## 1. Get the app running

```bash
sudo mkdir -p /opt/max-ammon-site
sudo chown "$USER":"$USER" /opt/max-ammon-site
git clone https://github.com/max-ammon/max-ammon-site.git /opt/max-ammon-site
cd /opt/max-ammon-site
```

**Create `.env`** (secrets — never committed):

```bash
cp .env.example .env
nano .env
```

Set at least:

```
SESSION_SECRET=<paste the one from your backup, or generate a new long random value>
SMTP_HOST=smtp.ionos.de
SMTP_PORT=587
SMTP_USER=3d@max-ammon.com
SMTP_PASS=<your mailbox password>
MAIL_FROM=Max Ammon <3d@max-ammon.com>
MAIL_TO=3d@max-ammon.com
```

(`NODE_ENV` and `HOST` are forced to production values by compose — leave them.)
Generate a secret if needed:
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

**Seed your content** — the media and database are **not** in git, so copy them
from your backup into the two volume folders (from your PC, e.g. with `scp`):

```bash
# run these on your PC (Windows: use WinSCP, or scp from PowerShell/Git Bash)
scp -r <backup>/uploads/*  "$USER"@YOUR_VPS_IP:/opt/max-ammon-site/uploads/
scp -r <backup>/data/*     "$USER"@YOUR_VPS_IP:/opt/max-ammon-site/data/
```

> Skip this and the gallery is empty. Your `maxammon0` admin login comes across
> inside `data/site.db`, so you won't need to set the account up again.

**Build and start:**

```bash
docker compose up -d --build      # first build takes a few minutes
docker compose ps                 # STATUS should be "healthy"
curl -I http://127.0.0.1:3000/    # expect HTTP/1.1 200
docker compose logs --tail=20     # should show "running at http://0.0.0.0:3000"
```

At this point the site works locally on the server but isn't public yet.

---

## 2. Automatic redeploys (cron)

A small script pulls the repo and rebuilds **only when there are changes**.

Create `/usr/local/bin/max-ammon-deploy.sh` (kept **outside** the repo so it
isn't rewritten by its own `git pull`):

```bash
sudo tee /usr/local/bin/max-ammon-deploy.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/opt/max-ammon-site
BRANCH=main

cd "$APP_DIR"
git fetch --quiet origin "$BRANCH"
LOCAL=$(git rev-parse "$BRANCH")
REMOTE=$(git rev-parse "origin/$BRANCH")

[ "$LOCAL" = "$REMOTE" ] && exit 0    # nothing new

echo "[$(date -Is)] deploying $LOCAL -> $REMOTE"
git pull --ff-only origin "$BRANCH"
docker compose up -d --build
docker image prune -f                 # clean up old layers
echo "[$(date -Is)] done"
EOF
sudo chmod +x /usr/local/bin/max-ammon-deploy.sh
```

Add it to **your** crontab (the user in the `docker` group, not root) with
`crontab -e` — checks every 5 minutes, and `flock` stops overlapping runs if a
build is slow:

```cron
*/5 * * * * /usr/bin/flock -n /tmp/max-ammon-deploy.lock /usr/local/bin/max-ammon-deploy.sh >> "$HOME/max-ammon-deploy.log" 2>&1
```

Test it once by hand: `/usr/local/bin/max-ammon-deploy.sh` — it should print
either "nothing new" (silent exit) or a deploy line. Watch it with
`tail -f ~/max-ammon-deploy.log`.

> The pull needs no credentials (the repo is public). **Don't edit git-tracked
> files on the VPS** — it would make `git pull --ff-only` fail. All server-side
> config lives in `.env` (untracked) and the volumes.

---

## 3. Point the domain at the VPS (IONOS DNS)

Find the server's public IP first: on the VPS run `curl -4 ifconfig.me`.

In the **IONOS control panel**:

1. **Menu → Domains & SSL** → click **max-ammon.com**.
2. Open the **DNS** tab ("Adjust DNS settings").
3. Set the **A record for the root** (Host shown as `@`, or the domain itself):
   - Type **A**, Host **@**, Value **YOUR_VPS_IP**.
   - If it currently points at IONOS hosting, change it. (If IONOS won't let you
     edit it, first remove the domain's "connection" to any IONOS website/hosting
     product, then choose *point to an IP address / A record*.)
4. Add an **A record for `www`**: Type **A**, Host **www**, Value **YOUR_VPS_IP**
   (or a CNAME `www` → `max-ammon.com`).
5. If your VPS has an IPv6 address, add **AAAA** records for `@` and `www` too.
6. Set **TTL** low (e.g. **300 seconds**) while setting up, so changes apply fast.
7. **Save.**

> ⚠️ **Do not touch the MX records** (`mx00.ionos.de` / `mx01.ionos.de`) or the
> mail-related TXT/SPF records. Changing the A record only affects the *website*
> — your email keeps working.

**Wait for it to propagate** (minutes, up to a couple of hours), then verify from
anywhere:

```bash
dig +short max-ammon.com        # should print YOUR_VPS_IP
dig +short www.max-ammon.com    # same
```

Don't continue to Certbot until both return the VPS IP.

---

## 4. Apache reverse proxy

Create `/etc/apache2/sites-available/max-ammon.com.conf`:

```apache
<VirtualHost *:80>
    ServerName max-ammon.com
    ServerAlias www.max-ammon.com

    # Let Certbot answer its challenge locally instead of proxying it.
    ProxyPass /.well-known/acme-challenge/ !

    # ProxyPreserveHost is REQUIRED: it forwards the real Host, which the app's
    # CSRF check compares against the browser's Origin. Without it, logging in
    # and submitting the contact form return 403.
    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/

    # Uploading a clip/master (especially over a slow connection) plus its
    # server-side processing can take a while; don't let the proxy time out at
    # Apache's 60s default. 1800s = 30 min, matching the app's request timeout.
    ProxyTimeout 1800

    # Tells the app the request arrived over HTTPS, so its secure login cookies
    # work. Correct once Certbot has run: it moves this block to the :443 vhost
    # and redirects all :80 traffic to :443.
    RequestHeader set X-Forwarded-Proto "https"

    ErrorLog  ${APACHE_LOG_DIR}/max-ammon_error.log
    CustomLog ${APACHE_LOG_DIR}/max-ammon_access.log combined
</VirtualHost>
```

Enable it and reload:

```bash
sudo a2ensite max-ammon.com
sudo a2dissite 000-default        # optional: drop the default site
sudo apache2ctl configtest        # must say "Syntax OK"
sudo systemctl reload apache2
```

Check (over plain HTTP for now): visiting `http://max-ammon.com` should show your
site.

---

## 5. HTTPS with Certbot

With DNS resolving (step 3) and Apache serving (step 4):

```bash
sudo certbot --apache \
  -d max-ammon.com -d www.max-ammon.com \
  --agree-tos -m 3d@max-ammon.com --redirect --no-eff-email
```

Certbot obtains the certificate, creates the `:443` vhost, and (with `--redirect`)
makes `http://` send everyone to `https://`.

**Confirm auto-renewal** (certificates last 90 days):

```bash
sudo certbot renew --dry-run
systemctl list-timers | grep certbot     # a renewal timer should be listed
```

**Finally, test the real thing:**

- Open `https://max-ammon.com` — padlock, site loads.
- Go to `https://max-ammon.com/admin`, log in as `maxammon0`, and confirm the
  session sticks (proves `X-Forwarded-Proto` + `ProxyPreserveHost` are right).
- Submit the contact form once — you should get the email.

---

## Everyday operations

```bash
cd /opt/max-ammon-site

docker compose logs -f            # live logs
docker compose ps                 # health/status
docker compose restart            # restart the app
docker compose up -d --build      # manual rebuild/redeploy (cron does this too)
docker compose down               # stop (volumes + your content are kept)
```

**Editing the site:** once live, do it through `https://max-ammon.com/admin`. That
writes to the VPS's `data/` + `uploads/` volumes — which are the live source of
truth. (Don't also edit locally and re-sync, or the two diverge.)

**Backups (do these regularly):** the whole site is two folders on the VPS —
`/opt/max-ammon-site/data/` and `/opt/max-ammon-site/uploads/`. A cron `tar` +
copy off-server, or a provider snapshot, covers you. Take `data/` with the app
stopped (or copy `site.db`, `site.db-wal`, `site.db-shm` together).

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| **502 Bad Gateway** | Container not running/healthy. `docker compose ps`, `docker compose logs`. |
| **403 on login / contact form** | `ProxyPreserveHost On` missing from the vhost. |
| **Login doesn't stay signed in** | `RequestHeader set X-Forwarded-Proto "https"` missing on the `:443` vhost. |
| **Certbot fails to validate** | DNS not resolving to the VPS yet, or port 80 blocked (`sudo ufw allow 'Apache Full'`), or the `ProxyPass /.well-known/... !` line is missing. |
| **Upload times out / 502 / 504** (esp. slow connection) | Proxy gave up before the upload finished. Raise `ProxyTimeout` (1800 above) and reload Apache; the app itself allows 30 min (`REQUEST_TIMEOUT_MS`). A short, small clip also uploads far faster — previews are downscaled to 700px anyway. |
| **Gallery empty after deploy** | The `uploads/` + `data/` volumes weren't seeded from your backup (step 1). |
| **`git pull` fails in cron** | A git-tracked file was edited on the VPS. Revert it (`git checkout -- <file>`); keep all config in `.env`. |
