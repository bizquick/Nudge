import { ExternalLink, Play, Music2, Youtube, Instagram, Facebook, Twitter, Twitch, Globe } from 'lucide-react';
import { platformOf, linkImage, type Platform } from '../utils/platform';

// A link, shown the way that app would show it: YouTube and TikTok as a big video
// thumbnail with a play button, Spotify and Apple Music as an album-art row, Instagram
// and Reddit with their colors. Any other site gets a clean picture-and-title card.

const BRAND_ICON: Record<string, typeof Play> = {
  youtube: Youtube, 'youtube-music': Youtube, instagram: Instagram, facebook: Facebook, x: Twitter, twitch: Twitch,
};

export function domainOf(url: string) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The app's name on its own color, e.g. a green "Spotify" chip */
export function PlatformBadge({ platform, className = '' }: { platform: Platform; className?: string }) {
  const Icon = BRAND_ICON[platform.key] ?? (platform.kind === 'music' ? Music2 : platform.kind === 'video' ? Play : Globe);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${className}`} style={{ background: platform.color, color: platform.on }}>
      <Icon className="w-3 h-3" />
      {platform.name}
    </span>
  );
}

/**
 * The picture area for a link (used at the top of the big "Up next" card).
 * Returns null when there's nothing nicer to show than the normal card.
 */
export function LinkHero({ url, image, title }: { url: string; image?: string; title?: string }) {
  const platform = platformOf(url);
  const picture = linkImage(url, image);
  if (!platform && !picture) return null;
  const isVideo = platform?.kind === 'video';
  const isMusic = platform?.kind === 'music';
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="relative block" aria-label={`Open ${title || 'link'}`}>
      {picture ? (
        isMusic ? (
          // Album art, centered on a soft wash of the app's color
          <div className="h-44 flex items-center justify-center" style={{ background: `${platform!.color}22` }}>
            <img src={picture} alt="" className="h-32 w-32 rounded-xl object-cover shadow-md" />
          </div>
        ) : (
          <img src={picture} alt="" className={`w-full object-cover bg-stone-100 ${isVideo ? 'aspect-video' : 'h-44'}`} />
        )
      ) : (
        // No picture: a tile in the app's own color
        <div className="h-32 flex flex-col items-center justify-center gap-2" style={{ background: platform!.color, color: platform!.on }}>
          {platform!.kind === 'music' ? <Music2 className="w-9 h-9" /> : platform!.kind === 'video' ? <Play className="w-9 h-9" /> : <Globe className="w-9 h-9" />}
          <span className="text-sm font-medium">{platform!.name}</span>
        </div>
      )}
      {isVideo && picture && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-14 h-14 rounded-full bg-black/55 flex items-center justify-center">
            <Play className="w-7 h-7 text-white fill-white ml-0.5" />
          </span>
        </span>
      )}
      {platform && <PlatformBadge platform={platform} className="absolute top-2.5 left-2.5 shadow-sm" />}
    </a>
  );
}

/** A link inside an opened nudge: the whole card opens it */
export function LinkCard({ url, image, title }: { url: string; image?: string; title?: string }) {
  const platform = platformOf(url);
  const picture = linkImage(url, image);
  const label = title || domainOf(url);

  // Music: a compact row with the album art, like a share card from Spotify
  if (platform?.kind === 'music') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
        className="mb-3 flex items-center gap-3 p-2.5 rounded-2xl border border-stone-200 bg-white active:bg-stone-50">
        {picture ? (
          <img src={picture} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0" />
        ) : (
          <span className="w-16 h-16 rounded-xl shrink-0 flex items-center justify-center" style={{ background: platform.color, color: platform.on }}>
            <Music2 className="w-7 h-7" />
          </span>
        )}
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] text-stone-900 line-clamp-2">{label}</span>
          <PlatformBadge platform={platform} className="mt-1" />
        </span>
        <span className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center" style={{ background: platform.color, color: platform.on }}>
          <Play className="w-4 h-4 ml-0.5" style={{ fill: platform.on }} />
        </span>
      </a>
    );
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
      className="mb-3 block rounded-2xl overflow-hidden border border-stone-200 bg-white active:bg-stone-50">
      {picture && (
        <span className="relative block">
          <img src={picture} alt="" className={`w-full object-cover bg-stone-100 ${platform?.kind === 'video' ? 'aspect-video' : 'h-40'}`} />
          {platform?.kind === 'video' && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="w-12 h-12 rounded-full bg-black/55 flex items-center justify-center">
                <Play className="w-6 h-6 text-white fill-white ml-0.5" />
              </span>
            </span>
          )}
        </span>
      )}
      <span className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] text-stone-800 truncate">{label}</span>
          {platform ? <PlatformBadge platform={platform} className="mt-1" /> : <span className="block text-[11px] text-stone-500 truncate">{domainOf(url)}</span>}
        </span>
        <ExternalLink className="w-4 h-4 text-brand-600 shrink-0" />
      </span>
    </a>
  );
}
