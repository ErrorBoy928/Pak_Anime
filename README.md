# Pak-Anime

Stream and download anime. Users create an account, browse the library, watch
in-browser, and download titles for offline viewing. Admins upload new
titles from a simple upload page.

## Stack

- Backend: Node.js + Express
- Database: [Turso](https://turso.tech) (a free, SQLite-compatible cloud
  database) via `@libsql/client`. For local development, no account is
  needed — it automatically falls back to a local SQLite file.
- File storage: [Cloudflare R2](https://developers.cloudflare.com/r2/) (free
  object storage, zero bandwidth fees) via the AWS S3 SDK, since R2 speaks
  the S3 API. For local development, no account is needed — it automatically
  falls back to saving files under `uploads/`.
- Sessions: express-session with a small custom store (`server/db/session-store.js`)
  backed by the same database, so logins survive a server restart.
- Uploads: multer, streamed through a temp file into storage (keeps memory
  usage flat regardless of video size).
- Frontend: plain HTML/CSS/JS, no build step — open any page, edit, refresh.

This is deliberately framework-light so changes are easy to make by hand.
When you're ready to wrap it as a desktop/mobile app, this same backend can
serve a WebView/Capacitor/Electron shell without changes.

## Local development

No cloud accounts needed for this — everything falls back to local files.

```bash
npm install
cp .env.example .env
npm run seed      # creates the first admin account, prints its password
npm start
```

Open http://localhost:3000

The seed script reads `ADMIN_EMAIL` / `ADMIN_USERNAME` / `ADMIN_PASSWORD`
from `.env` (or falls back to the defaults printed in `.env.example`).
**Change the admin password after your first login** — there's no in-app
"change password" screen yet, so for now update it directly:

```bash
node -e "
const bcrypt = require('bcryptjs');
const { run } = require('./server/db');
run('UPDATE users SET password_hash = ? WHERE username = ?', [bcrypt.hashSync('your-new-password', 10), 'admin']);
"
```

## Going live for free

This takes three free services, in this order: **Turso** (database),
**Cloudflare R2** (video/poster storage), and **Render** (hosting the app
itself). None of the three should charge you anything at the scale of a
personal/small project. Render's free tier does put your app to sleep after
inactivity (it wakes up again in a few seconds on the next visit) — that's
the trade-off for it being free.

### 1. Database — Turso

1. Sign up at [turso.tech](https://turso.tech) (free, no card needed).
2. From the dashboard, create a new database.
3. Copy its **URL** (starts with `libsql://...`) — this is `DATABASE_URL`.
4. Generate a token for it in the dashboard — this is `DATABASE_AUTH_TOKEN`.

### 2. File storage — Cloudflare R2

1. Sign up at [cloudflare.com](https://cloudflare.com). R2 asks you to add a
   payment method to switch it on, even for the free tier — you won't be
   charged unless you go over 10GB storage / 10 million reads a month,
   which is a lot of anime episodes.
2. In the dashboard, go to **R2 Object Storage** and create a bucket. Note
   its name — this is `R2_BUCKET`.
3. On the R2 Overview page, find your **Account ID** — this is
   `R2_ACCOUNT_ID`.
4. Still on the R2 page, go to **Manage R2 API Tokens** → **Create API
   Token**. Give it **Object Read & Write** permission, scoped to your new
   bucket. Copy the **Access Key ID** (`R2_ACCESS_KEY_ID`) and **Secret
   Access Key** (`R2_SECRET_ACCESS_KEY`) it shows you — the secret is only
   shown once.
5. Open your bucket → **Settings** → **CORS Policy** → **Add CORS policy**,
   and paste this in (this is what lets the admin upload page talk to R2
   directly from the browser — without it, uploads will fail):
   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3000
     }
   ]
   ```
   (Once your site is live, you can tighten `AllowedOrigins` to your actual
   `https://your-app.onrender.com` URL instead of `*` if you'd like.)

### 3. Push the code to GitHub

Render deploys from a GitHub repo.

1. Create a free account at [github.com](https://github.com) if you don't
   have one.
2. Create a new empty repository (e.g. `pak-anime`).
3. On the repo page, use **Add file → Upload files** and drag in everything
   from this project *except* the `node_modules` folder (Render installs
   dependencies itself) — no command line needed.

### 4. Deploy — Render

1. Sign up at [render.com](https://render.com) (free, no card needed) and
   connect your GitHub account.
2. **New → Web Service**, pick your `pak-anime` repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Under **Environment**, add these variables (same names as `.env.example`):
   `SESSION_SECRET` (any long random string), `ADMIN_EMAIL`,
   `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `DATABASE_URL`,
   `DATABASE_AUTH_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
6. Deploy. The admin account (using the `ADMIN_EMAIL` / `ADMIN_USERNAME` /
   `ADMIN_PASSWORD` you set above) is created automatically the first time
   the server starts — no Shell or extra step needed. (Render's free tier
   doesn't include Shell access, so this matters.)

Your site is now live at the `.onrender.com` address Render gives you.

## How it fits together

```
public/            static site — index, login, register, watch, admin, downloads
server/index.js    Express app, sessions, static file serving
server/routes/      auth.js (register/login/logout/me), anime.js (browse/upload/stream/download)
server/db/          Turso connection + schema, session store, seed script
server/storage/      Cloudflare R2 (or local disk fallback) for video/poster files
uploads/            local fallback storage — only used when R2 isn't configured
data/                local fallback database — only used when DATABASE_URL isn't set
```

- Anyone can browse the library and see title/poster/description.
- Watching and downloading require a logged-in account (`requireAuth`).
- Uploading and deleting titles require the admin flag (`requireAdmin`).
- Video streaming supports HTTP range requests, so the player can seek
  without downloading the whole file first — this works the same way
  whether the video lives on R2 or on local disk.

## Large video uploads

The admin upload page doesn't send video files through your Express
server — it uploads them straight from the browser to R2 (using a
short-lived signed URL your server hands out first). This matters because
Render's free-tier proxy — like most free hosts — silently cuts off large
requests that route through the app itself, typically somewhere in the
300–450MB range. Sending the file directly to R2 avoids that limit
entirely; only the small metadata (title, genre, etc.) goes through Render.
This needs the R2 CORS policy from step 5 above to work. Local development
(no R2 configured) instead uploads through the server the simple way,
since there's no such limit on your own machine.

## Series and episodes

Uploading with **"This is an episode of a series/season"** checked (on the
admin upload page) groups that upload under a series. Type the exact same
series name for every episode of the same show — matching is by name (not
case-sensitive), so a typo creates a second, separate series by mistake.

- The library grid shows one card per series (using the first episode's
  poster/title), not one card per episode — clicking it opens episode 1.
- A poster only needs to be uploaded once, on the first episode; later
  episodes without their own poster automatically use the series' poster.
- On the watch page, opening any episode shows the full episode list for
  that series underneath the description, each one clickable.
- Uploads without the series checkbox behave exactly as before — a single
  standalone entry (for movies, one-offs, etc).
- The admin panel's "Uploaded titles" list still shows every episode
  individually (with its series name and episode number), so any single
  episode can be deleted without affecting the rest of the series.

## Downloads (in-app, per account)

The "Download" button on the watch page doesn't hand the file to the
browser's normal Downloads folder. It streams the video into the app's own
storage (IndexedDB, via `public/js/downloads.js`) tagged to the logged-in
username, and it shows up under **My Downloads** in the nav. Playback there
works fully offline, straight from a Blob — no server round-trip.

Trade-off worth knowing: this storage lives in the browser on that one
device, so downloads don't follow the account across devices the way
YouTube's do. Making that possible would mean storing a copy of every
download per user in R2 as well — more storage cost — so it's left as
local-device storage for now.

## Pre-roll ads

`public/js/ads-config.js` holds one line that matters: `AD_TAG_URL`. It's
currently pointed at Google's public IMA test tag, which always serves a
real ad for testing but pays nothing. Once you're signed up with an ad
network — Google AdSense for Video / Ad Manager, Adsterra, ExoClick, and
PropellerAds all offer this — drop their VAST tag URL in and nothing else
needs to change. The player (`public/watch.html`) uses Google's IMA SDK,
which is the standard way to play VAST ads and works with virtually any
network that offers one.

Ad networks generally review a site before serving real (paying) ads, so
expect an approval step with whichever one you pick.

## Dark / light mode

Toggled from the navbar, persisted in `localStorage`, applied via a
`data-theme` attribute on `<html>` and CSS variables in `public/css/theme.css`.
Respects the visitor's OS preference on first visit.

## Turning this into a packaged app later

Since there's no build step and everything is server-rendered/static, you
have two straightforward paths once you're ready:

1. **Wrap it**: point Capacitor/Electron/a WebView at this same Express
   server (self-hosted or deployed) — minimal changes needed.
2. **Go native later**: keep this Express API as-is and build native
   screens that call the same `/api/auth/*` and `/api/anime/*` endpoints.
