# max-ammon.com

Your portfolio site, now self-managed. The **public site looks exactly as it did
before**, but there is now a private admin area where you log in to edit text,
manage the gallery and media, change colours, set the demo video, and read
messages from the contact form.

- **Public site:** `/` (main page) and `/gallery`
- **Admin:** `/admin` (owner login required)

---

## Running it locally

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install        # first time only
npm run dev        # start with auto-reload (development)
# or
npm start          # start normally
```

Then open <http://localhost:3000>. Stop the server with **Ctrl+C**.

**First run:** go to <http://localhost:3000/admin>. Because no owner exists yet,
you'll be asked to **create your owner account** (choose a username + password).
After that, `/admin` is your login.

> **If you get `node : The term 'node' is not recognized`** — close that terminal
> and open a **new** one. Node was installed while this project was set up, and
> terminals opened before then don't see it yet. (Restarting the PC also works.)
> As a last resort you can call it directly:
> `& "C:\Program Files\nodejs\node.exe" server/index.js`

---

## What's where

```
server/            the backend (Express)
  app.js           middleware + routes wiring
  index.js         entry point
  db/              SQLite schema + seed (first-run content)
  routes/          public, auth, admin, contact
  services/        content, gallery, media, mailer, messages, auth
  middleware/      upload handling
views/             EJS templates (public pages + admin)
public/            new CSS/JS (admin, viewer, demo, responsive tweaks)
max-ammon.com/     your original site — still the home of fonts/images/CSS
uploads/           media you upload through the admin        (git-ignored)
data/              the database (site.db) + sessions         (git-ignored)
.env               secrets/config                            (git-ignored)
```

Your existing images/videos still live under `max-ammon.com/assets/…` and are
served unchanged. New uploads go under `uploads/`.

---

## Admin overview

| Section | What you can do |
|---|---|
| **Text** | Edit Demo/Skills/About/Contact/Gallery wording. |
| **Colours** | Change the colour scheme with a live preview; reset to defaults. |
| **Profile & banner** | Upload a new profile picture or About banner (or point at an existing path). |
| **Skills images** | Swap the five images shown with your four skill categories. |
| **Demo video** | Set the YouTube video + its shape (e.g. 3840×1646) + poster. |
| **Gallery** | Add/arrange projects; upload images/videos or embed YouTube; pick each project's thumbnail; add downloads. |
| **Messages** | Read (and archive/delete) contact-form messages. |

Clicking a project on the public gallery opens the **viewer** — arrow through the
project's images/videos/embeds, with a fullscreen button (arrow keys + Esc work
too).

---

## Contact form email

Messages are always saved to the admin **Messages** inbox. To also have them
**emailed** to you, put your mail (SMTP) details in `.env`:

```
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=you@max-ammon.com
SMTP_PASS=your-mailbox-password
MAIL_FROM="Max Ammon site <no-reply@max-ammon.com>"
MAIL_TO=3d@max-ammon.com
```

Restart the server after changing `.env`. Until SMTP is set, messages are just
saved (and logged to the console) — nothing is emailed.

---

## Putting it online (Docker)

The repo ships a `Dockerfile` + `docker-compose.yml`. The image is built from the
code in git; **your media and database are NOT in git** — they live in mounted
volumes, so they survive rebuilds and re-pulls.

### The one thing that matters: seed the volumes

Git gives the VPS the *code*, not the *site*. On the VPS, before the first run:

```bash
git clone https://github.com/max-ammon/max-ammon-site.git
cd max-ammon-site

# 1. secrets (never in git)
cp .env.example .env
#    then set a strong SESSION_SECRET (reuse the one from your backup to keep
#    existing logins), plus SMTP if you want contact emails.

# 2. YOUR CONTENT — copy from your backup into these two folders:
#      <backup>/uploads/  ->  ./uploads/
#      <backup>/data/     ->  ./data/     (site.db + -wal + -shm together)
#    Skip this and the gallery is empty (the first-run seed only produces the
#    original demo content, whose media isn't shipped either).

# 3. build + run
docker compose up -d --build
```

Because `./uploads` and `./data` are git-ignored bind mounts, `git pull` never
touches them — so your auto-deploy loop (`git pull && docker compose up -d
--build`) updates the code and leaves your content alone. Code-only changes
rebuild fast (dependencies are a cached layer).

### Reverse proxy + HTTPS (required in production)

`NODE_ENV=production` (set in compose) turns on secure cookies and trusts one
proxy hop, so the app must sit behind HTTPS that forwards `X-Forwarded-Proto` —
any normal reverse proxy does. Point the proxy at the container's port. Caddy:

```
max-ammon.com {
    reverse_proxy 127.0.0.1:3000
}
```

(For a proxy on the same host, change the compose port mapping to
`"127.0.0.1:3000:3000"` so only the proxy can reach the app.)

### Without Docker

It's a plain Node app: `npm ci --omit=dev`, create `.env`, `npm start`, keep it
alive with pm2, same reverse proxy. Node 20+ and **ffmpeg** on the PATH (for
gallery video previews; the app runs without it, just can't generate them).

### Backups

Two folders are your whole site — back them up regularly (a copy on external
media is fine):

- `data/` — `site.db` holds all text, colours, gallery structure and messages.
  Copy the whole folder, or stop the app first so `-wal`/`-shm` are merged in.
- `uploads/` — every image and video.

Everything else is code, safe on GitHub.

---

## Resetting the owner account

If you're ever locked out or want to start the account fresh:

```bash
npm run reset-owner
```

This clears the owner so the next visit to `/admin` shows the create-account
screen again. Your content, gallery and messages are untouched.
