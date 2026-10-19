// BeagleExpress - Addly's Explore bot (Supabase Edge Function, deploy it named "beagle-express").
//
// Keeps Explore full: if people post fewer than 1,000 public nudges in a week,
// BeagleExpress tops it up to 1,000 with neutral, interesting things from free,
// family-friendly sources - NASA's astronomy picture of the day, public-domain art
// from the Art Institute of Chicago, recipes from TheMealDB, and Wikipedia's featured
// article, picture of the day, and random articles with pictures. A word filter skips
// anything about war, crime, politics, religion, and the like.
//
// Run it once a day (Supabase -> Integrations -> Cron). Each run adds about a
// seventh of what the week still needs (the very first run adds up to 300 so Explore
// isn't empty), so running it extra times can't overfill Explore.
// Add ?dry=1 to see what it would do without adding anything.
//
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically. Optional:
// a NASA_API_KEY secret from api.nasa.gov - without it NASA's shared demo key is used.)
// Written in plain ASCII so copying it into the Supabase editor can't garble anything.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const BOT = 'BeagleExpress';
const WEEKLY_GOAL = 1000;
const FIRST_RUN = 300;
const MAX_PER_RUN = 300;
const UA = 'Addly BeagleExpress (support@addlyapp.com)';

interface Pick {
  title: string;
  content: string;
  url: string;
  preview_image: string | null;
  type: 'interesting' | 'food' | 'video' | 'website';
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

const clean = (text: unknown, max: number) =>
  String(text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Keep Explore neutral: skip anything that touches these topics
const AVOID = /\b(war|wars|warfare|battle|massacre|murder|kill|killed|killing|death|deaths|died|dead|suicide|terror\w*|bomb\w*|shooting|genocide|sex\w*|porn\w*|nude|naked|rape|abuse\w*|drug|drugs|cocaine|heroin|slave\w*|nazi\w*|holocaust|execut\w*|assassin\w*|crime\w*|criminal\w*|prison\w*|disease\w*|cancer|epidemic|pandemic|politic\w*|election\w*|president\w*|senator|congress\w*|parliament\w*|religio\w*|church\w*|mosque\w*|god|gods|deity|weapon\w*|gun|guns|rifle\w*|military|army|soldier\w*|violence|violent|blood\w*|hate|racis\w*)\b/i;
const neutral = (...texts: string[]) => !AVOID.test(texts.join(' '));

// First sentence or two, for the description
function blurb(text: string, max = 220): string {
  const t = clean(text, 1000);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '...';
}

async function getJson(url: string, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA, 'Api-User-Agent': UA, 'AIC-User-Agent': UA } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// NASA Astronomy Picture of the Day (random days from its 30-year archive)
async function nasa(count: number): Promise<Pick[]> {
  if (count <= 0) return [];
  const key = Deno.env.get('NASA_API_KEY') || 'DEMO_KEY';
  const items = await getJson(`https://api.nasa.gov/planetary/apod?api_key=${key}&count=${Math.min(count, 100)}&thumbs=true`, 20000);
  if (!Array.isArray(items)) return [];
  const out: Pick[] = [];
  for (const it of items) {
    const title = clean(it.title, 150);
    const text = String(it.explanation ?? '');
    if (!title || !neutral(title, text)) continue;
    const day = String(it.date ?? '').replace(/-/g, '').slice(2); // YYMMDD
    if (it.media_type === 'video') {
      const id = String(it.url ?? '').match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/)?.[1];
      if (!id) continue;
      out.push({ title, content: blurb(text), url: `https://www.youtube.com/watch?v=${id}`, preview_image: it.thumbnail_url ?? null, type: 'video' });
    } else if (it.media_type === 'image' && day.length === 6) {
      out.push({ title, content: blurb(text), url: `https://apod.nasa.gov/apod/ap${day}.html`, preview_image: it.url ?? null, type: 'interesting' });
    }
  }
  return out;
}

// Public-domain art from the Art Institute of Chicago
async function art(count: number): Promise<Pick[]> {
  if (count <= 0) return [];
  const page = 1 + Math.floor(Math.random() * 90);
  const data = await getJson(`https://api.artic.edu/api/v1/artworks/search?query[term][is_public_domain]=true&fields=id,title,image_id,artist_title,date_display,medium_display&limit=${Math.min(100, count * 2)}&page=${page}`);
  const out: Pick[] = [];
  for (const a of data?.data ?? []) {
    if (!a.image_id || !a.title) continue;
    const title = clean(a.title, 120);
    const who = [a.artist_title, a.date_display].filter(Boolean).join(', ');
    if (!neutral(title, who, String(a.medium_display ?? ''))) continue;
    out.push({
      title: who ? `${title} (${clean(who, 80)})` : title,
      content: clean(a.medium_display ? `${a.medium_display}. From the Art Institute of Chicago.` : 'From the Art Institute of Chicago.', 220),
      url: `https://www.artic.edu/artworks/${a.id}`,
      preview_image: `https://www.artic.edu/iiif/2/${a.image_id}/full/843,/0/default.jpg`,
      type: 'interesting',
    });
    if (out.length >= count) break;
  }
  return out;
}

// Recipes from TheMealDB
async function food(count: number): Promise<Pick[]> {
  const out: Pick[] = [];
  const seen = new Set<string>();
  for (let round = 0; round < 3 && out.length < count; round++) {
    const batch = await Promise.all(Array.from({ length: Math.min(10, count - out.length) }, () => getJson('https://www.themealdb.com/api/json/v1/1/random.php')));
    for (const d of batch) {
      const m = d?.meals?.[0];
      if (!m || seen.has(m.idMeal)) continue;
      seen.add(m.idMeal);
      const title = clean(m.strMeal, 120);
      if (!title || !neutral(title)) continue;
      const kind = [m.strArea, m.strCategory].filter((x: string) => x && x !== 'Unknown').join(' ').toLowerCase();
      out.push({
        title,
        content: kind ? `A ${kind} recipe to try.` : 'A recipe to try.',
        url: m.strSource && /^https?:\/\//.test(m.strSource) ? m.strSource : `https://www.themealdb.com/meal/${m.idMeal}`,
        preview_image: m.strMealThumb ?? null,
        type: 'food',
      });
    }
  }
  return out;
}

// Wikipedia: today's featured article and picture, plus random articles that have a picture
async function wikipedia(count: number): Promise<Pick[]> {
  const out: Pick[] = [];
  const d = new Date();
  const day = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
  const feed = await getJson(`https://en.wikipedia.org/api/rest_v1/feed/featured/${day}`);
  const tfa = feed?.tfa;
  if (tfa?.content_urls?.mobile?.page && neutral(String(tfa.titles?.normalized ?? ''), String(tfa.extract ?? ''))) {
    out.push({ title: clean(tfa.titles?.normalized, 150), content: blurb(tfa.extract ?? ''), url: tfa.content_urls.mobile.page, preview_image: tfa.thumbnail?.source ?? null, type: 'interesting' });
  }
  const pic = feed?.image;
  if (pic?.file_page && pic?.thumbnail?.source && neutral(String(pic.description?.text ?? ''))) {
    out.push({ title: 'Picture of the day', content: blurb(pic.description?.text ?? ''), url: pic.file_page, preview_image: pic.image?.source ?? pic.thumbnail.source, type: 'interesting' });
  }
  const seen = new Set<string>();
  for (let round = 0; round < 6 && out.length < count; round++) {
    const batch = await Promise.all(Array.from({ length: 12 }, () => getJson('https://en.wikipedia.org/api/rest_v1/page/random/summary')));
    for (const p of batch) {
      if (!p || p.type !== 'standard' || !p.thumbnail?.source || !p.content_urls?.mobile?.page) continue;
      const title = clean(p.titles?.normalized ?? p.title, 150);
      const extract = String(p.extract ?? '');
      if (seen.has(title) || extract.length < 160 || !neutral(title, extract, String(p.description ?? ''))) continue;
      if (/politician|footballer|cricketer|list of/i.test(`${p.description ?? ''} ${title}`)) continue;
      seen.add(title);
      out.push({ title, content: blurb(extract), url: p.content_urls.mobile.page, preview_image: p.originalimage?.source ?? p.thumbnail.source, type: 'interesting' });
      if (out.length >= count) break;
    }
  }
  return out;
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

Deno.serve(async (req) => {
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  // How many public nudges did people post this week, and how many has BeagleExpress added?
  const { count: people } = await db.from('reminders').select('id', { count: 'exact', head: true })
    .eq('is_public', true).neq('sender', BOT).gte('created_at', weekAgo);
  const { count: mine } = await db.from('reminders').select('id', { count: 'exact', head: true })
    .eq('sender', BOT).gte('created_at', weekAgo);
  const goal = Math.max(0, WEEKLY_GOAL - (people ?? 0));
  const stillNeeded = Math.max(0, goal - (mine ?? 0));
  const today = Math.min(stillNeeded, MAX_PER_RUN, (mine ?? 0) === 0 ? FIRST_RUN : Math.ceil(goal / 7));

  // Tidy up: old BeagleExpress posts nobody liked, saved, or talked about
  let removed = 0;
  if (!dry) {
    const { data } = await db.rpc('beagle_cleanup');
    removed = typeof data === 'number' ? data : 0;
  }

  if (today <= 0) return reply(200, { peopleThisWeek: people ?? 0, beagleThisWeek: mine ?? 0, added: 0, removedOld: removed, note: 'Explore is full for this week.' });

  // A mix: art 30%, NASA 25%, recipes 15%, Wikipedia the rest
  const [a, n, f] = await Promise.all([art(Math.round(today * 0.3)), nasa(Math.round(today * 0.25)), food(Math.round(today * 0.15))]);
  const w = await wikipedia(Math.max(2, today - a.length - n.length - f.length));
  let picks = shuffle([...a, ...n, ...f, ...w]);

  // Never post the same link twice
  const urls = picks.map(p => p.url);
  const already = new Set<string>();
  for (let i = 0; i < urls.length; i += 100) {
    const { data } = await db.from('reminders').select('url').eq('sender', BOT).in('url', urls.slice(i, i + 100));
    (data ?? []).forEach((r: { url: string }) => already.add(r.url));
  }
  const unique = new Set<string>();
  picks = picks.filter(p => !already.has(p.url) && !unique.has(p.url) && unique.add(p.url)).slice(0, today);

  if (dry) return reply(200, { peopleThisWeek: people ?? 0, beagleThisWeek: mine ?? 0, wouldAdd: picks.length, sample: picks.slice(0, 5) });

  let added = 0;
  for (let i = 0; i < picks.length; i += 50) {
    const rows = picks.slice(i, i + 50).map(p => ({
      type: p.type,
      title: p.title,
      content: p.content,
      url: p.url,
      preview_image: p.preview_image,
      sender: BOT,
      recipient: BOT,
      recipients: [BOT],
      is_public: true,
      checked_out: false,
      archived: false,
      favorited: false,
    }));
    const { error } = await db.from('reminders').insert(rows);
    if (error) { console.error('BeagleExpress insert failed', error); break; }
    added += rows.length;
  }
  return reply(200, { peopleThisWeek: people ?? 0, beagleThisWeek: (mine ?? 0) + added, added, removedOld: removed });
});
