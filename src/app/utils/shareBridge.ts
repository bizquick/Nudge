import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase } from './supabase/client';
import { projectId, publicAnonKey } from './supabase/info';

// The iPhone Share menu ("Addly" in the Share sheet) runs outside the app, so the app
// hands it what it needs through a storage area they share: a private send-key (not
// your password), your name, and the people you nudge most.

interface SharedStorePlugin {
  set(options: { values: Record<string, string | null> }): Promise<void>;
  clear(): Promise<void>;
}
const SharedStore = registerPlugin<SharedStorePlugin>('SharedStore');

const KEY_STORAGE = 'addly.shareKey';
let lastSent = '';

/** Keep the Share menu up to date. Cheap to call often: it only writes when something changed. */
export async function syncShareMenu(me: string, contacts: string[]) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    let saved: { owner: string; key: string } | null = null;
    try { saved = JSON.parse(localStorage.getItem(KEY_STORAGE) || 'null'); } catch { /* none yet */ }
    if (!saved || saved.owner !== me) {
      const { data, error } = await supabase.rpc('create_share_key');
      if (error || typeof data !== 'string') return; // not set up in the database yet
      saved = { owner: me, key: data };
      try { localStorage.setItem(KEY_STORAGE, JSON.stringify(saved)); } catch { /* storage unavailable */ }
    }
    const values = {
      shareKey: saved.key,
      displayName: me,
      contacts: JSON.stringify(contacts.slice(0, 60)),
      supabaseUrl: `https://${projectId}.supabase.co`,
      anonKey: publicAnonKey,
    };
    const fingerprint = JSON.stringify(values);
    if (fingerprint === lastSent) return;
    await SharedStore.set({ values });
    lastSent = fingerprint;
  } catch (err) {
    console.warn('Share menu not updated', err);
  }
}

/** Signing out: cancel the send-key and empty the Share menu */
export async function clearShareMenu() {
  if (!Capacitor.isNativePlatform()) return;
  lastSent = '';
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* storage unavailable */ }
  try { await supabase.rpc('revoke_share_keys'); } catch { /* offline: the key stays unusable once signed out */ }
  try { await SharedStore.clear(); } catch { /* not available */ }
}
