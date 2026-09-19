/**
 * Standalone CLI sync utility to push and verify all users in MongoDB Atlas
 * Usage: node sync-mongo.js [MONGODB_URI]
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const uri = process.argv[2] || process.env.MONGODB_URI;

if (!uri || uri.includes('<db_password>')) {
  console.error('\n❌ ERROR: MongoDB connection URI is missing or contains placeholder <db_password>.');
  console.error('👉 Please update MONGODB_URI in your .env file with your real database user password.');
  console.error('Example: node sync-mongo.js "mongodb+srv://praveenk3139_db_user:YOUR_PASSWORD@cluster0.x0fuq03.mongodb.net/chatshare?retryWrites=true&w=majority"\n');
  process.exit(1);
}

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Number, default: Date.now },
  isAdmin: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false },
  avatarFile: { type: String, default: null },
  avatarUpdatedAt: { type: Number, default: null }
}, { timestamps: false, collection: 'users' });

const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);

async function syncAll() {
  try {
    console.log('⏳ Connecting to MongoDB Atlas…');
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    console.log('✅ Connected to MongoDB Atlas successfully!\n');

    const usersPath = path.join(__dirname, 'data', 'users.json');
    if (!fs.existsSync(usersPath)) {
      console.error('❌ data/users.json file not found.');
      process.exit(1);
    }

    const localUsers = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    console.log(`📋 Found ${Object.keys(localUsers).length} users in data/users.json to sync.\n`);

    for (const [username, data] of Object.entries(localUsers)) {
      const escaped = String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existing = await UserModel.findOne({ username: new RegExp(`^${escaped}$`, 'i') });

      if (!existing) {
        await UserModel.create({
          username,
          passwordHash: data.passwordHash,
          createdAt: data.createdAt || Date.now(),
          isAdmin: !!data.isAdmin,
          isBlocked: !!data.isBlocked,
          avatarFile: data.avatarFile || null,
          avatarUpdatedAt: data.avatarUpdatedAt || null
        });
        console.log(`  ➕ [CREATED] "${username}" (Admin: ${!!data.isAdmin})`);
      } else {
        existing.passwordHash = data.passwordHash;
        existing.isAdmin = !!data.isAdmin;
        existing.isBlocked = !!data.isBlocked;
        if (data.avatarFile) existing.avatarFile = data.avatarFile;
        if (data.avatarUpdatedAt) existing.avatarUpdatedAt = data.avatarUpdatedAt;
        await existing.save();
        console.log(`  🔄 [UPDATED] "${username}" (Password and settings refreshed)`);
      }
    }

    const allInDb = await UserModel.find({}).lean();
    console.log(`\n🎉 Total users now in MongoDB Atlas (${allInDb.length}):`);
    allInDb.forEach((u, i) => {
      console.log(`   ${i + 1}. Username: ${u.username} | Admin: ${u.isAdmin} | Blocked: ${u.isBlocked}`);
    });

    console.log('\n✅ All users are successfully stored and verified in MongoDB Atlas!\n');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ MongoDB Sync Failed:', err.message);
    process.exit(1);
  }
}

syncAll();
