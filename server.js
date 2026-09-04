/**
 * Chat + File Share server
 * - Unique username/password login (passwords hashed with bcrypt)
 * - Admin account: praveen / 3139 with full management rights
 * - Block & delete users, monitor all conversations & files
 * - User avatars: custom photo upload anytime + instant real-time sync
 * - Private 1:1 chat between users (Socket.IO, persisted to data/messages.json)
 * - File sharing by username (stored in /uploads, a shared folder, metadata in data/files.json)
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { nanoid } = require('nanoid');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-in-production';

const ADMIN_USERNAME = 'praveen';
const ADMIN_PASSWORD = '3139';

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const BASE_STORAGE = isVercel ? path.join('/tmp', 'chat-file-share') : __dirname;

const DATA_DIR = path.join(BASE_STORAGE, 'data');
const UPLOAD_DIR = path.join(BASE_STORAGE, 'uploads');
const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const FILES_FILE = path.join(DATA_DIR, 'files.json');

// ---------- bootstrap data files/folders ----------
for (const dir of [DATA_DIR, UPLOAD_DIR, AVATAR_DIR]) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`Directory creation warning (${dir}):`, err.message);
  }
}
for (const [file, initial, defaultFileName] of [
  [USERS_FILE, {}, 'users.json'],
  [MESSAGES_FILE, [], 'messages.json'],
  [FILES_FILE, [], 'files.json']
]) {
  try {
    if (!fs.existsSync(file)) {
      const seedFile = path.join(__dirname, 'data', defaultFileName);
      if (isVercel && fs.existsSync(seedFile)) {
        fs.copyFileSync(seedFile, file);
      } else {
        fs.writeFileSync(file, JSON.stringify(initial, null, 2));
      }
    }
  } catch (err) {
    console.error(`File init warning (${file}):`, err.message);
  }
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return file === USERS_FILE ? {} : [];
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------- seed admin user ----------
function ensureAdminUser() {
  const users = readJSON(USERS_FILE);
  const current = users[ADMIN_USERNAME];
  if (!current) {
    users[ADMIN_USERNAME] = {
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      createdAt: Date.now(),
      isAdmin: true,
      isBlocked: false
    };
    writeJSON(USERS_FILE, users);
    console.log(`Admin user "${ADMIN_USERNAME}" seeded successfully.`);
  } else {
    users[ADMIN_USERNAME].isAdmin = true;
    users[ADMIN_USERNAME].isBlocked = false;
    if (!bcrypt.compareSync(ADMIN_PASSWORD, current.passwordHash)) {
      users[ADMIN_USERNAME].passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    }
    writeJSON(USERS_FILE, users);
  }
}
ensureAdminUser();

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateDefaultAvatarSvg(username) {
  const name = String(username || 'User').trim();
  const initials = (name.length >= 2 ? name.slice(0, 2) : name).toUpperCase();
  
  const palettes = [
    ['#4f46e5', '#7c3aed'], // indigo to purple
    ['#2563eb', '#06b6d4'], // blue to cyan
    ['#059669', '#10b981'], // emerald to teal
    ['#d97706', '#ea580c'], // amber to orange
    ['#db2777', '#f43f5e'], // pink to rose
    ['#0891b2', '#0284c7'], // cyan to sky
    ['#9333ea', '#c026d3'], // purple to fuchsia
    ['#16a34a', '#84cc16']  // green to lime
  ];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const [c1, c2] = palettes[Math.abs(hash) % palettes.length];
  const gradId = `g_${Math.abs(hash)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="50" fill="url(#${gradId})" />
  <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <text x="50" y="58" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="36" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="middle" letter-spacing="1">${escapeXml(initials)}</text>
</svg>`;
}

function getUserAvatarUrl(userRecord, username) {
  if (userRecord && userRecord.avatarUpdatedAt) {
    return `/api/avatar/${encodeURIComponent(username)}?t=${userRecord.avatarUpdatedAt}`;
  }
  return `/api/avatar/${encodeURIComponent(username)}`;
}

// ---------- express app ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    sameSite: 'lax'
  }
});
app.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, 'public')));

// in-memory map of live socket auth tokens -> username (issued at login)
const socketTokens = new Map();

function requireAuth(req, res, next) {
  if (!req.session.username) return res.status(401).json({ error: 'Not logged in' });
  const users = readJSON(USERS_FILE);
  const user = users[req.session.username];
  if (!user) return res.status(401).json({ error: 'User account not found' });
  if (user.isBlocked) {
    req.session.destroy(() => {});
    return res.status(403).json({ error: 'Your account has been blocked by the admin.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.username) return res.status(401).json({ error: 'Not logged in' });
  const users = readJSON(USERS_FILE);
  const user = users[req.session.username];
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: 'Access denied: Admin privileges required.' });
  }
  next();
}

// ---------- AUTH ROUTES ----------

app.post('/api/register', (req, res) => {
  let { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  username = String(username).trim();
  if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 chars: letters, numbers, _ . -' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const users = readJSON(USERS_FILE);
  const exists = Object.keys(users).some(u => u.toLowerCase() === username.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'That username is already taken' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  users[username] = {
    passwordHash,
    createdAt: Date.now(),
    isAdmin: false,
    isBlocked: false
  };
  writeJSON(USERS_FILE, users);

  const initialAvatarUrl = getUserAvatarUrl(users[username], username);
  io.emit('new-user', { username, avatarUrl: initialAvatarUrl });

  res.json({ ok: true, message: 'Account created. You can now log in.' });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const users = readJSON(USERS_FILE);
  const record = users[username];
  if (!record || !bcrypt.compareSync(password, record.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (record.isBlocked) {
    return res.status(403).json({ error: 'Your account has been blocked by the admin.' });
  }

  req.session.username = username;
  req.session.isAdmin = !!record.isAdmin;
  const token = nanoid();
  socketTokens.set(token, username);
  req.session.socketToken = token;

  const avatarUrl = getUserAvatarUrl(record, username);
  res.json({
    ok: true,
    username,
    isAdmin: !!record.isAdmin,
    socketToken: token,
    avatarUrl
  });
});

app.post('/api/logout', (req, res) => {
  const token = req.session.socketToken;
  if (token) socketTokens.delete(token);
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  const users = readJSON(USERS_FILE);
  const user = users[req.session.username];
  const avatarUrl = getUserAvatarUrl(user, req.session.username);
  res.json({
    username: req.session.username,
    isAdmin: !!user.isAdmin,
    socketToken: req.session.socketToken,
    avatarUrl
  });
});

app.get('/api/users', requireAuth, (req, res) => {
  const users = readJSON(USERS_FILE);
  const list = Object.keys(users)
    .filter(u => u !== req.session.username && !users[u].isBlocked)
    .map(u => ({
      username: u,
      avatarUrl: getUserAvatarUrl(users[u], u)
    }));
  res.json({ users: list });
});

// ---------- AVATAR ROUTES (ANYTIME CHANGE) ----------

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `avatar_${req.session.username}_${Date.now()}${ext}`);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, WebP, GIF) are allowed'));
    }
  }
});

app.post('/api/profile/avatar', requireAuth, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Avatar upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });

    const username = req.session.username;
    const users = readJSON(USERS_FILE);
    if (!users[username]) return res.status(404).json({ error: 'User not found' });

    // clean up previous uploaded avatar file
    if (users[username].avatarFile) {
      const oldPath = path.join(AVATAR_DIR, users[username].avatarFile);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (e) {}
      }
    }

    users[username].avatarFile = req.file.filename;
    users[username].avatarUpdatedAt = Date.now();
    writeJSON(USERS_FILE, users);

    const avatarUrl = getUserAvatarUrl(users[username], username);

    // broadcast avatar update to all connected clients
    io.emit('avatar-updated', { username, avatarUrl });

    res.json({ ok: true, avatarUrl, message: 'Profile picture updated successfully!' });
  });
});

app.get('/api/avatar/:username', (req, res) => {
  const username = req.params.username;
  const users = readJSON(USERS_FILE);
  const user = users[username];

  if (user && user.avatarFile) {
    const filePath = path.join(AVATAR_DIR, user.avatarFile);
    if (fs.existsSync(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(filePath);
    }
  }

  // Generate deterministic modern SVG avatar
  const svg = generateDefaultAvatarSvg(username);
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(svg);
});

// ---------- CHAT HISTORY ----------

function roomKeyFor(a, b) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join('::');
}

app.get('/api/messages/:withUser', requireAuth, (req, res) => {
  const me = req.session.username;
  const other = req.params.withUser;
  const key = roomKeyFor(me, other);
  const all = readJSON(MESSAGES_FILE);
  const users = readJSON(USERS_FILE);
  const thread = all.filter(m => roomKeyFor(m.from, m.to) === key).map(m => ({
    ...m,
    avatarUrl: m.avatarUrl || getUserAvatarUrl(users[m.from], m.from)
  }));
  res.json({ messages: thread });
});

// HTTP fallback for sending chat messages (essential for serverless environments like Vercel)
app.post('/api/messages/send', requireAuth, (req, res) => {
  const { to, text } = req.body || {};
  const cleanText = String(text || '').trim();
  if (!to || !cleanText) {
    return res.status(400).json({ error: 'Recipient and message text are required' });
  }

  const users = readJSON(USERS_FILE);
  if (!users[to]) {
    return res.status(404).json({ error: `User "${to}" does not exist` });
  }
  if (users[to].isBlocked) {
    return res.status(403).json({ error: `Cannot message "${to}" because this account is blocked.` });
  }

  const sender = users[req.session.username];
  const avatarUrl = getUserAvatarUrl(sender, req.session.username);

  const message = {
    id: nanoid(),
    from: req.session.username,
    to,
    text: cleanText,
    avatarUrl,
    timestamp: Date.now()
  };

  const all = readJSON(MESSAGES_FILE);
  all.push(message);
  writeJSON(MESSAGES_FILE, all);

  try {
    io.to(to).emit('private-message', message);
    io.to(req.session.username).emit('private-message', message);
  } catch (e) {}

  res.json({ ok: true, message });
});

// Incremental message polling endpoint for serverless/Vercel clients
app.get('/api/messages/:withUser/poll', requireAuth, (req, res) => {
  const me = req.session.username;
  const other = req.params.withUser;
  const since = parseInt(req.query.since || '0', 10);
  const key = roomKeyFor(me, other);
  const all = readJSON(MESSAGES_FILE);
  const users = readJSON(USERS_FILE);
  const newMessages = all
    .filter(m => roomKeyFor(m.from, m.to) === key && m.timestamp > since)
    .map(m => ({
      ...m,
      avatarUrl: m.avatarUrl || getUserAvatarUrl(users[m.from], m.from)
    }));
  res.json({ messages: newMessages });
});

// ---------- FILE SHARING ----------

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9_.\-]/g, '_');
    cb(null, `${Date.now()}_${nanoid(6)}_${safeOriginal}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB cap

app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  const me = req.session.username;
  const to = req.body.to;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const users = readJSON(USERS_FILE);
  if (!to || !users[to]) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Recipient username does not exist' });
  }
  if (users[to].isBlocked) {
    fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Cannot send files to a blocked user' });
  }

  const filesDb = readJSON(FILES_FILE);
  const record = {
    id: nanoid(),
    storedName: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    from: me,
    to,
    uploadedAt: Date.now()
  };
  filesDb.push(record);
  writeJSON(FILES_FILE, filesDb);

  // notify recipient live if connected
  io.to(to).emit('file-shared', record);

  res.json({ ok: true, file: record });
});

// list files visible to me (sent by me or sent to me)
app.get('/api/files', requireAuth, (req, res) => {
  const me = req.session.username;
  const filesDb = readJSON(FILES_FILE);
  const mine = filesDb.filter(f => f.from === me || f.to === me)
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
  res.json({ files: mine });
});

app.get('/api/files/:id/download', requireAuth, (req, res) => {
  const me = req.session.username;
  const users = readJSON(USERS_FILE);
  const isAdmin = users[me] && users[me].isAdmin;
  const filesDb = readJSON(FILES_FILE);
  const record = filesDb.find(f => f.id === req.params.id);
  if (!record) return res.status(404).send('File not found');
  if (!isAdmin && record.from !== me && record.to !== me) {
    return res.status(403).send('You do not have access to this file');
  }
  const fullPath = path.join(UPLOAD_DIR, record.storedName);
  if (!fs.existsSync(fullPath)) return res.status(404).send('File missing on server');
  res.download(fullPath, record.originalName);
});

// ==========================================
// ---------- ADMIN ENDPOINTS (PRAVEEN) -----
// ==========================================

// 1. Get stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const users = readJSON(USERS_FILE);
  const messages = readJSON(MESSAGES_FILE);
  const files = readJSON(FILES_FILE);

  const usernames = Object.keys(users);
  const totalUsers = usernames.length;
  const blockedUsers = usernames.filter(u => users[u].isBlocked).length;
  const activeUsers = totalUsers - blockedUsers;

  res.json({
    totalUsers,
    activeUsers,
    blockedUsers,
    totalMessages: messages.length,
    totalFiles: files.length
  });
});

// 2. Get all users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = readJSON(USERS_FILE);
  const list = Object.keys(users).map(u => ({
    username: u,
    avatarUrl: getUserAvatarUrl(users[u], u),
    createdAt: users[u].createdAt || Date.now(),
    isAdmin: !!users[u].isAdmin,
    isBlocked: !!users[u].isBlocked
  }));
  res.json({ users: list });
});

// 3. Block user
app.post('/api/admin/users/:username/block', requireAdmin, (req, res) => {
  const target = req.params.username;
  if (target === ADMIN_USERNAME) {
    return res.status(400).json({ error: 'Cannot block the primary admin account' });
  }
  const users = readJSON(USERS_FILE);
  if (!users[target]) return res.status(404).json({ error: 'User not found' });

  users[target].isBlocked = true;
  writeJSON(USERS_FILE, users);

  // Real-time disconnect and notify target user
  io.to(target).emit('account-blocked', { reason: 'Your account has been blocked by the admin.' });

  // Disconnect any active socket connection for this username
  for (const [id, socket] of io.of('/').sockets) {
    if (socket.username === target) {
      socket.disconnect(true);
    }
  }

  io.emit('admin-user-updated', { username: target, isBlocked: true });
  res.json({ ok: true, message: `User "${target}" has been blocked.` });
});

// 4. Unblock user
app.post('/api/admin/users/:username/unblock', requireAdmin, (req, res) => {
  const target = req.params.username;
  const users = readJSON(USERS_FILE);
  if (!users[target]) return res.status(404).json({ error: 'User not found' });

  users[target].isBlocked = false;
  writeJSON(USERS_FILE, users);

  io.emit('admin-user-updated', { username: target, isBlocked: false });
  res.json({ ok: true, message: `User "${target}" has been unblocked.` });
});

// 5. Delete user
app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const target = req.params.username;
  if (target === ADMIN_USERNAME) {
    return res.status(400).json({ error: 'Cannot delete the primary admin account' });
  }
  const users = readJSON(USERS_FILE);
  if (!users[target]) return res.status(404).json({ error: 'User not found' });

  // Delete custom avatar file if present
  if (users[target].avatarFile) {
    const avatarPath = path.join(AVATAR_DIR, users[target].avatarFile);
    if (fs.existsSync(avatarPath)) {
      try { fs.unlinkSync(avatarPath); } catch (e) {}
    }
  }

  delete users[target];
  writeJSON(USERS_FILE, users);

  // Notify and disconnect user
  io.to(target).emit('account-deleted');
  for (const [id, socket] of io.of('/').sockets) {
    if (socket.username === target) {
      socket.disconnect(true);
    }
  }

  // Broadcast deletion so all clients remove user from contact lists
  io.emit('user-deleted', { username: target });

  res.json({ ok: true, message: `User "${target}" has been deleted.` });
});

// 6. Get all conversations summary
app.get('/api/admin/conversations', requireAdmin, (req, res) => {
  const messages = readJSON(MESSAGES_FILE);
  const files = readJSON(FILES_FILE);
  const users = readJSON(USERS_FILE);

  const threads = new Map();

  messages.forEach(m => {
    const key = roomKeyFor(m.from, m.to);
    if (!threads.has(key)) {
      threads.set(key, {
        key,
        user1: [m.from, m.to].sort()[0],
        user2: [m.from, m.to].sort()[1],
        messageCount: 0,
        fileCount: 0,
        lastTimestamp: 0,
        lastPreview: ''
      });
    }
    const t = threads.get(key);
    t.messageCount += 1;
    if (m.timestamp > t.lastTimestamp) {
      t.lastTimestamp = m.timestamp;
      t.lastPreview = `${m.from}: ${m.text}`;
    }
  });

  files.forEach(f => {
    const key = roomKeyFor(f.from, f.to);
    if (!threads.has(key)) {
      threads.set(key, {
        key,
        user1: [f.from, f.to].sort()[0],
        user2: [f.from, f.to].sort()[1],
        messageCount: 0,
        fileCount: 0,
        lastTimestamp: 0,
        lastPreview: ''
      });
    }
    const t = threads.get(key);
    t.fileCount += 1;
    if (f.uploadedAt > t.lastTimestamp) {
      t.lastTimestamp = f.uploadedAt;
      t.lastPreview = `${f.from} sent a file: ${f.originalName}`;
    }
  });

  const list = Array.from(threads.values()).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  res.json({ conversations: list });
});

// 7. Inspect conversation between two users
app.get('/api/admin/messages/:userA/:userB', requireAdmin, (req, res) => {
  const { userA, userB } = req.params;
  const key = roomKeyFor(userA, userB);
  const allMessages = readJSON(MESSAGES_FILE);
  const allFiles = readJSON(FILES_FILE);
  const users = readJSON(USERS_FILE);

  const threadMessages = allMessages.filter(m => roomKeyFor(m.from, m.to) === key).map(m => ({
    ...m,
    avatarUrl: m.avatarUrl || getUserAvatarUrl(users[m.from], m.from)
  }));

  const threadFiles = allFiles.filter(f => roomKeyFor(f.from, f.to) === key);

  res.json({ messages: threadMessages, files: threadFiles });
});

// 8. Admin delete message
app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  const all = readJSON(MESSAGES_FILE);
  const filtered = all.filter(m => m.id !== req.params.id);
  writeJSON(MESSAGES_FILE, filtered);
  res.json({ ok: true });
});

// 9. Admin delete file
app.delete('/api/admin/files/:id', requireAdmin, (req, res) => {
  const all = readJSON(FILES_FILE);
  const file = all.find(f => f.id === req.params.id);
  if (file) {
    const fullPath = path.join(UPLOAD_DIR, file.storedName);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch (e) {}
    }
  }
  const filtered = all.filter(f => f.id !== req.params.id);
  writeJSON(FILES_FILE, filtered);
  res.json({ ok: true });
});

// ---------- fallback routes for pages ----------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', req.session.username ? 'dashboard.html' : 'login.html'));
});

// ---------- SOCKET.IO (real-time chat) ----------

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const username = socketTokens.get(token);
  if (!username) return next(new Error('Unauthorized socket connection'));

  const users = readJSON(USERS_FILE);
  const user = users[username];
  if (!user) return next(new Error('User account not found'));
  if (user.isBlocked) return next(new Error('Account is blocked by admin'));

  socket.username = username;
  socket.isAdmin = !!user.isAdmin;
  next();
});

io.on('connection', (socket) => {
  socket.join(socket.username);
  if (socket.isAdmin) {
    socket.join('admin-room');
  }

  socket.on('private-message', (payload) => {
    const to = payload && payload.to;
    const text = payload && String(payload.text || '').trim();
    if (!to || !text) return;

    const users = readJSON(USERS_FILE);
    if (!users[to]) {
      socket.emit('error-message', { error: `User "${to}" does not exist` });
      return;
    }
    if (users[to].isBlocked) {
      socket.emit('error-message', { error: `Cannot message "${to}" because this account is blocked.` });
      return;
    }

    const sender = users[socket.username];
    const avatarUrl = getUserAvatarUrl(sender, socket.username);

    const message = {
      id: nanoid(),
      from: socket.username,
      to,
      text,
      avatarUrl,
      timestamp: Date.now()
    };

    const all = readJSON(MESSAGES_FILE);
    all.push(message);
    writeJSON(MESSAGES_FILE, all);

    io.to(to).emit('private-message', message);
    io.to(socket.username).emit('private-message', message); // echo to sender (other tabs)
  });

  socket.on('typing', ({ to }) => {
    if (to) io.to(to).emit('typing', { from: socket.username });
  });
});

if (require.main === module || !process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`Chat + File Share server running on http://localhost:${PORT}`);
    console.log(`Admin account enabled: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  });
}

module.exports = app;
module.exports.server = server;
