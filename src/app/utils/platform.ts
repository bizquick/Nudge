// Recognize links from well-known apps so their cards can look like them:
// the app's name and color, the right kind of layout, and a thumbnail when we
// can work one out from the link itself (YouTube's are public and predictable).

export type PlatformKind = 'video' | 'music' | 'social';

export interface Platform {
  key: string;
  name: string;
  /** Brand color for the badge and the fallback tile */
  color: string;
  /** Text on top of that color */
  on: string;
  kind: PlatformKind;
}

const PLATFORMS: (Platform & { match: RegExp })[] = [
  { key: 'youtube-music', name: 'YouTube Music', color: '#FF0000', on: '#fff', kind: 'music', match: /(^|\.)music\.youtube\.com$/ },
  { key: 'youtube', name: 'YouTube', color: '#FF0000', on: '#fff', kind: 'video', match: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/ },
  { key: 'spotify', name: 'Spotify', color: '#1DB954', on: '#000', kind: 'music', match: /(^|\.)(spotify\.com|spotify\.link)$/ },
  { key: 'apple-music', name: 'Apple Music', color: '#FA2D48', on: '#fff', kind: 'music', match: /(^|\.)music\.apple\.com$/ },
  { key: 'apple-podcasts', name: 'Apple Podcasts', color: '#9933CC', on: '#fff', kind: 'music', match: /(^|\.)podcasts\.apple\.com$/ },
  { key: 'soundcloud', name: 'SoundCloud', color: '#FF5500', on: '#fff', kind: 'music', match: /(^|\.)(soundcloud\.com|on\.soundcloud\.com)$/ },
  { key: 'tiktok', name: 'TikTok', color: '#000000', on: '#fff', kind: 'video', match: /(^|\.)tiktok\.com$/ },
  { key: 'instagram', name: 'Instagram', color: '#E1306C', on: '#fff', kind: 'social', match: /(^|\.)(instagram\.com|instagr\.am)$/ },
  { key: 'reddit', name: 'Reddit', color: '#FF4500', on: '#fff', kind: 'social', match: /(^|\.)(reddit\.com|redd\.it)$/ },
  { key: 'facebook', name: 'Facebook', color: '#1877F2', on: '#fff', kind: 'social', match: /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/ },
  { key: 'x', name: 'X', color: '#000000', on: '#fff', kind: 'social', match: /(^|\.)(twitter\.com|x\.com)$/ },
  { key: 'threads', name: 'Threads', color: '#000000', on: '#fff', kind: 'social', match: /(^|\.)threads\.(net|com)$/ },
  { key: 'twitch', name: 'Twitch', color: '#9146FF', on: '#fff', kind: 'video', match: /(^|\.)twitch\.tv$/ },
  { key: 'netflix', name: 'Netflix', color: '#E50914', on: '#fff', kind: 'video', match: /(^|\.)netflix\.com$/ },
  { key: 'vimeo', name: 'Vimeo', color: '#1AB7EA', on: '#fff', kind: 'video', match: /(^|\.)vimeo\.com$/ },
  { key: 'pinterest', name: 'Pinterest', color: '#E60023', on: '#fff', kind: 'social', match: /(^|\.)(pinterest\.com|pin\.it)$/ },
];

function parse(url: string): URL | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
}

export function platformOf(url?: string): Platform | null {
  if (!url) return null;
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase();
  // Instagram reels and TikToks are videos; Instagram posts are photos
  const found = PLATFORMS.find(p => p.match.test(host));
  if (!found) return null;
  const { match: _match, ...platform } = found;
  if (found.key === 'instagram' && /\/(reel|reels|tv)\//.test(u.pathname)) return { ...platform, kind: 'video' };
  return platform;
}

/** YouTube's own thumbnail for a video link (works for youtube.com, youtu.be, shorts) */
export function youtubeThumbnail(url?: string): string | null {
  if (!url) return null;
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (/youtube(-nocookie)?\.com$/.test(host)) {
    id = u.searchParams.get('v') ?? u.pathname.match(/\/(shorts|embed|live|v)\/([\w-]{6,})/)?.[2] ?? null;
  }
  return id && /^[\w-]{6,}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/** The best picture for a link: the one saved when it was sent, or the app's own thumbnail */
export function linkImage(url?: string, saved?: string): string | null {
  return saved || youtubeThumbnail(url);
}
