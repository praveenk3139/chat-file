/**
 * Database abstraction layer for Chat + File Share
 * Supports:
 * - MongoDB Atlas (when MONGODB_URI is provided in environment)
 * - Local JSON file fallback (when MONGODB_URI is not set or offline)
 * - Cached connection for Vercel serverless functions
 */

const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
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
}, { timestamps: false });

const MessageSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  from: { type: String, required: true, index: true },
  to: { type: String, required: true, index: true },
  text: { type: String, required: true },
  avatarUrl: { type: String, default: null },
  timestamp: { type: Number, default: Date.now, index: true }
}, { timestamps: false });

const FileSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  storedName: { type: String, required: true },
  originalName: { type: String, required: true },
  size: { type: Number, default: 0 },
  from: { type: String, required: true, index: true },
  to: { type: String, required: true, index: true },
  uploadedAt: { type: Number, default: Date.now, index: true }
}, { timestamps: false });

const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);
const MessageModel = mongoose.models.Message || mongoose.model('Message', MessageSchema);
const FileModel = mongoose.models.SharedFile || mongoose.model('SharedFile', FileSchema);

// Cached connection for serverless
let cached = global._mongooseConn;
if (!cached) {
  cached = global._mongooseConn = { conn: null, promise: null };
}

let isMongoReady = false;

async function connectDB() {
  const uri = process.env.MONGODB_URI || MONGODB_URI;
  if (!uri) {
    return false;
  }
  if (cached.conn && mongoose.connection.readyState === 1) {
    isMongoReady = true;
    return true;
  }
  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    };
    cached.promise = mongoose.connect(uri, opts).then((m) => {
      console.log('Connected to MongoDB Atlas successfully.');
      isMongoReady = true;
      return m;
    }).catch((err) => {
      console.error('MongoDB connection error, falling back to local storage:', err.message);
      cached.promise = null;
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

// ---------------- USER OPERATIONS ----------------
async function getUser(username) {
  await connectDB();
  if (isUsingMongo()) {
    return await UserModel.findOne({ username }).lean();
  }
  const users = readJSON(USERS_FILE, {});
  return users[username] ? { username, ...users[username] } : null;
}

async function findUserCaseInsensitive(username) {
  await connectDB();
  if (isUsingMongo()) {
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return await UserModel.findOne({ username: new RegExp(`^${escaped}$`, 'i') }).lean();
  }
  const users = readJSON(USERS_FILE, {});
  const match = Object.keys(users).find(u => u.toLowerCase() === username.toLowerCase());
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
    const doc = await UserModel.findOneAndUpdate(
      { username },
      { $set: { username, ...data } },
      { upsert: true, returnDocument: 'after' }
    ).lean();
    return doc;
  }
  const users = readJSON(USERS_FILE, {});
  users[username] = { ...(users[username] || {}), ...data };
  writeJSON(USERS_FILE, users);
  return { username, ...users[username] };
}

async function deleteUser(username) {
  await connectDB();
  if (isUsingMongo()) {
    await UserModel.deleteOne({ username });
    return true;
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

// ---------------- SEED & SYNC ----------------
async function seedAndSync({ adminUsername, adminPasswordHash, seedPath }) {
  await connectDB();

  // Load local seed file if present
  let localUsers = {};
  if (seedPath && fs.existsSync(seedPath)) {
    try {
      localUsers = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    } catch (e) {}
  }

  if (isUsingMongo()) {
    // 1. Ensure Admin User in MongoDB
    const adminDoc = await UserModel.findOne({ username: adminUsername });
    if (!adminDoc) {
      await UserModel.create({
        username: adminUsername,
        passwordHash: adminPasswordHash,
        createdAt: Date.now(),
        isAdmin: true,
        isBlocked: false
      });
      console.log(`[MongoDB] Admin user "${adminUsername}" created.`);
    } else {
      adminDoc.isAdmin = true;
      adminDoc.isBlocked = false;
      await adminDoc.save();
    }

    // 2. Sync local users (e.g. praveenkumar) into MongoDB if they don't exist yet
    for (const [uname, udata] of Object.entries(localUsers)) {
      if (uname === adminUsername) continue;
      const exists = await UserModel.findOne({ username: uname });
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
        console.log(`[MongoDB] Synced local user "${uname}" into MongoDB Atlas.`);
      }
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
