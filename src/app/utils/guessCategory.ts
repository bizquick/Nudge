import type { ReminderType, Attachment } from '../App';

// When someone doesn't pick a category, make a sensible guess from the link and the
// words they wrote. A picked category always wins; this only fills in a blank.

const VIDEO_SITES = ['youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com', 'twitch.tv', 'netflix.com', 'hulu.com',
  'disneyplus.com', 'max.com', 'primevideo.com', 'tv.apple.com', 'dailymotion.com', 'loom.com'];
const MUSIC_SITES = ['spotify.com', 'music.apple.com', 'soundcloud.com', 'bandcamp.com', 'tidal.com', 'pandora.com',
  'deezer.com', 'music.youtube.com', 'music.amazon.com', 'audiomack.com', 'genius.com', 'podcasts.apple.com'];
const FOOD_SITES = ['allrecipes.com', 'seriouseats.com', 'bonappetit.com', 'food52.com', 'epicurious.com', 'tasty.co',
  'delish.com', 'foodnetwork.com', 'cooking.nytimes.com', 'budgetbytes.com', 'smittenkitchen.com', 'yelp.com',
  'opentable.com', 'resy.com', 'doordash.com', 'ubereats.com', 'grubhub.com', 'tock.com', 'thekitchn.com', 'eater.com'];
const SHOPPING_SITES = ['amazon.com', 'a.co', 'amzn.to', 'etsy.com', 'ebay.com', 'target.com', 'walmart.com', 'bestbuy.com',
  'costco.com', 'wayfair.com', 'ikea.com', 'nike.com', 'apple.com/shop', 'temu.com', 'shein.com', 'homedepot.com',
  'lowes.com', 'sephora.com', 'ulta.com', 'zara.com', 'uniqlo.com', 'rei.com', 'aliexpress.com'];
const SOCIAL_SITES = ['instagram.com', 'instagr.am', 'reddit.com', 'redd.it', 'facebook.com', 'fb.com', 'twitter.com', 'x.com',
  'threads.net', 'threads.com', 'pinterest.com', 'pin.it', 'linkedin.com', 'snapchat.com', 'bsky.app'];
const HACK_SITES = ['lifehacker.com', 'wikihow.com', 'instructables.com'];
const INTERESTING_SITES = ['wikipedia.org', 'ted.com', 'nationalgeographic.com', 'smithsonianmag.com', 'atlasobscura.com',
  'nasa.gov', 'aeon.co', 'quantamagazine.org', 'mentalfloss.com', 'vox.com'];

const WORDS: [ReminderType, RegExp][] = [
  ['food', /\b(recipe|restaurant|dinner|lunch|breakfast|brunch|bake|baking|cook(ing)?|tacos?|pizza|sushi|burger|ramen|dessert|cocktail|coffee|cafe|menu|eat|foodie)\b/i],
  ['music', /\b(song|album|playlist|band|concert|track|single|lyrics|ep|vinyl|podcast|listen)\b/i],
  ['video', /\b(video|movie|film|trailer|episode|watch|show|series|clip|documentary|reel)\b/i],
  ['unnecessary', /(\$\d|\b(buy|deal|sale|discount|price|order|cart|want this|need this|shopping|gadget)\b)/i],
  ['lifehack', /\b(hack|tip|trick|how to|how-to|tutorial|diy|guide|easier way|pro tip)\b/i],
  ['interesting', /\b(did you know|fascinating|history|science|study|fact|weird|crazy|wild|mind[- ]?blown)\b/i],
];

function hostAndPath(url: string): string | null {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return (u.hostname.replace(/^www\.|^m\./, '') + u.pathname).toLowerCase();
  } catch {
    return null;
  }
}

const onSite = (where: string, sites: string[]) =>
  sites.some(site => where === site || where.startsWith(site + '/') || where.includes('.' + site) || where.startsWith(site));

export function guessCategory(input: { url?: string; title?: string; content?: string; attachments?: Attachment[] }): ReminderType | null {
  const words = `${input.title ?? ''} ${input.content ?? ''}`;

  if (input.url) {
    const where = hostAndPath(input.url);
    if (where) {
      // Music before video: music.youtube.com is music, not a video
      if (onSite(where, MUSIC_SITES)) return 'music';
      if (onSite(where, VIDEO_SITES) || /instagram\.com\/(reel|tv)\//.test(where)) return 'video';
      if (onSite(where, FOOD_SITES)) return 'food';
      // Social posts are just posts (Instagram's "/p/" links aren't product pages)
      if (onSite(where, SOCIAL_SITES)) {
        for (const [type, pattern] of WORDS) if (pattern.test(words)) return type;
        return 'website';
      }
      if (onSite(where, SHOPPING_SITES) || /\/(dp|product|products|item)\//.test(where)) return 'unnecessary';
      if (onSite(where, HACK_SITES)) return 'lifehack';
      if (onSite(where, INTERESTING_SITES)) return 'interesting';
    }
    // Any other link: the words decide, otherwise it's a website
    for (const [type, pattern] of WORDS) if (pattern.test(words)) return type;
    return 'website';
  }

  // Photos and videos with no link
  const files = input.attachments ?? [];
  if (files.length && files.every(f => f.type.startsWith('video/'))) return 'video';

  for (const [type, pattern] of WORDS) if (pattern.test(words)) return type;

  // Just words, no link or files
  if (!files.length && words.trim()) return 'text';
  return null;
}
