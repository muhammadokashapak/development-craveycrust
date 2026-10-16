// ─── Automatic Client Cache Invalidation (v9.0.0) ───────────
(function() {
  const currentVer = '9.0.0';
  if (localStorage.getItem('cc_cache_ver') !== currentVer) {
    localStorage.setItem('cc_cache_ver', currentVer);
    // Wipe all entity cache keys and stale brand names
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('cc_cache_') || key.startsWith('cc_last_sync_')) {
        localStorage.removeItem(key);
      }
    });
    const cachedBrand = localStorage.getItem('app_brand_name');
    if (cachedBrand && /cravey/i.test(cachedBrand)) {
      localStorage.removeItem('app_brand_name');
    }
    if (window.indexedDB) {
      try {
        indexedDB.deleteDatabase('CraveyCrustLocalDB');
        indexedDB.deleteDatabase('StoreBotLocalDB');
      } catch (_) {}
    }
  }
})();

// ─── DOM Elements ──────────────────────────────────────────
const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');
const headerLogoutBtn = document.getElementById('headerLogoutBtn');

// Screens
const phoneSection = document.getElementById('phoneSection');
const pairingSection = document.getElementById('pairingSection');
const qrSection = document.getElementById('qrSection');
const connectedSection = document.getElementById('connectedSection');
const disconnectedSection = document.getElementById('disconnectedSection');

// Phone Form
const phoneForm = document.getElementById('phoneForm');
const phoneInput = document.getElementById('phoneInput');
const getPairingBtn = document.getElementById('getPairingBtn');
const startQrBtn = document.getElementById('startQrBtn');
const phoneError = document.getElementById('phoneError');

// Pairing Code Screen
const pairingCodeDisplay = document.getElementById('pairingCodeDisplay');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const copyBtnText = document.getElementById('copyBtnText');
const pairingTimerSec = document.getElementById('pairingTimerSec');
const pairingProgress = document.getElementById('pairingProgress');
const cancelPairingBtn = document.getElementById('cancelPairingBtn');

// QR Code Screen
const qrDisplay = document.getElementById('qrDisplay');
const qrTimerSec = document.getElementById('qrTimerSec');
const qrProgress = document.getElementById('qrProgress');
const cancelQrBtn = document.getElementById('cancelQrBtn');

// Connected Stats
const statName = document.getElementById('statName');
const statNumber = document.getElementById('statNumber');
const statPrefix = document.getElementById('statPrefix');
const statCommands = document.getElementById('statCommands');
const statUptime = document.getElementById('statUptime');

// Accounts Bar
const accountsList = document.getElementById('accountsList');
const addAccountBtn = document.getElementById('addAccountBtn');

// Logout
const logoutBtn = document.getElementById('logoutBtn');
const logoutModal = document.getElementById('logoutModal');
const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');
const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');

// ─── Authentication & Login Gate ─────────────────────────
const authGate = document.getElementById('authGate');
const dashboardApp = document.getElementById('dashboardApp');
const authLoginForm = document.getElementById('authLoginForm');
const authUsername = document.getElementById('authUsername');
const authPassword = document.getElementById('authPassword');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authErrorMsg = document.getElementById('authErrorMsg');
const authThemeToggleBtn = document.getElementById('authThemeToggleBtn');
const dashLogoutBtn = document.getElementById('dashLogoutBtn');

let isAuthenticated = false;

function showAuthGate() {
  isAuthenticated = false;
  document.documentElement.classList.remove('auth-saved');
  if (authGate) authGate.classList.remove('hidden');
  if (dashboardApp) dashboardApp.classList.add('hidden');
}

function showDashboard() {
  isAuthenticated = true;
  document.documentElement.classList.add('auth-saved');
  if (authGate) authGate.classList.add('hidden');
  if (dashboardApp) dashboardApp.classList.remove('hidden');
  loadBrandDisplay();
  loadDashboardStats();
  if (typeof loadOrders === 'function') loadOrders();
  if (typeof initRealtimeOrdersFeed === 'function') initRealtimeOrdersFeed();
}

function showAuthError(msg) {
  if (authErrorMsg) {
    authErrorMsg.textContent = msg;
    authErrorMsg.classList.remove('hidden');
  }
}

function hideAuthError() {
  if (authErrorMsg) {
    authErrorMsg.textContent = '';
    authErrorMsg.classList.add('hidden');
  }
}

// Intercept window.fetch to automatically include Bearer token & handle 401
const originalFetch = window.fetch;
window.fetch = async function (...args) {
  let [resource, config] = args;
  config = config || {};
  config.headers = config.headers || {};

  const token = localStorage.getItem('wa_dash_token');
  if (token) {
    if (config.headers instanceof Headers) {
      if (!config.headers.has('Authorization')) {
        config.headers.set('Authorization', `Bearer ${token}`);
      }
    } else if (Array.isArray(config.headers)) {
      config.headers.push(['Authorization', `Bearer ${token}`]);
    } else {
      if (!config.headers['Authorization']) {
        config.headers['Authorization'] = `Bearer ${token}`;
      }
    }
  }

  const response = await originalFetch(resource, config);
  const url = typeof resource === 'string' ? resource : (resource?.url || '');
  if (response.status === 401 && !url.includes('/api/auth/login')) {
    localStorage.removeItem('wa_dash_token');
    showAuthGate();
  }
  return response;
};

// Toggle Password Visibility
const togglePasswordBtn = document.getElementById('togglePasswordBtn');
if (togglePasswordBtn && authPassword) {
  togglePasswordBtn.addEventListener('click', () => {
    const type = authPassword.getAttribute('type') === 'password' ? 'text' : 'password';
    authPassword.setAttribute('type', type);
    
    // Toggle icon
    if (type === 'text') {
      togglePasswordBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        </svg>
      `;
    } else {
      togglePasswordBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      `;
    }
  });
}

// Handle Login Form Submission
if (authLoginForm) {
  authLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = authUsername ? authUsername.value.trim() : '';
    const password = authPassword ? authPassword.value : '';

    if (!username || !password) {
      showAuthError('Please enter both username and password.');
      return;
    }

    if (authSubmitBtn) {
      authSubmitBtn.disabled = true;
      authSubmitBtn.innerHTML = '<span>Signing In...</span>';
    }
    hideAuthError();

    try {
      const res = await originalFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.success && data.token) {
        localStorage.setItem('wa_dash_token', data.token);
        if (data.user) updateSidebarUserProfile(data.user);
        showDashboard();
        checkStatus();
        if (data.user?.role === 'SUPER_ADMIN') {
          fetchLiveLogs(true);
        }
      } else {
        showAuthError(data.error || 'Invalid credentials. Please try again.');
      }
    } catch (err) {
      showAuthError('Connection error: ' + err.message);
    } finally {
      if (authSubmitBtn) {
        authSubmitBtn.disabled = false;
        authSubmitBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
            <polyline points="10 17 15 12 10 7"></polyline>
            <line x1="15" y1="12" x2="3" y2="12"></line>
          </svg>
          <span>Sign In</span>
        `;
      }
    }
  });
}

// Role-Based Access Control State
let currentUserRole = 'ADMIN';

function applyRolePermissions(user) {
  if (!user) return;
  if (user.username === 'admin' || user.username === 'admin@craveycrust.com') {
    user.role = 'ADMIN';
  }
  currentUserRole = user.role || 'ADMIN';
  const isSuper = currentUserRole === 'SUPER_ADMIN';

  if (isSuper) {
    document.body.classList.add('is-superadmin');
  } else {
    document.body.classList.remove('is-superadmin');
  }

  // 1. Toggle Super Admin exclusive sidebar items (Prompt, Settings)
  const superOnlyNavs = document.querySelectorAll('[data-min-role="SUPER_ADMIN"]');
  superOnlyNavs.forEach(el => {
    if (isSuper) {
      el.classList.remove('hidden');
      el.style.display = '';
    } else {
      el.classList.add('hidden');
      el.style.display = 'none';
    }
  });

  // Customer Chats: visible ONLY for Super Admin
  const navChats = document.getElementById('navChats');
  if (navChats) {
    if (isSuper) {
      navChats.classList.remove('hidden');
      navChats.style.removeProperty('display');
      navChats.style.display = 'flex';
    } else {
      navChats.classList.add('hidden');
      navChats.style.setProperty('display', 'none', 'important');
    }
  }

  // 2. Toggle WhatsApp terminal vs centered connection view (Super Admin Only)
  const waTerminalRight = document.getElementById('waTerminalRight');
  const waSplitContainer = document.getElementById('waSplitContainer');
  if (waTerminalRight && waSplitContainer) {
    if (isSuper) {
      waTerminalRight.classList.remove('hidden');
      waTerminalRight.style.removeProperty('display');
      waTerminalRight.style.display = 'block';
      waSplitContainer.style.gridTemplateColumns = '1fr 1fr';
      waSplitContainer.style.maxWidth = '';
      waSplitContainer.style.margin = '';
    } else {
      waTerminalRight.classList.add('hidden');
      waTerminalRight.style.setProperty('display', 'none', 'important');
      waSplitContainer.style.gridTemplateColumns = '1fr';
      waSplitContainer.style.maxWidth = '680px';
      waSplitContainer.style.margin = '0 auto';
    }
  }

  // 3. Add buttons in Menu & Deals are visible for all admins
  const addMenuBtn = document.getElementById('openAddMenuItemBtn');
  if (addMenuBtn) {
    addMenuBtn.style.display = '';
    addMenuBtn.classList.remove('hidden');
  }
  const addDealBtn = document.getElementById('openAddDealBtn');
  if (addDealBtn) {
    addDealBtn.style.display = '';
    addDealBtn.classList.remove('hidden');
  }
}
window.applyRolePermissions = applyRolePermissions;

// User Profile display in sidebar
function updateSidebarUserProfile(user) {
  if (!user) return;
  if (user.username === 'admin' || user.username === 'admin@craveycrust.com') {
    user.role = 'ADMIN';
  }
  const avatar = document.getElementById('sidebarAvatar');
  const uname = document.getElementById('sidebarUsername');
  const urole = document.getElementById('sidebarRole');

  const username = user.username || user.email || 'admin';
  if (uname) uname.textContent = username;
  if (avatar) avatar.textContent = username.charAt(0).toUpperCase();
  if (urole) {
    if (user.username === 'admin' || user.role !== 'SUPER_ADMIN') {
      urole.textContent = 'Admin';
    } else {
      urole.textContent = 'Super Admin';
    }
  }

  applyRolePermissions(user);
}
window.updateSidebarUserProfile = updateSidebarUserProfile;

// Unified Dashboard Logout
window.handleDashboardLogout = function() {
  document.body.classList.remove('is-superadmin');
  localStorage.removeItem('wa_dash_token');
  showAuthGate();
};

if (dashLogoutBtn) {
  dashLogoutBtn.addEventListener('click', window.handleDashboardLogout);
}

// Verify saved token on initial load
async function initAuth() {
  const token = localStorage.getItem('wa_dash_token');
  if (!token) {
    showAuthGate();
    return;
  }
  try {
    const res = await originalFetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated) {
        if (data.user) updateSidebarUserProfile(data.user);
        showDashboard();
        checkStatus();
        if (data.user?.role === 'SUPER_ADMIN') {
          fetchLiveLogs(true);
        }
        return;
      }
    }
  } catch (err) {
    console.error('Failed to verify token:', err);
  }
  localStorage.removeItem('wa_dash_token');
  showAuthGate();
}

// ─── Theme Switcher (Dark / Light) ─────────────────────────
const themeToggleBtn = document.getElementById('themeToggleBtn');
const savedTheme = localStorage.getItem('wa_bot_theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nextTheme);
  localStorage.setItem('wa_bot_theme', nextTheme);
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', toggleTheme);
}
if (authThemeToggleBtn) {
  authThemeToggleBtn.addEventListener('click', toggleTheme);
}

// ─── State Variables ───────────────────────────────────────
let activeSection = phoneSection;
let countdownInterval = null;
let currentCountdown = 60;
const TOTAL_TIMEOUT = 60; // 60 seconds
let isRequesting = false;
let isLoggingOut = false;
let currentQrDataUrl = null;
let rawPairingCode = '';
let currentSessionId = 'primary';
let allSessions = [];

const cleanInactiveBtn = document.getElementById('cleanInactiveBtn');

// ─── Accounts Bar Rendering ───────────────────────────────
function renderAccountsBar(sessions) {
  if (!accountsList) return;
  accountsList.innerHTML = '';

  // Show "Clean Inactive" button if there are unconnected extra accounts
  const inactiveCount = sessions.filter(s => s.id !== 'primary' && s.state !== 'connected').length;
  if (cleanInactiveBtn) {
    if (inactiveCount > 0) {
      cleanInactiveBtn.classList.remove('hidden');
      const textSpan = cleanInactiveBtn.querySelector('span');
      if (textSpan) textSpan.textContent = `Clean (${inactiveCount})`;
    } else {
      cleanInactiveBtn.classList.add('hidden');
    }
  }

  sessions.forEach(s => {
    const pill = document.createElement('div');
    const isActive = s.id === currentSessionId;
    pill.className = `account-pill ${isActive ? 'active' : ''}`;
    
    let dotClass = 'offline';
    if (s.state === 'connected') dotClass = 'online';
    else if (['starting', 'pairing_code', 'qr'].includes(s.state)) dotClass = 'pairing';
    
    const rawName = (s.user?.name || s.name || s.id || '').trim();
    const displayName = (rawName && rawName !== '.') ? rawName : 'WhatsApp Bot';

    pill.innerHTML = `
      <span class="pill-dot ${dotClass}"></span>
      <span class="pill-name" title="${displayName}">${displayName}</span>
      <button class="pill-delete-btn" type="button" title="Delete account" onclick="window.deleteAccount('${s.id}', event)">✕</button>
    `;

    pill.addEventListener('click', (e) => {
      if (e.target.closest('.pill-delete-btn')) return;
      switchSession(s.id);
    });

    accountsList.appendChild(pill);
  });
}

function switchSession(sessionId) {
  if (currentSessionId === sessionId) return;
  currentSessionId = sessionId;
  stopCountdown();
  rawPairingCode = '';
  currentQrDataUrl = null;
  phoneInput.value = '';
  clearPhoneError();
  checkStatus();
}

window.deleteAccount = async function(sessionId, event) {
  if (event) event.stopPropagation();

  const session = allSessions.find(s => s.id === sessionId);
  const name = session?.user?.name || session?.name || sessionId;

  if (session?.state === 'connected') {
    if (!confirm(`Are you sure you want to disconnect and delete account "${name}"?`)) {
      return;
    }
  }

  try {
    await fetch(`/api/sessions/${sessionId}/delete`, { method: 'POST' });
    
    // If the deleted session was currently selected, pick another session
    if (currentSessionId === sessionId) {
      const remaining = allSessions.filter(s => s.id !== sessionId);
      const connected = remaining.find(s => s.state === 'connected');
      currentSessionId = connected ? connected.id : (remaining[0]?.id || 'primary');
    }

    await checkStatus();
  } catch (err) {
    alert('Failed to delete account: ' + err.message);
  }
};

window.cleanInactiveAccounts = async function() {
  if (cleanInactiveBtn) cleanInactiveBtn.disabled = true;
  try {
    const res = await fetch('/api/sessions/clear-inactive', { method: 'POST' });
    const data = await res.json();
    console.log(`Cleaned up ${data.deletedCount} accounts.`);
    
    // If current session was deleted, switch to primary or first available
    const remaining = allSessions.filter(s => s.state === 'connected' || s.id === 'primary');
    if (!remaining.some(s => s.id === currentSessionId)) {
      currentSessionId = remaining[0]?.id || 'primary';
    }
    await checkStatus();
  } catch (err) {
    alert('Error cleaning inactive accounts: ' + err.message);
  } finally {
    if (cleanInactiveBtn) cleanInactiveBtn.disabled = false;
  }
};

window.createNewAccount = async function() {
  const btn = document.getElementById('addAccountBtn');
  try {
    if (btn) btn.disabled = true;
    const res = await fetch('/api/sessions/create', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success && data.session) {
      currentSessionId = data.session.id;
      showSection(phoneSection);
      setStatus('loading', 'Ready to Link');
      phoneInput.value = '';
      clearPhoneError();
      await checkStatus();
    }
  } catch (err) {
    alert('Error adding account: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
};

if (addAccountBtn) {
  addAccountBtn.addEventListener('click', window.createNewAccount);
}

// ─── Helpers ───────────────────────────────────────────────
function setStatus(type, text) {
  if (statusPill) {
    statusPill.className = 'status-pill';
    if (type === 'online') {
      statusPill.classList.add('status-online');
    } else if (type === 'offline') {
      statusPill.classList.add('status-offline');
    } else {
      statusPill.classList.add('status-loading');
    }
  }
  if (statusText) {
    statusText.textContent = text;
  }
}

function showSection(section) {
  if (activeSection === section) return;
  [phoneSection, pairingSection, qrSection, connectedSection, disconnectedSection].forEach(s => {
    s.classList.add('hidden');
  });
  section.classList.remove('hidden');
  activeSection = section;

  if (headerLogoutBtn) {
    if (section === connectedSection) {
      headerLogoutBtn.classList.remove('hidden');
    } else {
      headerLogoutBtn.classList.add('hidden');
    }
  }
}

function showPhoneError(msg) {
  phoneError.textContent = msg;
  phoneError.classList.remove('hidden');
}

function clearPhoneError() {
  phoneError.textContent = '';
  phoneError.classList.add('hidden');
}

function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// ─── 60-Second Countdown Timer ────────────────────────────
function startCountdown(type) {
  stopCountdown();
  currentCountdown = TOTAL_TIMEOUT;

  function updateUi() {
    const percent = Math.max(0, (currentCountdown / TOTAL_TIMEOUT) * 100);
    if (type === 'pairing') {
      pairingTimerSec.textContent = `${currentCountdown}s`;
      pairingProgress.style.width = `${percent}%`;
    } else if (type === 'qr') {
      qrTimerSec.textContent = `${currentCountdown}s`;
      qrProgress.style.width = `${percent}%`;
    }
  }

  updateUi();

  countdownInterval = setInterval(async () => {
    currentCountdown--;
    updateUi();

    if (currentCountdown <= 0) {
      stopCountdown();
      console.log('⏰ Auth session timed out after 60s. Returning to phone input...');
      await cancelAuth();
    }
  }, 1000);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

async function cancelAuth() {
  stopCountdown();
  try {
    await fetch(`/api/sessions/${currentSessionId}/auth/cancel`, { method: 'POST' });
  } catch (_) {}
  showSection(phoneSection);
  setStatus('loading', 'Ready');
}

// ─── Phone Form: Request Pairing Code ─────────────────────
phoneForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearPhoneError();

  const num = phoneInput.value.trim().replace(/[^0-9]/g, '');
  if (!num || num.length < 8) {
    showPhoneError('Please enter a valid phone number with your country code (e.g. 923321234567).');
    return;
  }

  isRequesting = true;
  getPairingBtn.disabled = true;
  getPairingBtn.innerHTML = `<span>Requesting Code...</span>`;
  setStatus('loading', 'Connecting...');

  try {
    const res = await fetch(`/api/sessions/${currentSessionId}/auth/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: num })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to get pairing code');
    }

    if (data.pairingCode) {
      rawPairingCode = data.pairingCode;
      const formatted = data.pairingCode.length === 8 
        ? `${data.pairingCode.slice(0, 4)} - ${data.pairingCode.slice(4)}`
        : data.pairingCode;
      pairingCodeDisplay.textContent = formatted;
      showSection(pairingSection);
      setStatus('loading', 'Enter Code');
      startCountdown('pairing');
    }
  } catch (err) {
    showPhoneError(err.message);
    setStatus('loading', 'Ready');
  } finally {
    isRequesting = false;
    getPairingBtn.disabled = false;
    getPairingBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
      <span>Get 8-Digit Pairing Code</span>
    `;
  }
});

// ─── Copy Pairing Code to Clipboard ───────────────────────
copyCodeBtn.addEventListener('click', async () => {
  if (!rawPairingCode) return;
  try {
    await navigator.clipboard.writeText(rawPairingCode.replace(/[^a-zA-Z0-9]/g, ''));
    copyBtnText.textContent = 'Copied! ✓';
    copyCodeBtn.style.background = 'rgba(37, 211, 102, 0.35)';
    setTimeout(() => {
      copyBtnText.textContent = 'Copy Code';
      copyCodeBtn.style.background = '';
    }, 2500);
  } catch (err) {
    const input = document.createElement('input');
    input.value = rawPairingCode.replace(/[^a-zA-Z0-9]/g, '');
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    copyBtnText.textContent = 'Copied! ✓';
    setTimeout(() => {
      copyBtnText.textContent = 'Copy Code';
    }, 2500);
  }
});

cancelPairingBtn.addEventListener('click', cancelAuth);

// ─── QR Code Flow ─────────────────────────────────────────
startQrBtn.addEventListener('click', async () => {
  clearPhoneError();
  startQrBtn.disabled = true;
  startQrBtn.innerHTML = `<span>Starting QR...</span>`;
  setStatus('loading', 'Generating QR...');

  try {
    showSection(qrSection);
    qrDisplay.innerHTML = `
      <div class="qr-spinner"></div>
      <p class="qr-loading-text">Generating QR code...</p>
    `;
    startCountdown('qr');

    const res = await fetch(`/api/sessions/${currentSessionId}/auth/start-qr`, { method: 'POST' });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to start QR code');
    }

    if (data.qrDataUrl) {
      currentQrDataUrl = data.qrDataUrl;
      qrDisplay.innerHTML = `<img src="${data.qrDataUrl}" alt="WhatsApp Login QR Code" />`;
      setStatus('loading', 'Scan QR Code');
    }
  } catch (err) {
    showPhoneError(err.message);
    showSection(phoneSection);
    stopCountdown();
  } finally {
    startQrBtn.disabled = false;
    startQrBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="14" y="14" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
      </svg>
      <span>Scan with QR Code</span>
    `;
  }
});

cancelQrBtn.addEventListener('click', cancelAuth);

// ─── Status Polling ───────────────────────────────────────
async function checkStatus() {
  if (!isAuthenticated || isLoggingOut || isRequesting) return;

  try {
    const res = await fetch('/api/sessions', { cache: 'no-store' });
    if (!res.ok) throw new Error('Network error');
    const data = await res.json();
    allSessions = data.sessions || [];

    renderAccountsBar(allSessions);

    let current = allSessions.find(s => s.id === currentSessionId);
    if (!current && allSessions.length > 0) {
      current = allSessions[0];
      currentSessionId = current.id;
    }

    if (!current) return;

    if (current.state === 'connected') {
      stopCountdown();
      const rawName = (current.user?.name || current.name || '').trim();
      const validName = (rawName && rawName !== '.') ? rawName : 'WhatsApp Bot';
      setStatus('online', 'Active');
      showSection(connectedSection);

      statName.textContent = validName;
      statNumber.textContent = 'Active';
      if (statPrefix) statPrefix.textContent = current.prefix || '.';
      if (statCommands) statCommands.textContent = `${current.commandsCount || 12} loaded`;
      statUptime.textContent = formatUptime(current.uptime);

      const termPromptPrefix = document.getElementById('terminalPromptPrefix') || document.querySelector('.prompt-long');
      if (termPromptPrefix) {
        termPromptPrefix.textContent = 'admin@system:';
      }
      const termTitle = document.getElementById('terminalTitleText') || document.querySelector('.term-title-text');
      if (termTitle) {
        termTitle.textContent = 'admin@system:~$';
      }
    } 
    else if (current.state === 'pairing_code') {
      if (activeSection !== pairingSection) {
        showSection(pairingSection);
        startCountdown('pairing');
      }
      if (current.pairingCode && current.pairingCode !== rawPairingCode) {
        rawPairingCode = current.pairingCode;
        const formatted = current.pairingCode.length === 8 
          ? `${current.pairingCode.slice(0, 4)} - ${current.pairingCode.slice(4)}`
          : current.pairingCode;
        pairingCodeDisplay.textContent = formatted;
      }
      setStatus('loading', 'Enter Code');
    }
    else if (current.state === 'qr') {
      if (activeSection !== qrSection) {
        showSection(qrSection);
        startCountdown('qr');
      }
      if (current.qrDataUrl && current.qrDataUrl !== currentQrDataUrl) {
        currentQrDataUrl = current.qrDataUrl;
        qrDisplay.innerHTML = `<img src="${current.qrDataUrl}" alt="WhatsApp Login QR Code" />`;
      }
      setStatus('loading', 'Scan QR Code');
    }
    else if (current.state === 'idle') {
      if (activeSection !== phoneSection) {
        stopCountdown();
        showSection(phoneSection);
      }
      setStatus('loading', 'Ready to Link');
    }
    else if (current.state === 'disconnected') {
      stopCountdown();
      showSection(disconnectedSection);
      setStatus('offline', 'Disconnected');
    }
  } catch (err) {
    setStatus('offline', 'Server Offline');
  }
}

// ─── Logout Handlers ──────────────────────────────────────
function openLogoutModal() {
  logoutModal.classList.remove('hidden');
}

function closeLogoutModal() {
  logoutModal.classList.add('hidden');
}

if (logoutBtn) logoutBtn.addEventListener('click', openLogoutModal);
if (headerLogoutBtn) headerLogoutBtn.addEventListener('click', openLogoutModal);
if (cancelLogoutBtn) cancelLogoutBtn.addEventListener('click', closeLogoutModal);

logoutModal.addEventListener('click', (e) => {
  if (e.target === logoutModal) closeLogoutModal();
});

confirmLogoutBtn.addEventListener('click', async () => {
  isLoggingOut = true;
  confirmLogoutBtn.disabled = true;
  confirmLogoutBtn.innerHTML = `<span>Unlinking...</span>`;

  try {
    setStatus('loading', 'Logging out...');
    await fetch(`/api/sessions/${currentSessionId}/logout`, { method: 'POST' });
    closeLogoutModal();

    rawPairingCode = '';
    currentQrDataUrl = null;
    phoneInput.value = '';
    showSection(phoneSection);
    setStatus('loading', 'Ready');

    setTimeout(() => {
      isLoggingOut = false;
      confirmLogoutBtn.disabled = false;
      confirmLogoutBtn.innerHTML = `<span>Yes, Log Out</span>`;
      checkStatus();
    }, 1200);
  } catch (err) {
    alert('Failed to log out: ' + err.message);
    isLoggingOut = false;
    confirmLogoutBtn.disabled = false;
    confirmLogoutBtn.innerHTML = `<span>Yes, Log Out</span>`;
    closeLogoutModal();
  }
});

// Start authentication verification and interval polling
initAuth();
setInterval(() => {
  if (isAuthenticated) checkStatus();
}, 2000);

// ─── Interactive Web Terminal / Live Logs Portal ────────────
const terminalBody = document.getElementById('terminalBody');
const terminalForm = document.getElementById('terminalForm');
const terminalInput = document.getElementById('terminalInput');
const terminalTabCmd = document.getElementById('terminalTabCmd');
const terminalTabLogs = document.getElementById('terminalTabLogs');
const terminalClearBtn = document.getElementById('terminalClearBtn');
const terminalToggleCollapseBtn = document.getElementById('terminalToggleCollapseBtn');
const terminalCard = document.querySelector('.terminal-card');

if (terminalToggleCollapseBtn && terminalCard) {
  terminalToggleCollapseBtn.addEventListener('click', () => {
    terminalCard.classList.toggle('collapsed');
  });
}

let activeTerminalTab = 'cmd'; // 'cmd' | 'logs'
let commandHistory = [];
let historyIndex = -1;
let lastLogCount = 0;

function appendTerminalLine(text, className = '') {
  if (!terminalBody) return;
  const line = document.createElement('div');
  line.className = `term-line ${className}`;
  line.textContent = text;
  terminalBody.appendChild(line);
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

async function clearTerminal() {
  if (!terminalBody) return;
  terminalBody.innerHTML = '';
  lastLogCount = 0;

  if (activeTerminalTab === 'cmd') {
    appendTerminalLine('Xortlogix Bot Terminal [Web Console v1.0]', 'term-system');
    appendTerminalLine('Type "help" for commands, "status" for stats, or click Live Logs.', 'term-dim');
    appendTerminalLine('────────────────────────────────────────────────────────────────', 'term-dim');
  } else if (activeTerminalTab === 'logs') {
    terminalBody.innerHTML = '<div class="term-line term-dim">Logs cleared. Waiting for new events...</div>';
    try {
      await fetch('/api/terminal/logs/clear', { method: 'POST' });
    } catch (_) {}
  }
}

if (terminalClearBtn) {
  terminalClearBtn.addEventListener('click', clearTerminal);
}

if (terminalTabCmd && terminalTabLogs && terminalForm) {
  terminalTabCmd.addEventListener('click', () => {
    activeTerminalTab = 'cmd';
    terminalTabCmd.classList.add('active');
    terminalTabLogs.classList.remove('active');
    terminalForm.style.display = 'flex';
    clearTerminal();
  });

  terminalTabLogs.addEventListener('click', () => {
    activeTerminalTab = 'logs';
    terminalTabLogs.classList.add('active');
    terminalTabCmd.classList.remove('active');
    terminalForm.style.display = 'none';
    if (terminalBody) {
      terminalBody.innerHTML = '<div class="term-line term-dim">Streaming live container logs...</div>';
    }
    fetchLiveLogs(true);
  });
}

// Arrow Up / Down History Navigation
if (terminalInput) {
  terminalInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0 && historyIndex < commandHistory.length - 1) {
        historyIndex++;
        terminalInput.value = commandHistory[commandHistory.length - 1 - historyIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        terminalInput.value = commandHistory[commandHistory.length - 1 - historyIndex];
      } else if (historyIndex === 0) {
        historyIndex = -1;
        terminalInput.value = '';
      }
    }
  });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPaginationControl({
  containerId,
  totalItems,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange
}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (totalItems <= 0) {
    container.innerHTML = `
      <div class="pagination-left">
        <span class="pagination-info">Showing <span class="pagination-badge">0</span> of <span class="pagination-badge">0</span> entries</span>
        <div class="pagination-size-wrapper">
          <span class="pagination-size-label">Per page:</span>
          <select id="${containerId}-pagesize" class="pagination-size-select" aria-label="Entries per page">
            <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
            <option value="25" ${pageSize === 25 ? 'selected' : ''}>25</option>
            <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
            <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
          </select>
        </div>
      </div>
      <div class="pagination-nav">
        <button type="button" class="pagination-btn pagination-prev" disabled title="Previous page">‹ Prev</button>
        <button type="button" class="pagination-btn pagination-num active" disabled>1</button>
        <button type="button" class="pagination-btn pagination-next" disabled title="Next page">Next ›</button>
      </div>
    `;
    const sizeSelect = container.querySelector(`#${containerId}-pagesize`);
    if (sizeSelect) {
      sizeSelect.addEventListener('change', (e) => {
        const newSize = parseInt(e.target.value, 10);
        if (!isNaN(newSize) && typeof onPageSizeChange === 'function') {
          onPageSizeChange(newSize);
        }
      });
    }
    return;
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const startItem = (safePage - 1) * pageSize + 1;
  const endItem = Math.min(safePage * pageSize, totalItems);

  // Generate page numbers with smart ellipsis
  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (safePage > 3) pages.push('...');

    const start = Math.max(2, safePage - 1);
    const end = Math.min(totalPages - 1, safePage + 1);
    for (let i = start; i <= end; i++) {
      if (!pages.includes(i)) pages.push(i);
    }

    if (safePage < totalPages - 2) pages.push('...');
    if (!pages.includes(totalPages)) pages.push(totalPages);
  }

  let navHtml = `
    <button type="button" class="pagination-btn pagination-prev" ${safePage <= 1 ? 'disabled' : ''} data-page="${safePage - 1}" title="Previous page">‹ Prev</button>
  `;

  pages.forEach(p => {
    if (p === '...') {
      navHtml += `<span class="pagination-ellipsis">…</span>`;
    } else {
      navHtml += `<button type="button" class="pagination-btn pagination-num ${p === safePage ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }
  });

  navHtml += `
    <button type="button" class="pagination-btn pagination-next" ${safePage >= totalPages ? 'disabled' : ''} data-page="${safePage + 1}" title="Next page">Next ›</button>
  `;

  container.innerHTML = `
    <div class="pagination-left">
      <span class="pagination-info">
        Showing <span class="pagination-badge">${startItem}–${endItem}</span> of <span class="pagination-badge">${totalItems}</span> entries
      </span>
      <div class="pagination-size-wrapper">
        <span class="pagination-size-label">Per page:</span>
        <select id="${containerId}-pagesize" class="pagination-size-select" aria-label="Entries per page">
          <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
          <option value="25" ${pageSize === 25 ? 'selected' : ''}>25</option>
          <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
          <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
        </select>
      </div>
    </div>
    <div class="pagination-nav">
      ${navHtml}
    </div>
  `;

  // Attach button click handlers
  container.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const p = parseInt(btn.getAttribute('data-page'), 10);
      if (!isNaN(p) && p >= 1 && p <= totalPages && p !== safePage) {
        if (typeof onPageChange === 'function') onPageChange(p);
      }
    });
  });

  // Attach page size change handler
  const sizeSelect = container.querySelector(`#${containerId}-pagesize`);
  if (sizeSelect) {
    sizeSelect.addEventListener('change', (e) => {
      const newSize = parseInt(e.target.value, 10);
      if (!isNaN(newSize) && typeof onPageSizeChange === 'function') {
        onPageSizeChange(newSize);
      }
    });
  }
}
window.renderPaginationControl = renderPaginationControl;


window.insertTerminalCmd = function(cmd) {
  if (terminalInput) {
    terminalInput.value = cmd;
    terminalInput.focus();
    if (terminalCard) {
      terminalCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
};

// Execute Command Form Submit
if (terminalForm && terminalInput) {
  terminalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cmd = terminalInput.value.trim();
    if (!cmd) return;

    // Save to history
    commandHistory.push(cmd);
    historyIndex = -1;
    terminalInput.value = '';

    // Render user command
    const userLine = document.createElement('div');
    userLine.className = 'term-line term-user-cmd';
    userLine.innerHTML = `<span class="term-green">admin@system:~$</span> <strong>${escapeHtml(cmd)}</strong>`;
    if (terminalBody) {
      terminalBody.appendChild(userLine);
      terminalBody.scrollTop = terminalBody.scrollHeight;
    }

    try {
      const res = await fetch('/api/terminal/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      });
      const data = await res.json();

      if (data.clear) {
        clearTerminal();
        return;
      }

      if (data.output && terminalBody) {
        const outputLine = document.createElement('div');
        outputLine.className = 'term-line term-output';
        outputLine.textContent = data.output;
        terminalBody.appendChild(outputLine);
        terminalBody.scrollTop = terminalBody.scrollHeight;
      }
    } catch (err) {
      appendTerminalLine(`Error: ${err.message}`, 'term-error');
    }
  });
}

// Live Logs Polling (SUPER_ADMIN ONLY)
async function fetchLiveLogs(forceRerender = false) {
  if (!isAuthenticated || currentUserRole !== 'SUPER_ADMIN' || activeTerminalTab !== 'logs' || !terminalBody) return;

  try {
    const res = await fetch('/api/terminal/logs', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const logs = data.logs || [];

    if (forceRerender || logs.length !== lastLogCount) {
      lastLogCount = logs.length;
      terminalBody.innerHTML = '';
      if (logs.length === 0) {
        terminalBody.innerHTML = '<div class="term-line term-dim">No logs recorded yet.</div>';
        return;
      }
      logs.slice(-100).forEach(log => {
        const line = document.createElement('div');
        const isQr = log.type === 'qr' || (/[\u2580-\u2588]/.test(log.text) && log.text.includes('\n'));
        if (isQr) {
          line.className = 'term-line term-qr-wrapper';
          line.innerHTML = `
            <div class="term-qr-header"><span class="term-dim">[${log.time}]</span> <span class="term-cyan">📱 WhatsApp QR Code (Scan with phone):</span></div>
            <div class="term-qr-container">
              <pre class="term-qr-art">${escapeHtml(log.text)}</pre>
            </div>
          `;
        } else {
          const colorClass = log.type === 'error' ? 'term-error' :
                             log.type === 'warn' ? 'term-warn' :
                             log.type === 'command' ? 'term-cyan' : 'term-output';
          line.className = `term-line ${colorClass}`;
          line.innerHTML = `<span class="term-dim">[${log.time}]</span> ${escapeHtml(log.text)}`;
        }
        terminalBody.appendChild(line);
      });
      terminalBody.scrollTop = terminalBody.scrollHeight;
    }
  } catch (_) {}
}

setInterval(() => {
  if (isAuthenticated && activeTerminalTab === 'logs') fetchLiveLogs(false);
}, 2500);


// ══════════════════════════════════════════════════════════════════════════
// PHASE 2: RESTAURANT MANAGEMENT DASHBOARD CONTROLLERS
// ══════════════════════════════════════════════════════════════════════════

let currentActiveView = 'dashboard';
let cachedCategoriesList = [];

// ─── Toast Notifications ───────────────────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.getElementById('toastNotification');
  const icon = document.getElementById('toastIcon');
  const msg = document.getElementById('toastMessage');
  if (!toast || !msg) return;

  msg.textContent = message;
  toast.className = `toast-container toast-${type}`;
  if (icon) {
    icon.textContent = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  }
  toast.classList.remove('hidden');

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}
window.showToast = showToast;

// ─── View Switcher ─────────────────────────────────────────────────────
function switchView(viewName) {
  currentActiveView = viewName;
  const views = {
    dashboard:  { el: document.getElementById('viewDashboard'),  title: 'Dashboard Overview', sub: 'Real-time restaurant metrics & operations' },
    orders:     { el: document.getElementById('viewOrders'),     title: 'Live Orders Management', sub: 'Real-time orders feed, customer details, and status updates' },
    menu:       { el: document.getElementById('viewMenu'),       title: 'Menu Management',    sub: 'Manage items, prices, variants and availability' },
    categories: { el: document.getElementById('viewCategories'), title: 'Categories',         sub: 'Organize menu sections and ordering' },
    deals:      { el: document.getElementById('viewDeals'),      title: 'Meal Deals',         sub: 'Meal bundles and special value combos' },
    delivery:   { el: document.getElementById('viewDelivery'),   title: 'Delivery Areas',     sub: 'Delivery zones, fees and minimum order amounts' },
    customers:      { el: document.getElementById('viewCustomers'),      title: 'Customers Directory', sub: 'Verified WhatsApp customers and lifetime order history' },
    customerDetail: { el: document.getElementById('viewCustomerDetail'), title: 'Customer Profile',   sub: 'Complete customer order history, metrics & data management' },
    chats:      { el: document.getElementById('viewChats'),      title: 'Customer Chats',     sub: 'Live WhatsApp customer conversation audit log and bot responses' },
    faq:        { el: document.getElementById('viewFaq'),        title: 'FAQ / Knowledge Base', sub: 'Authoritative dynamic knowledge base & customer answering policies' },
    whatsapp:   { el: document.getElementById('viewWhatsapp'),   title: 'WhatsApp Bot',       sub: 'Multi-session connection and terminal' },
    prompt:     { el: document.getElementById('viewPrompt'),     title: 'AI Bot Prompt & Instructions', sub: 'Customize WhatsApp bot instructions, personality and rules in real-time' },
    settings:   { el: document.getElementById('viewSettings'),   title: 'Restaurant Settings',sub: 'Configure operating hours, delivery fees and payments' },
  };

  if (viewName === 'chats' && currentUserRole !== 'SUPER_ADMIN') {
    return switchView('dashboard');
  }

  Object.keys(views).forEach(k => {
    if (views[k].el) views[k].el.classList.add('hidden');
  });

  const target = views[viewName] || views.dashboard;
  if (target.el) target.el.classList.remove('hidden');

  if (viewName === 'chats') {
    if (typeof window.loadConversations === 'function') {
      window.loadConversations();
    }
    if (window._chatsInterval) clearInterval(window._chatsInterval);
    window._chatsInterval = setInterval(() => {
      if (currentActiveView === 'chats') {
        window.loadConversations();
        if (activeChatCustomer && typeof window.fetchAndRenderChatMessages === 'function') {
          window.fetchAndRenderChatMessages(activeChatCustomer.chatId);
        }
      } else {
        clearInterval(window._chatsInterval);
        window._chatsInterval = null;
      }
    }, 4000);
  } else {
    if (window._chatsInterval) {
      clearInterval(window._chatsInterval);
      window._chatsInterval = null;
    }
  }

  if (viewName === 'orders') {
    if (window._ordersInterval) clearInterval(window._ordersInterval);
    window._ordersInterval = setInterval(() => {
      if (currentActiveView === 'orders') {
        // Silent background fallback to ensure fresh data
        loadOrders(false);
      } else {
        clearInterval(window._ordersInterval);
        window._ordersInterval = null;
      }
    }, 15000);
    if (typeof initRealtimeOrdersFeed === 'function') {
      if (!realtimeEventSource || realtimeEventSource.readyState === 2) {
        initRealtimeOrdersFeed();
      }
    }
  } else {
    if (window._ordersInterval) {
      clearInterval(window._ordersInterval);
      window._ordersInterval = null;
    }
  }

  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');
  if (pageTitle) pageTitle.textContent = target.title;
  if (pageSubtitle) pageSubtitle.textContent = target.sub;

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    const dataView = btn.getAttribute('data-view');
    if (dataView === viewName || (viewName === 'customerDetail' && dataView === 'customers')) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Close mobile sidebar if open
  const sidebar = document.getElementById('appSidebar');
  if (sidebar) sidebar.classList.remove('open');

  // Load view-specific data
  if (viewName === 'dashboard') loadDashboardStats();
  if (viewName === 'orders') loadOrders();
  if (viewName === 'customers') loadCustomers();
  if (viewName === 'faq') {
    loadFaqCategoriesForDropdown();
    loadFaqs();
  }
  if (viewName === 'menu') {
    loadCategoriesForDropdown();
    loadMenuItems();
  }
  if (viewName === 'categories') loadCategories();
  if (viewName === 'deals') {
    loadDeals();
    loadMenuItemsForDeals();
  }
  if (viewName === 'delivery') loadDeliveryAreas();
  if (viewName === 'settings') loadSettings();
  if (viewName === 'prompt') loadBotPrompt();
}
window.switchView = switchView;

// Attach click listeners to sidebar nav items
document.querySelectorAll('.sidebar-nav .nav-item:not(.nav-item-disabled)').forEach(item => {
  item.addEventListener('click', () => {
    const view = item.getAttribute('data-view');
    if (view) switchView(view);
  });
});

// Mobile Sidebar Toggle
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
const appSidebar = document.getElementById('appSidebar');

if (sidebarToggleBtn && appSidebar) {
  sidebarToggleBtn.addEventListener('click', () => {
    appSidebar.classList.toggle('open');
  });
}
if (sidebarCloseBtn && appSidebar) {
  sidebarCloseBtn.addEventListener('click', () => {
    appSidebar.classList.remove('open');
  });
}

// Sidebar Logout & User Profile Card
const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
if (sidebarLogoutBtn) {
  sidebarLogoutBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.handleDashboardLogout();
  });
}

const sidebarUserCard = document.getElementById('sidebarUserCard');
if (sidebarUserCard) {
  sidebarUserCard.addEventListener('click', (e) => {
    if (!e.target.closest('#sidebarLogoutBtn')) {
      if (typeof switchView === 'function') {
        switchView('settings');
      }
    }
  });
}

// ─── Dashboard Stats Controller ────────────────────────────────────────
async function loadDashboardStats() {
  try {
    const res = await fetch('/api/admin/dashboard');
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && data.data?.stats) {
      const stats = data.data.stats;
      const elCat = document.getElementById('metricCategoriesCount');
      const elItems = document.getElementById('metricItemsCount');
      const elAvail = document.getElementById('metricAvailableCount');
      const elUnavail = document.getElementById('metricUnavailableCount');
      const elDeals = document.getElementById('metricDealsCount');
      const elDelivery = document.getElementById('metricDeliveryCount');
      const elTodayOrders = document.getElementById('metricTodayOrders');
      const elTodayRevenue = document.getElementById('metricTodayRevenue');

      if (elCat) elCat.textContent = stats.categories_count ?? 0;
      if (elItems) elItems.textContent = stats.items_count ?? 0;
      if (elAvail) elAvail.textContent = stats.available_items_count ?? 0;
      if (elUnavail) elUnavail.textContent = stats.unavailable_items_count ?? 0;
      if (elDeals) elDeals.textContent = stats.deals_count ?? 0;
      if (elDelivery) elDelivery.textContent = stats.delivery_areas_count ?? 0;
      if (elTodayOrders) elTodayOrders.textContent = stats.today_orders_count ?? 0;
      if (elTodayRevenue) elTodayRevenue.textContent = `Rs. ${stats.today_revenue ?? 0}`;

      const elTotalOrdersSub = document.getElementById('metricTotalOrdersSub');
      if (elTotalOrdersSub && stats.total_orders_count !== undefined) {
        elTotalOrdersSub.textContent = `All-time orders: ${stats.total_orders_count}`;
      }
      const elTotalRevenueSub = document.getElementById('metricTotalRevenueSub');
      if (elTotalRevenueSub && stats.total_revenue !== undefined) {
        elTotalRevenueSub.textContent = `All-time revenue: Rs. ${Number(stats.total_revenue).toLocaleString()}`;
      }

      // Update nav badge count for orders
      if (stats.total_orders_count !== undefined) {
        const navBadge = document.getElementById('navOrdersBadge');
        if (navBadge) {
          navBadge.textContent = stats.total_orders_count;
          navBadge.classList.remove('hidden');
        }
      }

      // Render recent live orders table on dashboard (flicker-free signature check)
      const dashOrdersBody = document.getElementById('dashboardRecentOrdersBody');
      const recentOrders = data.data?.recent_orders || [];
      if (dashOrdersBody) {
        const recentSig = recentOrders.map(o => `${o.orderNumber}:${o.orderStatus}:${o.total}`).join('|');
        if (recentSig !== window._lastDashboardRecentSig || dashOrdersBody.children.length === 0) {
          window._lastDashboardRecentSig = recentSig;
          if (recentOrders.length === 0) {
            dashOrdersBody.innerHTML = '<tr><td colspan="8" class="table-empty">No orders recorded yet.</td></tr>';
          } else {
            dashOrdersBody.innerHTML = '';
            recentOrders.forEach(ord => {
              const tr = document.createElement('tr');
              const timeStr = new Date(ord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const dateStr = new Date(ord.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
              tr.innerHTML = `
                <td><strong style="color: var(--accent); font-family: var(--f-mono);">${escapeHtml(ord.orderNumber)}</strong></td>
                <td><strong>${escapeHtml(ord.customerName)}</strong></td>
                <td><span class="subtext">${escapeHtml(ord.phone)}</span></td>
                <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(ord.itemsSummary || '')}">
                  <span>${ord.itemCount} items (${escapeHtml(ord.itemsSummary || '')})</span>
                </td>
                <td><strong>Rs. ${Number(ord.total).toLocaleString()}</strong></td>
                <td><span class="badge-order-status ${ord.orderStatus}">${ord.orderStatus}</span></td>
                <td><span class="subtext">${dateStr} ${timeStr}</span></td>
                <td style="text-align: right;">
                  <button class="btn btn-secondary btn-xs" onclick="window.openOrderDetailModal('${ord.orderNumber}')">View</button>
                </td>
              `;
              dashOrdersBody.appendChild(tr);
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to load dashboard stats:', err);
  }
}

// ─── Categories Controller ─────────────────────────────────────────────
let categoriesPageState = { page: 1, pageSize: 50 };

function renderCategoriesTable() {
  const tbody = document.getElementById('categoriesTableBody');
  if (!tbody) return;

  const categories = cachedCategoriesList || [];
  if (categories.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No categories found. Click "+ Add Category" to create one.</td></tr>';
    renderPaginationControl({
      containerId: 'categoriesPagination',
      totalItems: 0,
      currentPage: 1,
      pageSize: categoriesPageState.pageSize,
      onPageSizeChange: (s) => {
        categoriesPageState.pageSize = s;
        categoriesPageState.page = 1;
        renderCategoriesTable();
      }
    });
    return;
  }

  const totalPages = Math.ceil(categories.length / categoriesPageState.pageSize);
  if (categoriesPageState.page > totalPages) categoriesPageState.page = totalPages;
  const startIndex = (categoriesPageState.page - 1) * categoriesPageState.pageSize;
  const pageItems = categories.slice(startIndex, startIndex + categoriesPageState.pageSize);

  tbody.innerHTML = '';
  pageItems.forEach(cat => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="price-tag">${cat.sort_order}</span></td>
      <td><strong>${escapeHtml(cat.name)}</strong></td>
      <td><code>${escapeHtml(cat.slug)}</code></td>
      <td><span class="subtext">${escapeHtml(cat.description || '—')}</span></td>
      <td><span class="badge-tag badge-category">${cat.items_count} item(s)</span></td>
      <td>
        <label class="switch">
          <input type="checkbox" ${cat.is_active ? 'checked' : ''} onchange="window.toggleCategoryStatus('${cat.id}', this.checked)">
          <span class="slider"></span>
        </label>
      </td>
      <td style="text-align: right;">
        <div class="table-actions">
          <button class="btn-table-icon" title="Edit" onclick="window.openEditCategory('${cat.id}')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-table-icon danger" title="Delete" onclick="window.deleteCategory('${cat.id}', '${escapeHtml(cat.name)}')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPaginationControl({
    containerId: 'categoriesPagination',
    totalItems: categories.length,
    currentPage: categoriesPageState.page,
    pageSize: categoriesPageState.pageSize,
    onPageChange: (p) => {
      categoriesPageState.page = p;
      renderCategoriesTable();
    },
    onPageSizeChange: (s) => {
      categoriesPageState.pageSize = s;
      categoriesPageState.page = 1;
      renderCategoriesTable();
    }
  });
}
window.renderCategoriesTable = renderCategoriesTable;

async function loadCategories() {
  const tbody = document.getElementById('categoriesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Loading categories...</td></tr>';

  try {
    const res = await fetch('/api/admin/categories');
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: #ff6b6b;">Error: ${data.error?.message}</td></tr>`;
      return;
    }

    const categories = data.data || [];
    cachedCategoriesList = categories;
    renderCategoriesTable();
    try {
      await LocalDB.clear('categories');
      if (categories.length > 0) {
        await LocalDB.putBatch('categories', categories, true);
      }
    } catch (_) {}
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: #ff6b6b;">Failed to load: ${err.message}</td></tr>`;
  }
}

// Toggle Category Active Status
window.toggleCategoryStatus = async function(id, is_active) {
  try {
    const res = await fetch(`/api/admin/categories/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Category status updated`, 'success');
    } else {
      showToast(data.error?.message || 'Failed to update category', 'error');
      loadCategories();
    }
  } catch (err) {
    showToast(err.message, 'error');
    loadCategories();
  }
};

// Open Add Category Modal
const openAddCategoryBtn = document.getElementById('openAddCategoryBtn');
const categoryModal = document.getElementById('categoryModal');
const categoryForm = document.getElementById('categoryForm');
const categoryModalTitle = document.getElementById('categoryModalTitle');
const catEditId = document.getElementById('catEditId');
const catName = document.getElementById('catName');
const catDescription = document.getElementById('catDescription');
const catSortOrder = document.getElementById('catSortOrder');
const catIsActive = document.getElementById('catIsActive');

if (openAddCategoryBtn) {
  openAddCategoryBtn.addEventListener('click', () => {
    if (catEditId) catEditId.value = '';
    if (catName) catName.value = '';
    if (catDescription) catDescription.value = '';
    if (catSortOrder) catSortOrder.value = '0';
    if (catIsActive) catIsActive.checked = true;
    if (categoryModalTitle) categoryModalTitle.textContent = 'Add Category';
    if (categoryModal) categoryModal.classList.remove('hidden');
  });
}

window.closeCategoryModal = function() {
  if (categoryModal) categoryModal.classList.add('hidden');
};

const catCancelBtn = document.getElementById('catCancelBtn');
if (catCancelBtn) {
  catCancelBtn.addEventListener('click', window.closeCategoryModal);
}

// Open Edit Category Modal
window.openEditCategory = async function(id) {
  try {
    const res = await fetch(`/api/admin/categories/${id}`);
    const data = await res.json();
    if (data.success && data.data) {
      const c = data.data;
      if (catEditId) catEditId.value = c.id;
      if (catName) catName.value = c.name;
      if (catDescription) catDescription.value = c.description || '';
      if (catSortOrder) catSortOrder.value = c.sort_order;
      if (catIsActive) catIsActive.checked = c.is_active;
      if (categoryModalTitle) categoryModalTitle.textContent = 'Edit Category';
      if (categoryModal) categoryModal.classList.remove('hidden');
    }
  } catch (err) {
    showToast('Failed to fetch category details: ' + err.message, 'error');
  }
};

// Save Category (Create or Update)
if (categoryForm) {
  categoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = catEditId ? catEditId.value : '';
    const payload = {
      name: catName.value.trim(),
      description: catDescription.value.trim() || null,
      sort_order: parseInt(catSortOrder.value, 10) || 0,
      is_active: catIsActive.checked,
    };

    const isEdit = Boolean(id);
    const url = isEdit ? `/api/admin/categories/${id}` : '/api/admin/categories';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        showToast(isEdit ? 'Category updated' : 'Category created', 'success');
        window.closeCategoryModal();
        loadCategories();
      } else {
        showToast(data.error?.message || 'Failed to save category', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// Delete Category
window.deleteCategory = async function(id, name) {
  if (!confirm(`Are you sure you want to delete category "${name}"?`)) return;

  try {
    const res = await fetch(`/api/admin/categories/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Category "${name}" deleted`, 'success');
      if (Array.isArray(cachedCategoriesList)) {
        cachedCategoriesList = cachedCategoriesList.filter(c => c.id !== id);
        renderCategoriesTable();
      }
      try {
        await LocalDB.delete('categories', id);
      } catch (_) {}
      loadCategories();
    } else {
      showToast(data.error?.message || 'Could not delete category', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ─── Menu Items Controller ─────────────────────────────────────────────
async function loadCategoriesForDropdown() {
  const select = document.getElementById('menuCategoryFilter');
  const modalSelect = document.getElementById('itemCategorySelect');
  if (!select) return;

  try {
    const res = await fetch('/api/admin/categories');
    const data = await res.json();
    if (data.success) {
      cachedCategoriesList = data.data || [];
      select.innerHTML = '<option value="">All Categories</option>';
      if (modalSelect) modalSelect.innerHTML = '<option value="">Select Category...</option>';

      cachedCategoriesList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        select.appendChild(opt);

        if (modalSelect) {
          const mOpt = document.createElement('option');
          mOpt.value = c.id;
          mOpt.textContent = c.name;
          modalSelect.appendChild(mOpt);
        }
      });
    }
  } catch (_) {}
}

let cachedMenuItemsList = [];
let menuPageState = { page: 1, pageSize: 50 };

function renderMenuItemsTable() {
  const tbody = document.getElementById('menuItemsTableBody');
  if (!tbody) return;

  const items = cachedMenuItemsList || [];
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No menu items match your search.</td></tr>';
    renderPaginationControl({
      containerId: 'menuPagination',
      totalItems: 0,
      currentPage: 1,
      pageSize: menuPageState.pageSize,
      onPageSizeChange: (s) => {
        menuPageState.pageSize = s;
        menuPageState.page = 1;
        renderMenuItemsTable();
      }
    });
    return;
  }

  const totalPages = Math.ceil(items.length / menuPageState.pageSize);
  if (menuPageState.page > totalPages) menuPageState.page = totalPages;
  const startIndex = (menuPageState.page - 1) * menuPageState.pageSize;
  const pageItems = items.slice(startIndex, startIndex + menuPageState.pageSize);

  tbody.innerHTML = '';
  pageItems.forEach(item => {
    const tr = document.createElement('tr');
    const thumbHtml = item.image_url
      ? `<img src="${escapeHtml(item.image_url)}" class="item-thumb" alt="${escapeHtml(item.name)}" />`
      : `<div class="item-thumb-placeholder">🍔</div>`;

    const spicyHtml = item.spicy_level && item.spicy_level !== 'NONE'
      ? `<span class="badge-spicy ${item.spicy_level}">${item.spicy_level}</span>`
      : '';

    tr.innerHTML = `
      <td>${thumbHtml}</td>
      <td>
        <strong>${escapeHtml(item.name)}</strong> ${spicyHtml}
        <div class="subtext">${escapeHtml(item.description || '—')}</div>
      </td>
      <td><span class="badge-tag badge-category">${escapeHtml(item.category?.name || 'Uncategorized')}</span></td>
      <td><span class="price-tag">Rs.${item.base_price}</span></td>
      <td>
        <span class="badge-variant-count" title="Click to manage variants" onclick="window.openVariantsModal('${item.id}', '${escapeHtml(item.name)}')">
          ${item.variants_count} variant(s)
        </span>
      </td>
      <td>
        <label class="switch">
          <input type="checkbox" ${item.is_available ? 'checked' : ''} onchange="window.toggleMenuItemAvailability('${item.id}', this.checked)">
          <span class="slider"></span>
        </label>
      </td>
      <td>
        <span class="badge-tag ${item.is_active ? 'badge-active' : 'badge-inactive'}">
          ${item.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td style="text-align: right;">
        <div class="table-actions">
          <button class="btn-table-icon" title="Variants" onclick="window.openVariantsModal('${item.id}', '${escapeHtml(item.name)}')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
          </button>
          <button class="btn-table-icon" title="Edit" onclick="window.openEditMenuItem('${item.id}')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-table-icon danger" title="Delete" onclick="window.deleteMenuItem('${item.id}', '${escapeHtml(item.name)}')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPaginationControl({
    containerId: 'menuPagination',
    totalItems: items.length,
    currentPage: menuPageState.page,
    pageSize: menuPageState.pageSize,
    onPageChange: (p) => {
      menuPageState.page = p;
      renderMenuItemsTable();
    },
    onPageSizeChange: (s) => {
      menuPageState.pageSize = s;
      menuPageState.page = 1;
      renderMenuItemsTable();
    }
  });
}
window.renderMenuItemsTable = renderMenuItemsTable;

async function loadMenuItems(resetPage = false) {
  if (resetPage === true) menuPageState.page = 1;
  const tbody = document.getElementById('menuItemsTableBody');
  if (!tbody) return;

  const categoryFilter = document.getElementById('menuCategoryFilter')?.value || '';
  const availFilter = document.getElementById('menuAvailFilter')?.value || '';
  const search = document.getElementById('menuSearchInput')?.value.trim() || '';

  // Only render from memory if we already have items and no filters are active
  if (!resetPage && cachedMenuItemsList && cachedMenuItemsList.length > 0 && !categoryFilter && !availFilter && !search) {
    renderMenuItemsTable();
  } else if (!cachedMenuItemsList || cachedMenuItemsList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Loading menu items...</td></tr>';
  }

  const query = new URLSearchParams();
  if (categoryFilter) query.set('category_id', categoryFilter);
  if (availFilter) query.set('available', availFilter);
  if (search) query.set('search', search);

  try {
    const res = await fetch(`/api/admin/menu?${query.toString()}`);
    const data = await res.json();
    if (!data.success) {
      if (!cachedMenuItemsList || cachedMenuItemsList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty" style="color: #ff6b6b;">Error: ${data.error?.message || 'Failed to load menu items'}</td></tr>`;
      }
      return;
    }

    const items = data.data || [];
    cachedMenuItemsList = items;
    renderMenuItemsTable();

    // Cleanly sync fresh server data to LocalDB (purge deleted items)
    if (!categoryFilter && !availFilter && !search) {
      try {
        await LocalDB.clear('menu');
        if (items.length > 0) {
          await LocalDB.putBatch('menu', items, true);
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn('Menu fetch failed; running in offline cache mode:', err);
    if (!cachedMenuItemsList || cachedMenuItemsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="table-empty" style="color: #ff6b6b;">Failed to load: ${err.message}</td></tr>`;
    }
  }
}

// Filter listeners
const menuSearchInput = document.getElementById('menuSearchInput');
const menuCategoryFilter = document.getElementById('menuCategoryFilter');
const menuAvailFilter = document.getElementById('menuAvailFilter');

if (menuSearchInput) {
  let debounceTimer;
  menuSearchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadMenuItems(true), 300);
  });
}
if (menuCategoryFilter) menuCategoryFilter.addEventListener('change', () => loadMenuItems(true));
if (menuAvailFilter) menuAvailFilter.addEventListener('change', () => loadMenuItems(true));

// Toggle Menu Item Availability
window.toggleMenuItemAvailability = async function(id, is_available) {
  try {
    const res = await fetch(`/api/admin/menu/${id}/availability`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_available }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Item availability updated`, 'success');
    } else {
      showToast(data.error?.message || 'Failed to update item availability', 'error');
      loadMenuItems();
    }
  } catch (err) {
    showToast(err.message, 'error');
    loadMenuItems();
  }
};

// Menu Item Modal Handling
const menuItemModal = document.getElementById('menuItemModal');
const menuItemForm = document.getElementById('menuItemForm');
const openAddMenuItemBtn = document.getElementById('openAddMenuItemBtn');
const menuItemModalTitle = document.getElementById('menuItemModalTitle');
const itemEditId = document.getElementById('itemEditId');
const itemName = document.getElementById('itemName');
const itemCategorySelect = document.getElementById('itemCategorySelect');
const itemDescription = document.getElementById('itemDescription');
const itemPrice = document.getElementById('itemPrice');
const itemSpicyLevel = document.getElementById('itemSpicyLevel');
const itemIsAvailable = document.getElementById('itemIsAvailable');
const itemImageFile = document.getElementById('itemImageFile');
const itemImageUrl = document.getElementById('itemImageUrl');
const itemImagePreview = document.getElementById('itemImagePreview');

if (openAddMenuItemBtn) {
  openAddMenuItemBtn.addEventListener('click', () => {
    if (itemEditId) itemEditId.value = '';
    if (itemName) itemName.value = '';
    if (itemCategorySelect) itemCategorySelect.value = '';
    if (itemDescription) itemDescription.value = '';
    if (itemPrice) itemPrice.value = '';
    if (itemSpicyLevel) itemSpicyLevel.value = 'NONE';
    if (itemIsAvailable) itemIsAvailable.checked = true;
    if (itemImageUrl) itemImageUrl.value = '';
    if (itemImagePreview) {
      itemImagePreview.style.backgroundImage = '';
      itemImagePreview.classList.add('hidden');
    }
    if (menuItemModalTitle) menuItemModalTitle.textContent = 'Add Menu Item';
    if (menuItemModal) menuItemModal.classList.remove('hidden');
  });
}

window.closeMenuItemModal = function() {
  if (menuItemModal) menuItemModal.classList.add('hidden');
};

const itemCancelBtn = document.getElementById('itemCancelBtn');
if (itemCancelBtn) itemCancelBtn.addEventListener('click', window.closeMenuItemModal);

window.openEditMenuItem = async function(id) {
  try {
    const res = await fetch(`/api/admin/menu/${id}`);
    const data = await res.json();
    if (data.success && data.data) {
      const it = data.data;
      if (itemEditId) itemEditId.value = it.id;
      if (itemName) itemName.value = it.name;
      if (itemCategorySelect) itemCategorySelect.value = it.category_id;
      if (itemDescription) itemDescription.value = it.description || '';
      if (itemPrice) itemPrice.value = it.base_price;
      if (itemSpicyLevel) itemSpicyLevel.value = it.spicy_level || 'NONE';
      if (itemIsAvailable) itemIsAvailable.checked = it.is_available;
      if (itemImageUrl) itemImageUrl.value = it.image_url || '';
      if (itemImagePreview) {
        if (it.image_url) {
          itemImagePreview.style.backgroundImage = `url('${it.image_url}')`;
          itemImagePreview.classList.remove('hidden');
        } else {
          itemImagePreview.classList.add('hidden');
        }
      }
      if (menuItemModalTitle) menuItemModalTitle.textContent = 'Edit Menu Item';
      if (menuItemModal) menuItemModal.classList.remove('hidden');
    }
  } catch (err) {
    showToast('Failed to fetch item details: ' + err.message, 'error');
  }
};

// Save Menu Item
if (menuItemForm) {
  menuItemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = itemEditId ? itemEditId.value : '';

    // Handle file upload if selected
    let uploadedUrl = itemImageUrl ? itemImageUrl.value : '';
    if (itemImageFile && itemImageFile.files && itemImageFile.files[0]) {
      const formData = new FormData();
      formData.append('image', itemImageFile.files[0]);
      try {
        const uploadRes = await fetch('/api/admin/upload/image', {
          method: 'POST',
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (uploadData.success && uploadData.data?.url) {
          uploadedUrl = uploadData.data.url;
        } else {
          showToast(uploadData.error?.message || 'Image upload failed', 'error');
          return;
        }
      } catch (err) {
        showToast('Image upload failed: ' + err.message, 'error');
        return;
      }
    }

    const payload = {
      name: itemName.value.trim(),
      category_id: itemCategorySelect.value,
      description: itemDescription.value.trim() || null,
      base_price: parseFloat(itemPrice.value) || 0,
      spicy_level: itemSpicyLevel.value,
      is_available: itemIsAvailable.checked,
      image_url: uploadedUrl || null,
    };

    const isEdit = Boolean(id);
    const url = isEdit ? `/api/admin/menu/${id}` : '/api/admin/menu';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        showToast(isEdit ? 'Menu item updated' : 'Menu item created', 'success');
        window.closeMenuItemModal();
        if (typeof loadCategoriesForDropdown === 'function') loadCategoriesForDropdown();
        loadMenuItems(true);
      } else {
        showToast(data.error?.message || 'Failed to save menu item', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// Delete Menu Item
window.deleteMenuItem = async function(id, name) {
  if (!confirm(`Are you sure you want to delete menu item "${name}"?`)) return;

  try {
    const res = await fetch(`/api/admin/menu/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Menu item "${name}" deleted`, 'success');
      // Instantly remove from local memory & UI
      if (Array.isArray(cachedMenuItemsList)) {
        cachedMenuItemsList = cachedMenuItemsList.filter(item => item.id !== id);
        renderMenuItemsTable();
      }
      try {
        await LocalDB.delete('menu', id);
      } catch (_) {}
      loadMenuItems();
    } else {
      showToast(data.error?.message || 'Failed to delete item', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ─── Variants Controller ───────────────────────────────────────────────
const variantsModal = document.getElementById('variantsModal');
const variantsItemName = document.getElementById('variantsItemName');
const varMenuItemId = document.getElementById('varMenuItemId');
const variantsList = document.getElementById('variantsList');
const addVariantForm = document.getElementById('addVariantForm');
const varName = document.getElementById('varName');
const varPrice = document.getElementById('varPrice');
const varSortOrder = document.getElementById('varSortOrder');
const varIsAvailable = document.getElementById('varIsAvailable');

window.openVariantsModal = async function(menuItemId, itemName) {
  if (varMenuItemId) varMenuItemId.value = menuItemId;
  if (variantsItemName) variantsItemName.textContent = itemName;
  if (variantsModal) variantsModal.classList.remove('hidden');
  loadItemVariants(menuItemId);
};

window.closeVariantsModal = function() {
  if (variantsModal) variantsModal.classList.add('hidden');
  loadMenuItems(); // Refresh counts in table
};

async function loadItemVariants(itemId) {
  if (!variantsList) return;
  variantsList.innerHTML = '<tr><td colspan="5" class="table-empty">Loading variants...</td></tr>';

  try {
    const res = await fetch(`/api/admin/variants/menu/${itemId}/variants`);
    const data = await res.json();
    if (!data.success) {
      variantsList.innerHTML = `<tr><td colspan="5" class="table-empty">${data.error?.message}</td></tr>`;
      return;
    }

    const variants = data.data || [];
    if (variants.length === 0) {
      variantsList.innerHTML = '<tr><td colspan="5" class="table-empty">No variants defined. Item uses base price.</td></tr>';
      return;
    }

    variantsList.innerHTML = '';
    variants.forEach(v => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(v.name)}</strong></td>
        <td><span class="price-tag">Rs.${v.price}</span></td>
        <td>${v.sort_order}</td>
        <td>
          <label class="switch">
            <input type="checkbox" ${v.is_available ? 'checked' : ''} onchange="window.toggleVariantAvailability('${v.id}', this.checked)">
            <span class="slider"></span>
          </label>
        </td>
        <td style="text-align: right;">
          <button class="btn-table-icon danger" title="Delete variant" onclick="window.deleteVariant('${v.id}')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </td>
      `;
      variantsList.appendChild(tr);
    });
  } catch (err) {
    variantsList.innerHTML = `<tr><td colspan="5" class="table-empty">${err.message}</td></tr>`;
  }
}

// Add Variant Submit
if (addVariantForm) {
  addVariantForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = varMenuItemId ? varMenuItemId.value : '';
    if (!itemId) return;

    const payload = {
      name: varName.value.trim(),
      price: parseFloat(varPrice.value) || 0,
      sort_order: parseInt(varSortOrder.value, 10) || 0,
      is_available: varIsAvailable.checked,
    };

    try {
      const res = await fetch(`/api/admin/variants/menu/${itemId}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Variant "${payload.name}" added`, 'success');
        if (varName) varName.value = '';
        if (varPrice) varPrice.value = '';
        if (varSortOrder) varSortOrder.value = '0';
        loadItemVariants(itemId);
      } else {
        showToast(data.error?.message || 'Failed to add variant', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

window.toggleVariantAvailability = async function(id, is_available) {
  try {
    const res = await fetch(`/api/admin/variants/${id}/availability`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_available }),
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.error?.message || 'Failed to update variant', 'error');
      const itemId = varMenuItemId ? varMenuItemId.value : '';
      if (itemId) loadItemVariants(itemId);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteVariant = async function(id) {
  if (!confirm('Delete this variant?')) return;
  try {
    const res = await fetch(`/api/admin/variants/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Variant deleted', 'success');
      const itemId = varMenuItemId ? varMenuItemId.value : '';
      if (itemId) loadItemVariants(itemId);
    } else {
      showToast(data.error?.message || 'Failed to delete variant', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ─── Settings Controller ───────────────────────────────────────────────
async function loadSettings() {
  try {
    const res = await fetch('/api/admin/settings');
    const data = await res.json();
    if (data.success && data.data) {
      const s = data.data;
      const setRestName = document.getElementById('setRestName');
      const setRestPhone = document.getElementById('setRestPhone');
      const setRestAddress = document.getElementById('setRestAddress');
      const setOpenTime = document.getElementById('setOpenTime');
      const setCloseTime = document.getElementById('setCloseTime');
      const setCurrency = document.getElementById('setCurrency');
      const setTimezone = document.getElementById('setTimezone');
      const setMinOrder = document.getElementById('setMinOrder');
      const setDefaultDelivery = document.getElementById('setDefaultDelivery');
      const setCodEnabled = document.getElementById('setCodEnabled');
      const setEasypaisaEnabled = document.getElementById('setEasypaisaEnabled');
      const setEasypaisaNumber = document.getElementById('setEasypaisaNumber');
      const setAccountName = document.getElementById('setAccountName');
      const setAdminPhone = document.getElementById('setAdminPhone');

      if (setRestName) setRestName.value = s.name || '';
      if (setRestPhone) setRestPhone.value = s.phone || '';
      if (setRestAddress) setRestAddress.value = s.address || '';
      if (setOpenTime) setOpenTime.value = s.opening_time || '';
      if (setCloseTime) setCloseTime.value = s.closing_time || '';
      if (setCurrency) setCurrency.value = s.currency || 'PKR';
      if (setTimezone) setTimezone.value = s.timezone || 'Asia/Karachi';
      if (setMinOrder) setMinOrder.value = s.min_order !== null ? s.min_order : '';
      if (setDefaultDelivery) setDefaultDelivery.value = s.default_delivery_fee !== null ? s.default_delivery_fee : '';
      if (setCodEnabled) setCodEnabled.checked = s.cod_enabled;
      if (setEasypaisaEnabled) setEasypaisaEnabled.checked = s.easypaisa_enabled;
      if (setEasypaisaNumber) setEasypaisaNumber.value = s.easypaisa_number || '';
      if (setAccountName) setAccountName.value = s.account_name || '';
      if (setAdminPhone) setAdminPhone.value = s.admin_notification_phone || '';

      const setHumanHandoffEnabled = document.getElementById('setHumanHandoffEnabled');
      const setHumanHandoffPhone = document.getElementById('setHumanHandoffPhone');
      const setHumanHandoffMuteMinutes = document.getElementById('setHumanHandoffMuteMinutes');
      const setHumanHandoffMsg = document.getElementById('setHumanHandoffMsg');
      const custom = s.custom_settings || {};

      if (setHumanHandoffEnabled) {
        setHumanHandoffEnabled.checked = custom.human_handoff_enabled !== 'false';
      }
      if (setHumanHandoffPhone) {
        setHumanHandoffPhone.value = custom.human_handoff_phone || '';
      }
      if (setHumanHandoffMuteMinutes) {
        setHumanHandoffMuteMinutes.value = custom.human_handoff_mute_minutes || '120';
      }
      if (setHumanHandoffMsg) {
        setHumanHandoffMsg.value = custom.human_handoff_message || 'Aapki request humare support agent ko forward kar di gayi hai, humara representative jald aapse rabta karega.';
      }
      const setOutOfDeliveryMsg = document.getElementById('setOutOfDeliveryMsg');
      if (setOutOfDeliveryMsg) {
        setOutOfDeliveryMsg.value = custom.out_of_delivery_range_message || 'Maazrat! Aapki share ki hui location hamari delivery range se bahar hai. Hum sirf apne approved delivery areas mein delivery provide karte hain.\n\nBarah-e-karam kisi approved delivery area ka address ya WhatsApp location pin share karein, taake hum aapki delivery confirm kar sakein. Shukriya!';
      }
      const setGoogleReviewsUrl = document.getElementById('setGoogleReviewsUrl');
      if (setGoogleReviewsUrl) {
        setGoogleReviewsUrl.value = custom.google_reviews_url || 'https://maps.app.goo.gl/rVvANx8pRmtXrEMj9';
      }

      if (s.name) updateBrandDisplay(s.name);
    }
  } catch (err) {
    showToast('Failed to load settings: ' + err.message, 'error');
  }
}

function updateBrandDisplay(name) {
  const cleanName = 'Admin';
  localStorage.setItem('app_brand_name', cleanName);
  document.querySelectorAll('#sidebarBrandName, #authBrandName').forEach(el => {
    el.textContent = cleanName;
  });
  document.title = `${cleanName} — Management Dashboard`;

  // Dynamically update terminal window title and terminal prompt
  const slug = 'admin';
  const termTitle = document.getElementById('terminalTitleText') || document.querySelector('.term-title-text');
  if (termTitle) {
    termTitle.textContent = `${slug}@system:~$`;
  }
  const termPromptPrefix = document.getElementById('terminalPromptPrefix') || document.querySelector('.prompt-long');
  if (termPromptPrefix) {
    termPromptPrefix.textContent = `${slug}@system:`;
  }
}

async function loadBrandDisplay() {
  const cached = localStorage.getItem('app_brand_name');
  if (cached) {
    updateBrandDisplay(cached);
  }

  try {
    const res = await fetch('/api/public/brand');
    const data = await res.json();
    if (data.success && data.data?.name) {
      updateBrandDisplay(data.data.name);
      return;
    }
  } catch (_) {}
}

// Immediately load brand display on page startup so login screen gets dynamic name
loadBrandDisplay();

const settingsForm = document.getElementById('settingsForm');
if (settingsForm) {
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const setRestName = document.getElementById('setRestName');
    const setRestPhone = document.getElementById('setRestPhone');
    const setRestAddress = document.getElementById('setRestAddress');
    const setOpenTime = document.getElementById('setOpenTime');
    const setCloseTime = document.getElementById('setCloseTime');
    const setCurrency = document.getElementById('setCurrency');
    const setTimezone = document.getElementById('setTimezone');
    const setMinOrder = document.getElementById('setMinOrder');
    const setDefaultDelivery = document.getElementById('setDefaultDelivery');
    const setCodEnabled = document.getElementById('setCodEnabled');
    const setEasypaisaEnabled = document.getElementById('setEasypaisaEnabled');
    const setEasypaisaNumber = document.getElementById('setEasypaisaNumber');
    const setAccountName = document.getElementById('setAccountName');
    const setAdminPhone = document.getElementById('setAdminPhone');
    const setHumanHandoffEnabled = document.getElementById('setHumanHandoffEnabled');
    const setHumanHandoffPhone = document.getElementById('setHumanHandoffPhone');
    const setHumanHandoffMuteMinutes = document.getElementById('setHumanHandoffMuteMinutes');
    const setHumanHandoffMsg = document.getElementById('setHumanHandoffMsg');
    const setOutOfDeliveryMsg = document.getElementById('setOutOfDeliveryMsg');
    const setGoogleReviewsUrl = document.getElementById('setGoogleReviewsUrl');

    const supportPhoneVal = setHumanHandoffPhone ? setHumanHandoffPhone.value.trim() : '';

    const payload = {
      name: setRestName ? setRestName.value.trim() : undefined,
      phone: setRestPhone ? setRestPhone.value.trim() || null : null,
      address: setRestAddress ? setRestAddress.value.trim() || null : null,
      opening_time: setOpenTime ? setOpenTime.value || null : null,
      closing_time: setCloseTime ? setCloseTime.value || null : null,
      currency: setCurrency ? setCurrency.value.trim() || 'PKR' : 'PKR',
      timezone: setTimezone ? setTimezone.value.trim() || 'Asia/Karachi' : 'Asia/Karachi',
      min_order: setMinOrder && setMinOrder.value !== '' ? parseFloat(setMinOrder.value) : null,
      default_delivery_fee: setDefaultDelivery && setDefaultDelivery.value !== '' ? parseFloat(setDefaultDelivery.value) : null,
      cod_enabled: setCodEnabled ? setCodEnabled.checked : true,
      easypaisa_enabled: setEasypaisaEnabled ? setEasypaisaEnabled.checked : false,
      easypaisa_number: setEasypaisaNumber ? setEasypaisaNumber.value.trim() || null : null,
      account_name: setAccountName ? setAccountName.value.trim() || null : null,
      admin_notification_phone: supportPhoneVal || (setAdminPhone ? setAdminPhone.value.trim() || null : null),
      custom_settings: {
        human_handoff_enabled: setHumanHandoffEnabled ? String(setHumanHandoffEnabled.checked) : 'true',
        human_handoff_phone: supportPhoneVal,
        human_handoff_mute_minutes: setHumanHandoffMuteMinutes && setHumanHandoffMuteMinutes.value.trim() ? setHumanHandoffMuteMinutes.value.trim() : '120',
        human_handoff_message: setHumanHandoffMsg ? setHumanHandoffMsg.value.trim() : '',
        out_of_delivery_range_message: setOutOfDeliveryMsg ? setOutOfDeliveryMsg.value.trim() : '',
        google_reviews_url: setGoogleReviewsUrl ? setGoogleReviewsUrl.value.trim() : '',
      },
    };

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Restaurant settings saved successfully', 'success');
        if (payload.name) updateBrandDisplay(payload.name);
      } else {
        showToast(data.error?.message || 'Failed to save settings', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ─── AI Bot Prompt Controller ───────────────────────────────────────────
let currentPromptFontSize = 13.5;
let lastSearchIdx = -1;

function updatePromptEditorStats() {
  const textarea = document.getElementById('botPromptTextarea');
  if (!textarea) return;
  const text = textarea.value || '';
  const charCount = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lineCount = text ? text.split('\n').length : 1;

  const charEl = document.getElementById('promptCharCount');
  const wordEl = document.getElementById('promptWordCount');
  const lineEl = document.getElementById('promptLineCount');

  if (charEl) charEl.textContent = `${charCount.toLocaleString()} characters`;
  if (wordEl) wordEl.textContent = `${words.toLocaleString()} words`;
  if (lineEl) lineEl.textContent = `${lineCount.toLocaleString()} lines`;

  // Update line numbers gutter
  const lineNumbersEl = document.getElementById('promptLineNumbers');
  if (lineNumbersEl) {
    let nums = '';
    for (let i = 1; i <= lineCount; i++) {
      nums += i + '\n';
    }
    lineNumbersEl.textContent = nums;
  }
}

async function loadBotPrompt() {
  const textarea = document.getElementById('botPromptTextarea');
  const badge = document.getElementById('promptStatusBadge');
  const saveMsg = document.getElementById('promptSaveMessage');
  if (saveMsg) saveMsg.textContent = '';

  try {
    const res = await fetch('/api/admin/prompt');
    const json = await res.json();
    if (json.success && json.data) {
      const { prompt, isCustom, updatedAt } = json.data;
      if (textarea) textarea.value = prompt || '';
      if (badge) {
        if (isCustom && prompt && prompt.trim().length > 0) {
          badge.className = 'status-pill status-online';
          badge.textContent = '🟢 Custom Prompt Active';
        } else {
          badge.className = 'status-pill status-offline';
          badge.textContent = '⚪ Prompt Empty (Not Set)';
        }
      }
      updatePromptEditorStats();
    }
  } catch (err) {
    console.error('Failed to load bot prompt:', err);
    showToast('Failed to load bot prompt: ' + err.message, 'error');
  }
}

async function saveBotPrompt() {
  const textarea = document.getElementById('botPromptTextarea');
  const saveBtn = document.getElementById('savePromptBtn');
  const badge = document.getElementById('promptStatusBadge');
  const saveMsg = document.getElementById('promptSaveMessage');
  if (!textarea) return;

  const promptText = textarea.value.trim();

  const originalBtnHtml = saveBtn ? saveBtn.innerHTML : '';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span>Saving...</span>';
  }

  try {
    const res = await fetch('/api/admin/prompt', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptText }),
    });
    const json = await res.json();
    if (json.success) {
      if (badge) {
        if (json.data && json.data.isCustom && promptText.length > 0) {
          badge.className = 'status-pill status-online';
          badge.textContent = '🟢 Custom Prompt Active';
        } else {
          badge.className = 'status-pill status-offline';
          badge.textContent = '⚪ Prompt Empty (Not Set)';
        }
      }
      if (saveMsg) {
        saveMsg.textContent = 'Saved successfully! Live on next message.';
        setTimeout(() => { if (saveMsg) saveMsg.textContent = ''; }, 4000);
      }
      showToast('Bot prompt saved and applied live!', 'success');
    } else {
      showToast(json.error?.message || 'Failed to save prompt', 'error');
    }
  } catch (err) {
    console.error('Error saving prompt:', err);
    showToast('Network error while saving prompt: ' + err.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalBtnHtml;
    }
  }
}

async function resetBotPrompt() {
  const confirmed = confirm('Are you sure you want to clear the bot prompt? Any custom prompt text will be removed and set to empty.');
  if (!confirmed) return;

  const badge = document.getElementById('promptStatusBadge');
  const saveMsg = document.getElementById('promptSaveMessage');

  try {
    const res = await fetch('/api/admin/prompt/reset', { method: 'POST' });
    const json = await res.json();
    if (json.success && json.data) {
      const textarea = document.getElementById('botPromptTextarea');
      if (textarea) textarea.value = json.data.prompt || '';
      if (badge) {
        badge.className = 'status-pill status-offline';
        badge.textContent = '⚪ Prompt Empty (Not Set)';
      }
      if (saveMsg) {
        saveMsg.textContent = 'Prompt cleared to empty.';
        setTimeout(() => { if (saveMsg) saveMsg.textContent = ''; }, 4000);
      }
      updatePromptEditorStats();
      showToast('Bot prompt cleared to empty!', 'info');
    } else {
      showToast(json.error?.message || 'Failed to reset prompt', 'error');
    }
  } catch (err) {
    console.error('Error resetting prompt:', err);
    showToast('Network error while resetting prompt: ' + err.message, 'error');
  }
}

function copyBotPrompt() {
  const textarea = document.getElementById('botPromptTextarea');
  if (!textarea || !textarea.value) return;
  navigator.clipboard.writeText(textarea.value).then(() => {
    showToast('Prompt copied to clipboard!', 'success');
  }).catch(() => {
    textarea.select();
    document.execCommand('copy');
    showToast('Prompt copied to clipboard!', 'success');
  });
}

function insertPromptVariable(variableTag) {
  const textarea = document.getElementById('botPromptTextarea');
  if (!textarea) return;
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const val = textarea.value;
  textarea.value = val.substring(0, start) + variableTag + val.substring(end);
  textarea.selectionStart = textarea.selectionEnd = start + variableTag.length;
  textarea.focus();
  updatePromptEditorStats();
}

function togglePromptFullscreen() {
  const card = document.getElementById('promptEditorCard');
  const btn = document.getElementById('toggleFullscreenBtn');
  if (!card) return;
  card.classList.toggle('fullscreen');
  const isFull = card.classList.contains('fullscreen');
  if (btn) btn.innerHTML = isFull ? '🗗 Minimize' : '⛶ Maximize';
}

function jumpToPromptSection(searchPhrase) {
  const textarea = document.getElementById('botPromptTextarea');
  if (!textarea || !textarea.value) return;
  const idx = textarea.value.toLowerCase().indexOf(searchPhrase.toLowerCase());
  if (idx !== -1) {
    textarea.focus();
    textarea.setSelectionRange(idx, idx + searchPhrase.length);
    const linesBefore = textarea.value.substring(0, idx).split('\n').length;
    const totalLines = textarea.value.split('\n').length;
    const scrollRatio = linesBefore / totalLines;
    textarea.scrollTop = Math.max(0, scrollRatio * textarea.scrollHeight - 60);
    const gutter = document.getElementById('promptLineNumbers');
    if (gutter) gutter.scrollTop = textarea.scrollTop;
    showToast(`Jumped to: ${searchPhrase.slice(0, 30)}...`, 'info');
  } else {
    showToast(`Section "${searchPhrase}" not found in current prompt`, 'error');
  }
}

function findInPrompt() {
  const input = document.getElementById('promptSearchInput');
  const textarea = document.getElementById('botPromptTextarea');
  if (!input || !textarea || !input.value.trim()) return;
  const term = input.value.trim().toLowerCase();
  const text = textarea.value.toLowerCase();

  let nextIdx = text.indexOf(term, lastSearchIdx + 1);
  if (nextIdx === -1) {
    nextIdx = text.indexOf(term, 0); // wrap around
    if (nextIdx === -1) {
      showToast(`"${term}" not found in prompt`, 'error');
      return;
    }
    showToast('Reached end, starting from top', 'info');
  }
  lastSearchIdx = nextIdx;
  textarea.focus();
  textarea.setSelectionRange(nextIdx, nextIdx + term.length);
  const linesBefore = textarea.value.substring(0, nextIdx).split('\n').length;
  const totalLines = textarea.value.split('\n').length;
  textarea.scrollTop = Math.max(0, (linesBefore / totalLines) * textarea.scrollHeight - 60);
  const gutter = document.getElementById('promptLineNumbers');
  if (gutter) gutter.scrollTop = textarea.scrollTop;
}

function changePromptFontSize(delta) {
  const textarea = document.getElementById('botPromptTextarea');
  const gutter = document.getElementById('promptLineNumbers');
  currentPromptFontSize = Math.min(22, Math.max(11, currentPromptFontSize + delta));
  if (textarea) textarea.style.fontSize = `${currentPromptFontSize}px`;
  if (gutter) gutter.style.fontSize = `${currentPromptFontSize - 0.5}px`;
}

window.insertPromptVariable = insertPromptVariable;
window.loadBotPrompt = loadBotPrompt;
window.saveBotPrompt = saveBotPrompt;
window.resetBotPrompt = resetBotPrompt;
window.copyBotPrompt = copyBotPrompt;
window.togglePromptFullscreen = togglePromptFullscreen;
window.jumpToPromptSection = jumpToPromptSection;
window.findInPrompt = findInPrompt;
window.changePromptFontSize = changePromptFontSize;

// Setup prompt listeners
function initPromptEditorEvents() {
  const savePromptBtn = document.getElementById('savePromptBtn');
  const resetPromptBtn = document.getElementById('resetPromptBtn');
  const copyPromptBtn = document.getElementById('copyPromptBtn');
  const promptTextarea = document.getElementById('botPromptTextarea');
  const promptLineNumbers = document.getElementById('promptLineNumbers');

  if (savePromptBtn) savePromptBtn.addEventListener('click', saveBotPrompt);
  if (resetPromptBtn) resetPromptBtn.addEventListener('click', resetBotPrompt);
  if (copyPromptBtn) copyPromptBtn.addEventListener('click', copyBotPrompt);

  if (promptTextarea) {
    promptTextarea.addEventListener('input', updatePromptEditorStats);
    promptTextarea.addEventListener('keyup', updatePromptEditorStats);

    // Sync line numbers scrolling
    promptTextarea.addEventListener('scroll', () => {
      if (promptLineNumbers) promptLineNumbers.scrollTop = promptTextarea.scrollTop;
    });

    // Support Tab key indent
    promptTextarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = promptTextarea.selectionStart;
        const end = promptTextarea.selectionEnd;
        promptTextarea.value = promptTextarea.value.substring(0, start) + '  ' + promptTextarea.value.substring(end);
        promptTextarea.selectionStart = promptTextarea.selectionEnd = start + 2;
        updatePromptEditorStats();
      }
    });
  }

  // Escape exits fullscreen
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const card = document.getElementById('promptEditorCard');
      if (card && card.classList.contains('fullscreen')) {
        card.classList.remove('fullscreen');
        const btn = document.getElementById('toggleFullscreenBtn');
        if (btn) btn.innerHTML = '⛶ Maximize';
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', initPromptEditorEvents);
initPromptEditorEvents();

// ─── Phase 3: Deals & Promotions Controller ────────────────────────────
let cachedMenuItemsForDeals = [];

async function loadMenuItemsForDeals() {
  try {
    const res = await fetch('/api/admin/menu');
    const data = await res.json();
    if (data.success && data.data) {
      cachedMenuItemsForDeals = data.data;
    }
  } catch (err) {
    console.error('Failed to load menu items for deals:', err);
  }
}

function switchDealsSubTab(tab) {
  loadDeals();
}
window.switchDealsSubTab = switchDealsSubTab;

// ─── Deals CRUD ────────────────────────────────────────────────────────
let cachedDealsList = [];
let dealsPageState = { page: 1, pageSize: 50, search: '' };

function renderDealsTable() {
  const tbody = document.getElementById('dealsTableBody');
  if (!tbody) return;

  let filtered = cachedDealsList || [];
  if (dealsPageState.search) {
    const q = dealsPageState.search.toLowerCase();
    filtered = filtered.filter(d =>
      (d.name && d.name.toLowerCase().includes(q)) ||
      (d.description && d.description.toLowerCase().includes(q)) ||
      (d.items && d.items.some(it => it.item_name && it.item_name.toLowerCase().includes(q)))
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No meal deals found. Click "Add Deal" to create one.</td></tr>';
    renderPaginationControl({
      containerId: 'dealsPagination',
      totalItems: 0,
      currentPage: 1,
      pageSize: dealsPageState.pageSize,
      onPageSizeChange: (s) => {
        dealsPageState.pageSize = s;
        dealsPageState.page = 1;
        renderDealsTable();
      }
    });
    return;
  }

  const totalPages = Math.ceil(filtered.length / dealsPageState.pageSize);
  if (dealsPageState.page > totalPages) dealsPageState.page = totalPages;
  const startIndex = (dealsPageState.page - 1) * dealsPageState.pageSize;
  const pageItems = filtered.slice(startIndex, startIndex + dealsPageState.pageSize);

  tbody.innerHTML = pageItems.map(d => {
    const itemsBadges = d.items?.map(it => 
      `<span class="badge-item-tag">${it.quantity}x ${it.item_name}${it.variant_name ? ` (${it.variant_name})` : ''}</span>`
    ).join(' ') || '<span class="term-dim">None</span>';

    const validStr = d.start_at || d.end_at 
      ? `${d.start_at ? new Date(d.start_at).toLocaleDateString() : 'Now'} - ${d.end_at ? new Date(d.end_at).toLocaleDateString() : 'Forever'}`
      : 'Always Active';

    const statusBadge = d.is_active 
      ? `<span class="badge badge-success">Active</span>`
      : `<span class="badge badge-secondary">Disabled</span>`;

    const imgEl = d.image_url 
      ? `<img src="${d.image_url}" class="table-thumb" alt="" />`
      : `<div class="table-thumb-placeholder">🎁</div>`;

    return `
      <tr>
        <td>${imgEl}</td>
        <td><strong>${escapeHtml(d.name)}</strong><br><small class="term-dim">${escapeHtml(d.description || '')}</small></td>
        <td><div style="display: flex; flex-wrap: wrap; gap: 4px;">${itemsBadges}</div></td>
        <td><strong>Rs. ${d.deal_price}</strong></td>
        <td><small>${validStr}</small></td>
        <td>${statusBadge}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-secondary btn-xs" onclick="window.openEditDealModal('${d.id}')">Edit</button>
          <button class="btn btn-secondary btn-xs" onclick="window.toggleDealStatus('${d.id}', ${d.is_active})">${d.is_active ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-danger btn-xs" onclick="window.deleteDeal('${d.id}')">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  renderPaginationControl({
    containerId: 'dealsPagination',
    totalItems: filtered.length,
    currentPage: dealsPageState.page,
    pageSize: dealsPageState.pageSize,
    onPageChange: (p) => {
      dealsPageState.page = p;
      renderDealsTable();
    },
    onPageSizeChange: (s) => {
      dealsPageState.pageSize = s;
      dealsPageState.page = 1;
      renderDealsTable();
    }
  });
}
window.renderDealsTable = renderDealsTable;

async function loadDeals() {
  const tbody = document.getElementById('dealsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Loading deals...</td></tr>';

  try {
    const res = await fetch('/api/admin/deals');
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: #ff6b6b;">Error: ${data.error?.message}</td></tr>`;
      return;
    }

    const deals = data.data || [];
    cachedDealsList = deals;
    renderDealsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: #ff6b6b;">Failed: ${err.message}</td></tr>`;
  }
}
window.loadDeals = loadDeals;

function getDealCategories() {
  const map = new Map();
  if (Array.isArray(cachedCategoriesList)) {
    cachedCategoriesList.forEach(c => {
      if (c && c.id && c.name) map.set(c.id, c.name);
    });
  }
  if (Array.isArray(cachedMenuItemsForDeals)) {
    cachedMenuItemsForDeals.forEach(m => {
      if (m.category && m.category.id && m.category.name) {
        map.set(m.category.id, m.category.name);
      } else if (m.category_id && !map.has(m.category_id)) {
        map.set(m.category_id, m.category_id);
      }
    });
  }
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
}

async function openAddDealModal() {
  const modal = document.getElementById('dealModal');
  const title = document.getElementById('dealModalTitle');
  const form = document.getElementById('dealForm');
  const editId = document.getElementById('dealEditId');
  const container = document.getElementById('dealItemsContainer');

  if (form) form.reset();
  if (editId) editId.value = '';
  if (title) title.textContent = 'Add Deal';
  if (container) container.innerHTML = '';
  const isActive = document.getElementById('dealIsActive');
  if (isActive) isActive.checked = true;

  if (!cachedMenuItemsForDeals || cachedMenuItemsForDeals.length === 0) {
    await loadMenuItemsForDeals();
  }
  if (!cachedCategoriesList || cachedCategoriesList.length === 0) {
    await loadCategories();
  }

  // Add one empty row
  addDealItemRow();

  if (modal) modal.classList.remove('hidden');
}
window.openAddDealModal = openAddDealModal;

function closeDealModal() {
  const modal = document.getElementById('dealModal');
  if (modal) modal.classList.add('hidden');
}
window.closeDealModal = closeDealModal;

function addDealItemRow(selectedItemId = '', selectedVariantId = '', quantity = 1) {
  const container = document.getElementById('dealItemsContainer');
  if (!container) return;

  const rowId = `deal_row_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
  const row = document.createElement('div');
  row.className = 'deal-item-row';
  row.id = rowId;

  // If item is already selected, detect its category
  let initialCategoryId = '';
  if (selectedItemId) {
    const foundItem = (cachedMenuItemsForDeals || []).find(m => m.id === selectedItemId);
    if (foundItem) {
      initialCategoryId = foundItem.category_id || (foundItem.category && foundItem.category.id) || '';
    }
  }

  const categories = getDealCategories();
  const categoryOptions = categories.map(c => 
    `<option value="${c.id}" ${c.id === initialCategoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');

  row.innerHTML = `
    <select class="deal-category-select" title="1. Select Category" onchange="window.updateDealItemCategory('${rowId}')">
      <option value="">Category...</option>
      <option value="__ALL__" ${initialCategoryId === '__ALL__' ? 'selected' : ''}>All Categories</option>
      ${categoryOptions}
    </select>
    <select class="deal-item-select" title="2. Select Item / Flavour" onchange="window.updateDealItemVariants('${rowId}')">
      <option value="">Select Item / Flavour...</option>
    </select>
    <select class="deal-variant-select" title="3. Select Size / Variant">
      <option value="">Standard / Base</option>
    </select>
    <input type="number" class="deal-qty-input" min="1" value="${quantity || 1}" title="Quantity" placeholder="Qty" />
    <button type="button" class="deal-item-del-btn" onclick="document.getElementById('${rowId}').remove()" title="Remove item">✕</button>
  `;

  container.appendChild(row);

  updateDealItemCategory(rowId, selectedItemId, selectedVariantId);
}
window.addDealItemRow = addDealItemRow;

function updateDealItemCategory(rowId, preselectedItemId = '', preselectedVariantId = '') {
  const row = document.getElementById(rowId);
  if (!row) return;

  const catSelect = row.querySelector('.deal-category-select');
  const itemSelect = row.querySelector('.deal-item-select');
  const varSelect = row.querySelector('.deal-variant-select');
  if (!catSelect || !itemSelect || !varSelect) return;

  const catId = catSelect.value;

  // Filter items by category
  let items = cachedMenuItemsForDeals || [];
  if (catId && catId !== '__ALL__') {
    items = items.filter(m => m.category_id === catId || (m.category && m.category.id === catId));
  }

  itemSelect.innerHTML = '<option value="">Select Item / Flavour...</option>';
  if (items.length === 0) {
    if (catId) {
      itemSelect.innerHTML = '<option value="">No items in this category</option>';
    } else {
      itemSelect.innerHTML = '<option value="">Choose category first...</option>';
    }
  } else {
    items.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} (Rs. ${m.base_price})`;
      if (m.id === preselectedItemId) opt.selected = true;
      itemSelect.appendChild(opt);
    });
  }

  updateDealItemVariants(rowId, preselectedVariantId);
}
window.updateDealItemCategory = updateDealItemCategory;

function updateDealItemVariants(rowId, preselectedVariantId = '') {
  const row = document.getElementById(rowId);
  if (!row) return;

  const itemSelect = row.querySelector('.deal-item-select');
  const varSelect = row.querySelector('.deal-variant-select');
  if (!itemSelect || !varSelect) return;

  const selectedItemId = itemSelect.value;
  const item = (cachedMenuItemsForDeals || []).find(m => m.id === selectedItemId);

  varSelect.innerHTML = '<option value="">Standard / Base Size</option>';
  if (item && item.variants && item.variants.length > 0) {
    item.variants.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.name} (Rs. ${v.price})`;
      if (v.id === preselectedVariantId) opt.selected = true;
      varSelect.appendChild(opt);
    });
  }
}
window.updateDealItemVariants = updateDealItemVariants;

async function openEditDealModal(dealId) {
  try {
    if (!cachedMenuItemsForDeals || cachedMenuItemsForDeals.length === 0) {
      await loadMenuItemsForDeals();
    }
    if (!cachedCategoriesList || cachedCategoriesList.length === 0) {
      await loadCategories();
    }

    const res = await fetch(`/api/admin/deals/${dealId}`);
    const data = await res.json();
    if (!data.success) {
      showToast(data.error?.message || 'Failed to fetch deal', 'error');
      return;
    }

    const d = data.data;
    document.getElementById('dealEditId').value = d.id;
    document.getElementById('dealModalTitle').textContent = 'Edit Deal';
    document.getElementById('dealName').value = d.name || '';
    document.getElementById('dealPrice').value = d.deal_price ?? '';
    document.getElementById('dealDescription').value = d.description || '';
    document.getElementById('dealSortOrder').value = d.sort_order ?? 0;
    document.getElementById('dealIsActive').checked = d.is_active ?? true;

    if (d.start_at) {
      const dt = new Date(d.start_at);
      document.getElementById('dealStartAt').value = dt.toISOString().slice(0, 16);
    } else {
      document.getElementById('dealStartAt').value = '';
    }

    if (d.end_at) {
      const dt = new Date(d.end_at);
      document.getElementById('dealEndAt').value = dt.toISOString().slice(0, 16);
    } else {
      document.getElementById('dealEndAt').value = '';
    }

    const container = document.getElementById('dealItemsContainer');
    container.innerHTML = '';

    if (d.deal_items && d.deal_items.length > 0) {
      d.deal_items.forEach(di => {
        addDealItemRow(di.menu_item_id, di.menu_variant_id, di.quantity);
      });
    } else {
      addDealItemRow();
    }

    document.getElementById('dealModal').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.openEditDealModal = openEditDealModal;

// Save Deal form submission
const dealForm = document.getElementById('dealForm');
if (dealForm) {
  dealForm.addEventListener('submit', async () => {
    const editId = document.getElementById('dealEditId').value;
    const name = document.getElementById('dealName').value.trim();
    const deal_price = parseFloat(document.getElementById('dealPrice').value);
    const description = document.getElementById('dealDescription').value.trim();
    const start_at = document.getElementById('dealStartAt').value || null;
    const end_at = document.getElementById('dealEndAt').value || null;
    const sort_order = parseInt(document.getElementById('dealSortOrder').value, 10) || 0;
    const is_active = document.getElementById('dealIsActive').checked;

    // Collect items
    const rows = document.querySelectorAll('#dealItemsContainer .deal-item-row');
    const items = [];
    rows.forEach(r => {
      const itId = r.querySelector('.deal-item-select')?.value;
      const vId = r.querySelector('.deal-variant-select')?.value || null;
      const qty = parseInt(r.querySelector('.deal-qty-input')?.value, 10) || 1;
      if (itId) {
        items.push({
          menu_item_id: itId,
          menu_variant_id: vId,
          quantity: qty,
        });
      }
    });

    const payload = {
      name,
      deal_price,
      description: description || null,
      start_at: start_at ? new Date(start_at).toISOString() : null,
      end_at: end_at ? new Date(end_at).toISOString() : null,
      sort_order,
      is_active,
      items,
    };

    try {
      const url = editId ? `/api/admin/deals/${editId}` : '/api/admin/deals';
      const method = editId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        showToast(editId ? 'Deal updated successfully' : 'Deal created successfully', 'success');
        closeDealModal();
        loadDeals();
        loadDashboardStats();
      } else {
        showToast(data.error?.message || 'Failed to save deal', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function toggleDealStatus(dealId, currentActive) {
  try {
    const res = await fetch(`/api/admin/deals/${dealId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !currentActive }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('Deal status updated', 'success');
      loadDeals();
    } else {
      showToast(data.error?.message || 'Failed to update status', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.toggleDealStatus = toggleDealStatus;

async function deleteDeal(dealId) {
  if (!confirm('Are you sure you want to delete this deal?')) return;
  try {
    const res = await fetch(`/api/admin/deals/${dealId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Deal deleted successfully', 'success');
      loadDeals();
      loadDashboardStats();
    } else {
      showToast(data.error?.message || 'Failed to delete deal', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.deleteDeal = deleteDeal;

// ─── Promotions (Disabled & Removed) ───────────────────────────
window.loadPromotions = function() {};
window.openAddPromoModal = function() {};
window.closePromoModal = function() {};
window.openEditPromoModal = function() {};
window.togglePromoStatus = function() {};
window.deletePromotion = function() {};

// ─── Delivery Areas CRUD ───────────────────────────────────────────────
let cachedDeliveryAreas = [];
let deliveryPageState = { page: 1, pageSize: 50, search: '' };

function renderDeliveryAreasTable() {
  const tbody = document.getElementById('deliveryTableBody');
  if (!tbody) return;

  let filtered = cachedDeliveryAreas || [];
  if (deliveryPageState.search) {
    const q = deliveryPageState.search.toLowerCase();
    filtered = filtered.filter(a => 
      (a.name && a.name.toLowerCase().includes(q)) ||
      (a.radius_km != null && `${a.radius_km}km`.includes(q)) ||
      (a.latitude != null && String(a.latitude).includes(q)) ||
      (a.longitude != null && String(a.longitude).includes(q))
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No delivery areas found.</td></tr>';
    renderPaginationControl({
      containerId: 'deliveryPagination',
      totalItems: 0,
      currentPage: 1,
      pageSize: deliveryPageState.pageSize,
      onPageSizeChange: (s) => {
        deliveryPageState.pageSize = s;
        deliveryPageState.page = 1;
        renderDeliveryAreasTable();
      }
    });
    return;
  }

  const totalPages = Math.ceil(filtered.length / deliveryPageState.pageSize);
  if (deliveryPageState.page > totalPages) deliveryPageState.page = totalPages;
  const startIndex = (deliveryPageState.page - 1) * deliveryPageState.pageSize;
  const pageItems = filtered.slice(startIndex, startIndex + deliveryPageState.pageSize);

  tbody.innerHTML = pageItems.map(a => {
    let geoStr = '';
    if (a.latitude && a.longitude) {
      const rad = a.radius_km != null ? a.radius_km : 2.5;
      geoStr = `
        <div class="geo-badge-wrap">
          <a href="https://maps.google.com/?q=${a.latitude},${a.longitude}" target="_blank" rel="noopener noreferrer" class="link-preview" title="View location on Google Maps">
            📍 ${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)} ↗
          </a>
          <span class="geo-radius-tag">⭕ ${rad} km coverage</span>
        </div>
      `;
    } else {
      geoStr = `<span class="badge badge-secondary" style="font-size: 11px;">📍 Named Area</span>`;
    }
    const statusBadge = a.is_active ? `<span class="badge badge-success">Active</span>` : `<span class="badge badge-secondary">Disabled</span>`;

    return `
      <tr>
        <td><span class="badge badge-secondary">${a.sort_order ?? 0}</span></td>
        <td>
          <strong>${escapeHtml(a.name)}</strong>
          ${a.aliases ? `<div class="subtext" style="font-size: 11px; color: var(--fg-muted); margin-top: 2px;">🔖 <em>${escapeHtml(a.aliases)}</em></div>` : ''}
        </td>
        <td><strong>Rs. ${a.delivery_fee}</strong></td>
        <td>Rs. ${a.minimum_order ?? 0}</td>
        <td>${geoStr}</td>
        <td>${statusBadge}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-secondary btn-xs" onclick="window.openEditDeliveryModal('${a.id}')">Edit</button>
          <button class="btn btn-secondary btn-xs" onclick="window.toggleDeliveryStatus('${a.id}', ${a.is_active})">${a.is_active ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-danger btn-xs" onclick="window.deleteDeliveryArea('${a.id}')">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  renderPaginationControl({
    containerId: 'deliveryPagination',
    totalItems: filtered.length,
    currentPage: deliveryPageState.page,
    pageSize: deliveryPageState.pageSize,
    onPageChange: (p) => {
      deliveryPageState.page = p;
      renderDeliveryAreasTable();
    },
    onPageSizeChange: (s) => {
      deliveryPageState.pageSize = s;
      deliveryPageState.page = 1;
      renderDeliveryAreasTable();
    }
  });
}
window.renderDeliveryAreasTable = renderDeliveryAreasTable;

async function loadDeliveryAreas() {
  const tbody = document.getElementById('deliveryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Loading delivery areas...</td></tr>';

  try {
    const res = await fetch('/api/admin/delivery-areas');
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: #ff6b6b;">Error: ${data.error?.message}</td></tr>`;
      return;
    }

    const areas = data.data || [];
    cachedDeliveryAreas = areas;
    renderDeliveryAreasTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: #ff6b6b;">Failed: ${err.message}</td></tr>`;
  }
}
window.loadDeliveryAreas = loadDeliveryAreas;

// ── Geolocation & Radius Helpers for Delivery Zone Modal ────────────────────

function fetchCurrentAdminLocation() {
  const btn = document.getElementById('btnGetMyLoc');
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser', 'error');
    return;
  }
  if (btn) btn.innerHTML = '<span>⏳ Detecting...</span>';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const latInput = document.getElementById('deliveryLat');
      const lngInput = document.getElementById('deliveryLng');
      if (latInput) latInput.value = lat.toFixed(6);
      if (lngInput) lngInput.value = lng.toFixed(6);
      updateMapPreviewLink();
      if (btn) btn.innerHTML = '<span>🎯 Use My Current Location</span>';
      showToast(`Location captured: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
    },
    (err) => {
      if (btn) btn.innerHTML = '<span>🎯 Use My Current Location</span>';
      showToast(`Failed to get location: ${err.message}`, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}
window.fetchCurrentAdminLocation = fetchCurrentAdminLocation;

function parseQuickCoordinates() {
  const input = document.getElementById('deliveryQuickPaste');
  if (!input) return;
  const val = (input.value || '').trim();
  if (!val) {
    showToast('Please paste a Google Maps link or "lat, lng" coordinates', 'info');
    return;
  }

  // Matches Google Maps URLs or raw coordinates e.g. 33.6261, 73.1255 or @33.6261,73.1255 or q=33.6261,73.1255
  const match = val.match(/(?:q=|@|destination=|\/dir\/|loc:)?(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lng)) {
      const latInput = document.getElementById('deliveryLat');
      const lngInput = document.getElementById('deliveryLng');
      if (latInput) latInput.value = lat.toFixed(6);
      if (lngInput) lngInput.value = lng.toFixed(6);
      updateMapPreviewLink();
      showToast(`Coordinates extracted: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
      return;
    }
  }

  showToast('Could not find latitude & longitude in text. Example format: 33.6261, 73.1255', 'error');
}
window.parseQuickCoordinates = parseQuickCoordinates;

function updateMapPreviewLink() {
  const latVal = document.getElementById('deliveryLat')?.value;
  const lngVal = document.getElementById('deliveryLng')?.value;
  const wrap = document.getElementById('deliveryMapPreviewWrap');
  const link = document.getElementById('deliveryMapLink');
  if (!wrap || !link) return;

  const lat = parseFloat(latVal);
  const lng = parseFloat(lngVal);
  if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
    link.href = `https://maps.google.com/?q=${lat},${lng}`;
    wrap.classList.remove('hidden');
  } else {
    wrap.classList.add('hidden');
  }
}
window.updateMapPreviewLink = updateMapPreviewLink;

function onRadiusSliderChange(val) {
  const num = parseFloat(val) || 1;
  const numInput = document.getElementById('deliveryRadius');
  if (numInput) numInput.value = num.toFixed(1);
  updateRadiusLiveBadge(num);
  highlightRadiusPresetChip(num);
}
window.onRadiusSliderChange = onRadiusSliderChange;

function onRadiusInputChange(val) {
  const num = parseFloat(val) || 1;
  const slider = document.getElementById('deliveryRadiusSlider');
  if (slider) slider.value = Math.min(Math.max(num, 0.5), 30);
  updateRadiusLiveBadge(num);
  highlightRadiusPresetChip(num);
}
window.onRadiusInputChange = onRadiusInputChange;

function setRadiusPreset(km) {
  const slider = document.getElementById('deliveryRadiusSlider');
  const input = document.getElementById('deliveryRadius');
  if (slider) slider.value = km;
  if (input) input.value = km.toFixed(1);
  updateRadiusLiveBadge(km);
  highlightRadiusPresetChip(km);
}
window.setRadiusPreset = setRadiusPreset;

function updateRadiusLiveBadge(km) {
  const badge = document.getElementById('radiusLiveBadge');
  if (badge) {
    badge.textContent = `⭕ ${km.toFixed(1)} km`;
  }
}

function highlightRadiusPresetChip(km) {
  document.querySelectorAll('.chip-preset').forEach(btn => {
    const text = btn.textContent.replace('km', '').trim();
    if (parseFloat(text) === km) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function openAddDeliveryModal() {
  const modal = document.getElementById('deliveryModal');
  const title = document.getElementById('deliveryModalTitle');
  const form = document.getElementById('deliveryForm');
  const editId = document.getElementById('deliveryEditId');

  if (form) form.reset();
  if (editId) editId.value = '';
  if (title) title.textContent = 'Add Delivery Area';
  document.getElementById('deliveryIsActive').checked = true;

  // Reset coordinates & radius defaults
  const slider = document.getElementById('deliveryRadiusSlider');
  const radiusInput = document.getElementById('deliveryRadius');
  const pasteInput = document.getElementById('deliveryQuickPaste');
  const aliasInput = document.getElementById('deliveryAliases');
  if (slider) slider.value = 3.0;
  if (radiusInput) radiusInput.value = '3.0';
  if (pasteInput) pasteInput.value = '';
  if (aliasInput) aliasInput.value = '';
  updateRadiusLiveBadge(3.0);
  highlightRadiusPresetChip(3);
  updateMapPreviewLink();

  if (modal) modal.classList.remove('hidden');
}
window.openAddDeliveryModal = openAddDeliveryModal;

function closeDeliveryModal() {
  const modal = document.getElementById('deliveryModal');
  if (modal) modal.classList.add('hidden');
}
window.closeDeliveryModal = closeDeliveryModal;

async function openEditDeliveryModal(areaId) {
  try {
    const res = await fetch(`/api/admin/delivery-areas/${areaId}`);
    const data = await res.json();
    if (!data.success) {
      showToast(data.error?.message || 'Failed to fetch area', 'error');
      return;
    }

    const a = data.data;
    document.getElementById('deliveryEditId').value = a.id;
    document.getElementById('deliveryModalTitle').textContent = 'Edit Delivery Area';
    document.getElementById('deliveryName').value = a.name || '';
    document.getElementById('deliveryFee').value = a.delivery_fee ?? '';
    document.getElementById('deliveryMinOrder').value = a.minimum_order ?? '';
    document.getElementById('deliverySortOrder').value = a.sort_order ?? 0;
    document.getElementById('deliveryLat').value = a.latitude ?? '';
    document.getElementById('deliveryLng').value = a.longitude ?? '';
    const aliasInput = document.getElementById('deliveryAliases');
    if (aliasInput) aliasInput.value = a.aliases || '';

    const rad = a.radius_km != null ? Number(a.radius_km) : 3.0;
    document.getElementById('deliveryRadius').value = rad;
    const slider = document.getElementById('deliveryRadiusSlider');
    if (slider) slider.value = Math.min(Math.max(rad, 0.5), 30);
    updateRadiusLiveBadge(rad);
    highlightRadiusPresetChip(rad);

    const pasteInput = document.getElementById('deliveryQuickPaste');
    if (pasteInput) pasteInput.value = '';
    updateMapPreviewLink();

    document.getElementById('deliveryIsActive').checked = a.is_active ?? true;

    document.getElementById('deliveryModal').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.openEditDeliveryModal = openEditDeliveryModal;

// Save Delivery Area form
const deliveryForm = document.getElementById('deliveryForm');
if (deliveryForm) {
  deliveryForm.addEventListener('submit', async () => {
    const editId = document.getElementById('deliveryEditId').value;
    const name = document.getElementById('deliveryName').value.trim();
    const delivery_fee = parseFloat(document.getElementById('deliveryFee').value);
    const minimum_order = document.getElementById('deliveryMinOrder').value ? parseFloat(document.getElementById('deliveryMinOrder').value) : null;
    const sort_order = parseInt(document.getElementById('deliverySortOrder').value, 10) || 0;
    const latitude = document.getElementById('deliveryLat').value ? parseFloat(document.getElementById('deliveryLat').value) : null;
    const longitude = document.getElementById('deliveryLng').value ? parseFloat(document.getElementById('deliveryLng').value) : null;
    const radius_km = document.getElementById('deliveryRadius').value ? parseFloat(document.getElementById('deliveryRadius').value) : null;
    const aliases = document.getElementById('deliveryAliases') ? document.getElementById('deliveryAliases').value.trim() : null;
    const is_active = document.getElementById('deliveryIsActive').checked;

    const payload = {
      name,
      delivery_fee,
      minimum_order,
      sort_order,
      latitude,
      longitude,
      radius_km,
      aliases,
      is_active,
    };

    try {
      const url = editId ? `/api/admin/delivery-areas/${editId}` : '/api/admin/delivery-areas';
      const method = editId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        showToast(editId ? 'Delivery area updated successfully' : 'Delivery area created successfully', 'success');
        closeDeliveryModal();
        loadDeliveryAreas();
        loadDashboardStats();
      } else {
        showToast(data.error?.message || 'Failed to save delivery area', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function toggleDeliveryStatus(areaId, currentActive) {
  try {
    const res = await fetch(`/api/admin/delivery-areas/${areaId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !currentActive }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('Delivery area status updated', 'success');
      loadDeliveryAreas();
    } else {
      showToast(data.error?.message || 'Failed to update status', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.toggleDeliveryStatus = toggleDeliveryStatus;

async function deleteDeliveryArea(areaId) {
  if (!confirm('Are you sure you want to delete this delivery area?')) return;
  try {
    const res = await fetch(`/api/admin/delivery-areas/${areaId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Delivery area deleted successfully', 'success');
      loadDeliveryAreas();
      loadDashboardStats();
    } else {
      showToast(data.error?.message || 'Failed to delete delivery area', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.deleteDeliveryArea = deleteDeliveryArea;

// Update User display on Dashboard init
const originalShowDashboard = showDashboard;
showDashboard = function() {
  originalShowDashboard();
  switchView('dashboard');
};

// Search filter listeners for Deals, Promotions, and Delivery
const dealsSearchInput = document.getElementById('dealsSearchInput');
if (dealsSearchInput) {
  dealsSearchInput.addEventListener('input', () => {
    dealsPageState.search = dealsSearchInput.value.trim();
    dealsPageState.page = 1;
    renderDealsTable();
  });
}

const promoSearchInput = document.getElementById('promoSearchInput');
if (promoSearchInput) {
  promoSearchInput.addEventListener('input', () => {
    promosPageState.search = promoSearchInput.value.trim();
    promosPageState.page = 1;
    renderPromotionsTable();
  });
}

const deliverySearchInput = document.getElementById('deliverySearchInput');
if (deliverySearchInput) {
  deliverySearchInput.addEventListener('input', () => {
    deliveryPageState.search = deliverySearchInput.value.trim();
    deliveryPageState.page = 1;
    renderDeliveryAreasTable();
  });
}

// ══════════════════════════════════════════════════════════════
// PHASE 4: ORDERS, CUSTOMERS & REAL-TIME STREAM CONTROLLERS
// ══════════════════════════════════════════════════════════════

let currentOrderStatusFilter = 'ALL';
let activeOrdersList = [];
let realtimeEventSource = null;

const VALID_STATUS_TRANSITIONS_MAP = {
  PENDING: [{ to: 'CONFIRMED', label: 'Confirm Order', cls: 'btn-primary' }, { to: 'CANCELLED', label: 'Cancel Order', cls: 'btn-danger' }],
  CONFIRMED: [{ to: 'CANCELLED', label: 'Cancel Order', cls: 'btn-danger' }],
  PREPARING: [{ to: 'READY', label: 'Mark as Ready', cls: 'btn-primary' }, { to: 'CANCELLED', label: 'Cancel Order', cls: 'btn-danger' }],
  READY: [{ to: 'OUT_FOR_DELIVERY', label: 'Dispatch for Delivery', cls: 'btn-primary' }, { to: 'CANCELLED', label: 'Cancel Order', cls: 'btn-danger' }],
  OUT_FOR_DELIVERY: [{ to: 'DELIVERED', label: 'Mark as Delivered', cls: 'btn-primary' }],
  DELIVERED: [],
  CANCELLED: [],
};

// ─── Orders Loader ──────────────────────────────────────────
let ordersPageState = { page: 1, pageSize: 10 };
let _lastRenderedOrdersSignature = '';

function renderOrdersTable(force = false) {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  const orders = activeOrdersList || [];
  const signature = `${ordersPageState.page}:${ordersPageState.pageSize}:${orders.map(o => `${o.orderNumber}:${o.orderStatus}:${o.paymentStatus}:${o.total}`).join('|')}`;
  
  // Skip DOM re-render if data and pagination have not changed (prevents flickering)
  if (!force && signature === _lastRenderedOrdersSignature && tbody.children.length > 0) {
    return;
  }
  _lastRenderedOrdersSignature = signature;

  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No orders found matching criteria.</td></tr>';
    renderPaginationControl({
      containerId: 'ordersPagination',
      totalItems: 0,
      currentPage: 1,
      pageSize: ordersPageState.pageSize,
      onPageSizeChange: (s) => {
        ordersPageState.pageSize = s;
        ordersPageState.page = 1;
        renderOrdersTable(true);
      }
    });
    return;
  }

  const totalPages = Math.ceil(orders.length / ordersPageState.pageSize);
  if (ordersPageState.page > totalPages) ordersPageState.page = totalPages;
  const startIndex = (ordersPageState.page - 1) * ordersPageState.pageSize;
  const pageItems = orders.slice(startIndex, startIndex + ordersPageState.pageSize);

  tbody.innerHTML = '';
  pageItems.forEach(ord => {
    const tr = document.createElement('tr');
    const timeStr = new Date(ord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date(ord.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });

    tr.innerHTML = `
      <td><strong style="color: var(--accent); font-family: var(--f-mono);">${ord.orderNumber}</strong></td>
      <td><strong>${escapeHtml(ord.customerName)}</strong></td>
      <td><span class="subtext">${escapeHtml(ord.phone)}</span></td>
      <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(ord.itemsSummary || '')}">
        <span>${ord.itemCount} items (${escapeHtml(ord.itemsSummary || '')})</span>
      </td>
      <td><strong>Rs. ${Number(ord.total).toLocaleString()}</strong></td>
      <td><span class="badge-tag">${ord.paymentMethod} (${ord.paymentStatus})</span></td>
      <td><span class="badge-order-status ${ord.orderStatus}">${ord.orderStatus}</span></td>
      <td><span class="subtext">${dateStr} ${timeStr}</span></td>
      <td style="text-align: right;">
        <button class="btn btn-secondary btn-sm" onclick="window.openOrderDetailModal('${ord.orderNumber}')">
          View
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPaginationControl({
    containerId: 'ordersPagination',
    totalItems: orders.length,
    currentPage: ordersPageState.page,
    pageSize: ordersPageState.pageSize,
    onPageChange: (p) => {
      ordersPageState.page = p;
      renderOrdersTable(true);
    },
    onPageSizeChange: (s) => {
      ordersPageState.pageSize = s;
      ordersPageState.page = 1;
      renderOrdersTable(true);
    }
  });
}
window.renderOrdersTable = renderOrdersTable;

async function loadOrders(resetPage = false) {
  if (resetPage === true) ordersPageState.page = 1;
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  const searchVal = document.getElementById('ordersSearchInput')?.value?.trim() || '';
  const dateVal = document.getElementById('ordersDateFilter')?.value || '';

  // Only show "Loading orders..." on absolute initial load when tbody has no rows
  if ((!activeOrdersList || activeOrdersList.length === 0) && (!tbody.children || tbody.children.length === 0)) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty">Loading orders...</td></tr>';
  }

  try {
    const params = new URLSearchParams();
    if (currentOrderStatusFilter && currentOrderStatusFilter !== 'ALL') {
      params.set('status', currentOrderStatusFilter);
    }
    if (searchVal) params.set('search', searchVal);
    if (dateVal) params.set('date', dateVal);

    const res = await fetch(`/api/admin/orders?${params.toString()}`);
    const data = await res.json();
    if (!data.success) {
      if (!activeOrdersList || activeOrdersList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="table-empty" style="color: #ff6b6b;">Error: ${data.error}</td></tr>`;
      }
      return;
    }

    const orders = data.data?.orders || [];
    activeOrdersList = orders;

    // Render cleanly without blank flashes
    renderOrdersTable();

    // Cache orders locally in background if no filter active
    if (!searchVal && !dateVal && (!currentOrderStatusFilter || currentOrderStatusFilter === 'ALL')) {
      LocalDB.clear('orders').then(() => {
        if (orders.length > 0) LocalDB.putBatch('orders', orders, true);
      }).catch(() => {});
    }

    // Update nav badge count for active orders
    const activeCount = orders.filter(o => !['DELIVERED', 'CANCELLED'].includes(o.orderStatus)).length;
    const navBadge = document.getElementById('navOrdersBadge');
    if (navBadge) {
      navBadge.textContent = activeCount;
      navBadge.classList.toggle('hidden', activeCount === 0);
    }
  } catch (err) {
    console.warn('Failed to fetch orders, running in cached mode:', err);
    if (!activeOrdersList || activeOrdersList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="table-empty">Offline cache mode active</td></tr>`;
    }
  }
}
window.loadOrders = loadOrders;

async function syncOrdersNow() {
  await loadOrders(true);
}
window.syncOrdersNow = syncOrdersNow;

function filterOrdersByStatus(status) {
  currentOrderStatusFilter = status;
  document.querySelectorAll('.orders-filter-strip .filter-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-status') === status);
  });
  loadOrders(true);
}
window.filterOrdersByStatus = filterOrdersByStatus;

// ─── Order Detail Modal & Transitions ───────────────────────
async function openOrderDetailModal(orderNumber) {
  const modal = document.getElementById('orderDetailModal');
  if (!modal) return;

  try {
    const res = await fetch(`/api/admin/orders/${orderNumber}`);
    const data = await res.json();
    if (!data.success || !data.data) {
      showToast('Order not found', 'error');
      return;
    }

    const ord = data.data;

    // Header info
    document.getElementById('modalOrderNumber').textContent = ord.orderNumber;
    const badge = document.getElementById('modalOrderStatusBadge');
    badge.textContent = ord.orderStatus;
    badge.className = `badge-order-status ${ord.orderStatus}`;

    const dateFormatted = new Date(ord.createdAt).toLocaleString();
    document.getElementById('modalOrderTime').textContent = `Placed: ${dateFormatted}`;

    // Customer
    document.getElementById('modalCustomerName').textContent = ord.customerName || '-';
    document.getElementById('modalCustomerPhone').textContent = ord.phone || '-';
    document.getElementById('modalCustomerWaPhone').textContent = ord.whatsappPhone || '-';

    // Delivery
    document.getElementById('modalDeliveryArea').textContent = ord.delivery?.areaName || 'Standard Delivery Zone';
    document.getElementById('modalDeliveryAddress').textContent = ord.delivery?.address || 'Standard Delivery Area';

    const mapBox = document.getElementById('modalMapsLinkContainer');
    const mapLink = document.getElementById('modalMapsLink');
    if (ord.delivery?.googleMapsUrl) {
      mapLink.href = ord.delivery.googleMapsUrl;
      mapBox.classList.remove('hidden');
    } else {
      mapBox.classList.add('hidden');
    }

    // Payment
    document.getElementById('modalPaymentMethod').textContent = ord.payment?.method || 'COD';
    const payStatusEl = document.getElementById('modalPaymentStatus');
    payStatusEl.textContent = ord.payment?.status || 'PENDING';
    payStatusEl.className = `badge-tag ${ord.payment?.status === 'PAID' ? 'badge-active' : ''}`;

    // Items list (snapshots)
    const itemsTbody = document.getElementById('modalOrderItemsBody');
    itemsTbody.innerHTML = '';
    (ord.items || []).forEach(it => {
      const displayName = it.itemName || it.dealName || 'Menu Item';
      const variantStr = it.variantName ? `<span class="subtext">(${it.variantName})</span>` : '';
      const notesStr = it.notes ? `<div class="subtext" style="color: var(--accent);">Note: ${escapeHtml(it.notes)}</div>` : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(displayName)}</strong> ${variantStr} ${notesStr}</td>
        <td style="text-align: center;">${it.quantity}</td>
        <td style="text-align: right;">Rs. ${Number(it.unitPrice).toLocaleString()}</td>
        <td style="text-align: right;"><strong>Rs. ${Number(it.lineTotal).toLocaleString()}</strong></td>
      `;
      itemsTbody.appendChild(tr);
    });

    // Pricing summary
    document.getElementById('modalOrderSubtotal').textContent = `Rs. ${Number(ord.pricing?.subtotal || 0).toLocaleString()}`;
    document.getElementById('modalOrderDiscount').textContent = `- Rs. ${Number(ord.pricing?.discountTotal || 0).toLocaleString()}`;
    document.getElementById('modalOrderDeliveryFee').textContent = `Rs. ${Number(ord.pricing?.deliveryFee || 0).toLocaleString()}`;
    document.getElementById('modalOrderTotal').textContent = `Rs. ${Number(ord.pricing?.total || 0).toLocaleString()}`;

    // Status Timeline
    const timelineBox = document.getElementById('modalOrderTimeline');
    timelineBox.innerHTML = '';
    (ord.statusHistory || []).forEach(h => {
      const tDiv = document.createElement('div');
      tDiv.className = 'timeline-entry';
      const timeFormatted = new Date(h.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const dateFormatted = new Date(h.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });

      tDiv.innerHTML = `
        <span class="timeline-dot"></span>
        <span class="timeline-title">${h.newStatus}</span>
        <span class="timeline-meta">${dateFormatted} ${timeFormatted} • by ${h.changedByType || 'SYSTEM'}${h.reason ? ' (' + escapeHtml(h.reason) + ')' : ''}</span>
      `;
      timelineBox.appendChild(tDiv);
    });

    // Action buttons: ONLY Cancel Order & Delete Order (plus Close on right)
    const actionsBox = document.getElementById('modalStatusActionButtons');
    actionsBox.innerHTML = '';

    // 1. Cancel Order Button
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-danger-outline';
    if (ord.orderStatus === 'CANCELLED') {
      cancelBtn.textContent = 'Order Cancelled';
      cancelBtn.disabled = true;
      cancelBtn.style.opacity = '0.5';
      cancelBtn.style.cursor = 'not-allowed';
    } else {
      cancelBtn.textContent = 'Cancel Order';
      cancelBtn.onclick = (e) => window.updateOrderStatusAction(ord.orderNumber, 'CANCELLED', e.currentTarget);
    }
    actionsBox.appendChild(cancelBtn);

    // 2. Delete Order Button
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete Order';
    deleteBtn.onclick = (e) => window.deleteOrderAction(ord.orderNumber, e.currentTarget);
    actionsBox.appendChild(deleteBtn);

    modal.classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.openOrderDetailModal = openOrderDetailModal;

function closeOrderDetailModal() {
  const modal = document.getElementById('orderDetailModal');
  if (modal) modal.classList.add('hidden');
}
window.closeOrderDetailModal = closeOrderDetailModal;

async function updateOrderStatusAction(orderNumber, newStatus, triggerBtn = null) {
  if (newStatus === 'CANCELLED') {
    const confirmed = confirm(`Are you sure you want to cancel order ${orderNumber}?`);
    if (!confirmed) return;
  }

  const originalText = triggerBtn ? triggerBtn.textContent : '';
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = 'Updating...';
  }

  try {
    const res = await fetch(`/api/admin/orders/${orderNumber}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Order ${orderNumber} moved to ${newStatus}`, 'success');
      await openOrderDetailModal(orderNumber);
      loadOrders();
      loadDashboardStats();
    } else {
      showToast(data.error?.message || data.error || 'Failed to update order status', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (triggerBtn && triggerBtn.parentNode) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = originalText;
    }
  }
}
window.updateOrderStatusAction = updateOrderStatusAction;

async function deleteOrderAction(orderNumber, triggerBtn = null) {
  const confirmed = confirm(`Are you sure you want to permanently delete order ${orderNumber}? This action cannot be undone.`);
  if (!confirmed) return;

  const originalText = triggerBtn ? triggerBtn.textContent : '';
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = 'Deleting...';
  }

  try {
    const res = await fetch(`/api/admin/orders/${orderNumber}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Order ${orderNumber} deleted successfully`, 'success');
      closeOrderDetailModal();
      loadOrders();
      loadDashboardStats();
    } else {
      showToast(data.error?.message || data.error || 'Failed to delete order', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (triggerBtn && triggerBtn.parentNode) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = originalText;
    }
  }
}
window.deleteOrderAction = deleteOrderAction;

// ─── Customers Controller ───────────────────────────────────
let cachedCustomersList = [];
let customersPageState = { page: 1, pageSize: 10, search: '' };
let activeCustomerDetail = null;

function renderCustomersTable() {
  const tbody = document.getElementById('customersTableBody');
  if (!tbody) return;

  let filtered = cachedCustomersList || [];
  if (customersPageState.search) {
    const q = customersPageState.search.toLowerCase();
    filtered = filtered.filter(c => 
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.phone && c.phone.toLowerCase().includes(q))
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No customer order records found.</td></tr>';
    renderPaginationControl({
      containerId: 'customersPagination',
      totalItems: 0,
      currentPage: 1,
      pageSize: customersPageState.pageSize,
      onPageSizeChange: (s) => {
        customersPageState.pageSize = s;
        customersPageState.page = 1;
        renderCustomersTable();
      }
    });
    return;
  }

  const totalPages = Math.ceil(filtered.length / customersPageState.pageSize);
  if (customersPageState.page > totalPages) customersPageState.page = totalPages;
  const startIndex = (customersPageState.page - 1) * customersPageState.pageSize;
  const pageItems = filtered.slice(startIndex, startIndex + customersPageState.pageSize);

  tbody.innerHTML = '';
  pageItems.forEach(c => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    tr.title = `Click to view full profile & orders for ${escapeHtml(c.name)}`;
    tr.onclick = () => window.openCustomerDetailPage(c.id, c.phone, c.name);

    tr.innerHTML = `
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>${escapeHtml(c.phone)}</td>
      <td><span class="badge-tag badge-active">${escapeHtml(c.whatsappPhone)}</span></td>
      <td><strong>${c.totalOrders}</strong></td>
      <td><span class="subtext">${new Date(c.firstOrder).toLocaleDateString()}</span></td>
      <td><span class="subtext">${new Date(c.lastOrder).toLocaleDateString()}</span></td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-secondary btn-sm btn-view-profile">
          View Profile
        </button>
        <button class="btn btn-danger-outline btn-sm btn-delete-customer" style="margin-left: 6px;" title="Delete customer record">
          🗑️ Delete
        </button>
      </td>
    `;

    const viewBtn = tr.querySelector('.btn-view-profile');
    if (viewBtn) {
      viewBtn.onclick = (e) => {
        e.stopPropagation();
        window.openCustomerDetailPage(c.id, c.phone, c.name);
      };
    }
    const delBtn = tr.querySelector('.btn-delete-customer');
    if (delBtn) {
      delBtn.onclick = (e) => {
        e.stopPropagation();
        window.confirmDeleteCustomer(c.id, c.name, c.phone);
      };
    }
    tbody.appendChild(tr);
  });

  renderPaginationControl({
    containerId: 'customersPagination',
    totalItems: filtered.length,
    currentPage: customersPageState.page,
    pageSize: customersPageState.pageSize,
    onPageChange: (p) => {
      customersPageState.page = p;
      renderCustomersTable();
    },
    onPageSizeChange: (s) => {
      customersPageState.pageSize = s;
      customersPageState.page = 1;
      renderCustomersTable();
    }
  });
}
window.renderCustomersTable = renderCustomersTable;

// ─── Local Database Caching Engine (IndexedDB + Cache-First) ───
// ─── Local Database Caching Engine (IndexedDB + Multi-Module Cache-First) ───
const LocalDB = {
  dbName: 'StoreBotLocalDB',
  version: 2,
  _db: null,

  async init() {
    if (this._db) return this._db;
    if (typeof window === 'undefined' || !window.indexedDB) return null;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 1000);
      try {
        const request = indexedDB.open(this.dbName, this.version);
        request.onblocked = () => {
          clearTimeout(timer);
          resolve(null);
        };
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          const stores = [
            'customers',
            'orders',
            'menu',
            'categories',
            'deals',
            'settings',
            'faqs',
            'dashboard',
            'drafts',
            'metadata'
          ];
          stores.forEach(name => {
            if (!db.objectStoreNames.contains(name)) {
              const keyPath = (name === 'metadata' || name === 'dashboard' || name === 'settings') ? 'key' : 'id';
              const store = db.createObjectStore(name, { keyPath });
              if (name !== 'metadata' && name !== 'dashboard' && name !== 'settings') {
                store.createIndex('updated_at', 'updated_at', { unique: false });
                store.createIndex('is_synced', 'is_synced', { unique: false });
              }
            }
          });
        };
        request.onsuccess = (e) => {
          clearTimeout(timer);
          this._db = e.target.result;
          resolve(this._db);
        };
        request.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
      } catch (_) {
        clearTimeout(timer);
        resolve(null);
      }
    });
  },

  async getAll(storeName) {
    try {
      const db = await this.init();
      if (!db || !db.objectStoreNames || !db.objectStoreNames.contains(storeName)) {
        const raw = localStorage.getItem(`cc_cache_${storeName}`);
        return raw ? JSON.parse(raw) : [];
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const raw = localStorage.getItem(`cc_cache_${storeName}`);
          resolve(raw ? JSON.parse(raw) : []);
        }, 500);
        try {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const req = store.getAll();
          req.onsuccess = () => {
            clearTimeout(timer);
            resolve(req.result || []);
          };
          req.onerror = () => {
            clearTimeout(timer);
            const raw = localStorage.getItem(`cc_cache_${storeName}`);
            resolve(raw ? JSON.parse(raw) : []);
          };
        } catch (_) {
          clearTimeout(timer);
          const raw = localStorage.getItem(`cc_cache_${storeName}`);
          resolve(raw ? JSON.parse(raw) : []);
        }
      });
    } catch {
      const raw = localStorage.getItem(`cc_cache_${storeName}`);
      return raw ? JSON.parse(raw) : [];
    }
  },

  async putBatch(storeName, items, isSynced = true) {
    if (!Array.isArray(items)) items = [items];
    try {
      localStorage.setItem(`cc_cache_${storeName}`, JSON.stringify(items));
      const db = await this.init();
      if (!db || !db.objectStoreNames || !db.objectStoreNames.contains(storeName)) return;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          items.forEach(item => {
            if (!item) return;
            const record = (typeof item === 'object') ? { ...item, is_synced: isSynced } : item;
            store.put(record);
          });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch (_) {
          resolve(false);
        }
      });
    } catch (e) {
      console.warn('LocalDB putBatch warning for ' + storeName, e);
    }
  },

  async clear(storeName) {
    try {
      localStorage.removeItem(`cc_cache_${storeName}`);
      localStorage.removeItem(`cc_last_sync_${storeName}`);
      const db = await this.init();
      if (!db || !db.objectStoreNames || !db.objectStoreNames.contains(storeName)) return;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          store.clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch (_) {
          resolve(false);
        }
      });
    } catch (e) {
      console.warn('LocalDB clear warning for ' + storeName, e);
    }
  },

  async delete(storeName, id) {
    try {
      const raw = localStorage.getItem(`cc_cache_${storeName}`);
      if (raw) {
        try {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const filtered = list.filter(item => {
              if (!item) return false;
              if (item.id && id && item.id === id) return false;
              if (item.phone && id && item.phone === id) return false;
              if (item.whatsappPhone && id && item.whatsappPhone === id) return false;
              return true;
            });
            localStorage.setItem(`cc_cache_${storeName}`, JSON.stringify(filtered));
          }
        } catch (_) {}
      }
      const db = await this.init();
      if (!db) return;
      return new Promise((resolve) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        if (id) {
          try {
            store.delete(id);
          } catch (_) {}
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {
      console.warn('LocalDB delete warning for ' + storeName, e);
    }
  },

  getLastSync(entity = 'global') {
    return localStorage.getItem(`cc_last_sync_${entity}`) || localStorage.getItem('cc_last_sync_time') || null;
  },

  setLastSync(isoTime, entity = 'global') {
    const time = isoTime || new Date().toISOString();
    localStorage.setItem(`cc_last_sync_${entity}`, time);
    localStorage.setItem('cc_last_sync_time', time);
  }
};
window.LocalDB = LocalDB;

function updateSyncStatusBadge() {}

/**
 * Universal Multi-Module Synchronizer: Syncs Master Lookups and Delta Orders
 */
async function syncAllModules(forceSync = false) {
  const syncBtn = document.getElementById('btnSyncAllModules');
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = '🔄 <span>Syncing...</span>';
    syncBtn.classList.remove('btn-synced-active');
  }

  try {
    const lastSyncTime = forceSync ? null : LocalDB.getLastSync('global');
    const url = lastSyncTime 
      ? `/api/admin/sync?last_sync_time=${encodeURIComponent(lastSyncTime)}&entities=all`
      : `/api/admin/sync?entities=all`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.success && data.data) {
      const d = data.data;
      if (d.customers) {
        await LocalDB.clear('customers');
        if (d.customers.length > 0) {
          await LocalDB.putBatch('customers', d.customers, true);
        }
        cachedCustomersList = d.customers || [];
      }
      if (d.orders) await LocalDB.putBatch('orders', d.orders, true);
      if (d.menu) await LocalDB.putBatch('menu', d.menu, true);
      if (d.categories) await LocalDB.putBatch('categories', d.categories, true);
      if (d.deals) await LocalDB.putBatch('deals', d.deals, true);
      if (d.settings) await LocalDB.putBatch('settings', [{ key: 'main', ...d.settings }], true);
      if (d.faqs) await LocalDB.putBatch('faqs', d.faqs, true);
      if (d.dashboard) await LocalDB.putBatch('dashboard', [{ key: 'stats', ...d.dashboard }], true);

      LocalDB.setLastSync(data.serverTime, 'global');
      showToast(`⚡ Sync complete! ${data.totalChanges || 0} delta updates stored.`, 'success');

      if (syncBtn) {
        syncBtn.classList.add('btn-synced-active');
        syncBtn.innerHTML = '✓ <span>Synced</span>';
      }

      // Refresh current view if active
      if (window.currentActiveView === 'customers' && typeof renderCustomersTable === 'function') renderCustomersTable();
      if (window.currentActiveView === 'orders' && typeof renderOrdersTable === 'function') renderOrdersTable();
      if (window.currentActiveView === 'menu' && typeof renderMenuItemsTable === 'function') renderMenuItemsTable();
    }
  } catch (err) {
    console.warn('Sync failed:', err);
    showToast('Offline mode: Using cached database', 'warning');
    if (syncBtn) {
      syncBtn.innerHTML = '⚠️ <span>Offline</span>';
    }
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      setTimeout(() => {
        if (syncBtn) {
          syncBtn.classList.remove('btn-synced-active');
          syncBtn.innerHTML = '⚡ <span>Sync All</span>';
        }
      }, 4000);
    }
  }
}
window.syncAllModules = syncAllModules;

async function loadCustomers(forceSync = false) {
  const tbody = document.getElementById('customersTableBody');
  if (!tbody) return;

  updateSyncStatusBadge('🔄 Syncing...', true);

  try {
    const res = await fetch(`/api/admin/customers?limit=100&_t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    const data = await res.json();

    if (data.success) {
      const incoming = data.data?.customers || data.data || [];
      if (Array.isArray(incoming)) {
        cachedCustomersList = incoming.map(c => ({ ...c, is_synced: true }));
        renderCustomersTable();
        updateSyncStatusBadge(`☁️ Synced (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`);

        LocalDB.clear('customers').then(() => {
          if (cachedCustomersList.length > 0) {
            LocalDB.putBatch('customers', cachedCustomersList, true);
          }
        }).catch(() => {});
        return;
      }
    }

    // Fallback if DB empty or error
    cachedCustomersList = [];
    await LocalDB.clear('customers');
    renderCustomersTable();
    updateSyncStatusBadge('☁️ Synced');
  } catch (err) {
    console.warn('Failed to load customers from server, falling back to cache:', err);
    const localCached = await LocalDB.getAll('customers');
    if (localCached && localCached.length > 0) {
      cachedCustomersList = localCached;
      renderCustomersTable();
      updateSyncStatusBadge('⚠️ Offline Cache');
    } else {
      cachedCustomersList = [];
      renderCustomersTable();
      updateSyncStatusBadge('☁️ Synced');
    }
  }
}
window.loadCustomers = loadCustomers;

async function syncDataNow() {
  await loadCustomers(true);
}
window.syncDataNow = syncDataNow;

// Customers search listener with 200ms debounce and clear button
let customerSearchTimeout = null;
const customersSearchInput = document.getElementById('customersSearchInput');
const customersSearchClearBtn = document.getElementById('customersSearchClearBtn');

function clearCustomerSearch() {
  if (customersSearchInput) {
    customersSearchInput.value = '';
    customersPageState.search = '';
    customersPageState.page = 1;
    renderCustomersTable();
  }
  if (customersSearchClearBtn) customersSearchClearBtn.classList.add('hidden');
}
window.clearCustomerSearch = clearCustomerSearch;

if (customersSearchInput) {
  customersSearchInput.addEventListener('input', () => {
    const val = customersSearchInput.value;
    if (customersSearchClearBtn) {
      if (val.trim()) customersSearchClearBtn.classList.remove('hidden');
      else customersSearchClearBtn.classList.add('hidden');
    }

    clearTimeout(customerSearchTimeout);
    customerSearchTimeout = setTimeout(() => {
      customersPageState.search = val.trim();
      customersPageState.page = 1;
      renderCustomersTable();
    }, 200);
  });
}

// ─── Customer Dedicated Detail Page Controller ──────────────
async function openCustomerDetailPage(id, phone, name) {
  switchView('customerDetail');

  const nameEl = document.getElementById('cdProfileName');
  if (nameEl) nameEl.textContent = name || 'Loading...';
  const tbody = document.getElementById('cdOrdersTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Loading customer profile & orders...</td></tr>';

  let customer = (cachedCustomersList || []).find(c => 
    (id && c.id === id) ||
    (phone && (c.phone === phone || c.whatsappPhone === phone)) || 
    (name && c.name && c.name.toLowerCase() === name.toLowerCase())
  );

  activeCustomerDetail = customer || { id, phone, name };
  window.activeCustomerDetail = activeCustomerDetail;

  const viewCd = document.getElementById('viewCustomerDetail');
  if (viewCd) {
    viewCd.dataset.customerId = id || customer?.id || '';
    viewCd.dataset.customerPhone = phone || customer?.phone || customer?.whatsappPhone || '';
    viewCd.dataset.customerName = name || customer?.name || '';
  }

  if (id) {
    try {
      const res = await fetch(`/api/admin/customers/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.success && data.data) {
        customer = data.data;
        activeCustomerDetail = customer;
        window.activeCustomerDetail = customer;
        if (viewCd) {
          viewCd.dataset.customerId = customer.id || '';
          viewCd.dataset.customerPhone = customer.phone || customer.whatsappPhone || '';
          viewCd.dataset.customerName = customer.name || '';
        }
      }
    } catch (e) {
      console.warn('Failed to load full customer detail:', e);
    }
  }

  renderCustomerDetailPage(customer || activeCustomerDetail);
}
window.openCustomerDetailPage = openCustomerDetailPage;
window.openCustomerDetailModal = openCustomerDetailPage; // Backward compatibility

function renderCustomerDetailPage(customer) {
  if (!customer) return;

  // Header & Avatar
  const nameEl = document.getElementById('cdProfileName');
  if (nameEl) nameEl.textContent = customer.name || 'Anonymous Customer';

  const avatarEl = document.getElementById('cdProfileAvatar');
  if (avatarEl) {
    avatarEl.textContent = (customer.name && customer.name.trim().length > 0) ? customer.name.trim()[0].toUpperCase() : '👤';
  }

  const phoneEl = document.getElementById('cdProfilePhone');
  if (phoneEl) phoneEl.textContent = customer.phone || '-';

  const waEl = document.getElementById('cdProfileWa');
  if (waEl) waEl.textContent = customer.whatsappPhone || customer.phone || '-';

  // Direct WhatsApp Button
  const waBtn = document.getElementById('cdWhatsappDirectBtn');
  if (waBtn) {
    const rawPhone = customer.whatsappPhone || customer.phone || '';
    const cleanPhone = String(rawPhone).replace(/[^\d]/g, '');
    if (cleanPhone && cleanPhone.length >= 10) {
      waBtn.href = `https://wa.me/${cleanPhone}`;
      waBtn.style.display = 'inline-flex';
    } else {
      waBtn.style.display = 'none';
    }
  }

  // Tier Badge
  const tierBadge = document.getElementById('cdProfileTierBadge');
  if (tierBadge) {
    const ordersCount = customer.totalOrders || (customer.orders ? customer.orders.length : 0);
    if (ordersCount >= 3) {
      tierBadge.textContent = '🌟 VIP Customer';
      tierBadge.className = 'badge-tag badge-active';
    } else if (ordersCount > 1) {
      tierBadge.textContent = 'Repeat Customer';
      tierBadge.className = 'badge-tag badge-active';
    } else {
      tierBadge.textContent = 'New Customer';
      tierBadge.className = 'badge-tag';
    }
  }

  // Summary Metrics
  const ordersCount = customer.totalOrders || (customer.orders ? customer.orders.length : 0);
  const totalOrdersEl = document.getElementById('cdTotalOrders');
  if (totalOrdersEl) totalOrdersEl.textContent = ordersCount;

  const totalSpendEl = document.getElementById('cdTotalSpend');
  if (totalSpendEl) totalSpendEl.textContent = `Rs. ${Number(customer.totalSpent || 0).toLocaleString()}`;

  const firstOrderEl = document.getElementById('cdFirstOrder');
  if (firstOrderEl) firstOrderEl.textContent = customer.firstOrder ? new Date(customer.firstOrder).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '-';

  const lastOrderEl = document.getElementById('cdLastOrder');
  if (lastOrderEl) lastOrderEl.textContent = customer.lastOrder ? new Date(customer.lastOrder).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '-';

  // Orders Count Subtext
  const ordersCountSub = document.getElementById('cdOrdersCountSub');
  if (ordersCountSub) ordersCountSub.textContent = `${ordersCount} order${ordersCount === 1 ? '' : 's'} recorded`;

  // Delivery Address Banner
  const addrBanner = document.getElementById('cdDeliveryAddressBanner');
  const addrText = document.getElementById('cdDeliveryAddressText');
  const mapsLink = document.getElementById('cdDeliveryMapsLink');

  let latestAddress = null;
  let latestMapsUrl = null;

  if (customer.orders && customer.orders.length > 0) {
    for (const ord of customer.orders) {
      if (ord.deliveryAddress) {
        latestAddress = ord.deliveryAddress;
        latestMapsUrl = ord.googleMapsUrl || (ord.latitude && ord.longitude ? `https://maps.google.com/?q=${ord.latitude},${ord.longitude}` : null);
        break;
      }
    }
  }

  if (addrBanner) {
    if (latestAddress) {
      addrBanner.style.display = 'flex';
      if (addrText) addrText.textContent = latestAddress;
      if (mapsLink) {
        if (latestMapsUrl) {
          mapsLink.href = latestMapsUrl;
          mapsLink.style.display = 'inline-flex';
        } else {
          mapsLink.style.display = 'none';
        }
      }
    } else {
      addrBanner.style.display = 'none';
    }
  }

  // Orders Table Body
  const tbody = document.getElementById('cdOrdersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!customer.orders || customer.orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No orders found for this customer.</td></tr>';
  } else {
    customer.orders.forEach(ord => {
      const tr = document.createElement('tr');
      const timeStr = new Date(ord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = new Date(ord.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      tr.innerHTML = `
        <td><strong style="color: var(--accent); font-family: var(--f-mono);">${escapeHtml(ord.orderNumber)}</strong></td>
        <td><span class="subtext">${dateStr} ${timeStr}</span></td>
        <td style="max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(ord.itemsSummary || '')}">
          ${escapeHtml(ord.itemsSummary || (ord.itemCount ? ord.itemCount + ' items' : 'View order details'))}
        </td>
        <td><span class="badge-tag">${escapeHtml(ord.paymentMethod || 'COD')} (${escapeHtml(ord.paymentStatus || 'PENDING')})</span></td>
        <td><span class="badge-order-status ${ord.orderStatus}">${ord.orderStatus}</span></td>
        <td style="text-align: right;"><strong>Rs. ${Number(ord.total).toLocaleString()}</strong></td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-sm" onclick="window.openOrderDetailModal('${ord.orderNumber}')">
            View Order
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }
}

async function refreshActiveCustomerDetail() {
  if (!activeCustomerDetail) return;
  await openCustomerDetailPage(activeCustomerDetail.id, activeCustomerDetail.phone, activeCustomerDetail.name);
  showToast('Customer profile refreshed', 'success');
}
window.refreshActiveCustomerDetail = refreshActiveCustomerDetail;

function closeCustomerDetailModal() {
  const modal = document.getElementById('customerDetailModal');
  if (modal) modal.classList.add('hidden');
}
window.closeCustomerDetailModal = closeCustomerDetailModal;

async function confirmDeleteCustomerFromPage() {
  let cust = activeCustomerDetail || window.activeCustomerDetail;
  const viewCd = document.getElementById('viewCustomerDetail');
  
  const idFromDom = viewCd?.dataset?.customerId;
  const phoneFromDom = viewCd?.dataset?.customerPhone || document.getElementById('cdProfilePhone')?.textContent?.trim();
  const waFromDom = document.getElementById('cdProfileWa')?.textContent?.trim();
  const nameFromDom = viewCd?.dataset?.customerName || document.getElementById('cdProfileName')?.textContent?.trim();

  const id = cust?.id || (idFromDom && idFromDom !== 'undefined' ? idFromDom : null);
  const rawPhone = cust?.phone || (phoneFromDom && phoneFromDom !== '-' ? phoneFromDom : null) || (waFromDom && waFromDom !== '-' ? waFromDom : null);
  const name = cust?.name || nameFromDom;

  let phone = rawPhone;
  if (!id && !phone) {
    const matched = (cachedCustomersList || []).find(c => 
      (name && c.name && c.name.toLowerCase() === name.toLowerCase())
    );
    if (matched) {
      cust = matched;
      phone = matched.phone || matched.whatsappPhone;
    }
  }

  const finalId = id || cust?.id;
  const finalPhone = phone || cust?.phone || cust?.whatsappPhone;
  const finalName = name || cust?.name;

  if (!finalId && !finalPhone) {
    showToast('Customer record details not found', 'error');
    return;
  }

  const deleted = await confirmDeleteCustomer(finalId, finalName, finalPhone);
  if (deleted) {
    activeCustomerDetail = null;
    window.activeCustomerDetail = null;
    if (viewCd) {
      delete viewCd.dataset.customerId;
      delete viewCd.dataset.customerPhone;
      delete viewCd.dataset.customerName;
    }
    switchView('customers');
  }
}
window.confirmDeleteCustomerFromPage = confirmDeleteCustomerFromPage;

async function confirmDeleteCustomerFromModal() {
  let cust = activeCustomerDetail || window.activeCustomerDetail;
  if (!cust) {
    showToast('Customer record details not found', 'error');
    return;
  }
  const deleted = await confirmDeleteCustomer(cust.id, cust.name, cust.phone);
  if (deleted) {
    closeCustomerDetailModal();
  }
}
window.confirmDeleteCustomerFromModal = confirmDeleteCustomerFromModal;

// ─── Delete Customer Handlers ─────────────────────────────────
async function confirmDeleteCustomer(customerId, customerName, phone) {
  const displayName = customerName || phone || 'this customer';
  const proceed = confirm(`Are you sure you want to delete customer "${displayName}"?\n\nThis will remove their profile and chat history.`);
  if (!proceed) return false;

  // 1. Optimistic UI update: instantly remove from memory and table
  cachedCustomersList = (cachedCustomersList || []).filter(c => {
    if (customerId && c.id === customerId) return false;
    if (phone && (c.phone === phone || c.whatsappPhone === phone)) return false;
    return true;
  });
  renderCustomersTable();

  // 2. Remove immediately from LocalDB (IndexedDB and localStorage)
  if (customerId) await LocalDB.delete('customers', customerId);
  if (phone) await LocalDB.delete('customers', phone);

  // 3. Close customer detail modal if open
  closeCustomerDetailModal();

  try {
    let res;
    if (customerId) {
      res = await fetch(`/api/admin/customers/${encodeURIComponent(customerId)}?deleteOrders=false`, {
        method: 'DELETE',
      });
    } else if (phone && phone !== '-') {
      res = await fetch(`/api/admin/customers/by-phone/${encodeURIComponent(phone)}?deleteOrders=false`, {
        method: 'DELETE',
      });
    } else {
      showToast('Cannot delete customer without ID or phone', 'error');
      return false;
    }

    const data = await res.json().catch(() => ({}));
    if (res.ok || data.success || data.alreadyDeleted || res.status === 404) {
      showToast(`Customer "${displayName}" deleted successfully!`, 'success');
      await loadCustomers(true);
      return true;
    } else {
      showToast(data.error || 'Failed to delete customer', 'error');
      await loadCustomers(true);
      return false;
    }
  } catch (err) {
    console.error('Delete customer error:', err);
    showToast(`Error deleting customer: ${err.message}`, 'error');
    await loadCustomers(true);
    return false;
  }
}
window.confirmDeleteCustomer = confirmDeleteCustomer;

// ─── Bulk Cleanup / Purge Modal Controller ────────────────────
function openCustomerCleanupModal() {
  const modal = document.getElementById('customerCleanupModal');
  if (modal) modal.classList.remove('hidden');
}
window.openCustomerCleanupModal = openCustomerCleanupModal;

function closeCustomerCleanupModal() {
  const modal = document.getElementById('customerCleanupModal');
  if (modal) modal.classList.add('hidden');
}
window.closeCustomerCleanupModal = closeCustomerCleanupModal;

async function executeCustomerCleanup() {
  const select = document.getElementById('cleanupCriteriaSelect');
  const checkbox = document.getElementById('cleanupDeleteOrdersCheckbox');
  const confirmBtn = document.getElementById('confirmPurgeBtn');

  const criteria = select ? select.value : '90';
  const deleteOrders = checkbox ? checkbox.checked : false;

  const label = criteria === 'all' ? 'ALL customer profiles' : `customers inactive for over ${criteria} days`;
  const proceed = confirm(`⚠️ WARNING: You are about to permanently purge ${label}.\n\nAre you sure you want to proceed?`);
  if (!proceed) return;

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Purging...';
  }

  try {
    const res = await fetch('/api/admin/customers/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        olderThanDays: criteria === 'all' ? 0 : parseInt(criteria, 10),
        deleteOrders,
      }),
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Successfully purged ${data.data?.count || 0} customer records!`, 'success');
      closeCustomerCleanupModal();
      await LocalDB.clear('customers');
      await loadCustomers(true);
    } else {
      showToast(data.error || 'Failed to purge customer records', 'error');
    }
  } catch (err) {
    showToast(`Error during cleanup: ${err.message}`, 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Purge Data Now';
    }
  }
}
window.executeCustomerCleanup = executeCustomerCleanup;

// ─── Real-Time Orders SSE Feed ──────────────────────────────
function initRealtimeOrdersFeed() {
  if (realtimeEventSource) {
    realtimeEventSource.close();
    realtimeEventSource = null;
  }

  const liveBadge = document.getElementById('realtimeLiveBadge');

  try {
    const token = localStorage.getItem('wa_dash_token');
    const streamUrl = token ? `/api/admin/orders/stream?token=${encodeURIComponent(token)}` : '/api/admin/orders/stream';
    realtimeEventSource = new EventSource(streamUrl);

    realtimeEventSource.onopen = () => {
      if (liveBadge) liveBadge.style.display = 'inline-flex';
    };

    realtimeEventSource.addEventListener('order.created', (e) => {
      try {
        const payload = JSON.parse(e.data);
        const orderData = payload.data || {};
        showToast(`🔔 New Order ${orderData.orderNumber || ''} received!`, 'success');
        if (currentActiveView === 'orders' || !currentActiveView) loadOrders();
        loadDashboardStats();
      } catch (err) {
        console.error('SSE order.created parse error:', err);
      }
    });

    realtimeEventSource.addEventListener('order.status_changed', (e) => {
      try {
        const payload = JSON.parse(e.data);
        const orderData = payload.data || {};
        showToast(`Order ${orderData.orderNumber || ''} status updated to ${orderData.newStatus || ''}`, 'info');
        if (currentActiveView === 'orders' || !currentActiveView) loadOrders();
        loadDashboardStats();
      } catch (err) {
        console.error('SSE status_changed parse error:', err);
      }
    });

    realtimeEventSource.addEventListener('order.cancelled', (e) => {
      try {
        const payload = JSON.parse(e.data);
        const orderData = payload.data || {};
        showToast(`Order ${orderData.orderNumber || ''} was cancelled`, 'warning');
        if (currentActiveView === 'orders' || !currentActiveView) loadOrders();
        loadDashboardStats();
      } catch (err) {
        console.error('SSE order.cancelled parse error:', err);
      }
    });

    realtimeEventSource.onmessage = (e) => {
      try {
        if (!e.data || e.data.startsWith(':')) return;
        const payload = JSON.parse(e.data);
        if (payload.event === 'order.created' || payload.event === 'order.status_changed' || payload.event === 'order.cancelled' || payload.event === 'order.deleted') {
          if (currentActiveView === 'orders' || !currentActiveView) loadOrders();
          loadDashboardStats();
        }
      } catch (_) {}
    };

    realtimeEventSource.onerror = () => {
      if (liveBadge) liveBadge.style.display = 'none';
      // Auto-reconnect after 5 seconds
      setTimeout(() => {
        if (isAuthenticated) initRealtimeOrdersFeed();
      }, 5000);
    };
  } catch (err) {
    console.warn('Realtime SSE feed not available:', err);
  }
}

// Search and filter listeners for Orders view
const ordersSearchInput = document.getElementById('ordersSearchInput');
const ordersSearchClearBtn = document.getElementById('ordersSearchClearBtn');

function clearOrdersSearch() {
  if (ordersSearchInput) {
    ordersSearchInput.value = '';
    if (ordersSearchClearBtn) ordersSearchClearBtn.classList.add('hidden');
    loadOrders(true);
  }
}
window.clearOrdersSearch = clearOrdersSearch;

if (ordersSearchInput) {
  ordersSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadOrders(true);
  });
  ordersSearchInput.addEventListener('input', () => {
    const val = ordersSearchInput.value.trim();
    if (ordersSearchClearBtn) {
      if (val) ordersSearchClearBtn.classList.remove('hidden');
      else ordersSearchClearBtn.classList.add('hidden');
    }
    if (!val) loadOrders(true);
  });
}

const ordersDateFilter = document.getElementById('ordersDateFilter');
if (ordersDateFilter) {
  ordersDateFilter.addEventListener('change', () => {
    loadOrders(true);
  });
}

// Start Real-Time Feed upon authentication
const prevShowDashboard = showDashboard;
showDashboard = function() {
  prevShowDashboard();
  initRealtimeOrdersFeed();
};

// ─── Phase 4.5: FAQ & Knowledge Base Management ─────────────────────────

let faqCategoriesCache = [];

async function loadFaqCategoriesForDropdown() {
  const catSelect = document.getElementById('faqCategorySelect');
  const catFilter = document.getElementById('faqCategoryFilter');
  if (!catSelect && !catFilter) return;

  try {
    const res = await fetch('/api/admin/faq-categories');
    const data = await res.json();
    if (!data.success) return;

    faqCategoriesCache = data.data || [];

    if (catSelect) {
      const currentVal = catSelect.value;
      catSelect.innerHTML = '<option value="">Uncategorized</option>' +
        faqCategoriesCache.map(c => `<option value="${c.id}">${c.name}${c.is_active ? '' : ' (Inactive)'}</option>`).join('');
      if (currentVal) catSelect.value = currentVal;
    }

    if (catFilter) {
      const currentFilter = catFilter.value;
      catFilter.innerHTML = '<option value="">All Categories</option>' +
        faqCategoriesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      if (currentFilter) catFilter.value = currentFilter;
    }
  } catch (err) {
    console.error('Failed to load FAQ categories dropdown:', err);
  }
}
window.loadFaqCategoriesForDropdown = loadFaqCategoriesForDropdown;

let cachedFaqsList = [];
let faqsPageState = { page: 1, pageSize: 50 };

function renderFaqsTable() {
  const tbody = document.getElementById('faqsTableBody');
  if (!tbody) return;

  const faqs = cachedFaqsList || [];
  if (faqs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No FAQs found. Click "Add FAQ" to create authoritative bot knowledge.</td></tr>';
    renderPaginationControl({
      containerId: 'faqsPagination',
      totalItems: 0,
      currentPage: 1,
      pageSize: faqsPageState.pageSize,
      onPageSizeChange: (s) => {
        faqsPageState.pageSize = s;
        faqsPageState.page = 1;
        renderFaqsTable();
      }
    });
    return;
  }

  const totalPages = Math.ceil(faqs.length / faqsPageState.pageSize);
  if (faqsPageState.page > totalPages) faqsPageState.page = totalPages;
  const startIndex = (faqsPageState.page - 1) * faqsPageState.pageSize;
  const pageItems = faqs.slice(startIndex, startIndex + faqsPageState.pageSize);

  tbody.innerHTML = pageItems.map(faq => {
    const statusBadge = faq.is_active
      ? `<span class="badge-tag badge-active">Active</span>`
      : `<span class="badge-tag badge-inactive">Inactive</span>`;

    const kwBadges = (faq.keywords && faq.keywords.length > 0)
      ? faq.keywords.slice(0, 3).map(k => `<span class="badge-tag" style="background: var(--surface-2); color: var(--fg); border: 1px solid var(--hairline-2); font-size: 9px; text-transform: none;">${escapeHtml(k)}</span>`).join(' ') +
        (faq.keywords.length > 3 ? ` <span style="font-size: 10px; color: var(--fg-muted);">+${faq.keywords.length - 3}</span>` : '')
      : '<span style="color: var(--fg-faint); font-size: 11px;">None</span>';

    const altQuestionsText = (faq.alternative_questions && faq.alternative_questions.length > 0)
      ? `<div style="font-size: 11px; color: var(--fg-muted); margin-top: 4px; font-style: italic;">Alt: "${escapeHtml(faq.alternative_questions[0])}"${faq.alternative_questions.length > 1 ? ` (+${faq.alternative_questions.length - 1})` : ''}</div>`
      : '';

    const updatedStr = faq.updated_at ? new Date(faq.updated_at).toLocaleDateString() : '-';

    return `
      <tr>
        <td><span class="badge-tag" style="background: var(--surface-2); color: var(--fg);">${faq.sort_order ?? 0}</span></td>
        <td style="max-width: 280px;">
          <div style="font-weight: 600; color: var(--fg); margin-bottom: 2px;">${escapeHtml(faq.question)}</div>
          <div style="font-size: 12px; color: var(--fg-dim); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${escapeHtml(faq.answer)}">
            ${escapeHtml(faq.answer)}
          </div>
        </td>
        <td><span class="badge-tag badge-category">${escapeHtml(faq.category_name || 'Uncategorized')}</span></td>
        <td style="max-width: 220px;">
          <div>${kwBadges}</div>
          ${altQuestionsText}
        </td>
        <td>${statusBadge}</td>
        <td><small style="color: var(--fg-muted);">${updatedStr}</small></td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-secondary btn-xs" onclick="window.openEditFaqModal('${faq.id}')">Edit</button>
          <button class="btn btn-secondary btn-xs" onclick="window.toggleFaqStatus('${faq.id}', ${faq.is_active})">${faq.is_active ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-danger btn-xs" onclick="window.deleteFaq('${faq.id}', '${escapeHtml(faq.question).replace(/'/g, "\\'")}')">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  renderPaginationControl({
    containerId: 'faqsPagination',
    totalItems: faqs.length,
    currentPage: faqsPageState.page,
    pageSize: faqsPageState.pageSize,
    onPageChange: (p) => {
      faqsPageState.page = p;
      renderFaqsTable();
    },
    onPageSizeChange: (s) => {
      faqsPageState.pageSize = s;
      faqsPageState.page = 1;
      renderFaqsTable();
    }
  });
}
window.renderFaqsTable = renderFaqsTable;

async function loadFaqs(resetPage = false) {
  if (resetPage === true) faqsPageState.page = 1;
  const tbody = document.getElementById('faqsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Loading FAQs...</td></tr>';

  try {
    const search = document.getElementById('faqSearchInput')?.value?.trim() || '';
    const category_id = document.getElementById('faqCategoryFilter')?.value || '';
    const is_active = document.getElementById('faqStatusFilter')?.value || '';

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (category_id) params.append('category_id', category_id);
    if (is_active !== '') params.append('is_active', is_active);

    const res = await fetch(`/api/admin/faqs?${params.toString()}`);
    const data = await res.json();

    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: #ff6b6b;">Error: ${data.error?.message}</td></tr>`;
      return;
    }

    const faqs = data.data || [];
    cachedFaqsList = faqs;
    renderFaqsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: #ff6b6b;">Failed: ${err.message}</td></tr>`;
  }
}
window.loadFaqs = loadFaqs;

function openAddFaqModal() {
  document.getElementById('faqModalTitle').textContent = 'Add FAQ';
  document.getElementById('faqEditId').value = '';
  document.getElementById('faqQuestion').value = '';
  document.getElementById('faqAnswer').value = '';
  document.getElementById('faqSortOrder').value = '0';
  document.getElementById('faqKeywords').value = '';
  document.getElementById('faqAlternativeQuestions').value = '';
  document.getElementById('faqIsActive').checked = true;

  loadFaqCategoriesForDropdown();
  document.getElementById('faqModal').classList.remove('hidden');
}
window.openAddFaqModal = openAddFaqModal;

function closeFaqModal() {
  document.getElementById('faqModal').classList.add('hidden');
}
window.closeFaqModal = closeFaqModal;

async function openEditFaqModal(id) {
  try {
    const res = await fetch(`/api/admin/faqs/${id}`);
    const data = await res.json();
    if (!data.success) {
      showToast('Error', data.error?.message || 'Failed to load FAQ', 'error');
      return;
    }

    const faq = data.data;
    document.getElementById('faqModalTitle').textContent = 'Edit FAQ';
    document.getElementById('faqEditId').value = faq.id;
    document.getElementById('faqQuestion').value = faq.question;
    document.getElementById('faqAnswer').value = faq.answer;
    document.getElementById('faqSortOrder').value = faq.sort_order ?? 0;
    document.getElementById('faqKeywords').value = (faq.keywords || []).join(', ');
    document.getElementById('faqAlternativeQuestions').value = (faq.alternative_questions || []).join('\n');
    document.getElementById('faqIsActive').checked = faq.is_active;

    await loadFaqCategoriesForDropdown();
    document.getElementById('faqCategorySelect').value = faq.category_id || '';

    document.getElementById('faqModal').classList.remove('hidden');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}
window.openEditFaqModal = openEditFaqModal;

async function saveFaq() {
  const id = document.getElementById('faqEditId').value;
  const question = document.getElementById('faqQuestion').value.trim();
  const answer = document.getElementById('faqAnswer').value.trim();
  const category_id = document.getElementById('faqCategorySelect').value || null;
  const sort_order = parseInt(document.getElementById('faqSortOrder').value, 10) || 0;
  const keywordsRaw = document.getElementById('faqKeywords').value;
  const alternativeQuestionsRaw = document.getElementById('faqAlternativeQuestions').value;
  const is_active = document.getElementById('faqIsActive').checked;

  if (!question || !answer) {
    showToast('Validation Error', 'Question and Answer are required', 'error');
    return;
  }

  const payload = {
    question,
    answer,
    category_id,
    sort_order,
    keywords: keywordsRaw,
    alternative_questions: alternativeQuestionsRaw,
    is_active,
  };

  try {
    const url = id ? `/api/admin/faqs/${id}` : '/api/admin/faqs';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!data.success) {
      showToast('Error', data.error?.message || 'Failed to save FAQ', 'error');
      return;
    }

    showToast('Success', id ? 'FAQ updated successfully' : 'FAQ created successfully', 'success');
    closeFaqModal();
    loadFaqs();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}
window.saveFaq = saveFaq;

async function toggleFaqStatus(id, currentStatus) {
  try {
    const res = await fetch(`/api/admin/faqs/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !currentStatus }),
    });
    const data = await res.json();
    if (!data.success) {
      showToast('Error', data.error?.message || 'Failed to toggle status', 'error');
      return;
    }
    showToast('Success', `FAQ is now ${data.data.is_active ? 'Active' : 'Disabled'}`, 'success');
    loadFaqs();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}
window.toggleFaqStatus = toggleFaqStatus;

async function deleteFaq(id, question) {
  if (!confirm(`Are you sure you want to delete FAQ:\n"${question}"?`)) return;

  try {
    const res = await fetch(`/api/admin/faqs/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) {
      showToast(data.error?.message || 'Failed to delete FAQ', 'error');
      return;
    }
    showToast('FAQ removed from knowledge base', 'success');
    loadFaqs();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}
window.deleteFaq = deleteFaq;

// ─── FAQ Categories Modal Management ─────────────────────────────────────

function openFaqCategoriesModal() {
  document.getElementById('faqCategoriesModal').classList.remove('hidden');
  resetFaqCatForm();
  loadFaqCategoriesTable();
}
window.openFaqCategoriesModal = openFaqCategoriesModal;

function closeFaqCategoriesModal() {
  document.getElementById('faqCategoriesModal').classList.add('hidden');
  loadFaqCategoriesForDropdown();
}
window.closeFaqCategoriesModal = closeFaqCategoriesModal;

function resetFaqCatForm() {
  document.getElementById('faqCatFormTitle').textContent = 'Add New Category';
  document.getElementById('faqCatEditId').value = '';
  document.getElementById('faqCatName').value = '';
  document.getElementById('faqCatDescription').value = '';
  document.getElementById('faqCatSortOrder').value = '0';
  document.getElementById('faqCatIsActive').checked = true;
  document.getElementById('faqCatSaveBtn').textContent = 'Save Category';
}
window.resetFaqCatForm = resetFaqCatForm;

async function loadFaqCategoriesTable() {
  const tbody = document.getElementById('faqCategoriesTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Loading categories...</td></tr>';

  try {
    const res = await fetch('/api/admin/faq-categories');
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty" style="color: #ff6b6b;">Error: ${data.error?.message}</td></tr>`;
      return;
    }

    const categories = data.data || [];
    if (categories.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No categories yet. Use the form above to add one.</td></tr>';
      return;
    }

    tbody.innerHTML = categories.map(c => {
      const statusBadge = c.is_active
        ? `<span class="badge-tag badge-active">Active</span>`
        : `<span class="badge-tag badge-inactive">Inactive</span>`;

      return `
        <tr>
          <td><span class="badge-tag" style="background: var(--surface-2);">${c.sort_order ?? 0}</span></td>
          <td><strong>${c.name}</strong></td>
          <td><small style="opacity: 0.7;">${c.slug}</small></td>
          <td><span class="badge-tag badge-category">${c.faqs_count ?? 0} FAQs</span></td>
          <td>${statusBadge}</td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn btn-secondary btn-xs" onclick="window.editFaqCategory('${c.id}')">Edit</button>
            <button class="btn btn-secondary btn-xs" onclick="window.toggleFaqCategoryStatus('${c.id}', ${c.is_active})">${c.is_active ? 'Disable' : 'Enable'}</button>
            <button class="btn btn-danger btn-xs" onclick="window.deleteFaqCategory('${c.id}', '${c.name.replace(/'/g, "\\'")}', ${c.faqs_count ?? 0})">Delete</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty" style="color: #ff6b6b;">Failed: ${err.message}</td></tr>`;
  }
}
window.loadFaqCategoriesTable = loadFaqCategoriesTable;

async function editFaqCategory(id) {
  try {
    const res = await fetch(`/api/admin/faq-categories/${id}`);
    const data = await res.json();
    if (!data.success) {
      showToast('Error', data.error?.message || 'Failed to load category', 'error');
      return;
    }

    const cat = data.data;
    document.getElementById('faqCatFormTitle').textContent = `Edit Category: ${cat.name}`;
    document.getElementById('faqCatEditId').value = cat.id;
    document.getElementById('faqCatName').value = cat.name;
    document.getElementById('faqCatDescription').value = cat.description || '';
    document.getElementById('faqCatSortOrder').value = cat.sort_order ?? 0;
    document.getElementById('faqCatIsActive').checked = cat.is_active;
    document.getElementById('faqCatSaveBtn').textContent = 'Update Category';
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}
window.editFaqCategory = editFaqCategory;

async function saveFaqCategory() {
  const id = document.getElementById('faqCatEditId').value;
  const name = document.getElementById('faqCatName').value.trim();
  const description = document.getElementById('faqCatDescription').value.trim();
  const sort_order = parseInt(document.getElementById('faqCatSortOrder').value, 10) || 0;
  const is_active = document.getElementById('faqCatIsActive').checked;

  if (!name) {
    showToast('Validation Error', 'Category name is required', 'error');
    return;
  }

  const payload = {
    name,
    description: description || null,
    sort_order,
    is_active,
  };

  try {
    const url = id ? `/api/admin/faq-categories/${id}` : '/api/admin/faq-categories';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!data.success) {
      showToast('Error', data.error?.message || 'Failed to save category', 'error');
      return;
    }

    showToast('Success', id ? 'Category updated' : 'Category created', 'success');
    resetFaqCatForm();
    loadFaqCategoriesTable();
    loadFaqCategoriesForDropdown();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}
window.saveFaqCategory = saveFaqCategory;

async function toggleFaqCategoryStatus(id, currentStatus) {
  try {
    const res = await fetch(`/api/admin/faq-categories/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !currentStatus }),
    });
    const data = await res.json();
    if (!data.success) {
      showToast('Error', data.error?.message || 'Failed to toggle status', 'error');
      return;
    }
    showToast('Success', `Category status changed`, 'success');
    loadFaqCategoriesTable();
    loadFaqCategoriesForDropdown();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}
window.toggleFaqCategoryStatus = toggleFaqCategoryStatus;

async function deleteFaqCategory(id, name, faqsCount) {
  let promptMsg = `Are you sure you want to delete category "${name}"?`;
  let force = false;

  if (faqsCount > 0) {
    const confirmForce = confirm(
      `Category "${name}" has ${faqsCount} FAQ(s) assigned to it.\n\nClick OK to unassign FAQs and safely delete category, or Cancel to abort.`
    );
    if (!confirmForce) return;
    force = true;
  } else {
    if (!confirm(promptMsg)) return;
  }

  try {
    const url = `/api/admin/faq-categories/${id}${force ? '?force=true' : ''}`;
    const res = await fetch(url, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) {
      showToast(data.error?.message || 'Failed to delete category', 'error');
      return;
    }
    showToast('Category removed successfully', 'success');
    loadFaqCategoriesTable();
    loadFaqCategoriesForDropdown();
    loadFaqs();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}
window.deleteFaqCategory = deleteFaqCategory;

// Attach event listeners for FAQ controls
document.addEventListener('DOMContentLoaded', () => {
  const openAddFaqBtn = document.getElementById('openAddFaqBtn');
  if (openAddFaqBtn) openAddFaqBtn.addEventListener('click', openAddFaqModal);

  const openFaqCategoriesBtn = document.getElementById('openFaqCategoriesBtn');
  if (openFaqCategoriesBtn) openFaqCategoriesBtn.addEventListener('click', openFaqCategoriesModal);

  const faqForm = document.getElementById('faqForm');
  if (faqForm) faqForm.addEventListener('submit', (e) => { e.preventDefault(); saveFaq(); });

  const faqCatForm = document.getElementById('faqCatForm');
  if (faqCatForm) faqCatForm.addEventListener('submit', (e) => { e.preventDefault(); saveFaqCategory(); });

  const faqSearchInput = document.getElementById('faqSearchInput');
  if (faqSearchInput) {
    let debounceTimer;
    faqSearchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadFaqs(true), 350);
    });
  }

  const faqCategoryFilter = document.getElementById('faqCategoryFilter');
  if (faqCategoryFilter) faqCategoryFilter.addEventListener('change', () => loadFaqs(true));

  const faqStatusFilter = document.getElementById('faqStatusFilter');
  if (faqStatusFilter) faqStatusFilter.addEventListener('change', () => loadFaqs(true));
});

// Also initialize listeners immediately in case DOMContentLoaded already fired
const openAddFaqBtn = document.getElementById('openAddFaqBtn');
if (openAddFaqBtn) openAddFaqBtn.addEventListener('click', openAddFaqModal);

const openFaqCategoriesBtn = document.getElementById('openFaqCategoriesBtn');
if (openFaqCategoriesBtn) openFaqCategoriesBtn.addEventListener('click', openFaqCategoriesModal);

const faqForm = document.getElementById('faqForm');
if (faqForm) faqForm.addEventListener('submit', (e) => { e.preventDefault(); saveFaq(); });

const faqCatForm = document.getElementById('faqCatForm');
if (faqCatForm) faqCatForm.addEventListener('submit', (e) => { e.preventDefault(); saveFaqCategory(); });

const faqSearchInput = document.getElementById('faqSearchInput');
if (faqSearchInput) {
  let debounceTimer;
  faqSearchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadFaqs(true), 350);
  });
}

const faqCategoryFilter = document.getElementById('faqCategoryFilter');
if (faqCategoryFilter) faqCategoryFilter.addEventListener('change', () => loadFaqs(true));

const faqStatusFilter = document.getElementById('faqStatusFilter');
if (faqStatusFilter) faqStatusFilter.addEventListener('change', () => loadFaqs(true));

// ══════════════════════════════════════════════════════════════════════════════
//  CUSTOMER CHATS MODULE (SUPER ADMIN EXCLUSIVE)
// ══════════════════════════════════════════════════════════════════════════════
let activeChatCustomer = null;
let chatPollTimer = null;

async function loadConversations(searchQuery = '') {
  if (currentUserRole !== 'SUPER_ADMIN') return;
  const container = document.getElementById('chatsConversationsList');
  if (!container) return;

  try {
    const q = searchQuery || (document.getElementById('chatsSearchInput') ? document.getElementById('chatsSearchInput').value : '');
    const url = `/api/admin/chats/conversations${q ? `?search=${encodeURIComponent(q)}` : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.success) {
      container.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--fg-muted); font-size: 13px;">${escapeHtml(data.error || 'Failed to load conversations')}</div>`;
      return;
    }

    const conversations = data.data?.conversations || [];
    if (conversations.length === 0) {
      container.innerHTML = `<div style="padding: 28px 16px; text-align: center; color: var(--fg-muted); font-size: 13px;">No customer chats recorded yet.</div>`;
      return;
    }

    container.innerHTML = '';
    conversations.forEach(c => {
      const item = document.createElement('div');
      const isSelected = activeChatCustomer && activeChatCustomer.chatId === c.chatId;
      item.className = 'chat-conv-item' + (isSelected ? ' selected' : '');
      item.setAttribute('data-selected', isSelected ? 'true' : 'false');

      const displayName = c.customerName && c.customerName !== 'Customer' ? c.customerName : (c.phone ? `Customer (+${c.phone})` : 'Customer');
      const displayPhone = c.phone || c.chatId.split('@')[0];
      const initial = (c.customerName && c.customerName !== 'Customer' ? c.customerName : displayPhone).replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || 'C';
      const timeStr = c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      item.innerHTML = `
        <div class="conv-avatar">
          ${escapeHtml(initial)}
        </div>
        <div class="conv-content">
          <div class="conv-top-row">
            <strong class="conv-name">${escapeHtml(displayName)}</strong>
            <span class="conv-time">${escapeHtml(timeStr)}</span>
          </div>
          <div class="conv-phone">
            +${escapeHtml(displayPhone)}
          </div>
          <div class="conv-bottom-row">
            <span class="conv-snippet">
              ${escapeHtml(c.lastMessage || '')}
            </span>
            <span class="chat-conv-badge">${c.totalMessages}</span>
          </div>
        </div>
      `;

      item.addEventListener('click', () => {
        openCustomerChatThread(c);
      });
      container.appendChild(item);
    });

  } catch (err) {
    console.error('Error loading conversations:', err);
  }
}
window.loadConversations = loadConversations;

async function openCustomerChatThread(customer) {
  activeChatCustomer = customer;
  
  // Re-render conversations list to update active highlight
  loadConversations();

  // Update Chat Header
  const headerName = document.getElementById('chatActiveName');
  const headerPhone = document.getElementById('chatActivePhone');
  const headerAvatar = document.getElementById('chatActiveAvatar');
  const badge = document.getElementById('chatActiveStatusBadge');

  const resolvedName = customer.customerName && customer.customerName !== 'Customer' ? customer.customerName : (customer.phone ? `Customer (${customer.phone})` : 'Customer');
  const resolvedPhone = customer.phone || customer.chatId.split('@')[0];

  if (headerName) headerName.textContent = resolvedName;
  if (headerPhone) headerPhone.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block; vertical-align:middle; margin-right:4px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>+${resolvedPhone}`;
  if (headerAvatar) headerAvatar.textContent = resolvedName.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || 'C';
  if (badge) {
    badge.style.display = 'inline-flex';
    badge.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> <span>VERIFIED WHATSAPP</span>`;
  }

  await fetchAndRenderChatMessages(customer.chatId);
}
window.openCustomerChatThread = openCustomerChatThread;

async function fetchAndRenderChatMessages(chatId) {
  const thread = document.getElementById('chatMessagesThread');
  const countLabel = document.getElementById('chatMsgCountLabel');
  if (!thread || !chatId) return;

  try {
    const res = await fetch(`/api/admin/chats/conversations/${encodeURIComponent(chatId)}/messages`);
    const data = await res.json();
    if (!data.success) return;

    const messages = data.data?.messages || [];
    if (countLabel) countLabel.textContent = `${messages.length} messages`;

    thread.innerHTML = '';
    if (messages.length === 0) {
      thread.innerHTML = '<div style="text-align: center; color: var(--fg-muted); padding: 40px;">No messages recorded yet for this customer.</div>';
      return;
    }

    messages.forEach(m => {
      const isUser = m.sender === 'user';
      const bubbleRow = document.createElement('div');
      bubbleRow.className = `chat-bubble-row ${isUser ? 'chat-row-user' : 'chat-row-bot'}`;

      const timeStr = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      // Authoritative customer name: The conversation/thread's confirmed customer name takes full precedence
      const threadName = (activeChatCustomer?.customerName && activeChatCustomer.customerName !== 'Customer' && !activeChatCustomer.customerName.startsWith('Customer ('))
        ? activeChatCustomer.customerName.trim()
        : null;

      const bubbleCustomerName = (isUser && threadName)
        ? threadName
        : ((m.customerName && m.customerName !== 'Customer' && !m.customerName.startsWith('Customer ('))
            ? m.customerName.trim()
            : (threadName || 'Customer'));

      bubbleRow.innerHTML = `
        <div class="chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-bot'}">
          <div class="chat-meta">
            <span class="chat-name">${isUser ? `👤 ${escapeHtml(bubbleCustomerName)}` : '🍔 Burger Raja'}</span>
            <span class="chat-time">${escapeHtml(timeStr)}${!isUser ? ' <span class="chat-checkmarks">✔✔</span>' : ''}</span>
          </div>
          <div class="chat-body">${escapeHtml(m.message)}</div>
        </div>
      `;
      thread.appendChild(bubbleRow);
    });

    // Auto-scroll to bottom of thread
    thread.scrollTop = thread.scrollHeight;
  } catch (err) {
    console.error('Failed to load chat messages:', err);
  }
}
window.fetchAndRenderChatMessages = fetchAndRenderChatMessages;

// Send manual reply from chat input bar
async function sendManualChatMessage() {
  const input = document.getElementById('chatInputMessage');
  if (!input || !activeChatCustomer) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  try {
    const res = await fetch(`/api/admin/chats/conversations/${encodeURIComponent(activeChatCustomer.chatId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchAndRenderChatMessages(activeChatCustomer.chatId);
      loadConversations();
    } else {
      if (typeof showToast === 'function') showToast(data.error || 'Failed to send message', 'error');
    }
  } catch (err) {
    console.error('Error sending chat message:', err);
    if (typeof showToast === 'function') showToast('Failed to send message', 'error');
  }
}

const chatSendButton = document.getElementById('chatSendButton');
if (chatSendButton) {
  chatSendButton.addEventListener('click', sendManualChatMessage);
}
const chatInputMessage = document.getElementById('chatInputMessage');
if (chatInputMessage) {
  chatInputMessage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendManualChatMessage();
    }
  });
}

// Event listeners for chats toolbar
const chatsRefreshBtn = document.getElementById('chatsRefreshBtn');
if (chatsRefreshBtn) {
  chatsRefreshBtn.addEventListener('click', () => {
    loadConversations();
    if (activeChatCustomer) fetchAndRenderChatMessages(activeChatCustomer.chatId);
  });
}

const chatsSearchInput = document.getElementById('chatsSearchInput');
if (chatsSearchInput) {
  let searchTimer;
  chatsSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      loadConversations(e.target.value.trim());
    }, 300);
  });
}



