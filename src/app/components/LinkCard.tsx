import { useState } from 'react';
import { ExternalLink, Play, Music2, Youtube, Instagram, Facebook, Twitter, Twitch, Globe, X, Eye } from 'lucide-react';
import { platformOf, linkImage, type Platform } from '../utils/platform';
import { embedFor, viewInApp, type Embed } from '../utils/embed';

// A link, shown the way that app would show it: YouTube and TikTok as a big video
// thumbnail with a play button, Spotify and Apple Music as an album-art row, Instagram
// and Reddit with their colors. Any other site gets a clean picture-and-title card.
// Tapping it plays/shows it right here in Addly; "Open in …" hands it to that app.

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

/** The app's player, right inside Addly */
export function EmbedFrame({ embed, title }: { embed: Embed; title: string }) {
  const frame = (
    <iframe
      src={embed.src}
      title={title}
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      className="block w-full h-full border-0"
    />
  );
  if (embed.tall) {
    // TikToks, Shorts and Reels stand tall, centered on black
    return (
      <div className="bg-black flex justify-center">
        <div style={{ aspectRatio: embed.aspect, height: 'min(68vh, 620px)' }}>{frame}</div>
      </div>
    );
  }
  return (
    <div className={embed.aspect ? 'bg-black' : 'bg-white'} style={embed.aspect ? { aspectRatio: embed.aspect } : { height: embed.height }}>
      {frame}
    </div>
  );
}

/** "Open in YouTube" / "Open in Safari": hands the link to its own app */
function openLabel(platform: Platform | null) {
  return `Open in ${platform ? platform.name : 'Safari'}`;
}

/** Whether a link has a picture area worth showing at the top of the "Up next" card */
export function hasLinkHero(url: string, image?: string) {
  return !!(platformOf(url) || linkImage(url, image));
}

/**
 * The picture area for a link (used at the top of the big "Up next" card).
 * Tap it to play right there; the corner button opens it in its own app.
 * Returns null when there's nothing nicer to show than the normal card.
 */
export function LinkHero({ url, image, title }: { url: string; image?: string; title?: string }) {
  const platform = platformOf(url);
  const picture = linkImage(url, image);
  const embed = embedFor(url);
  const [playing, setPlaying] = useState(false);
  if (!platform && !picture) return null;
  const isVideo = platform?.kind === 'video';
  const isMusic = platform?.kind === 'music';

  if (playing && embed) {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <EmbedFrame embed={embed} title={title || 'Player'} />
        <div className="flex items-center justify-between px-4 py-2 bg-stone-50 border-b border-stone-200/70 text-[13px]">
          <button type="button" onClick={() => setPlaying(false)} className="flex items-center gap-1 text-stone-600">
            <X className="w-4 h-4" /> Close player
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-brand-700 font-medium">
            {openLabel(platform)} <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (embed) setPlaying(true); else viewInApp(url); }}
        className="block w-full text-left"
        aria-label={`${embed ? (isMusic ? 'Listen to' : 'Play') : 'View'} ${title || 'link'}`}
      >
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
        {embed && (isVideo || isMusic) && (
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="w-14 h-14 rounded-full bg-black/55 flex items-center justify-center">
              <Play className="w-7 h-7 text-white fill-white ml-0.5" />
            </span>
          </span>
        )}
      </button>
      {platform && <PlatformBadge platform={platform} className="absolute top-2.5 left-2.5 shadow-sm pointer-events-none" />}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/55 text-white text-[11px] font-medium backdrop-blur-sm"
        aria-label={openLabel(platform)}
      >
        {platform ? platform.name : 'Safari'} <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

/** A link inside an opened nudge: play or view it here, or open it in its own app */
export function LinkCard({ url, image, title }: { url: string; image?: string; title?: string }) {
  const platform = platformOf(url);
  const picture = linkImage(url, image);
  const label = title || domainOf(url);
  const embed = embedFor(url);
  const [playing, setPlaying] = useState(false);
  const isMusic = platform?.kind === 'music';
  const isVideo = platform?.kind === 'video';
  const start = () => { if (embed) setPlaying(true); else viewInApp(url); };
  const verb = embed ? (isMusic ? 'Listen' : isVideo ? 'Watch' : 'View') : 'View';
  const VerbIcon = embed && (isMusic || isVideo) ? Play : Eye;

  let preview: React.ReactNode = null;
  if (playing && embed) {
    preview = <EmbedFrame embed={embed} title={label} />;
  } else if (isMusic) {
    // Music: a compact row with the album art, like a share card from Spotify
    preview = (
      <button type="button" onClick={start} className="w-full flex items-center gap-3 p-2.5 text-left">
        {picture ? (
          <img src={picture} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0" />
        ) : (
          <span className="w-16 h-16 rounded-xl shrink-0 flex items-center justify-center" style={{ background: platform!.color, color: platform!.on }}>
            <Music2 className="w-7 h-7" />
          </span>
        )}
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] text-stone-900 line-clamp-2 [overflow-wrap:anywhere]">{label}</span>
          <PlatformBadge platform={platform!} className="mt-1" />
        </span>
        <span className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center" style={{ background: platform!.color, color: platform!.on }}>
          <Play className="w-4 h-4 ml-0.5" style={{ fill: platform!.on }} />
        </span>
      </button>
    );
  } else if (picture) {
    preview = (
      <button type="button" onClick={start} className="relative block w-full">
        <img src={picture} alt="" className={`w-full object-cover bg-stone-100 ${isVideo ? 'aspect-video' : 'max-h-56'}`} />
        {embed && isVideo && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-12 h-12 rounded-full bg-black/55 flex items-center justify-center">
              <Play className="w-6 h-6 text-white fill-white ml-0.5" />
            </span>
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="mb-3 rounded-2xl overflow-hidden border border-stone-200 bg-white" onClick={(e) => e.stopPropagation()}>
      {preview}
      {/* Title and where it's from (music rows already show both) */}
      {!(isMusic && !playing) && (
        <button type="button" onClick={start} className="w-full text-left px-3 pt-2.5 pb-1">
          <span className="block text-[14px] text-stone-900 line-clamp-2 [overflow-wrap:anywhere]">{label}</span>
          {platform ? <PlatformBadge platform={platform} className="mt-1" /> : <span className="block text-[12px] text-stone-500 truncate">{domainOf(url)}</span>}
        </button>
      )}
      <div className="flex gap-2 px-2.5 pb-2.5 pt-1.5">
        <button
          type="button"
          onClick={() => (playing ? setPlaying(false) : start())}
          className="flex-1 h-9 rounded-full bg-brand-600 text-white text-[13px] font-medium flex items-center justify-center gap-1.5 active:bg-brand-700"
        >
          {playing ? <><X className="w-4 h-4" /> Close player</> : <><VerbIcon className={`w-4 h-4 ${VerbIcon === Play ? 'fill-white' : ''}`} /> {verb} here</>}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 min-w-0 h-9 rounded-full border border-stone-300 text-stone-700 text-[13px] font-medium flex items-center justify-center gap-1.5 active:bg-stone-50"
        >
          <span className="truncate">{openLabel(platform)}</span> <ExternalLink className="w-3.5 h-3.5 shrink-0" />
        </a>
      </div>
    </div>
  );
}
