// Addly "Share" menu - Supabase Edge Function (deployed in Supabase, where it got the name "smooth-function").
//
// The Share menu on iPhone (and the Chrome extension) sends what you shared here,
// along with your private send-key. This checks the key, fills in the link's title
// and picture, saves any photo, and creates the nudge as you. The normal
// notification setup then tells the people you sent it to.
//
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
// Written in plain ASCII so copying it into the Supabase editor can't garble anything.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const clean = (text: unknown, max: number) =>
  String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`;
}

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

// The link's own title and picture (same service the app uses), with a short time limit
async function lookUpLink(url: string): Promise<{ title?: string; image?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`, { signal: controller.signal });
    clearTimeout(timer);
    const json = await res.json();
    return {
      title: json?.data?.title ? clean(json.data.title, 200) : undefined,
      image: json?.data?.image?.url || json?.data?.logo?.url || undefined,
    };
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: 'Bad request' }); }

  // Whose key is this? (Only a fingerprint of each key is stored.)
  const { data: me, error: keyError } = await db.rpc('share_key_owner', { p_key: String(body.key ?? '') });
  if (keyError || typeof me !== 'string' || !me) return reply(401, { error: 'Open Addly and sign in, then try again.' });

  // Who it's going to: real Addly accounts only, plus "My Nudges" if chosen
  const asked = Array.isArray(body.recipients) ? body.recipients.map(r => clean(r, 60)).filter(Boolean) : [];
  const unique = Array.from(new Set(asked)).filter(name => name !== me).slice(0, 25);
  let people: string[] = [];
  if (unique.length) {
    const { data: found } = await db.from('profiles').select('display_name').in('display_name', unique);
    people = (found ?? []).map(p => p.display_name as string);
    const missing = unique.filter(n => !people.includes(n));
    if (missing.length) return reply(400, { error: `No one named ${missing.join(', ')} on Addly.` });
  }
  const recipients = body.saveToSelf ? [...people, me] : people;
  if (!recipients.length) return reply(400, { error: 'Pick someone to send it to.' });

  const text = String(body.text ?? '').trim().slice(0, 2000);
  const url = normalizeUrl(clean(body.url, 2000));
  let title = clean(body.title, 200);
  let previewImage: string | null = null;
  const attachments: { url: string; name: string; type: string }[] = [];

  // A shared photo: save it to the app's storage
  if (typeof body.imageBase64 === 'string' && body.imageBase64.length > 0) {
    if (body.imageBase64.length > 14_000_000) return reply(413, { error: 'That photo is too big.' });
    const bytes = Uint8Array.from(atob(body.imageBase64), c => c.charCodeAt(0));
    const type = typeof body.imageType === 'string' && body.imageType.startsWith('image/') ? body.imageType : 'image/jpeg';
    const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-shared.jpg`;
    const { error: upErr } = await db.storage.from('nudge-uploads').upload(path, bytes, { contentType: type });
    if (upErr) return reply(500, { error: "Couldn't save that photo. Try again." });
    const { data } = db.storage.from('nudge-uploads').getPublicUrl(path);
    attachments.push({ url: data.publicUrl, name: 'Photo.jpg', type });
    previewImage = data.publicUrl;
  }

  // A link: use its own title and picture when we don't have them
  if (url) {
    const found = await lookUpLink(url);
    if (!title) title = found.title || hostOf(url);
    if (!previewImage && found.image) previewImage = found.image;
  }

  // Just words? The first line is the title; anything after it is the note
  let content = text;
  if (!title) {
    if (attachments.length) title = 'Photo';
    else if (text) {
      const lines = text.split('\n');
      title = clean(lines[0], 80);
      content = lines.slice(1).join('\n').trim();
    } else return reply(400, { error: 'Nothing to send.' });
  }

  const { data: row, error: insErr } = await db.from('reminders').insert({
    type: null,
    title,
    content,
    url: url || null,
    preview_image: previewImage,
    sender: me,
    recipient: recipients[0],
    recipients,
    checked_out: false,
    archived: false,
    favorited: false,
    is_public: false,
    ...(attachments.length ? { attachments } : {}),
  }).select('id').single();
  if (insErr || !row) {
    console.error('share-nudge insert failed', insErr);
    return reply(500, { error: "Couldn't send. Try again." });
  }
  return reply(200, { ok: true, id: row.id });
});
