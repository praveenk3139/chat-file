let me = null;
let socket = null;
let activeUser = null;
const userAvatars = new Map();
const messageReactions = new Map(); // msgId -> { [emoji]: count }
const renderedMessageIds = new Set();
const renderedFileIds = new Set();
const unreadCounts = new Map(); // username -> count
const threadSnippets = new Map(); // username -> { text, timestamp, from }
let cachedUsers = [];
let lastSyncTimestamp = 0;
let isSyncInProgress = false;
let syncTimer = null;

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

// Command Mode & Voice Assistant Elements
const commandModeToggleBtn = document.getElementById('commandModeToggleBtn');
const cmdModeLabel = document.getElementById('cmdModeLabel');
const cmdStatusDot = document.getElementById('cmdStatusDot');
const commandHud = document.getElementById('commandHud');
const commandHudText = document.getElementById('commandHudText');
const commandHudDeactivateBtn = document.getElementById('commandHudDeactivateBtn');
const voiceCmdBtn = document.getElementById('voiceCmdBtn');
let isCommandModeActive = false;
let isVoiceListening = false;
let speechRecognition = null;

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

// Categorized Emojis
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

// ---------- APP INITIALIZATION ----------

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
  setupVoiceAssistant();

  // Socket.IO only when NOT in serverless mode (avoids 404 spam on Vercel)
  if (!me.isServerless && typeof io !== 'undefined') {
    try {
      socket = io({
        auth: { token: me.socketToken },
        reconnectionAttempts: 3,
        timeout: 4000,
        transports: ['websocket', 'polling']
      });

      socket.on('private-message', (msg) => {
        if (activeUser && (msg.from === activeUser || msg.to === activeUser)) {
          if (!renderedMessageIds.has(msg.id)) {
            renderMessage(msg);
            scrollToBottom();
          }
        }
      });

      socket.on('file-shared', (file) => {
        if (activeUser && (file.from === activeUser || file.to === activeUser)) {
          if (!renderedFileIds.has(file.id)) {
            renderFile(file);
            scrollToBottom();
          }
        }
      });

      socket.on('new-user', ({ username, avatarUrl }) => {
        userAvatars.set(username, avatarUrl);
        syncNow(true);
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
        syncNow(true);
      });

      socket.on('account-blocked', (data) => {
        alert(data.reason || 'Your account has been blocked by the admin.');
        window.location.href = '/login.html';
      });
    } catch (err) {
      console.warn('Socket connection fallback active.');
    }
  }

  // Load initial users
  await loadUsers();

  // Start real-time synchronization engine (vital for Vercel)
  startRealtimeSync();
}

// ---------- HIGH-SPEED REAL-TIME ENGINE ----------

function startRealtimeSync() {
  if (syncTimer) clearInterval(syncTimer);

  // High-frequency polling (1.2s for instantaneous real-time chat on Vercel)
  syncTimer = setInterval(syncNow, 1200);

  // Reactivate instantly when tab is focused
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncNow();
    }
  });
  window.addEventListener('focus', () => syncNow());
}

async function syncNow(forceUsers = false) {
  if (isSyncInProgress) return;
  isSyncInProgress = true;

  try {
    const params = new URLSearchParams({
      since: String(lastSyncTimestamp || 0),
      usersCount: String(cachedUsers.length),
      activeUser: activeUser || '',
      forceUsers: forceUsers ? 'true' : 'false'
    });

    const res = await fetch(`/api/sync?${params.toString()}`);
    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    if (!res.ok) return;

    const data = await res.json();
    if (data.isBlocked) {
      alert('Your account has been blocked by the admin.');
      window.location.href = '/login.html';
      return;
    }

    if (data.serverTime) {
      // Advance watermark slightly behind server time to prevent dropped messages
      lastSyncTimestamp = Math.max(lastSyncTimestamp, data.serverTime - 2500);
    }

    // 1. Update threads map
    if (data.threads) {
      Object.entries(data.threads).forEach(([u, t]) => {
        threadSnippets.set(u, t);
      });
    }

    // 2. Update users list if count changed or force updated
    if (data.users && Array.isArray(data.users)) {
      cachedUsers = data.users;
      cachedUsers.forEach(u => {
        userAvatars.set(u.username, u.avatarUrl);
      });
      renderUserList();
    }

    // 3. Process new messages in real time!
    let activeChatReceivedNew = false;
    if (data.newMessages && data.newMessages.length) {
      data.newMessages.forEach(msg => {
        if (!renderedMessageIds.has(msg.id)) {
          lastSyncTimestamp = Math.max(lastSyncTimestamp, msg.timestamp);

          const isForActive = activeUser && (msg.from === activeUser || (msg.from === me.username && msg.to === activeUser));
          if (isForActive) {
            renderMessage(msg);
            activeChatReceivedNew = true;
          } else {
            // Message from another contact -> increment unread badge!
            const other = msg.from === me.username ? msg.to : msg.from;
            const current = unreadCounts.get(other) || 0;
            unreadCounts.set(other, current + 1);
            updateUserBadge(other);
          }

          // Update snippet
          const contact = msg.from === me.username ? msg.to : msg.from;
          threadSnippets.set(contact, {
            text: msg.text,
            timestamp: msg.timestamp,
            from: msg.from
          });
          updateUserItemPreview(contact);
        }
      });
    }

    if (activeChatReceivedNew) {
      scrollToBottom();
    }

    // 4. Process new files
    if (data.newFiles && data.newFiles.length) {
      let activeChatReceivedFile = false;
      data.newFiles.forEach(file => {
        if (!renderedFileIds.has(file.id)) {
          lastSyncTimestamp = Math.max(lastSyncTimestamp, file.uploadedAt);
          const isForActive = activeUser && (file.from === activeUser || (file.from === me.username && file.to === activeUser));
          if (isForActive) {
            renderFile(file);
            activeChatReceivedFile = true;
          }
        }
      });
      if (activeChatReceivedFile) {
        scrollToBottom();
      }
    }
  } catch (e) {
    // Network hiccup - ignore and retry next cycle
  } finally {
    isSyncInProgress = false;
  }
}

// ---------- EMOJI PICKER SYSTEM ----------

function setupEmojiPicker() {
  renderEmojiGrid(currentEmojiCategory);

  emojiToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle('hidden');
    emojiToggleBtn.classList.toggle('active');
    if (!emojiPicker.classList.contains('hidden')) {
      emojiSearchInput.focus();
    }
  });

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

  emojiSearchInput.addEventListener('input', () => {
    const q = emojiSearchInput.value.trim().toLowerCase();
    if (!q) {
      renderEmojiGrid(currentEmojiCategory);
      return;
    }
    const results = [];
    Object.values(EMOJI_CATEGORIES).forEach(cat => {
      cat.emojis.forEach(em => results.push(em));
    });
    renderCustomEmojiList('Search Results', results);
  });

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

// =========================================================
// ---------- COMMAND MODE & VOICE ASSISTANT ---------------
// =========================================================

function speak(text) {
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      utter.pitch = 1.0;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }
}

function activateCommandMode(speakConfirmation = true) {
  if (isCommandModeActive) return;
  isCommandModeActive = true;
  if (commandModeToggleBtn) commandModeToggleBtn.classList.add('active');
  if (cmdModeLabel) cmdModeLabel.textContent = 'Command Mode ON';
  if (commandHud) commandHud.classList.remove('hidden');
  if (voiceCmdBtn) voiceCmdBtn.classList.add('active');
  if (messageInput) {
    messageInput.placeholder = '⚡ Command Mode ON — Speak or type a command (e.g. send hello, select user)…';
  }
  if (commandHudText) {
    commandHudText.textContent = 'Listening… Say "send <message>", "select <user>", "attach file", or "turn off command mode"';
  }
  if (speakConfirmation) {
    speak('Command mode activated');
  }
  startListening();
}

function deactivateCommandMode(speakConfirmation = true) {
  if (!isCommandModeActive) return;
  isCommandModeActive = false;
  if (commandModeToggleBtn) commandModeToggleBtn.classList.remove('active');
  if (cmdModeLabel) cmdModeLabel.textContent = 'Command Mode';
  if (commandHud) commandHud.classList.add('hidden');
  if (voiceCmdBtn) voiceCmdBtn.classList.remove('active', 'listening');
  if (messageInput) {
    messageInput.placeholder = 'Type a message, add emojis, or type "turn on command mode"…';
  }
  if (speakConfirmation) {
    speak('Command mode deactivated');
  }
  stopListening();
}

function toggleCommandMode() {
  if (isCommandModeActive) {
    deactivateCommandMode(true);
  } else {
    activateCommandMode(true);
  }
}

function handleCommand(rawText, fromVoice = false) {
  if (!rawText) return false;
  const clean = rawText.trim();
  const lower = clean.toLowerCase();

  // 1. Activation command
  if (lower.includes('turn on command mode') || lower.includes('activate command mode') || lower === '/command on' || lower === 'command mode on') {
    activateCommandMode(true);
    return true;
  }

  // 2. Deactivation command
  if (lower.includes('turn off command mode') || lower.includes('deactivate command mode') || lower.includes('exit command mode') || lower === '/command off' || lower === 'command mode off') {
    deactivateCommandMode(true);
    return true;
  }

  // If command mode is active, handle commands:
  if (isCommandModeActive) {
    // A. Send message command: "send message <text>", "send <text>", "say <text>", "tell <text>"
    const sendMatch = clean.match(/^(?:send\s+message|send|say|tell\s+(?:him|her|them)?)\s+(.+)$/i);
    if (sendMatch && sendMatch[1]) {
      const msgToSend = sendMatch[1].trim();
      if (msgToSend) {
        if (!activeUser) {
          speak('Please select a contact first');
          return true;
        }
        messageInput.value = msgToSend;
        sendMessage();
        speak('Message sent');
        return true;
      }
    }

    // B. Select user command: "select <name>", "chat with <name>", "open <name>"
    const selectMatch = clean.match(/^(?:select|chat\s+with|open|talk\s+to)\s+(.+)$/i);
    if (selectMatch && selectMatch[1]) {
      const targetQuery = selectMatch[1].trim().toLowerCase().replace(/\s+/g, '');
      const found = cachedUsers.find(u => 
        u.username.toLowerCase().replace(/[._-]/g, '').includes(targetQuery.replace(/[._-]/g, ''))
      );
      if (found) {
        selectUser(found.username);
        speak(`Chat opened with ${found.username}`);
        return true;
      } else {
        speak(`User ${selectMatch[1]} not found`);
        return true;
      }
    }

    // C. Attach file command: "attach file", "send file", "upload file"
    if (lower.includes('attach file') || lower.includes('send file') || lower.includes('upload file') || lower === 'attach' || lower === 'upload') {
      if (!activeUser) {
        speak('Please select a contact first');
        return true;
      }
      fileInput.click();
      speak('Opening file selector');
      return true;
    }

    // D. Open emoji picker: "emoji", "open emoji", "choose emoji"
    if (lower.includes('emoji') || lower.includes('choose emoji')) {
      emojiPicker.classList.toggle('hidden');
      emojiToggleBtn.classList.toggle('active');
      speak('Emoji picker toggled');
      return true;
    }

    // E. Clear message: "clear", "clear message", "reset"
    if (lower === 'clear' || lower === 'clear message' || lower === 'cancel') {
      messageInput.value = '';
      speak('Message cleared');
      return true;
    }

    // F. Logout command: "logout", "sign out"
    if (lower === 'logout' || lower === 'sign out') {
      speak('Logging out');
      fetch('/api/logout', { method: 'POST' }).then(() => {
        window.location.href = '/login.html';
      });
      return true;
    }

    // G. If from voice in command mode and didn't match specific keyword, send as message if activeUser selected
    if (fromVoice && activeUser && clean.length > 1) {
      messageInput.value = clean;
      sendMessage();
      speak('Message sent');
      return true;
    }
  }

  return false;
}

function setupVoiceAssistant() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (commandModeToggleBtn) {
    commandModeToggleBtn.addEventListener('click', toggleCommandMode);
  }
  if (commandHudDeactivateBtn) {
    commandHudDeactivateBtn.addEventListener('click', () => deactivateCommandMode(true));
  }
  if (voiceCmdBtn) {
    voiceCmdBtn.addEventListener('click', () => {
      toggleCommandMode();
    });
  }

  if (SpeechRec) {
    try {
      speechRecognition = new SpeechRec();
      speechRecognition.continuous = true;
      speechRecognition.interimResults = false;
      speechRecognition.lang = 'en-US';

      speechRecognition.onstart = () => {
        isVoiceListening = true;
        if (voiceCmdBtn) voiceCmdBtn.classList.add('listening');
        if (commandHudText && isCommandModeActive) {
          commandHudText.textContent = '🎙️ Listening to your voice commands…';
        }
      };

      speechRecognition.onresult = (event) => {
        const lastIndex = event.results.length - 1;
        const spoken = event.results[lastIndex][0].transcript.trim();
        console.log('[Voice Command Heard]:', spoken);
        if (commandHudText && isCommandModeActive) {
          commandHudText.textContent = `Heard: "${spoken}"`;
        }
        handleCommand(spoken, true);
      };

      speechRecognition.onerror = (event) => {
        console.warn('[Speech Recognition]:', event.error);
      };

      speechRecognition.onend = () => {
        isVoiceListening = false;
        if (voiceCmdBtn) voiceCmdBtn.classList.remove('listening');
        // Keep listening while command mode is active
        if (isCommandModeActive) {
          try { speechRecognition.start(); } catch (e) {}
        }
      };
    } catch (e) {
      console.warn('Speech recognition initialization:', e);
    }
  }
}

function startListening() {
  if (speechRecognition && !isVoiceListening) {
    try {
      speechRecognition.start();
    } catch (e) {}
  }
}

function stopListening() {
  if (speechRecognition && isVoiceListening) {
    try {
      speechRecognition.stop();
    } catch (e) {}
  }
}

// ---------- USER LIST & CHAT ----------

async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    const data = await res.json();
    if (data.users && Array.isArray(data.users)) {
      cachedUsers = data.users;
      cachedUsers.forEach(u => userAvatars.set(u.username, u.avatarUrl));
      renderUserList();
    }
  } catch (err) {
    console.error('Failed to load users:', err);
  }
}

function renderUserList() {
  if (!cachedUsers || !cachedUsers.length) {
    userListEl.innerHTML = '<div class="empty-state" style="margin-top:20px;">No other active users yet.<br><small style="opacity:0.75;display:block;margin-top:6px;">Sign up another account to start chatting!</small></div>';
    return;
  }

  // Sort: recent messages & unread first
  const sorted = [...cachedUsers].sort((a, b) => {
    const unreadA = unreadCounts.get(a.username) || 0;
    const unreadB = unreadCounts.get(b.username) || 0;
    if (unreadA !== unreadB) return unreadB - unreadA;
    const timeA = (threadSnippets.get(a.username) && threadSnippets.get(a.username).timestamp) || 0;
    const timeB = (threadSnippets.get(b.username) && threadSnippets.get(b.username).timestamp) || 0;
    return timeB - timeA;
  });

  userListEl.innerHTML = '';
  sorted.forEach(item => {
    const u = item.username;
    const avatarUrl = item.avatarUrl || getAvatar(u);
    userAvatars.set(u, avatarUrl);

    const el = document.createElement('div');
    el.className = `user-item ${activeUser === u ? 'active' : ''}`;
    el.dataset.username = u;

    const unread = unreadCounts.get(u) || 0;
    const snippet = threadSnippets.get(u);
    let previewText = 'Tap to chat';
    if (snippet && snippet.text) {
      previewText = snippet.from === me.username ? `You: ${snippet.text}` : snippet.text;
    }

    el.innerHTML = `
      <div class="user-avatar-wrap">
        <img class="avatar-img" src="${avatarUrl}" alt="${escapeHtml(u)}">
      </div>
      <div class="user-item-info">
        <span class="user-item-name">${escapeHtml(u)}</span>
        <span class="user-item-preview">${escapeHtml(previewText)}</span>
      </div>
      <span class="user-item-unread-badge ${unread > 0 ? '' : 'hidden'}">${unread}</span>
    `;

    el.addEventListener('click', () => {
      switchView('chat');
      selectUser(u);
    });

    userListEl.appendChild(el);
  });

  // Auto-select first contact if none currently selected
  if (!activeUser && sorted.length > 0) {
    selectUser(sorted[0].username);
  }
}

function updateUserBadge(username) {
  const el = document.querySelector(`.user-item[data-username="${username}"]`);
  if (!el) {
    renderUserList();
    return;
  }
  const badge = el.querySelector('.user-item-unread-badge');
  const count = unreadCounts.get(username) || 0;
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('hidden', count <= 0);
  }
}

function updateUserItemPreview(username) {
  const el = document.querySelector(`.user-item[data-username="${username}"]`);
  if (!el) return;
  const previewEl = el.querySelector('.user-item-preview');
  const snippet = threadSnippets.get(username);
  if (previewEl && snippet && snippet.text) {
    previewEl.textContent = snippet.from === me.username ? `You: ${snippet.text}` : snippet.text;
  }
}

async function selectUser(username) {
  activeUser = username;

  // Clear unread for this user
  unreadCounts.delete(username);
  updateUserBadge(username);

  document.querySelectorAll('.user-item').forEach(el => {
    el.classList.toggle('active', el.dataset.username === username);
  });

  const avatarUrl = getAvatar(username);
  chatHeaderAvatar.src = avatarUrl;
  chatHeaderAvatar.classList.remove('hidden');
  chatHeaderTitle.textContent = username;
  chatHeaderSubtitle.innerHTML = `<span class="dot"></span> Online · Direct Message`;
  chatHeaderSubtitle.classList.remove('hidden');

  composerEl.classList.remove('hidden');
  chatBodyEl.innerHTML = '<div class="empty-state">Loading conversation…</div>';

  renderedMessageIds.clear();
  renderedFileIds.clear();

  try {
    const [msgsRes, filesRes] = await Promise.all([
      fetch(`/api/messages/${encodeURIComponent(username)}`),
      fetch('/api/files')
    ]);
    const msgsData = await msgsRes.json();
    const filesData = await filesRes.json();

    const relevantFiles = (filesData.files || []).filter(f => f.from === username || f.to === username);

    const timeline = [
      ...(msgsData.messages || []).map(m => ({ type: 'message', ts: m.timestamp, data: m })),
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
  } catch (err) {
    console.error('Error loading thread:', err);
    chatBodyEl.innerHTML = `<div class="empty-state">Start a conversation with ${escapeHtml(username)}! 👋</div>`;
  }
}

function renderMessage(msg) {
  if (!msg || !msg.id) return;
  if (renderedMessageIds.has(msg.id)) return;
  
  // Check if message is already in DOM
  if (chatBodyEl.querySelector(`.msg-row[data-msg-id="${msg.id}"]`)) {
    renderedMessageIds.add(msg.id);
    return;
  }
  renderedMessageIds.add(msg.id);

  const emptyEl = chatBodyEl.querySelector('.empty-state');
  if (emptyEl) emptyEl.remove();

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
  if (!file || !file.id) return;
  if (renderedFileIds.has(file.id)) return;
  renderedFileIds.add(file.id);

  const emptyEl = chatBodyEl.querySelector('.empty-state');
  if (emptyEl) emptyEl.remove();

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
  if (!text) return;

  // Intercept typed activation/deactivation and commands
  if (handleCommand(text, false)) {
    messageInput.value = '';
    return;
  }

  if (!activeUser) return alert('Select a user first');
  const targetUser = activeUser;
  messageInput.value = '';
  emojiPicker.classList.add('hidden');
  emojiToggleBtn.classList.remove('active');

  const clientMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

  // Update recent conversation snippet immediately
  threadSnippets.set(targetUser, {
    text,
    timestamp: Date.now(),
    from: me.username
  });
  updateUserItemPreview(targetUser);

  if (socket && socket.connected) {
    // 1. Send via WebSocket (Instant single delivery)
    socket.emit('private-message', { id: clientMsgId, to: targetUser, text });
  } else {
    // 2. HTTP Fallback for serverless
    const tempMsg = {
      id: clientMsgId,
      from: me.username,
      to: targetUser,
      text,
      avatarUrl: me.avatarUrl,
      timestamp: Date.now()
    };
    renderMessage(tempMsg);
    scrollToBottom();

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientMsgId, to: targetUser, text })
      });
      const data = await res.json();
      if (!res.ok && data && data.error) {
        alert(data.error);
      }
    } catch (e) {
      console.error('Failed to send message via HTTP:', e);
    }
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
    if (res.ok && data.file) {
      renderFile(data.file);
      scrollToBottom();
      syncNow();
    } else {
      alert(data.error || 'Upload failed');
    }
  } catch (e) {
    alert('Upload failed due to network error');
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

  // Admin Create User Modal wiring
  const createUserModal = document.getElementById('createUserModal');
  const openCreateUserModalBtn = document.getElementById('openCreateUserModalBtn');
  const closeCreateUserModalBtn = document.getElementById('closeCreateUserModalBtn');
  const cancelCreateUserBtn = document.getElementById('cancelCreateUserBtn');
  const submitCreateUserBtn = document.getElementById('submitCreateUserBtn');
  const adminCreateUserForm = document.getElementById('adminCreateUserForm');
  const adminNewUsername = document.getElementById('adminNewUsername');
  const adminNewPassword = document.getElementById('adminNewPassword');
  const adminNewIsAdmin = document.getElementById('adminNewIsAdmin');
  const adminCreateUserMsg = document.getElementById('adminCreateUserMsg');

  function showAdminCreateMsg(text, type) {
    if (!adminCreateUserMsg) return;
    adminCreateUserMsg.className = `msg ${type}`;
    adminCreateUserMsg.textContent = text;
    adminCreateUserMsg.classList.remove('hidden');
  }

  function closeCreateModal() {
    if (createUserModal) createUserModal.classList.add('hidden');
  }

  if (openCreateUserModalBtn) {
    openCreateUserModalBtn.addEventListener('click', () => {
      adminCreateUserMsg.classList.add('hidden');
      adminNewUsername.value = '';
      adminNewPassword.value = '';
      adminNewIsAdmin.checked = false;
      createUserModal.classList.remove('hidden');
      adminNewUsername.focus();
    });
  }

  if (closeCreateUserModalBtn) closeCreateUserModalBtn.addEventListener('click', closeCreateModal);
  if (cancelCreateUserBtn) cancelCreateUserBtn.addEventListener('click', closeCreateModal);

  async function handleAdminCreateUser(e) {
    if (e) e.preventDefault();
    const username = adminNewUsername.value.trim().toLowerCase().replace(/\s+/g, '_');
    const password = adminNewPassword.value;
    const isAdmin = adminNewIsAdmin.checked;

    if (!username) return showAdminCreateMsg('Please enter a username', 'error');
    if (password.length < 6) return showAdminCreateMsg('Password must be at least 6 characters', 'error');

    submitCreateUserBtn.disabled = true;
    submitCreateUserBtn.textContent = 'Creating…';

    try {
      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, isAdmin })
      });
      const data = await res.json();
      if (!res.ok) {
        submitCreateUserBtn.disabled = false;
        submitCreateUserBtn.textContent = 'Create User ✨';
        return showAdminCreateMsg(data.error || 'Failed to create user', 'error');
      }

      showAdminCreateMsg(`User "${username}" created!`, 'success');
      submitCreateUserBtn.disabled = false;
      submitCreateUserBtn.textContent = 'Create User ✨';

      setTimeout(() => {
        closeCreateModal();
        loadAdminData();
        syncNow(true);
      }, 700);
    } catch (err) {
      submitCreateUserBtn.disabled = false;
      submitCreateUserBtn.textContent = 'Create User ✨';
      showAdminCreateMsg('Network error. Failed to create user.', 'error');
    }
  }

  if (submitCreateUserBtn) submitCreateUserBtn.addEventListener('click', handleAdminCreateUser);
  if (adminCreateUserForm) adminCreateUserForm.addEventListener('submit', handleAdminCreateUser);
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
      await syncNow(true);
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
      await syncNow(true);
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
      await syncNow(true);
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
