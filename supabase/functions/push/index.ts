// Nudge push notifications - Supabase Edge Function (deployed in Supabase under the name "smart-processor").
//
// The database calls this whenever a nudge or chat message is created (see
// supabase-push-setup.sql). It looks up who should hear about it, then asks
// Apple's Push Notification service (APNs) to show a banner on their iPhones.
//
// Secrets this needs (Supabase Dashboard -> Edge Functions -> Secrets):
//   APNS_KEY_P8          the full text of the .p8 key file from Apple
//   APNS_KEY_ID          the 10-character Key ID shown next to that key
//   APNS_TEAM_ID         your 10-character Apple Developer Team ID
//   APNS_BUNDLE_ID       com.brandonchirco.nudge
//   NUDGE_WEBHOOK_SECRET the shared secret the database sends, so strangers can't trigger pushes
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// -- Apple sign-in token (valid up to an hour; reuse it for 45 minutes) ------
let cachedJwt: { token: string; madeAt: number } | null = null;

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function apnsJwt(): Promise<string> {
  if (cachedJwt && Date.now() - cachedJwt.madeAt < 45 * 60 * 1000) return cachedJwt.token;
  const pem = Deno.env.get('APNS_KEY_P8')!;
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: Deno.env.get('APNS_KEY_ID') }));
  const claims = b64url(JSON.stringify({ iss: Deno.env.get('APNS_TEAM_ID'), iat: Math.floor(Date.now() / 1000) }));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`));
  const token = `${header}.${claims}.${b64url(signature)}`;
  cachedJwt = { token, madeAt: Date.now() };
  return token;
}

// -- Send one notification to one phone ---------------------------------------
interface Alert { title: string; subtitle?: string; body: string }

async function sendToDevice(token: string, alert: Alert, badge: number, threadId: string) {
  const payload = JSON.stringify({
    aps: { alert, sound: 'default', badge, 'thread-id': threadId },
  });
  const headers = {
    authorization: `bearer ${await apnsJwt()}`,
    'apns-topic': Deno.env.get('APNS_BUNDLE_ID')!,
    'apns-push-type': 'alert',
    'apns-priority': '10',
  };
  // TestFlight/App Store installs use Apple's main server; installs straight from
  // Xcode use the "sandbox" one. Try the main one first, then fall back.
  for (const host of ['api.push.apple.com', 'api.sandbox.push.apple.com']) {
    const res = await fetch(`https://${host}/3/device/${token}`, { method: 'POST', headers, body: payload });
    if (res.ok) return;
    const reason = (await res.json().catch(() => ({}))).reason as string | undefined;
    if (reason === 'BadDeviceToken') continue; // wrong server for this phone - try the other
    if (reason === 'Unregistered') {
      // App was deleted or notifications reset on that phone - forget the token
      await db.from('device_tokens').delete().eq('token', token);
      return;
    }
    console.error(`APNs ${host} rejected push: ${res.status} ${reason}`);
    return;
  }
}

// -- Who to notify, and what to say ------------------------------------------
async function notify(names: string[], alert: Alert, nudgeId: string, actor: string) {
  const threadId = `nudge-${nudgeId}`;
  for (const name of new Set(names)) {
    // Skip anyone who silenced this nudge, or the person/group it came from
    const { data: muted } = await db.rpc('is_muted', { p_owner: name, p_reminder: nudgeId, p_actor: actor });
    if (muted) continue;
    const { data: devices } = await db.from('device_tokens').select('token').eq('owner_name', name);
    if (!devices?.length) continue;
    // Badge = that person's unread count, like the red number on Messages
    const { count } = await db
      .from('reminders')
      .select('id', { count: 'exact', head: true })
      .contains('recipients', [name])
      .eq('checked_out', false)
      .eq('archived', false);
    await Promise.all(devices.map(d => sendToDevice(d.token, alert, count ?? 1, threadId)));
  }
}

const isRecent = (createdAt: string) => Date.now() - new Date(createdAt).getTime() < 2 * 60 * 1000;

// Notification text, cleaned up: no leftover web-page codes like "&amp;" or "&#39;",
// no invisible formatting characters, no line breaks, and not too long.
// (Written with plain-ASCII escapes so copying this file can't garble anything.)
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function clean(text: unknown, max = 180): string {
  let t = String(text ?? '');
  t = t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
  // control characters, zero-width and direction marks, the "object replacement" box, BOM
  t = t.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\ufffc\ufffd]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '\u2026' : t;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-nudge-secret') !== Deno.env.get('NUDGE_WEBHOOK_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }
  const { table, id } = await req.json();

  // Always re-read the row from the database rather than trusting the request,
  // and only announce things that were created just now.
  if (table === 'reminders') {
    const { data: nudge } = await db.from('reminders').select('*').eq('id', id).maybeSingle();
    if (!nudge || !isRecent(nudge.created_at)) return new Response('skipped');
    const recipients = (nudge.recipients as string[]).filter(name => name !== nudge.sender);
    const isGroup = recipients.length > 1;
    // Title: who sent it. Subtitle: the group, and whether it's a priority or a to-do list.
    // Body: just the nudge's title (or its link, if it has no title).
    const labels = [
      isGroup ? (clean(nudge.group_name, 60) || `To you and ${recipients.length - 1} other${recipients.length > 2 ? 's' : ''}`) : null,
      nudge.prioritized_at ? 'Priority' : null,
      nudge.todo_items ? 'To-do list' : null,
    ].filter(Boolean);
    await notify(recipients, {
      title: clean(nudge.sender, 60),
      ...(labels.length ? { subtitle: labels.join(' \u00b7 ') } : {}),
      body: clean(nudge.title) || clean(nudge.url) || 'New nudge',
    }, nudge.id, nudge.sender);
  } else if (table === 'messages') {
    const { data: message } = await db.from('messages').select('*').eq('id', id).maybeSingle();
    if (!message || !isRecent(message.created_at)) return new Response('skipped');
    const { data: nudge } = await db.from('reminders').select('*').eq('id', message.reminder_id).maybeSingle();
    if (!nudge) return new Response('skipped');
    const people = [nudge.sender, ...(nudge.recipients as string[])].filter(name => name !== message.sender);
    await notify(people, {
      title: clean(message.sender, 60),
      subtitle: clean(nudge.title, 80),
      body: clean(message.text) || 'New message',
    }, nudge.id, message.sender);
  }
  return new Response('ok');
});
