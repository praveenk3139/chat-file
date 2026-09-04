/**
 * Chat + File Share server
 * - Unique username/password login (passwords hashed with bcrypt)
 * - Admin account: praveen / 3139 with full management rights
 * - Block & delete users, monitor all conversations & files
 * - User avatars: custom photo upload anytime + instant real-time sync
 * - Private 1:1 chat between users (Socket.IO + HTTP fallback)
 * - File sharing by username (stored in uploads/, metadata persisted in database)
 * - Persistent Cloud DB (MongoDB Atlas) support + local JSON fallback via db.js
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
const crypto = require('crypto');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-in-production';

function signToken(payload) {
  const jsonStr = JSON.stringify(payload);
  const b64 = Buffer.from(jsonStr).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
}

function getAuthUser(req) {
  if (req.session && req.session.username) {
    return { username: req.session.username, isAdmin: !!req.session.isAdmin };
  }
  const cookieHeader = req.headers && req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
    if (match) {
      const payload = verifyToken(match[1]);
      if (payload && payload.username) {
        if (req.session) {
          req.session.username = payload.username;
          req.session.isAdmin = !!payload.isAdmin;
        }
        return payload;
      }
    }
  }
  return null;
}

const ADMIN_USERNAME = 'praveen';
const ADMIN_PASSWORD = '3139';

const IS_VERCEL = !!process.env.VERCEL;

const UPLOAD_DIR = IS_VERCEL ? path.join('/tmp', 'chat-uploads') : path.join(__dirname, 'uploads');
const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars');

// Bootstrap upload directories
for (const dir of [UPLOAD_DIR, AVATAR_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Seed & synchronize admin user and local seed accounts
db.seedAndSync({
  adminUsername: ADMIN_USERNAME,
  adminPasswordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
  seedPath: path.join(__dirname, 'data', 'users.json')
}).catch(err => console.error('Database seed error:', err.message));

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
    ['#4f46e5', '#7c3aed'],
    ['#2563eb', '#06b6d4'],
    ['#059669', '#10b981'],
    ['#d97706', '#ea580c'],
    ['#db2777', '#f43f5e'],
    ['#0891b2', '#0284c7'],
    ['#9333ea', '#c026d3'],
    ['#16a34a', '#84cc16']
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

function roomKeyFor(a, b) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join('::');
}

// ---------- express app ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 days
});
app.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, 'public')));

// In-flight socket auth tokens -> username (issued at login)
const socketTokens = new Map();

// Seamless auth restoration middleware for multi-instance serverless (Vercel)
app.use((req, res, next) => {
  const auth = getAuthUser(req);
  if (auth) {
    req.authUser = auth;
    if (req.session && !req.session.username) {
      req.session.username = auth.username;
      req.session.isAdmin = !!auth.isAdmin;
    }
  }
  next();
});

async function requireAuth(req, res, next) {
  const auth = getAuthUser(req);
  const username = (auth && auth.username) || (req.session && req.session.username);
  if (!username) return res.status(401).json({ error: 'Not logged in' });
  const user = await db.getUser(username);
  if (!user) return res.status(401).json({ error: 'User account not found' });
  if (user.isBlocked) {
    if (req.session) req.session.destroy(() => {});
    res.clearCookie('auth_token');
    return res.status(403).json({ error: 'Your account has been blocked by the admin.' });
  }
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  const auth = getAuthUser(req);
  const username = (auth && auth.username) || (req.session && req.session.username);
  if (!username) return res.status(401).json({ error: 'Not logged in' });
  const user = await db.getUser(username);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: 'Access denied: Admin privileges required.' });
  }
  req.user = user;
  next();
}

// ---------- AUTH ROUTES ----------

app.post('/api/register', async (req, res) => {
  try {
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

    const exists = await db.findUserCaseInsensitive(username);
    if (exists) {
      return res.status(409).json({ error: 'That username is already taken' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const newUser = await db.saveUser(username, {
      passwordHash,
      createdAt: Date.now(),
      isAdmin: false,
      isBlocked: false
    });

    const initialAvatarUrl = getUserAvatarUrl(newUser, username);
    io.emit('new-user', { username, avatarUrl: initialAvatarUrl });

    res.json({ ok: true, message: 'Account created. You can now log in.' });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const record = await db.getUser(username);
    if (!record || !bcrypt.compareSync(password, record.passwordHash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (record.isBlocked) {
      return res.status(403).json({ error: 'Your account has been blocked by the admin.' });
    }

    req.session.username = record.username;
    req.session.isAdmin = !!record.isAdmin;
    const token = nanoid();
    socketTokens.set(token, record.username);
    req.session.socketToken = token;

    // Set signed token cookie to survive across serverless lambda containers
    const authToken = signToken({ username: record.username, isAdmin: !!record.isAdmin });
    res.cookie('auth_token', authToken, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      sameSite: 'lax'
    });

    const avatarUrl = getUserAvatarUrl(record, record.username);
    res.json({
      ok: true,
      username: record.username,
      isAdmin: !!record.isAdmin,
      socketToken: token,
      avatarUrl
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.post('/api/logout', (req, res) => {
  const token = req.session && req.session.socketToken;
  if (token) socketTokens.delete(token);
  res.clearCookie('auth_token');
  if (req.session) {
    req.session.destroy(() => res.json({ ok: true }));
  } else {
    res.json({ ok: true });
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = req.user;
  const avatarUrl = getUserAvatarUrl(user, user.username);
  res.json({
    username: user.username,
    isAdmin: !!user.isAdmin,
    socketToken: (req.session && req.session.socketToken) || nanoid(),
    avatarUrl
  });
});

app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const currentUsername = req.user.username;
    const users = await db.getAllUsersList();
    const list = users
      .filter(u => u.username !== currentUsername && !u.isBlocked)
      .map(u => ({
        username: u.username,
        avatarUrl: getUserAvatarUrl(u, u.username)
      }));
    res.json({ users: list });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch user list' });
  }
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
  avatarUpload.single('avatar')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Avatar upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });

    const username = req.session.username;
    const user = await db.getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // clean up previous uploaded avatar file
    if (user.avatarFile) {
      const oldPath = path.join(AVATAR_DIR, user.avatarFile);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (e) {}
      }
    }

    const updated = await db.saveUser(username, {
      avatarFile: req.file.filename,
      avatarUpdatedAt: Date.now()
    });

    const avatarUrl = getUserAvatarUrl(updated, username);

    // broadcast avatar update to all connected clients
    io.emit('avatar-updated', { username, avatarUrl });

    res.json({ ok: true, avatarUrl, message: 'Profile picture updated successfully!' });
  });
});

app.get('/api/avatar/:username', async (req, res) => {
  const username = req.params.username;
  const user = await db.getUser(username);

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

app.get('/api/messages/:withUser', requireAuth, async (req, res) => {
  const me = req.session.username;
  const other = req.params.withUser;
  const thread = await db.getMessagesThread(me, other);
  const usersMap = await db.getAllUsersMap();

  const enriched = thread.map(m => ({
    ...m,
    avatarUrl: m.avatarUrl || getUserAvatarUrl(usersMap[m.from], m.from)
  }));
  res.json({ messages: enriched });
});

// HTTP fallback endpoint for sending messages (also handles /api/messages/send)
const handleSendMessage = async (req, res) => {
  const me = req.user ? req.user.username : (req.session && req.session.username);
  const { to, text } = req.body || {};
  const cleanText = String(text || '').trim();

  if (!to || !cleanText) {
    return res.status(400).json({ error: 'Recipient and message text are required' });
  }

  const recipient = await db.getUser(to);
  if (!recipient) {
    return res.status(404).json({ error: `User "${to}" does not exist` });
  }
  if (recipient.isBlocked) {
    return res.status(403).json({ error: `Cannot message "${to}" because this account is blocked.` });
  }

  const sender = req.user || await db.getUser(me);
  const avatarUrl = getUserAvatarUrl(sender, me);

  const message = {
    id: nanoid(),
    from: me,
    to,
    text: cleanText,
    avatarUrl,
    timestamp: Date.now()
  };

  await db.saveMessage(message);

  // Broadcast to Socket.IO if available/connected
  try {
    io.to(to).emit('private-message', message);
    io.to(me).emit('private-message', message);
  } catch (e) {}

  res.json({ ok: true, message });
};

app.post('/api/messages', requireAuth, handleSendMessage);
app.post('/api/messages/send', requireAuth, handleSendMessage);

// ---------- FILE SHARING ----------

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9_.\-]/g, '_');
    cb(null, `${Date.now()}_${nanoid(6)}_${safeOriginal}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB cap

app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  const me = req.session.username;
  const to = req.body.to;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const recipient = await db.getUser(to);
  if (!to || !recipient) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Recipient username does not exist' });
  }
  if (recipient.isBlocked) {
    fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Cannot send files to a blocked user' });
  }

  const record = {
    id: nanoid(),
    storedName: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    from: me,
    to,
    uploadedAt: Date.now()
  };
  await db.saveFile(record);

  // notify recipient live if connected
  io.to(to).emit('file-shared', record);

  res.json({ ok: true, file: record });
});

// list files visible to me (sent by me or sent to me)
app.get('/api/files', requireAuth, async (req, res) => {
  const me = req.session.username;
  const mine = await db.getUserFiles(me);
  res.json({ files: mine });
});

app.get('/api/files/:id/download', requireAuth, async (req, res) => {
  const me = req.session.username;
  const user = await db.getUser(me);
  const isAdmin = user && user.isAdmin;
  const record = await db.getFile(req.params.id);
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
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const users = await db.getAllUsersList();
  const messages = await db.getAllMessages();
  const files = await db.getAllFiles();

  const totalUsers = users.length;
  const blockedUsers = users.filter(u => u.isBlocked).length;
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
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const users = await db.getAllUsersList();
  const list = users.map(u => ({
    username: u.username,
    avatarUrl: getUserAvatarUrl(u, u.username),
    createdAt: u.createdAt || Date.now(),
    isAdmin: !!u.isAdmin,
    isBlocked: !!u.isBlocked
  }));
  res.json({ users: list });
});

// 3. Block user
app.post('/api/admin/users/:username/block', requireAdmin, async (req, res) => {
  const target = req.params.username;
  if (target === ADMIN_USERNAME) {
    return res.status(400).json({ error: 'Cannot block the primary admin account' });
  }
  const user = await db.getUser(target);
  if (!user) return res.status(404).json({ error: 'User not found' });

  await db.saveUser(target, { isBlocked: true });

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
app.post('/api/admin/users/:username/unblock', requireAdmin, async (req, res) => {
  const target = req.params.username;
  const user = await db.getUser(target);
  if (!user) return res.status(404).json({ error: 'User not found' });

  await db.saveUser(target, { isBlocked: false });

  io.emit('admin-user-updated', { username: target, isBlocked: false });
  res.json({ ok: true, message: `User "${target}" has been unblocked.` });
});

// 5. Delete user
app.delete('/api/admin/users/:username', requireAdmin, async (req, res) => {
  const target = req.params.username;
  if (target === ADMIN_USERNAME) {
    return res.status(400).json({ error: 'Cannot delete the primary admin account' });
  }
  const user = await db.getUser(target);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Delete custom avatar file if present
  if (user.avatarFile) {
    const avatarPath = path.join(AVATAR_DIR, user.avatarFile);
    if (fs.existsSync(avatarPath)) {
      try { fs.unlinkSync(avatarPath); } catch (e) {}
    }
  }

  await db.deleteUser(target);

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
app.get('/api/admin/conversations', requireAdmin, async (req, res) => {
  const messages = await db.getAllMessages();
  const files = await db.getAllFiles();

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
app.get('/api/admin/messages/:userA/:userB', requireAdmin, async (req, res) => {
  const { userA, userB } = req.params;
  const threadMessages = await db.getMessagesThread(userA, userB);
  const allFiles = await db.getAllFiles();
  const usersMap = await db.getAllUsersMap();

  const enrichedMessages = threadMessages.map(m => ({
    ...m,
    avatarUrl: m.avatarUrl || getUserAvatarUrl(usersMap[m.from], m.from)
  }));

  const key = roomKeyFor(userA, userB);
  const threadFiles = allFiles.filter(f => roomKeyFor(f.from, f.to) === key);

  res.json({ messages: enrichedMessages, files: threadFiles });
});

// 8. Admin delete message
app.delete('/api/admin/messages/:id', requireAdmin, async (req, res) => {
  await db.deleteMessage(req.params.id);
  res.json({ ok: true });
});

// 9. Admin delete file
app.delete('/api/admin/files/:id', requireAdmin, async (req, res) => {
  const file = await db.getFile(req.params.id);
  if (file) {
    const fullPath = path.join(UPLOAD_DIR, file.storedName);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch (e) {}
    }
  }
  await db.deleteFile(req.params.id);
  res.json({ ok: true });
});

// ---------- fallback routes for pages ----------
app.get('/', (req, res) => {
  const auth = getAuthUser(req);
  res.sendFile(path.join(__dirname, 'public', auth ? 'dashboard.html' : 'login.html'));
});

// ---------- SOCKET.IO (real-time chat) ----------

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    const username = socketTokens.get(token);
    if (!username) return next(new Error('Unauthorized socket connection'));

    const user = await db.getUser(username);
    if (!user) return next(new Error('User account not found'));
    if (user.isBlocked) return next(new Error('Account is blocked by admin'));

    socket.username = username;
    socket.isAdmin = !!user.isAdmin;
    next();
  } catch (err) {
    next(new Error('Authentication failed'));
  }
});

io.on('connection', (socket) => {
  socket.join(socket.username);
  if (socket.isAdmin) {
    socket.join('admin-room');
  }

  socket.on('private-message', async (payload) => {
    try {
      const to = payload && payload.to;
      const text = payload && String(payload.text || '').trim();
      if (!to || !text) return;

      const recipient = await db.getUser(to);
      if (!recipient) {
        socket.emit('error-message', { error: `User "${to}" does not exist` });
        return;
      }
      if (recipient.isBlocked) {
        socket.emit('error-message', { error: `Cannot message "${to}" because this account is blocked.` });
        return;
      }

      const sender = await db.getUser(socket.username);
      const avatarUrl = getUserAvatarUrl(sender, socket.username);

      const message = {
        id: nanoid(),
        from: socket.username,
        to,
        text,
        avatarUrl,
        timestamp: Date.now()
      };

      await db.saveMessage(message);

      io.to(to).emit('private-message', message);
      io.to(socket.username).emit('private-message', message); // echo to sender (other tabs)
    } catch (err) {
      console.error('Socket message error:', err);
    }
  });

  socket.on('typing', ({ to }) => {
    if (to) io.to(to).emit('typing', { from: socket.username });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Chat + File Share server running on http://localhost:${PORT}`);
    console.log(`Admin account enabled: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  });
}

module.exports = app;
