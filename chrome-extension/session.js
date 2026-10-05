import { SUPABASE_URL, ANON_KEY } from './config.js';

// Shared by the panel and the background badge: talking to Addly as you.
// Sending uses the private send-key; reading your inbox uses a normal sign-in session,
// which is refreshed here as needed (and saved, since each refresh gives a new token).

const hasChrome = typeof chrome !== 'undefined' && chrome.storage;

export async function loadAccount() {
  if (hasChrome) return (await chrome.storage.local.get('addly')).addly || null;
  try { return JSON.parse(localStorage.getItem('addly') || 'null'); } catch { return null; }
}

export async function saveAccount(addly) {
  if (hasChrome) await chrome.storage.local.set({ addly });
  else localStorage.setItem('addly', JSON.stringify(addly));
}

export async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token || ANON_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = data?.error_description || data?.msg || data?.message || data?.error || 'Something went wrong';
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** A fresh access token for reading your nudges (null if you need to sign in again) */
export async function accessToken() {
  const account = await loadAccount();
  if (!account?.refreshToken) return null;
  if (account.accessToken && account.expiresAt && account.expiresAt - Date.now() > 60_000) return account.accessToken;
  try {
    const session = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: account.refreshToken } });
    const updated = {
      ...account,
      refreshToken: session.refresh_token,
      accessToken: session.access_token,
      expiresAt: Date.now() + (session.expires_in || 3600) * 1000,
    };
    await saveAccount(updated);
    return updated.accessToken;
  } catch {
    return null;
  }
}

/** Nudges waiting for you: sent to you, not yet checked or archived by you */
export async function loadInbox() {
  const account = await loadAccount();
  const token = await accessToken();
  if (!account?.me || !token) return null;
  const me = encodeURIComponent(JSON.stringify(account.me));
  const [rows, states] = await Promise.all([
    api(`/rest/v1/reminders?select=id,title,content,url,preview_image,sender,recipients,group_name,created_at,type,todo_items,checked_out,completed_by,attachments,prioritized_at&recipients=cs.%7B${me}%7D&order=created_at.desc&limit=150`, { token }),
    api(`/rest/v1/nudge_user_state?select=reminder_id,checked_at,archived_at&owner_name=eq.${encodeURIComponent(account.me)}`, { token }),
  ]);
  const done = new Set((states || []).filter(s => s.checked_at || s.archived_at).map(s => s.reminder_id));
  return (rows || []).filter(r => {
    if (done.has(r.id)) return false;
    if (Array.isArray(r.todo_items)) return !r.checked_out && !(r.completed_by || []).includes(account.me);
    return true;
  });
}

/** Check a nudge off (just for you, like in the app) */
export async function checkNudge(id) {
  const account = await loadAccount();
  const token = await accessToken();
  if (!account?.me || !token) throw new Error('Please sign in again.');
  await api('/rest/v1/nudge_user_state?on_conflict=owner_name,reminder_id', {
    method: 'POST',
    token,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { owner_name: account.me, reminder_id: id, checked_at: new Date().toISOString() },
  });
}

/** The number on the toolbar icon */
export async function updateBadge(count) {
  if (!hasChrome) return;
  chrome.action.setBadgeBackgroundColor({ color: '#2F6FB7' });
  chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : '' });
}
