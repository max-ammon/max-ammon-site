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

## Putting it online

This is a normal Node app, so any host that runs Node works. You need somewhere
with **persistent disk** (for `data/` and `uploads/`) — a small VPS, or a
platform like Render / Railway / Fly.io.

Typical VPS setup:

1. Copy the project to the server (git clone, then copy `max-ammon.com/assets`,
   `uploads/` and `data/` separately — media and the DB are **not** in git).
2. `npm install --omit=dev` (or `npm install`).
3. Create `.env` with `NODE_ENV=production`, a strong `SESSION_SECRET`
   (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`),
   your `PORT`, and the SMTP settings.
4. Keep it running with a process manager, e.g. **pm2**:
   `pm2 start server/index.js --name max-ammon`.
5. Put a reverse proxy (Caddy or nginx) in front for your domain + HTTPS.
   Caddy example:
   ```
   max-ammon.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```
   (Caddy gets HTTPS certificates automatically.)

`NODE_ENV=production` turns on secure cookies and `trust proxy`, so run it behind
HTTPS in production.

### Backups

Everything that matters is two things — back them up regularly:

- `data/site.db` — all your text, colours, gallery structure and messages.
- `uploads/` — media you uploaded through the admin.

(Your original media under `max-ammon.com/assets/` should also be kept safe; it
isn't in git either.)

---

## Resetting the owner account

If you're ever locked out or want to start the account fresh:

```bash
npm run reset-owner
```

This clears the owner so the next visit to `/admin` shows the create-account
screen again. Your content, gallery and messages are untouched.
