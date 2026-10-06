import { platformOf } from './platform';

// Social apps give links messy titles: "jess on TikTok: "omg wait for it 😂 #fyp
// #foryou #viral #dog..."", "TikTok - Make Your Day", "Video | Instagram", "... - YouTube".
// Turn those into something short and readable for cards and lists.

const GENERIC = /^(tiktok\s*[-|·]\s*make your day|tiktok|instagram|youtube|facebook|log in.*|login.*|reddit.*the heart of the internet)$/i;

export function cleanLinkTitle(title: string | undefined | null, url?: string): string {
  let t = (title ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  const platform = platformOf(url);

  // Strip the app's name tacked onto the end
  t = t.replace(/\s*[-|·•]\s*(TikTok|YouTube|Instagram|Facebook|Reddit|X|Twitter|Spotify|SoundCloud|Apple Music|Pinterest)\s*$/i, '');

  // "Name on TikTok: "caption"" / "Name on Instagram: "caption"" → the caption
  const said = t.match(/^(.{1,60}?)\s+(?:on|\(@[^)]+\) on)\s+(TikTok|Instagram|X|Twitter|Threads|Facebook)\s*:?\s*["“'‘]?(.*?)["”'’]?\s*$/i);
  if (said) {
    const caption = said[3].trim();
    t = caption || `${platform?.kind === 'video' ? 'Video' : 'Post'} by ${said[1].trim()}`;
  }

  if (platform && (platform.kind === 'social' || platform.key === 'tiktok' || platform.key === 'instagram')) {
    // Hashtags and @mentions are noise in a title
    t = t.replace(/(^|\s)[#@][\p{L}\p{N}_.]+/gu, ' ');
    // Leftover links
    t = t.replace(/https?:\/\/\S+/g, ' ');
    t = t.replace(/\s+/g, ' ').trim().replace(/^[-|:·,\s]+|[-|:·,\s]+$/g, '');
  }

  if (!t || GENERIC.test(t)) {
    return platform?.key === 'tiktok' ? 'TikTok video'
      : platform?.key === 'instagram' ? (platform.kind === 'video' ? 'Instagram reel' : 'Instagram post')
      : platform ? `${platform.name} link`
      : (title ?? '').trim();
  }

  // Keep it to a readable length, ending on a whole word
  if (t.length > 90) t = t.slice(0, 88).replace(/\s+\S*$/, '') + '…';
  return t;
}

/** Pasted text that has a link inside it (TikTok shares look like this): split them apart */
export function splitLinkFromText(text: string): { url: string; rest: string } | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  const url = match[0].replace(/[),.;!?]+$/, '');
  const rest = text.replace(match[0], ' ').replace(/\s+/g, ' ').trim();
  return { url, rest };
}
