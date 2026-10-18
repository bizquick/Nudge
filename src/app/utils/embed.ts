import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

// Playing a link right inside Addly: the player each app offers for other sites
// (YouTube, Spotify, Apple Music, TikTok, Instagram…). Anything without a player
// opens in a browser inside the app instead. Either way, there's also a button to
// open it in the app it came from.

export interface Embed {
  src: string;
  /** Fixed height in pixels (music players, posts) */
  height?: number;
  /** Width/height shape for videos */
  aspect?: string;
  /** Tall videos (TikTok, Shorts, Reels) */
  tall?: boolean;
}

function parse(url: string): URL | null {
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`); } catch { return null; }
}

/** YouTube's "1m30s" / "90" start times, in seconds */
function startSeconds(u: URL): number {
  const t = u.searchParams.get('t') ?? u.searchParams.get('start');
  if (!t) return 0;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  return m ? (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0)) : 0;
}

export function embedFor(url?: string): Embed | null {
  if (!url) return null;
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase();
  const path = u.pathname;

  // YouTube (and YouTube Music): through Addly's player page, which YouTube requires
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(host) || host === 'youtu.be') {
    const shorts = path.match(/^\/shorts\/([\w-]{6,})/);
    const id = host === 'youtu.be' ? path.slice(1).split('/')[0]
      : u.searchParams.get('v') ?? shorts?.[1] ?? path.match(/^\/(embed|live|v)\/([\w-]{6,})/)?.[2] ?? null;
    if (!id || !/^[\w-]{6,}$/.test(id)) return null;
    const t = startSeconds(u);
    return { src: `https://addlyapp.com/play#yt=${id}${t ? `&t=${t}` : ''}`, ...(shorts ? { tall: true, aspect: '9 / 16' } : { aspect: '16 / 9' }) };
  }
  if (host === 'vimeo.com') {
    const id = path.match(/^\/(\d+)/)?.[1];
    return id ? { src: `https://player.vimeo.com/video/${id}?playsinline=1`, aspect: '16 / 9' } : null;
  }
  if (host === 'tiktok.com') {
    const id = path.match(/\/video\/(\d+)/)?.[1];
    return id ? { src: `https://www.tiktok.com/player/v1/${id}?description=1&music_info=1&rel=0`, aspect: '9 / 16', tall: true } : null;
  }
  if (host === 'instagram.com') {
    const m = path.match(/^\/(p|reel|reels|tv)\/([\w-]+)/);
    return m ? { src: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed/`, height: 560 } : null;
  }
  if (host === 'open.spotify.com') {
    const m = path.match(/^\/(?:intl-\w+\/)?(track|album|playlist|episode|show|artist)\/(\w+)/);
    return m ? { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: m[1] === 'track' || m[1] === 'episode' ? 152 : 352 } : null;
  }
  if (host === 'music.apple.com') {
    const song = u.searchParams.has('i') || /\/song\//.test(path);
    return { src: `https://embed.music.apple.com${path}${u.search}`, height: song ? 175 : 450 };
  }
  if (host === 'podcasts.apple.com') {
    return { src: `https://embed.podcasts.apple.com${path}${u.search}`, height: u.searchParams.has('i') ? 175 : 450 };
  }
  if (host === 'soundcloud.com') {
    return { src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.href)}&color=%231f5c3f&visual=false&show_comments=false`, height: 166 };
  }
  return null;
}

/** Websites without a player: open in a browser inside Addly (with Done to come back) */
export async function viewInApp(url: string) {
  if (Capacitor.isNativePlatform()) {
    try { await Browser.open({ url, presentationStyle: 'fullscreen', toolbarColor: '#FBF6EC' }); return; } catch { /* fall through */ }
  }
  window.open(url, '_blank', 'noopener');
}
