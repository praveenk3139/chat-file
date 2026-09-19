/**
 * Database abstraction layer for Chat + File Share
 * Supports:
 * - Online MongoDB / MongoDB Atlas (when MONGODB_URI is provided in environment or .env)
 * - Local JSON file fallback (when MONGODB_URI is not set or temporarily offline)
 * - Cached connection for Vercel serverless functions
 * - Automatic 2-way synchronization between local seed accounts and online MongoDB
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const githubSync = require('./githubSync');

const IS_VERCEL = !!process.env.VERCEL;

const DATA_DIR = IS_VERCEL ? path.join('/tmp', 'chat-data') : path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const FILES_FILE = path.join(DATA_DIR, 'files.json');

// Ensure local fallback folders exist
for (const dir of [DATA_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------------- JSON FILE HELPERS ----------------
function readJSON(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback || (file === USERS_FILE ? {} : []);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback || (file === USERS_FILE ? {} : []);
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Failed to write JSON file ${file}:`, e.message);
  }
}

// ---------------- MONGOOSE SCHEMAS ----------------
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Number, default: Date.now },
  isAdmin: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false },
  avatarFile: { type: String, default: null },
  avatarUpdatedAt: { type: Number, default: null }
}, { timestamps: false, collection: 'users' });

const MessageSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  from: { type: String, required: true, index: true },
  to: { type: String, required: true, index: true },
  text: { type: String, required: true },
  avatarUrl: { type: String, default: null },
  timestamp: { type: Number, default: Date.now, index: true }
}, { timestamps: false, collection: 'messages' });

const FileSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  storedName: { type: String, required: true },
  originalName: { type: String, required: true },
  size: { type: Number, default: 0 },
  from: { type: String, required: true, index: true },
  to: { type: String, required: true, index: true },
  uploadedAt: { type: Number, default: Date.now, index: true }
}, { timestamps: false, collection: 'files' });

const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);
const MessageModel = mongoose.models.Message || mongoose.model('Message', MessageSchema);
const FileModel = mongoose.models.SharedFile || mongoose.model('SharedFile', FileSchema);

// Cached connection for serverless / repeated calls
let cached = global._mongooseConn;
if (!cached) {
  cached = global._mongooseConn = { conn: null, promise: null, lastAttempt: 0, errorCount: 0 };
}

let isMongoReady = false;

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes('<db_password>') || uri.includes('<password>')) {
    isMongoReady = false;
    return false;
  }
  if (cached.conn && mongoose.connection.readyState === 1) {
    isMongoReady = true;
    return true;
  }

  // Prevent stalling every request if connection recently failed
  const now = Date.now();
  if (cached.errorCount > 0 && (now - cached.lastAttempt < 30000)) {
    return false;
  }

  if (!cached.promise) {
    cached.lastAttempt = now;
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 4000,
    };
    cached.promise = mongoose.connect(uri, opts).then((m) => {
      console.log('✅ Connected to online MongoDB successfully.');
      isMongoReady = true;
      cached.errorCount = 0;
      return m;
    }).catch((err) => {
      console.error('⚠️ MongoDB connection error, falling back to local storage:', err.message);
      cached.promise = null;
      cached.errorCount = (cached.errorCount || 0) + 1;
      isMongoReady = false;
      return null;
    });
  }
  try {
    cached.conn = await cached.promise;
    return !!cached.conn;
  } catch (err) {
    return false;
  }
}

function isUsingMongo() {
  return isMongoReady && mongoose.connection.readyState === 1;
}

function getDBStatus() {
  const usingMongo = isUsingMongo();
  return {
    provider: usingMongo ? 'MongoDB Atlas (Online)' : 'Local JSON Storage',
    isOnline: usingMongo,
    readyState: mongoose.connection.readyState
  };
}

// ---------------- USER OPERATIONS ----------------
async function getUser(username) {
  if (!username) return null;
  await connectDB();
  if (isUsingMongo()) {
    // Try exact match first, then case-insensitive fallback
    let doc = await UserModel.findOne({ username }).lean();
    if (!doc) {
      const escaped = String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      doc = await UserModel.findOne({ username: new RegExp(`^${escaped}$`, 'i') }).lean();
    }
    return doc;
  }
  let users = readJSON(USERS_FILE, {});
  if (!users[username]) {
    const match = Object.keys(users).find(u => u.toLowerCase() === String(username).toLowerCase());
    if (match) {
      return { username: match, ...users[match] };
    }
    // Check if new user was registered and committed to GitHub
    try {
      const gh = await githubSync.fetchUsersFromGithub();
      if (gh && gh.users) {
        users = { ...users, ...gh.users };
        writeJSON(USERS_FILE, users);
        const ghMatch = Object.keys(users).find(u => u.toLowerCase() === String(username).toLowerCase());
        if (ghMatch) return { username: ghMatch, ...users[ghMatch] };
      }
    } catch (e) {}
  }
  return users[username] ? { username, ...users[username] } : null;
}

async function findUserCaseInsensitive(username) {
  if (!username) return null;
  await connectDB();
  if (isUsingMongo()) {
    const escaped = String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return await UserModel.findOne({ username: new RegExp(`^${escaped}$`, 'i') }).lean();
  }
  let users = readJSON(USERS_FILE, {});
  let match = Object.keys(users).find(u => u.toLowerCase() === String(username).toLowerCase());
  if (!match) {
    // Check if new user exists in GitHub repository
    try {
      const gh = await githubSync.fetchUsersFromGithub();
      if (gh && gh.users) {
        users = { ...users, ...gh.users };
        writeJSON(USERS_FILE, users);
        match = Object.keys(users).find(u => u.toLowerCase() === String(username).toLowerCase());
      }
    } catch (e) {}
  }
  return match ? { username: match, ...users[match] } : null;
}

async function getAllUsersMap() {
  await connectDB();
  if (isUsingMongo()) {
    const list = await UserModel.find({}).lean();
    const map = {};
    for (const u of list) {
      map[u.username] = u;
    }
    return map;
  }
  return readJSON(USERS_FILE, {});
}

async function getAllUsersList() {
  await connectDB();
  if (isUsingMongo()) {
    return await UserModel.find({}).lean();
  }
  const users = readJSON(USERS_FILE, {});
  return Object.keys(users).map(u => ({ username: u, ...users[u] }));
}

async function saveUser(username, data) {
  await connectDB();
  if (isUsingMongo()) {
    const escaped = String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const doc = await UserModel.findOneAndUpdate(
      { username: new RegExp(`^${escaped}$`, 'i') },
      { $set: { username, ...data } },
      { upsert: true, returnDocument: 'after' }
    ).lean();

    // Mirror to local users.json for fast offline redundancy
    const users = readJSON(USERS_FILE, {});
    users[username] = { ...(users[username] || {}), ...data };
    writeJSON(USERS_FILE, users);

    // Also sync to GitHub repository if GITHUB_TOKEN is present
    try {
      await githubSync.syncUserToGithub(username, data);
    } catch (e) {}
    return doc || { username, ...data };
  }

  const users = readJSON(USERS_FILE, {});
  users[username] = { ...(users[username] || {}), ...data };
  writeJSON(USERS_FILE, users);

  // Automatically update data/users.json in GitHub repository if enabled
  try {
    await githubSync.syncUserToGithub(username, users[username]);
  } catch (e) {
    console.error('[db] Error syncing user to GitHub:', e.message);
  }

  return { username, ...users[username] };
}

async function deleteUser(username) {
  await connectDB();
  try {
    await githubSync.syncDeleteUserFromGithub(username);
  } catch (e) {}

  if (isUsingMongo()) {
    const escaped = String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await UserModel.deleteOne({ username: new RegExp(`^${escaped}$`, 'i') });
  }

  const users = readJSON(USERS_FILE, {});
  delete users[username];
  writeJSON(USERS_FILE, users);
  return true;
}

// ---------------- MESSAGE OPERATIONS ----------------
async function getMessagesThread(userA, userB) {
  await connectDB();
  if (isUsingMongo()) {
    return await MessageModel.find({
      $or: [
        { from: userA, to: userB },
        { from: userB, to: userA }
      ]
    }).sort({ timestamp: 1 }).lean();
  }
  const all = readJSON(MESSAGES_FILE, []);
  return all.filter(m => (m.from === userA && m.to === userB) || (m.from === userB && m.to === userA));
}

async function getAllMessages() {
  await connectDB();
  if (isUsingMongo()) {
    return await MessageModel.find({}).sort({ timestamp: 1 }).lean();
  }
  return readJSON(MESSAGES_FILE, []);
}

async function saveMessage(message) {
  await connectDB();
  if (isUsingMongo()) {
    const doc = new MessageModel(message);
    await doc.save();
    return message;
  }
  const all = readJSON(MESSAGES_FILE, []);
  all.push(message);
  writeJSON(MESSAGES_FILE, all);
  return message;
}

async function deleteMessage(id) {
  await connectDB();
  if (isUsingMongo()) {
    await MessageModel.deleteOne({ id });
    return true;
  }
  const all = readJSON(MESSAGES_FILE, []);
  const filtered = all.filter(m => m.id !== id);
  writeJSON(MESSAGES_FILE, filtered);
  return true;
}

// ---------------- FILE OPERATIONS ----------------
async function getFile(id) {
  await connectDB();
  if (isUsingMongo()) {
    return await FileModel.findOne({ id }).lean();
  }
  const all = readJSON(FILES_FILE, []);
  return all.find(f => f.id === id) || null;
}

async function getUserFiles(username) {
  await connectDB();
  if (isUsingMongo()) {
    return await FileModel.find({
      $or: [{ from: username }, { to: username }]
    }).sort({ uploadedAt: -1 }).lean();
  }
  const all = readJSON(FILES_FILE, []);
  return all.filter(f => f.from === username || f.to === username)
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

async function getAllFiles() {
  await connectDB();
  if (isUsingMongo()) {
    return await FileModel.find({}).sort({ uploadedAt: -1 }).lean();
  }
  return readJSON(FILES_FILE, []);
}

async function saveFile(fileRecord) {
  await connectDB();
  if (isUsingMongo()) {
    const doc = new FileModel(fileRecord);
    await doc.save();
    return fileRecord;
  }
  const all = readJSON(FILES_FILE, []);
  all.push(fileRecord);
  writeJSON(FILES_FILE, all);
  return fileRecord;
}

async function deleteFile(id) {
  await connectDB();
  if (isUsingMongo()) {
    await FileModel.deleteOne({ id });
    return true;
  }
  const all = readJSON(FILES_FILE, []);
  const filtered = all.filter(f => f.id !== id);
  writeJSON(FILES_FILE, filtered);
  return true;
}

// ---------------- SEED & SYNC (ALL USERS TO/FROM MONGODB) ----------------
async function seedAndSync({ adminUsername, adminPasswordHash, seedPath }) {
  await connectDB();

  // 1. Load local seed file if present
  let localUsers = {};
  if (seedPath && fs.existsSync(seedPath)) {
    try {
      localUsers = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    } catch (e) {}
  }

  // 2. Also pull latest users from GitHub repository if available
  try {
    const gh = await githubSync.fetchUsersFromGithub();
    if (gh && gh.users) {
      for (const [uname, udata] of Object.entries(gh.users)) {
        if (!localUsers[uname]) {
          localUsers[uname] = udata;
        }
      }
    }
  } catch (e) {}

  if (isUsingMongo()) {
    console.log('[MongoDB] Synchronizing all users with online MongoDB Atlas…');

    // Ensure Admin User in online MongoDB
    const escapedAdmin = String(adminUsername).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const adminDoc = await UserModel.findOne({ username: new RegExp(`^${escapedAdmin}$`, 'i') });
    const localAdmin = localUsers[adminUsername];

    if (!adminDoc) {
      await UserModel.create({
        username: adminUsername,
        passwordHash: (localAdmin && localAdmin.passwordHash) || adminPasswordHash,
        createdAt: (localAdmin && localAdmin.createdAt) || Date.now(),
        isAdmin: true,
        isBlocked: false,
        avatarFile: (localAdmin && localAdmin.avatarFile) || null,
        avatarUpdatedAt: (localAdmin && localAdmin.avatarUpdatedAt) || null
      });
      console.log(`[MongoDB] Admin user "${adminUsername}" registered in online MongoDB.`);
    } else {
      adminDoc.isAdmin = true;
      adminDoc.isBlocked = false;
      if (localAdmin && localAdmin.avatarFile && !adminDoc.avatarFile) {
        adminDoc.avatarFile = localAdmin.avatarFile;
        adminDoc.avatarUpdatedAt = localAdmin.avatarUpdatedAt;
      }
      await adminDoc.save();
    }

    // Sync ALL existing users from local users.json (pavithra, sanjay.k, etc.) into online MongoDB
    for (const [uname, udata] of Object.entries(localUsers)) {
      if (uname.toLowerCase() === adminUsername.toLowerCase()) continue;
      const escaped = String(uname).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const exists = await UserModel.findOne({ username: new RegExp(`^${escaped}$`, 'i') });
      if (!exists && udata && udata.passwordHash) {
        await UserModel.create({
          username: uname,
          passwordHash: udata.passwordHash,
          createdAt: udata.createdAt || Date.now(),
          isAdmin: !!udata.isAdmin,
          isBlocked: !!udata.isBlocked,
          avatarFile: udata.avatarFile || null,
          avatarUpdatedAt: udata.avatarUpdatedAt || null
        });
        console.log(`[MongoDB] Synced user "${uname}" into online MongoDB.`);
      } else if (exists && udata && udata.passwordHash && exists.passwordHash !== udata.passwordHash) {
        exists.passwordHash = udata.passwordHash;
        if (udata.avatarFile) exists.avatarFile = udata.avatarFile;
        if (udata.avatarUpdatedAt) exists.avatarUpdatedAt = udata.avatarUpdatedAt;
        await exists.save();
        console.log(`[MongoDB] Updated password/profile for user "${uname}" in online MongoDB.`);
      }
    }

    // Clean up any user deleted from users.json (like pavithra)
    const allMongoUsers = await UserModel.find({}).lean();
    for (const mUser of allMongoUsers) {
      const isSeedAdmin = mUser.username.toLowerCase() === adminUsername.toLowerCase();
      const existsInLocal = localUsers[mUser.username] || Object.keys(localUsers).some(k => k.toLowerCase() === mUser.username.toLowerCase());
      if (!isSeedAdmin && !existsInLocal) {
        await UserModel.deleteOne({ username: mUser.username });
        console.log(`[MongoDB] Removed deleted user "${mUser.username}" from online MongoDB.`);
      }
    }

    // Keep local cache in sync with active MongoDB users
    try {
      const currentMongoUsers = await UserModel.find({}).lean();
      const currentLocal = {};
      for (const mUser of currentMongoUsers) {
        currentLocal[mUser.username] = {
          passwordHash: mUser.passwordHash,
          createdAt: mUser.createdAt,
          isAdmin: !!mUser.isAdmin,
          isBlocked: !!mUser.isBlocked,
          avatarFile: mUser.avatarFile || null,
          avatarUpdatedAt: mUser.avatarUpdatedAt || null
        };
      }
      writeJSON(USERS_FILE, currentLocal);
    } catch (e) {
      console.error('[MongoDB] Error updating local cache from MongoDB:', e.message);
    }
  } else {
    // Local file fallback seeding
    const users = readJSON(USERS_FILE, {});
    
    // Merge any missing seed users into USERS_FILE
    for (const [uname, udata] of Object.entries(localUsers)) {
      if (!users[uname]) {
        users[uname] = udata;
      }
    }

    const current = users[adminUsername];
    if (!current) {
      users[adminUsername] = {
        passwordHash: adminPasswordHash,
        createdAt: Date.now(),
        isAdmin: true,
        isBlocked: false
      };
      console.log(`[Local] Admin user "${adminUsername}" seeded.`);
    } else {
      users[adminUsername].isAdmin = true;
      users[adminUsername].isBlocked = false;
    }
    writeJSON(USERS_FILE, users);
  }
}

module.exports = {
  connectDB,
  isUsingMongo,
  getDBStatus,
  getUser,
  findUserCaseInsensitive,
  getAllUsersMap,
  getAllUsersList,
  saveUser,
  deleteUser,
  getMessagesThread,
  getAllMessages,
  saveMessage,
  deleteMessage,
  getFile,
  getUserFiles,
  getAllFiles,
  saveFile,
  deleteFile,
  seedAndSync,
  DATA_DIR,
  USERS_FILE,
  MESSAGES_FILE,
  FILES_FILE
};
