let me = null;
let socket = null;
let activeUser = null;
const userAvatars = new Map();
const messageReactions = new Map(); // msgId -> { [emoji]: count }
const renderedMessageIds = new Set();
let chatPollInterval = null;
let lastMessageTs = 0;

// General UI elements
const userListEl = document.getElementById('userList');
const chatBodyEl = document.getElementById('chatBody');
const chatHeaderTitle = document.getElementById('chatHeaderTitle');
const chatHeaderSubtitle = document.getElementById('chatHeaderSubtitle');
const chatHeaderAvatar = document.getElementById('chatHeaderAvatar');
const composerEl = document.getElementById('composer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const myUsernameEl = document.getElementById('myUsername');
const myAvatarImg = document.getElementById('myAvatarImg');
const logoutBtn = document.getElementById('logoutBtn');
const myProfileBtn = document.getElementById('myProfileBtn');
const adminBadge = document.getElementById('adminBadge');

// Emoji Picker elements
const emojiToggleBtn = document.getElementById('emojiToggleBtn');
const emojiPicker = document.getElementById('emojiPicker');
const emojiSearchInput = document.getElementById('emojiSearchInput');
const emojiTabs = document.getElementById('emojiTabs');
const emojiPickerBody = document.getElementById('emojiPickerBody');

// View Switching
const adminNavSection = document.getElementById('adminNavSection');
const tabChatViewBtn = document.getElementById('tabChatViewBtn');
const tabAdminViewBtn = document.getElementById('tabAdminViewBtn');
const chatView = document.getElementById('chatView');
const adminView = document.getElementById('adminView');

// Admin Elements
const statTotalUsers = document.getElementById('statTotalUsers');
const statActiveUsers = document.getElementById('statActiveUsers');
const statBlockedUsers = document.getElementById('statBlockedUsers');
const statTotalMessages = document.getElementById('statTotalMessages');
const statTotalFiles = document.getElementById('statTotalFiles');
const adminUsersTableBody = document.getElementById('adminUsersTableBody');
const adminThreadsList = document.getElementById('adminThreadsList');
const inspectorHeader = document.getElementById('inspectorHeader');
const inspectorBody = document.getElementById('inspectorBody');
const refreshAdminBtn = document.getElementById('refreshAdminBtn');

// Modal elements (Avatar Upload Anytime)
const avatarModal = document.getElementById('avatarModal');
const closeAvatarModalBtn = document.getElementById('closeAvatarModalBtn');
const cancelAvatarBtn = document.getElementById('cancelAvatarBtn');
const saveAvatarBtn = document.getElementById('saveAvatarBtn');
const avatarDropzone = document.getElementById('avatarDropzone');
const avatarFileInput = document.getElementById('avatarFileInput');
const avatarPreviewImg = document.getElementById('avatarPreviewImg');
const avatarModalMsg = document.getElementById('avatarModalMsg');
let selectedAvatarFile = null;
let activeInspectorPair = null;
let currentEmojiCategory = 'smileys';

// Categorized Emojis with Search Keywords
const EMOJI_CATEGORIES = {
  smileys: {
    title: 'Smileys & Emotions',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '💩', '🤡', '👻', '👽', '🤖']
  },
  gestures: {
    title: 'Hands & People',
    emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '👀', '👁️', '🧠', '🫀', '🫁', '🦴']
  },
  hearts: {
    title: 'Hearts & Emotions',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💌', '💋', '💯', '💢', '💥', '💫', '✨']
  },
  fun: {
    title: 'Celebration & Fun',
    emojis: ['🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🎯', '🎮', '🕹️', '🎲', '🎨', '🎭', '🎪', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻']
  },
  objects: {
    title: 'Objects, Food & Fire',
    emojis: ['🔥', '⭐', '🌟', '⚡', '☄️', '🚀', '🛸', '🛰️', '👑', '💎', '💡', '🔔', '📣', '📢', '💰', '💵', '💳', '🍕', '🍔', '🍟', '🍦', '🍩', '☕', '🍺', '🍻', '🥂']
  }
};

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉', '🚀'];

function timeStr(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function dateStr(ts) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function getAvatar(username) {
  if (me && username === me.username) return me.avatarUrl;
  return userAvatars.get(username) || `/api/avatar/${encodeURIComponent(username)}`;
}

async function init() {
  const res = await fetch('/api/me');
  if (!res.ok) {
    window.location.href = '/login.html';
    return;
  }
  me = await res.json();
  myUsernameEl.textContent = me.username;
  myAvatarImg.src = me.avatarUrl;
  userAvatars.set(me.username, me.avatarUrl);

  if (me.isAdmin) {
    adminBadge.classList.remove('hidden');
    adminNavSection.classList.remove('hidden');
    setupAdminTabs();
  }

  setupEmojiPicker();
  localStorage.removeItem('chatshare_theme');
  localStorage.removeItem('chatshare_bg_image');
  localStorage.removeItem('chatshare_bg_opacity');
  document.body.removeAttribute('data-theme');

  try {
    socket = io({
      auth: { token: me.socketToken },
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 5,
      timeout: 5000
    });

    socket.on('connect_error', (err) => {
      console.log('Socket fallback active:', err.message);
    });

    socket.on('private-message', (msg) => {
      if (activeUser && (msg.from === activeUser || msg.to === activeUser)) {
        if (!renderedMessageIds.has(msg.id)) {
          renderMessage(msg);
          scrollToBottom();
        }
      }
    });
  } catch (err) {
    console.warn('Socket init exception:', err);
  }

  socket.on('file-shared', (file) => {
    if (activeUser && (file.from === activeUser || file.to === activeUser)) {
      renderFile(file);
      scrollToBottom();
    }
  });

  socket.on('avatar-updated', ({ username, avatarUrl }) => {
    userAvatars.set(username, avatarUrl);
    if (me && username === me.username) {
      me.avatarUrl = avatarUrl;
      myAvatarImg.src = avatarUrl;
    }
    // Update sidebar list avatar
    const contactImg = document.querySelector(`.user-item[data-username="${username}"] .avatar-img`);
    if (contactImg) contactImg.src = avatarUrl;

    // Update active chat header avatar
    if (activeUser === username && chatHeaderAvatar) {
      chatHeaderAvatar.src = avatarUrl;
    }

    // Update timeline avatars for this user
    document.querySelectorAll(`.msg-avatar[data-username="${username}"]`).forEach(img => {
      img.src = avatarUrl;
    });

    if (me && me.isAdmin) {
      loadAdminUsers();
    }
  });

  socket.on('new-user', ({ username, avatarUrl }) => {
    userAvatars.set(username, avatarUrl);
    loadUsers();
    if (me && me.isAdmin) loadAdminData();
  });

  socket.on('user-deleted', ({ username }) => {
    userAvatars.delete(username);
    if (activeUser === username) {
      activeUser = null;
      chatHeaderTitle.textContent = 'Select a user to start chatting';
      chatHeaderSubtitle.classList.add('hidden');
      chatHeaderAvatar.classList.add('hidden');
      composerEl.classList.add('hidden');
      chatBodyEl.innerHTML = '<div class="empty-state">This user has been deleted by the admin.</div>';
    }
    loadUsers();
    if (me && me.isAdmin) loadAdminData();
  });

  socket.on('account-blocked', (data) => {
    alert(data.reason || 'Your account has been blocked by the admin.');
    window.location.href = '/login.html';
  });

  socket.on('account-deleted', () => {
    alert('Your account has been deleted by the admin.');
    window.location.href = '/login.html';
  });

  socket.on('admin-user-updated', () => {
    if (me && me.isAdmin) loadAdminData();
  });

  socket.on('error-message', (e) => {
    alert(e.error || 'Something went wrong');
  });

  await loadUsers();
}

// ---------- EMOJI PICKER SYSTEM ----------

function setupEmojiPicker() {
  renderEmojiGrid(currentEmojiCategory);

  // Toggle emoji picker
  emojiToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle('hidden');
    emojiToggleBtn.classList.toggle('active');
    if (!emojiPicker.classList.contains('hidden')) {
      emojiSearchInput.focus();
    }
  });

  // Category Tab clicks
  emojiTabs.querySelectorAll('.emoji-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      emojiTabs.querySelectorAll('.emoji-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentEmojiCategory = btn.dataset.category;
      emojiSearchInput.value = '';
      renderEmojiGrid(currentEmojiCategory);
    });
  });

  // Search input filter
  emojiSearchInput.addEventListener('input', () => {
    const q = emojiSearchInput.value.trim().toLowerCase();
    if (!q) {
      renderEmojiGrid(currentEmojiCategory);
      return;
    }
    // Search across all categories
    const results = [];
    Object.values(EMOJI_CATEGORIES).forEach(cat => {
      cat.emojis.forEach(em => {
        results.push(em);
      });
    });
    renderCustomEmojiList('Search Results', results);
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiToggleBtn) {
      emojiPicker.classList.add('hidden');
      emojiToggleBtn.classList.remove('active');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !emojiPicker.classList.contains('hidden')) {
      emojiPicker.classList.add('hidden');
      emojiToggleBtn.classList.remove('active');
    }
  });
}

function renderEmojiGrid(categoryKey) {
  const cat = EMOJI_CATEGORIES[categoryKey];
  if (!cat) return;
  renderCustomEmojiList(cat.title, cat.emojis);
}

function renderCustomEmojiList(title, emojis) {
  emojiPickerBody.innerHTML = `
    <div class="emoji-category-title">${title}</div>
    <div class="emoji-grid">
      ${emojis.map(em => `<button class="emoji-btn" data-emoji="${em}">${em}</button>`).join('')}
    </div>
  `;

  emojiPickerBody.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = btn.dataset.emoji;
      insertEmoji(emoji);
    });
  });
}

function insertEmoji(emoji) {
  const input = messageInput;
  const start = input.selectionStart != null ? input.selectionStart : input.value.length;
  const end = input.selectionEnd != null ? input.selectionEnd : input.value.length;
  const text = input.value;
  input.value = text.substring(0, start) + emoji + text.substring(end);
  const nextPos = start + emoji.length;
  input.selectionStart = input.selectionEnd = nextPos;
  input.focus();
}

// ---------- USER LIST & CHAT ----------

async function loadUsers() {
  const res = await fetch('/api/users');
  const data = await res.json();
  if (!data.users || !data.users.length) {
    userListEl.innerHTML = '<div class="empty-state" style="margin-top:20px;">No other active users yet.<br>Invite someone to sign up!</div>';
    return;
  }
  userListEl.innerHTML = '';
  data.users.forEach(item => {
    const u = typeof item === 'string' ? item : item.username;
    const avatarUrl = (typeof item === 'object' && item.avatarUrl) ? item.avatarUrl : `/api/avatar/${encodeURIComponent(u)}`;
    userAvatars.set(u, avatarUrl);

    const el = document.createElement('div');
    el.className = `user-item ${activeUser === u ? 'active' : ''}`;
    el.dataset.username = u;
    el.innerHTML = `
      <div class="user-avatar-wrap">
        <img class="avatar-img" src="${avatarUrl}" alt="${escapeHtml(u)}">
      </div>
      <div class="user-item-info">
        <span class="user-item-name">${escapeHtml(u)}</span>
      </div>
    `;
    el.addEventListener('click', () => {
      switchView('chat');
      selectUser(u);
    });
    userListEl.appendChild(el);
  });
}

async function selectUser(username) {
  activeUser = username;
  document.querySelectorAll('.user-item').forEach(el => {
    el.classList.toggle('active', el.dataset.username === username);
  });

  const avatarUrl = getAvatar(username);
  chatHeaderAvatar.src = avatarUrl;
  chatHeaderAvatar.classList.remove('hidden');
  chatHeaderTitle.textContent = username;
  chatHeaderSubtitle.innerHTML = `<span class="dot"></span> Online · Direct Message`;
  chatHeaderSubtitle.classList.remove('hidden');

  if (chatPollInterval) clearInterval(chatPollInterval);
  renderedMessageIds.clear();
  lastMessageTs = 0;

  composerEl.classList.remove('hidden');
  chatBodyEl.innerHTML = '<div class="empty-state">Loading conversation…</div>';

  const [msgsRes, filesRes] = await Promise.all([
    fetch(`/api/messages/${encodeURIComponent(username)}`),
    fetch('/api/files')
  ]);
  const msgsData = await msgsRes.json();
  const filesData = await filesRes.json();

  const relevantFiles = filesData.files.filter(f => f.from === username || f.to === username);

  const timeline = [
    ...msgsData.messages.map(m => ({ type: 'message', ts: m.timestamp, data: m })),
    ...relevantFiles.map(f => ({ type: 'file', ts: f.uploadedAt, data: f }))
  ].sort((a, b) => a.ts - b.ts);

  chatBodyEl.innerHTML = '';
  if (!timeline.length) {
    chatBodyEl.innerHTML = `<div class="empty-state">No messages yet. Say hi to ${escapeHtml(username)}! 👋</div>`;
  } else {
    timeline.forEach(item => {
      if (item.type === 'message') renderMessage(item.data);
      else renderFile(item.data);
    });
  }
  scrollToBottom();

  // Background polling fallback for serverless platforms like Vercel
  chatPollInterval = setInterval(async () => {
    if (!activeUser || activeUser !== username) return;
    try {
      const pRes = await fetch(`/api/messages/${encodeURIComponent(username)}/poll?since=${lastMessageTs}`);
      if (!pRes.ok) return;
      const pData = await pRes.json();
      if (pData.messages && pData.messages.length) {
        let hasNew = false;
        pData.messages.forEach(m => {
          if (!renderedMessageIds.has(m.id)) {
            renderMessage(m);
            hasNew = true;
          }
        });
        if (hasNew) scrollToBottom();
      }
    } catch (e) {}
  }, 2500);
}

function renderMessage(msg) {
  if (!msg || !msg.id) return;
  if (renderedMessageIds.has(msg.id)) return;
  renderedMessageIds.add(msg.id);
  if (msg.timestamp && msg.timestamp > lastMessageTs) {
    lastMessageTs = msg.timestamp;
  }

  const mine = msg.from === me.username;
  const avatarUrl = msg.avatarUrl || getAvatar(msg.from);

  const row = document.createElement('div');
  row.className = `msg-row ${mine ? 'mine' : 'theirs'}`;
  row.dataset.msgId = msg.id;

  const quickReactionsHtml = `
    <div class="quick-reaction-bar">
      ${QUICK_REACTIONS.map(em => `<button class="reaction-btn" onclick="addReaction('${msg.id}', '${em}')" title="React with ${em}">${em}</button>`).join('')}
    </div>
  `;

  const avatarMarkup = `<img class="avatar-img msg-avatar" data-username="${escapeHtml(msg.from)}" src="${avatarUrl}" alt="${escapeHtml(msg.from)}">`;
  const bubbleMarkup = `
    <div class="bubble-wrap">
      ${quickReactionsHtml}
      <div class="bubble ${mine ? 'mine' : 'theirs'}">
        <div class="bubble-text">${escapeHtml(msg.text)}</div>
        <span class="time">${mine ? 'You' : escapeHtml(msg.from)} · ${timeStr(msg.timestamp)}</span>
      </div>
      <div class="msg-reactions-wrap" id="reactions_${msg.id}"></div>
    </div>
  `;

  row.innerHTML = mine ? `${bubbleMarkup}${avatarMarkup}` : `${avatarMarkup}${bubbleMarkup}`;
  chatBodyEl.appendChild(row);

  renderMessageReactions(msg.id);
}

function renderFile(file) {
  const mine = file.from === me.username;
  const avatarUrl = getAvatar(file.from);

  const row = document.createElement('div');
  row.className = `msg-row ${mine ? 'mine' : 'theirs'}`;

  const avatarMarkup = `<img class="avatar-img msg-avatar" data-username="${escapeHtml(file.from)}" src="${avatarUrl}" alt="${escapeHtml(file.from)}">`;
  const bubbleMarkup = `
    <div class="file-bubble ${mine ? 'mine' : ''}">
      <div class="file-icon">📄</div>
      <div class="file-info">
        <a class="file-name" href="/api/files/${file.id}/download" target="_blank">${escapeHtml(file.originalName)}</a>
        <span class="file-meta">(${formatSize(file.size)}) · ${mine ? 'sent to ' + escapeHtml(file.to) : 'from ' + escapeHtml(file.from)} · ${timeStr(file.uploadedAt)}</span>
      </div>
    </div>
  `;

  row.innerHTML = mine ? `${bubbleMarkup}${avatarMarkup}` : `${avatarMarkup}${bubbleMarkup}`;
  chatBodyEl.appendChild(row);
}

window.addReaction = function(msgId, emoji) {
  if (!messageReactions.has(msgId)) {
    messageReactions.set(msgId, {});
  }
  const reacts = messageReactions.get(msgId);
  reacts[emoji] = (reacts[emoji] || 0) + 1;
  renderMessageReactions(msgId);
};

function renderMessageReactions(msgId) {
  const container = document.getElementById(`reactions_${msgId}`);
  if (!container) return;
  const reacts = messageReactions.get(msgId);
  if (!reacts || !Object.keys(reacts).length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = Object.entries(reacts)
    .map(([em, count]) => `<span class="reaction-pill" onclick="addReaction('${msgId}', '${em}')">${em} ${count}</span>`)
    .join('');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function scrollToBottom() {
  chatBodyEl.scrollTop = chatBodyEl.scrollHeight;
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !activeUser) return;
  const targetUser = activeUser;
  messageInput.value = '';
  emojiPicker.classList.add('hidden');
  emojiToggleBtn.classList.remove('active');

  if (socket && socket.connected) {
    socket.emit('private-message', { to: targetUser, text });
  }

  // Also send via HTTP for Vercel/serverless environments
  try {
    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: targetUser, text })
    });
    const data = await res.json();
    if (res.ok && data.message) {
      if (!renderedMessageIds.has(data.message.id)) {
        renderMessage(data.message);
        scrollToBottom();
      }
    }
  } catch (err) {
    console.error('Failed to send message via HTTP:', err);
  }
}

attachBtn.addEventListener('click', () => {
  if (!activeUser) return alert('Select a user first');
  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file || !activeUser) return;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('to', activeUser);

  attachBtn.textContent = '⏳';
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Upload failed');
    } else {
      renderFile(data.file);
      scrollToBottom();
    }
  } catch (err) {
    alert('Upload failed. Please try again.');
  } finally {
    attachBtn.textContent = '📎';
    fileInput.value = '';
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ---------- ADMIN CONTROL PANEL ----------

function setupAdminTabs() {
  tabChatViewBtn.addEventListener('click', () => switchView('chat'));
  tabAdminViewBtn.addEventListener('click', () => {
    switchView('admin');
    loadAdminData();
  });
  refreshAdminBtn.addEventListener('click', loadAdminData);
}

function switchView(viewName) {
  if (viewName === 'admin') {
    tabAdminViewBtn.classList.add('active');
    tabChatViewBtn.classList.remove('active');
    adminView.classList.remove('hidden');
    chatView.classList.add('hidden');
  } else {
    tabChatViewBtn.classList.add('active');
    tabAdminViewBtn.classList.remove('active');
    chatView.classList.remove('hidden');
    adminView.classList.add('hidden');
  }
}

async function loadAdminData() {
  await Promise.all([
    loadAdminStats(),
    loadAdminUsers(),
    loadAdminConversations()
  ]);
}

async function loadAdminStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) return;
    const data = await res.json();
    statTotalUsers.textContent = data.totalUsers;
    statActiveUsers.textContent = data.activeUsers;
    statBlockedUsers.textContent = data.blockedUsers;
    statTotalMessages.textContent = data.totalMessages;
    statTotalFiles.textContent = data.totalFiles;
  } catch (e) {
    console.error('Failed to load admin stats', e);
  }
}

async function loadAdminUsers() {
  try {
    const res = await fetch('/api/admin/users');
    if (!res.ok) return;
    const data = await res.json();
    renderAdminUsers(data.users);
  } catch (e) {
    console.error('Failed to load admin users', e);
  }
}

function renderAdminUsers(users) {
  if (!users || !users.length) {
    adminUsersTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No users registered</td></tr>';
    return;
  }
  adminUsersTableBody.innerHTML = '';

  users.forEach(u => {
    const tr = document.createElement('tr');

    const roleBadge = u.isAdmin
      ? `<span class="badge badge-admin">Admin</span>`
      : `<span class="badge badge-user">User</span>`;

    const statusBadge = u.isBlocked
      ? `<span class="badge badge-blocked">🚫 Blocked</span>`
      : `<span class="badge badge-active">✅ Active</span>`;

    let actionBtns = '';
    if (!u.isAdmin) {
      const blockBtn = u.isBlocked
        ? `<button class="btn-action btn-unblock" onclick="adminUnblockUser('${escapeHtml(u.username)}')">Unblock</button>`
        : `<button class="btn-action btn-block" onclick="adminBlockUser('${escapeHtml(u.username)}')">Block</button>`;

      const deleteBtn = `<button class="btn-action btn-delete" onclick="adminDeleteUser('${escapeHtml(u.username)}')">Delete</button>`;
      actionBtns = `${blockBtn} ${deleteBtn}`;
    } else {
      actionBtns = `<span style="color:var(--muted);font-size:12px;">Primary Admin</span>`;
    }

    tr.innerHTML = `
      <td>
        <div class="admin-user-cell">
          <img class="avatar-img" src="${u.avatarUrl}" alt="${escapeHtml(u.username)}">
          <span class="admin-user-name">${escapeHtml(u.username)}</span>
        </div>
      </td>
      <td>${roleBadge}</td>
      <td>${statusBadge}</td>
      <td style="color:var(--muted);font-size:13px;">${dateStr(u.createdAt)}</td>
      <td style="text-align:right;">${actionBtns}</td>
    `;
    adminUsersTableBody.appendChild(tr);
  });
}

window.adminBlockUser = async function(username) {
  if (!confirm(`Are you sure you want to BLOCK user "${username}"? They will be immediately disconnected and prevented from logging in.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}/block`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Failed to block user');
    else {
      await loadAdminData();
      await loadUsers();
    }
  } catch (e) {
    alert('Action failed');
  }
};

window.adminUnblockUser = async function(username) {
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}/unblock`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Failed to unblock user');
    else {
      await loadAdminData();
      await loadUsers();
    }
  } catch (e) {
    alert('Action failed');
  }
};

window.adminDeleteUser = async function(username) {
  if (!confirm(`WARNING: Are you sure you want to permanently DELETE user "${username}"? This cannot be undone.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Failed to delete user');
    else {
      await loadAdminData();
      await loadUsers();
    }
  } catch (e) {
    alert('Action failed');
  }
};

// Admin Conversation Inspector
async function loadAdminConversations() {
  try {
    const res = await fetch('/api/admin/conversations');
    if (!res.ok) return;
    const data = await res.json();
    renderAdminThreads(data.conversations);
  } catch (e) {
    console.error('Failed to load conversations', e);
  }
}

function renderAdminThreads(threads) {
  if (!threads || !threads.length) {
    adminThreadsList.innerHTML = '<div class="empty-state" style="padding:20px 10px;">No messages sent yet across the system.</div>';
    return;
  }
  adminThreadsList.innerHTML = '';
  threads.forEach(t => {
    const item = document.createElement('div');
    item.className = 'inspector-thread-item';
    item.innerHTML = `
      <div class="thread-users">
        <strong>${escapeHtml(t.user1)}</strong> ↔ <strong>${escapeHtml(t.user2)}</strong>
      </div>
      <div class="thread-preview">${escapeHtml(t.lastPreview || 'No preview')}</div>
      <div class="thread-meta">${t.messageCount} msg${t.messageCount === 1 ? '' : 's'} · ${timeStr(t.lastTimestamp)}</div>
    `;
    item.addEventListener('click', () => {
      document.querySelectorAll('.inspector-thread-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      inspectConversation(t.user1, t.user2);
    });
    adminThreadsList.appendChild(item);
  });
}

async function inspectConversation(userA, userB) {
  activeInspectorPair = { userA, userB };
  inspectorHeader.innerHTML = `Conversation between <strong>${escapeHtml(userA)}</strong> and <strong>${escapeHtml(userB)}</strong>`;
  inspectorBody.innerHTML = '<div class="empty-state">Loading conversation log…</div>';

  try {
    const res = await fetch(`/api/admin/messages/${encodeURIComponent(userA)}/${encodeURIComponent(userB)}`);
    const data = await res.json();

    const timeline = [
      ...data.messages.map(m => ({ type: 'message', ts: m.timestamp, data: m })),
      ...data.files.map(f => ({ type: 'file', ts: f.uploadedAt, data: f }))
    ].sort((a, b) => a.ts - b.ts);

    inspectorBody.innerHTML = '';
    if (!timeline.length) {
      inspectorBody.innerHTML = '<div class="empty-state">No messages between these users.</div>';
      return;
    }

    timeline.forEach(item => {
      const row = document.createElement('div');
      row.className = 'inspector-msg-row';
      if (item.type === 'message') {
        const m = item.data;
        row.innerHTML = `
          <img class="avatar-img msg-avatar" src="${m.avatarUrl || getAvatar(m.from)}" alt="${escapeHtml(m.from)}">
          <div class="inspector-bubble">
            <div class="inspector-sender"><strong>${escapeHtml(m.from)}</strong> <span class="time">to ${escapeHtml(m.to)} · ${timeStr(m.timestamp)}</span></div>
            <div class="inspector-text">${escapeHtml(m.text)}</div>
          </div>
        `;
      } else {
        const f = item.data;
        row.innerHTML = `
          <img class="avatar-img msg-avatar" src="${getAvatar(f.from)}" alt="${escapeHtml(f.from)}">
          <div class="inspector-bubble file-bubble">
            <div class="inspector-sender"><strong>${escapeHtml(f.from)}</strong> <span class="time">sent file to ${escapeHtml(f.to)} · ${timeStr(f.uploadedAt)}</span></div>
            <div>📄 <a href="/api/files/${f.id}/download" target="_blank">${escapeHtml(f.originalName)}</a> (${formatSize(f.size)})</div>
          </div>
        `;
      }
      inspectorBody.appendChild(row);
    });

    inspectorBody.scrollTop = inspectorBody.scrollHeight;
  } catch (e) {
    inspectorBody.innerHTML = '<div class="empty-state">Failed to load conversation</div>';
  }
}

// ---------- PROFILE AVATAR MODAL (CHANGE ANYTIME) ----------

myProfileBtn.addEventListener('click', () => {
  if (!me) return;
  avatarPreviewImg.src = me.avatarUrl;
  selectedAvatarFile = null;
  avatarFileInput.value = '';
  avatarModalMsg.classList.add('hidden');
  avatarModal.classList.remove('hidden');
});

closeAvatarModalBtn.addEventListener('click', closeModal);
cancelAvatarBtn.addEventListener('click', closeModal);

function closeModal() {
  avatarModal.classList.add('hidden');
  selectedAvatarFile = null;
}

avatarDropzone.addEventListener('click', () => {
  avatarFileInput.click();
});

avatarDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  avatarDropzone.classList.add('drag-over');
});

avatarDropzone.addEventListener('dragleave', () => {
  avatarDropzone.classList.remove('drag-over');
});

avatarDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  avatarDropzone.classList.remove('drag-over');
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    handleAvatarFileSelect(e.dataTransfer.files[0]);
  }
});

avatarFileInput.addEventListener('change', () => {
  if (avatarFileInput.files && avatarFileInput.files[0]) {
    handleAvatarFileSelect(avatarFileInput.files[0]);
  }
});

function handleAvatarFileSelect(file) {
  if (!file.type.startsWith('image/')) {
    showAvatarModalMsg('Please select an image file (JPG, PNG, WebP, GIF)', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showAvatarModalMsg('Image size must be less than 5MB', 'error');
    return;
  }
  selectedAvatarFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    avatarPreviewImg.src = e.target.result;
  };
  reader.readAsDataURL(file);
  avatarModalMsg.classList.add('hidden');
}

saveAvatarBtn.addEventListener('click', async () => {
  if (!selectedAvatarFile) {
    showAvatarModalMsg('Please select a new image first', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('avatar', selectedAvatarFile);

  saveAvatarBtn.disabled = true;
  saveAvatarBtn.textContent = 'Saving…';

  try {
    const res = await fetch('/api/profile/avatar', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) {
      showAvatarModalMsg(data.error || 'Failed to upload avatar', 'error');
    } else {
      me.avatarUrl = data.avatarUrl;
      myAvatarImg.src = data.avatarUrl;
      userAvatars.set(me.username, data.avatarUrl);
      showAvatarModalMsg('Profile picture updated successfully!', 'success');
      setTimeout(() => {
        closeModal();
      }, 900);
    }
  } catch (err) {
    showAvatarModalMsg('Network error. Please try again.', 'error');
  } finally {
    saveAvatarBtn.disabled = false;
    saveAvatarBtn.textContent = 'Save Picture';
  }
});

function showAvatarModalMsg(text, type) {
  avatarModalMsg.textContent = text;
  avatarModalMsg.className = `msg ${type}`;
  avatarModalMsg.classList.remove('hidden');
}

init();
