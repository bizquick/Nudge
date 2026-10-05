import { SUPABASE_URL, ANON_KEY } from './config.js';

// The Addly panel in Chrome's toolbar. Sign in once; after that it keeps a private
// send-key (like the iPhone Share menu does) and sends the page you're on to the
// friends you pick, through Addly's "share-nudge" server function.

// Outside Chrome (opening this file directly), fall back to a stand-in so the panel can be previewed
const hasChrome = typeof chrome !== 'undefined' && chrome.storage;
const store = {
  async get() {
    if (hasChrome) return (await chrome.storage.local.get(['addly', 'pending']));
    return { addly: JSON.parse(localStorage.getItem('addly') || 'null'), pending: null };
  },
  async set(addly) {
    if (hasChrome) await chrome.storage.local.set({ addly });
    else localStorage.setItem('addly', JSON.stringify(addly));
  },
  async clearPending() { if (hasChrome) await chrome.storage.local.remove('pending'); },
  async clear() { if (hasChrome) await chrome.storage.local.clear(); else localStorage.removeItem('addly'); },
};

const $ = (id) => document.getElementById(id);
const show = (id) => ['signin', 'send', 'sent'].forEach(s => { $(s).hidden = s !== id; });

let account = null;          // { key, me, contacts, refreshToken }
let page = { url: '', title: '', image: '' };
const picked = new Set();
let saveToSelf = false;

// ---- Talking to Addly ----
async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token || ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = data?.error_description || data?.msg || data?.message || data?.error || 'Something went wrong';
    throw new Error(message);
  }
  return data;
}

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
  account = { key, me, contacts, refreshToken: session.refresh_token };
  await store.set(account);
}

async function refreshFriends() {
  if (!account?.refreshToken) return;
  const session = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: account.refreshToken } });
  account.contacts = await loadContacts(session.access_token, account.me);
  account.refreshToken = session.refresh_token;
  await store.set(account);
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
    await api('/functions/v1/share-nudge', {
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
  const { addly, pending } = await store.get();
  account = addly;
  if (!account?.key) { show('signin'); return; }
  show('send');
  $('me').textContent = account.me;
  await loadPage(pending);
  renderPeople();
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
$('search').addEventListener('input', renderPeople);
$('signout').addEventListener('click', async (e) => {
  e.preventDefault();
  if (account?.key) {
    try { await api('/rest/v1/rpc/revoke_share_key', { method: 'POST', body: { p_key: account.key } }); } catch { /* forget it locally either way */ }
  }
  await store.clear();
  account = null;
  picked.clear();
  show('signin');
});
$('refresh').addEventListener('click', async (e) => {
  e.preventDefault();
  try { await refreshFriends(); renderPeople(); } catch { $('send-error').textContent = 'Sign out and back in to refresh your friends.'; $('send-error').hidden = false; }
});

start();
