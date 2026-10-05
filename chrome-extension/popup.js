import { api, loadAccount, saveAccount, loadInbox, checkNudge, updateBadge } from './session.js';

// The Addly panel in Chrome's toolbar. Sign in once; after that it keeps a private
// send-key (like the iPhone Share menu does) and sends the page you're on to the
// friends you pick, through Addly's "share-nudge" server function.

// Outside Chrome (opening this file directly), fall back to a stand-in so the panel can be previewed
const hasChrome = typeof chrome !== 'undefined' && chrome.storage;
const store = {
  async get() {
    const addly = await loadAccount();
    if (hasChrome) { const { pending, tab } = await chrome.storage.local.get(['pending', 'tab']); return { addly, pending, tab }; }
    return { addly, pending: null, tab: localStorage.getItem('addly.tab') };
  },
  set: saveAccount,
  async setTab(tab) { if (hasChrome) await chrome.storage.local.set({ tab }); else localStorage.setItem('addly.tab', tab); },
  async clearPending() { if (hasChrome) await chrome.storage.local.remove('pending'); },
  async clear() { if (hasChrome) await chrome.storage.local.clear(); else localStorage.removeItem('addly'); },
};

const $ = (id) => document.getElementById(id);
const show = (id) => ['signin', 'send', 'sent'].forEach(s => { $(s).hidden = s !== id; });

let account = null;          // { key, me, contacts, refreshToken }
let page = { url: '', title: '', image: '' };
const picked = new Set();
let saveToSelf = false;

// The people you've sent nudges to or gotten them from, most recent first
async function loadContacts(token, me) {
  const rows = await api('/rest/v1/reminders?select=sender,recipients,created_at&order=created_at.desc&limit=400', { token });
  const seen = [];
  for (const r of rows || []) {
    for (const p of [r.sender, ...(r.recipients || [])]) {
      if (p && p !== me && !seen.includes(p)) seen.push(p);
    }
  }
  return seen;
}

async function signIn(email, password) {
  const session = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  const token = session.access_token;
  const profiles = await api(`/rest/v1/profiles?select=display_name&id=eq.${session.user.id}`, { token });
  const me = profiles?.[0]?.display_name;
  if (!me) throw new Error('Finish setting up your account in the Addly app first.');
  const key = await api('/rest/v1/rpc/create_share_key', { method: 'POST', token, body: {} });
  const contacts = await loadContacts(token, me);
  account = {
    key, me, contacts,
    refreshToken: session.refresh_token,
    accessToken: session.access_token,
    expiresAt: Date.now() + (session.expires_in || 3600) * 1000,
  };
  await store.set(account);
}

async function refreshFriends() {
  const { accessToken } = await import('./session.js');
  const token = await accessToken();
  if (!token) throw new Error('sign in again');
  account = await loadAccount();
  account.contacts = await loadContacts(token, account.me);
  await store.set(account);
}

// ---- Inbox: the nudges waiting for you ----
function ago(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ytThumb(url) {
  try {
    const u = new URL(url);
    const id = u.hostname.endsWith('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v');
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
  } catch { return ''; }
}

let inboxItems = [];
function renderInbox() {
  const box = $('inbox');
  box.textContent = '';
  $('inbox-count').textContent = String(inboxItems.length);
  $('inbox-count').hidden = inboxItems.length === 0;
  updateBadge(inboxItems.length);
  if (!inboxItems.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = "You're all caught up. Nice!";
    box.appendChild(p);
    return;
  }
  for (const r of inboxItems) {
    const row = document.createElement('div');
    row.className = 'item';
    const pic = document.createElement('div');
    pic.className = 'pic';
    const photo = (r.attachments || []).find(a => (a.type || '').startsWith('image/'))?.url;
    const image = photo || r.preview_image || ytThumb(r.url || '');
    if (image) pic.style.backgroundImage = `url("${image.replace(/"/g, '%22')}")`;
    else pic.textContent = Array.isArray(r.todo_items) ? '☑' : (r.sender[0] || '?').toUpperCase();
    const body = document.createElement('div');
    body.className = 'body';
    const t = document.createElement('p');
    t.className = 't';
    t.textContent = (r.prioritized_at ? '🤯 ' : '') + (r.title || r.url || 'Nudge');
    const sub = document.createElement('p');
    sub.className = 's';
    const from = r.sender === account.me ? 'You' : r.sender;
    sub.textContent = [r.group_name || from, ago(r.created_at), Array.isArray(r.todo_items) ? `To-do ${r.todo_items.filter(i => i.done).length}/${r.todo_items.length}` : ''].filter(Boolean).join(' · ');
    body.append(t, sub);
    if (r.content && r.content !== r.title) {
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = `“${r.content.slice(0, 140)}”`;
      note.hidden = true;
      body.appendChild(note);
    }
    // Tap: open the link in a new tab (or show the note if there's no link)
    body.addEventListener('click', () => {
      if (r.url && hasChrome) chrome.tabs.create({ url: r.url });
      else if (r.url) window.open(r.url, '_blank');
      else { const n = body.querySelector('.note'); if (n) n.hidden = !n.hidden; }
    });
    const check = document.createElement('button');
    check.className = 'check';
    check.type = 'button';
    check.textContent = '✓ Checked';
    check.title = 'Check it off (just for you)';
    check.addEventListener('click', async () => {
      check.disabled = true;
      try {
        await checkNudge(r.id);
        row.classList.add('leaving');
        setTimeout(() => { inboxItems = inboxItems.filter(x => x.id !== r.id); renderInbox(); }, 250);
      } catch {
        check.disabled = false;
        check.textContent = 'Try again';
      }
    });
    row.append(pic, body, check);
    box.appendChild(row);
  }
}

async function loadAndRenderInbox() {
  const box = $('inbox');
  if (!inboxItems.length) box.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const items = await loadInbox();
    if (items === null) { box.innerHTML = '<p class="empty">Sign out and back in to see your inbox.</p>'; return; }
    inboxItems = items;
    renderInbox();
  } catch {
    box.innerHTML = '<p class="empty">Couldn\u2019t load your inbox. Check your connection.</p>';
  }
}

function selectTab(which) {
  $('tab-inbox').setAttribute('aria-selected', String(which === 'inbox'));
  $('tab-send').setAttribute('aria-selected', String(which === 'send'));
  $('inbox-pane').hidden = which !== 'inbox';
  $('send-pane').hidden = which !== 'send';
  store.setTab(which);
}

// ---- The page you're on ----
async function loadPage(pending) {
  if (pending?.url) {
    page = { url: pending.url, title: pending.title || '', image: '' };
    await store.clearPending();
    if (hasChrome) chrome.action.setBadgeText({ text: '' });
  } else if (hasChrome) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    page = { url: tab?.url || '', title: tab?.title || '', image: '' };
    // The page's own share picture and title, if it has them
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          image: document.querySelector('meta[property="og:image"], meta[name="twitter:image"]')?.content || '',
          title: document.querySelector('meta[property="og:title"]')?.content || document.title || '',
        }),
      });
      if (result?.image) page.image = new URL(result.image, tab.url).href;
      if (result?.title) page.title = result.title;
    } catch { /* Chrome's own pages can't be read; that's fine */ }
  } else {
    page = { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up', image: '' };
  }
  const sendable = /^https?:\/\//.test(page.url);
  $('page-title').textContent = sendable ? (page.title || page.url) : "This page can't be sent";
  let host = '';
  try { host = new URL(page.url).hostname.replace(/^www\./, ''); } catch { /* not a web page */ }
  $('page-host').textContent = host;
  if (page.image) { $('thumb-img').src = page.image; $('thumb-img').hidden = false; }
  return sendable;
}

// ---- Picking people ----
function initials(name) {
  return name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
}

function personButton(name, sub, on, avatarText, onClick) {
  const b = document.createElement('button');
  b.className = 'person';
  b.type = 'button';
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.innerHTML = '<span class="avatar"></span><span class="name"></span><span class="tick"></span>';
  b.querySelector('.avatar').textContent = avatarText;
  b.querySelector('.name').textContent = name;
  if (sub) { const s = document.createElement('small'); s.textContent = sub; b.querySelector('.name').appendChild(s); }
  b.addEventListener('click', onClick);
  return b;
}

function renderPeople() {
  const list = $('people');
  list.textContent = '';
  const q = $('search').value.trim().toLowerCase();
  list.appendChild(personButton('My Nudges', 'Save it for yourself', saveToSelf, '★', () => { saveToSelf = !saveToSelf; renderPeople(); }));
  const names = (account.contacts || []).filter(n => !q || n.toLowerCase().includes(q));
  for (const name of names) {
    list.appendChild(personButton(name, '', picked.has(name), initials(name), () => {
      if (picked.has(name)) picked.delete(name); else picked.add(name);
      renderPeople();
    }));
  }
  if (!(account.contacts || []).length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Send someone a nudge in the Addly app first, and they’ll show up here.';
    list.appendChild(p);
  }
  $('search').hidden = (account.contacts || []).length <= 8;
  $('send-button').disabled = !(picked.size || saveToSelf) || !/^https?:\/\//.test(page.url);
}

async function send() {
  $('send-button').disabled = true;
  $('send-button').textContent = 'Sending…';
  $('send-error').hidden = true;
  try {
    await api('/functions/v1/smooth-function', {
      method: 'POST',
      body: {
        key: account.key,
        recipients: [...picked],
        saveToSelf,
        text: $('note').value.trim(),
        url: page.url,
        title: page.title,
      },
    });
    show('sent');
    setTimeout(() => window.close(), 1100);
  } catch (err) {
    $('send-error').textContent = /sign in/i.test(err.message) ? 'Please sign in again.' : err.message;
    $('send-error').hidden = false;
    $('send-button').textContent = 'Send';
    $('send-button').disabled = false;
  }
}

// ---- Start ----
async function start() {
  const { addly, pending, tab } = await store.get();
  account = addly;
  if (!account?.key) { show('signin'); return; }
  show('send');
  $('me').textContent = account.me;
  const sendable = await loadPage(pending);
  renderPeople();
  // Right-clicked "Send to Addly", or on a page that can't be sent? Pick the sensible tab
  selectTab(pending?.url ? 'send' : !sendable ? 'inbox' : (tab === 'inbox' ? 'inbox' : 'send'));
  loadAndRenderInbox();
}

$('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('signin-error').hidden = true;
  $('signin-button').disabled = true;
  $('signin-button').textContent = 'Signing in…';
  try {
    await signIn($('email').value.trim(), $('password').value);
    $('password').value = '';
    await start();
  } catch (err) {
    $('signin-error').textContent = /invalid/i.test(err.message) ? 'That email and password don’t match an Addly account.' : err.message;
    $('signin-error').hidden = false;
  } finally {
    $('signin-button').disabled = false;
    $('signin-button').textContent = 'Sign in';
  }
});
$('send-button').addEventListener('click', send);
$('tab-inbox').addEventListener('click', () => { selectTab('inbox'); loadAndRenderInbox(); });
$('tab-send').addEventListener('click', () => selectTab('send'));
$('search').addEventListener('input', renderPeople);
$('signout').addEventListener('click', async (e) => {
  e.preventDefault();
  if (account?.key) {
    try { await api('/rest/v1/rpc/revoke_share_key', { method: 'POST', body: { p_key: account.key } }); } catch { /* forget it locally either way */ }
  }
  await store.clear();
  updateBadge(0);
  account = null;
  picked.clear();
  show('signin');
});
$('refresh').addEventListener('click', async (e) => {
  e.preventDefault();
  try { await refreshFriends(); renderPeople(); } catch { $('send-error').textContent = 'Sign out and back in to refresh your friends.'; $('send-error').hidden = false; }
});

start();
