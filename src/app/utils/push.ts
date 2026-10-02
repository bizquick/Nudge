import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Badge } from '@capawesome/capacitor-badge';
import { supabase } from './supabase/client';

// Push notifications only exist in the installed iPhone app — on the website
// every function here quietly does nothing.
const isNative = () => Capacitor.isNativePlatform();

const TOKEN_KEY = 'nudge.pushToken';
let listenersReady = false;
let currentOwner: string | null = null;
let onOpenFromNotification: (() => void) | null = null;

async function saveToken(token: string) {
  if (!currentOwner) return;
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage unavailable */ }
  // One row per phone: if someone else signs in on this phone, the row moves to them.
  // (The database function checks the token really is being claimed by the signed-in user.)
  const { error } = await supabase.rpc('register_device_token', { p_token: token, p_platform: Capacitor.getPlatform() });
  if (error) console.error('Could not save push token', error);
}

/** Ask for notification permission (first time only) and register this phone for the signed-in user. */
export async function registerPush(owner: string, onOpen?: () => void) {
  if (!isNative()) return;
  currentOwner = owner;
  onOpenFromNotification = onOpen ?? null;

  if (!listenersReady) {
    listenersReady = true;
    await PushNotifications.addListener('registration', ({ value }) => { saveToken(value); });
    await PushNotifications.addListener('registrationError', (err) => console.error('Push registration failed', err));
    // Tapping a notification opens the app — jump to where new nudges are
    await PushNotifications.addListener('pushNotificationActionPerformed', () => { onOpenFromNotification?.(); });
  }

  let { receive } = await PushNotifications.checkPermissions();
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    ({ receive } = await PushNotifications.requestPermissions());
  }
  if (receive === 'granted') await PushNotifications.register();
}

/** On sign-out: stop sending this phone the previous person's notifications. */
export async function unregisterPush() {
  if (!isNative()) return;
  currentOwner = null;
  let token: string | null = null;
  try { token = localStorage.getItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
  if (token) {
    const { error } = await supabase.from('device_tokens').delete().eq('token', token);
    if (error) console.error('Could not remove push token', error);
  }
  await setBadge(0);
}

/** The red number on the app icon — kept equal to your unread count while the app is open. */
export async function setBadge(count: number) {
  if (!isNative()) return;
  try {
    const { display } = await Badge.checkPermissions();
    if (display !== 'granted') return;
    if (count > 0) await Badge.set({ count });
    else await Badge.clear();
  } catch {
    // badge unsupported — not important
  }
}
