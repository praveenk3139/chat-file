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

## Online MongoDB Atlas Setup

To store and verify all users in online MongoDB (MongoDB Atlas):

1. Create a free database cluster at [MongoDB Atlas](https://www.mongodb.com/atlas/database).
2. Create a Database User (username & password) under **Database Access**.
3. Under **Network Access**, allow access from anywhere (`0.0.0.0/0`) or your IP.
4. Click **Connect** → **Drivers** (Node.js) and copy your connection string:
   ```
   mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/chatshare?retryWrites=true&w=majority
   ```
5. Paste it in your [.env](file:///c:/Users/prave/Documents/chat-file-share/.env) file:
   ```env
   MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/chatshare?retryWrites=true&w=majority
   ```

### How User Verification & Online Storage Works:
- **Automatic Sync of Existing Users**: On startup, any existing users in `data/users.json` (including `praveen`, `pavithra`, etc.) are automatically synced into online MongoDB.
- **New User Registration**: When any new user creates an account (`/api/register`), they are stored directly into MongoDB.
- **Online User Verification**: During login (`/api/login`) and session validation (`/api/me`), credentials and blocked status are verified directly against online MongoDB.
- **Profile / Avatar Updates & Admin Actions**: Changes made to user accounts, avatars, passwords, and block status are saved and verified in real time in MongoDB.
- **Automatic Offline Fallback**: If `MONGODB_URI` is not set or network drops, the application smoothly falls back to local storage without crashing.

Optional environment variables:

| Variable         | Default                          | Purpose                          |
|------------------|-----------------------------------|-----------------------------------|
| `MONGODB_URI`    | *(optional)*                      | **Online MongoDB Atlas connection string** for cloud database user storage & verification |
| `PORT`           | `3000`                            | Port the server listens on       |
| `SESSION_SECRET` | (a default, **change for prod**)  | Secret used to sign session cookies |
| `GITHUB_TOKEN`   | *(optional)*                      | GitHub Personal Access Token (PAT) for fallback backup sync |
| `GITHUB_REPO`    | `praveenk3139/chat-file-share`    | GitHub repository (`owner/repo`) |
| `GITHUB_BRANCH`  | `main`                            | Branch to commit new users to    |

## How the pieces work

- **Unique usernames**: `/api/register` rejects a username (case-insensitively) if it's already taken, and only allows `3–20` letters/numbers/`_`/`.`/`-`.
- **Passwords**: hashed with `bcryptjs` before being written to `data/users.json` — plaintext passwords are never stored.
- **Chat**: after login, the client gets a short-lived socket token and connects via Socket.IO. Messages are routed to a room named after the recipient's username (`io.to(username)`), and every message is also appended to `data/messages.json` so history survives restarts.
- **File sharing**: uploads go through `multer` into the shared `uploads/` folder with a randomized on-disk filename (to avoid collisions/overwrites), while `data/files.json` tracks the *original* filename, sender, and recipient. Downloads are only served to the sender or recipient (`/api/files/:id/download` checks the session).

## Deploying

This project is configured and ready for deployment on **Vercel** as well as standard persistent Node hosts.

### Deploying to Vercel

The project includes `vercel.json`, `api/index.js`, and automatic serverless storage adaptations (`/tmp` fallback + HTTP message sending fallback).

#### Option A: Deploy via Vercel CLI (Fastest)
1. Install the Vercel CLI if you haven't:
   ```bash
   npm i -g vercel
   ```
2. In the project directory, run:
   ```bash
   vercel
   ```
3. Follow the prompts (use default settings). For production deployment:
   ```bash
   vercel --prod
   ```

#### Option B: Deploy via GitHub / Vercel Dashboard
1. Push this folder to a GitHub repository.
2. Go to [vercel.com/new](https://vercel.com/new) and import your repository.
3. In **Environment Variables**, add:
   - `SESSION_SECRET`: Any random secure string (e.g. `openssl rand -hex 32`).
   - `GITHUB_TOKEN`: *(Recommended)* A GitHub Personal Access Token (PAT) with `Contents: Read and write` permission. When any new user creates an account on your deployed Vercel site, it is automatically committed and pushed to `data/users.json` in your GitHub repository!
   - `MONGODB_URI`: *(Optional)* Your free MongoDB Atlas connection string (alternative permanent cloud storage).
4. Click **Deploy**.

> **Automatic GitHub Sync on Vercel**: Vercel serverless functions have ephemeral local storage. By providing `GITHUB_TOKEN` in your Vercel project settings, every new user registration automatically updates `data/users.json` in GitHub so accounts are never lost!

### Example: Render.com (For persistent WebSocket & disk)
1. Push this project to a GitHub repo.
2. New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add an environment variable `SESSION_SECRET` with a random value.
5. Add a **Persistent Disk** mounted at `/opt/render/project/src/data` and another at `.../uploads`.

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
