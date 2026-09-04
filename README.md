# ChatShare — Login, Chat & File Sharing by Username

A small full-stack web app with:

- **Sign up / log in** with a **unique username** and password (passwords hashed with bcrypt, sessions via cookies).
- **Live private chat** between any two users, addressed by username (Socket.IO), with history saved to disk.
- **File sharing by username** — pick a user, attach a file, they receive it instantly. Files live in one shared `uploads/` folder on the server.

No external database required — it uses simple JSON files on disk, so it deploys anywhere Node.js runs.

## Project structure

```
chat-file-share/
├── server.js              # Express + Socket.IO backend (auth, chat, file routes)
├── package.json
├── data/                  # users.json, messages.json, files.json (auto-created)
├── uploads/               # the shared folder where uploaded files are stored
└── public/                # frontend (login, register, dashboard)
    ├── login.html
    ├── register.html
    ├── dashboard.html
    ├── css/style.css
    └── js/dashboard.js
```

## Run it locally

```bash
npm install
npm start
```

Then open **http://localhost:3000** — register a couple of accounts (in two different browser tabs/windows or incognito), and chat / send files between them.

Optional environment variables:

| Variable         | Default                          | Purpose                          |
|------------------|-----------------------------------|-----------------------------------|
| `PORT`           | `3000`                            | Port the server listens on       |
| `SESSION_SECRET` | (a default, **change for prod**)  | Secret used to sign session cookies |

## How the pieces work

- **Unique usernames**: `/api/register` rejects a username (case-insensitively) if it's already taken, and only allows `3–20` letters/numbers/`_`/`.`/`-`.
- **Passwords**: hashed with `bcryptjs` before being written to `data/users.json` — plaintext passwords are never stored.
- **Chat**: after login, the client gets a short-lived socket token and connects via Socket.IO. Messages are routed to a room named after the recipient's username (`io.to(username)`), and every message is also appended to `data/messages.json` so history survives restarts.
- **File sharing**: uploads go through `multer` into the shared `uploads/` folder with a randomized on-disk filename (to avoid collisions/overwrites), while `data/files.json` tracks the *original* filename, sender, and recipient. Downloads are only served to the sender or recipient (`/api/files/:id/download` checks the session).

## Deploying

This is a standard Node.js + Express app, so it runs on most Node hosts. A few notes for any of them:

1. **Persistent disk** — because file uploads and the JSON "database" live on disk, pick a host that gives you a persistent volume (Railway, Render, a VPS, Fly.io with a volume, etc.). Purely ephemeral/serverless platforms (e.g. plain Vercel functions) will lose uploaded files and user data on redeploy — avoid those unless you swap in a real database + object storage first.
2. **Set `SESSION_SECRET`** to a long random string in the host's environment variables — don't rely on the default.
3. **Start command**: `npm install && npm start`.
4. **Port**: the app reads `process.env.PORT`, which most hosts (Railway, Render, Heroku) set automatically.

### Example: Render.com
1. Push this project to a GitHub repo.
2. New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add an environment variable `SESSION_SECRET` with a random value.
5. Add a **Persistent Disk** mounted at `/opt/render/project/src/data` and another (or the same, bigger) one at `.../uploads`, so uploads and accounts survive redeploys.

### Example: a plain VPS (Ubuntu)
```bash
git clone <your-repo>
cd chat-file-share
npm install
SESSION_SECRET="$(openssl rand -hex 32)" PORT=3000 npm start
# put nginx or Caddy in front for HTTPS + a domain, and use pm2 or systemd to keep it running
```

## Limitations / things to harden before real production use

- The JSON-file "database" is fine for a small number of users; for heavier use, swap in Postgres/SQLite and use a real object store (S3, etc.) for files.
- There's a single shared `uploads/` folder — that's intentional per the request, but for stricter isolation you could namespace it per-recipient (`uploads/<username>/...`).
- Add rate limiting on `/api/login` and `/api/register` if exposing this publicly.
- Consider enforcing HTTPS-only cookies (`cookie.secure = true`) once deployed behind HTTPS.
