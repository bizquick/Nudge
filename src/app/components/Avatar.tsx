import { createContext, useContext, type ReactNode } from 'react';

// Everyone's chosen picture, by display name. A value is either a photo address
// or a premade pick written as "emoji:🐸". No entry = colored initials.
export const AvatarContext = createContext<Record<string, string>>({});

// Opens someone's profile card. Avatars marked `profile` become tappable and call this.
export const ProfileContext = createContext<((name: string) => void) | null>(null);

/** Wrap a person's name (or anything) so tapping it opens their profile */
export function ProfileLink({ name, className = '', children }: { name: string; className?: string; children: ReactNode }) {
  const openProfile = useContext(ProfileContext);
  if (!openProfile) return <span className={className}>{children}</span>;
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); openProfile(name); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); openProfile(name); } }}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </span>
  );
}

// Premade options for people who don't want to upload a photo
export const PRESET_AVATARS = [
  '🐸', '🦊', '🐼', '🐙', '🦄', '🐵', '🐶', '🐱', '🦆', '🐳', '🦖', '🐧',
  '🤠', '👽', '🤖', '👻', '😎', '🤪', '🥸', '🫠', '🤓', '🧐', '🥳', '😴',
  '🍕', '🌮', '🥑', '🍩', '🌵', '🔥', '⭐', '🎸',
];

// Soft background colors for emoji avatars, picked from the emoji so each is consistent
const EMOJI_BACKGROUNDS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa', '#a5f3fc', '#fecaca'];

function backgroundFor(emoji: string) {
  let hash = 0;
  for (const ch of emoji) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return EMOJI_BACKGROUNDS[hash % EMOJI_BACKGROUNDS.length];
}

export function initialsFor(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

interface AvatarProps {
  name: string;
  /** Diameter in pixels */
  size: number;
  /** Optional override, e.g. a preview while picking a new picture */
  value?: string | null;
  className?: string;
  /** Tapping it opens this person's profile */
  profile?: boolean;
}

export function Avatar({ profile, ...props }: AvatarProps) {
  const picture = <AvatarPicture {...props} />;
  return profile ? <ProfileLink name={props.name} className="inline-flex shrink-0 rounded-full">{picture}</ProfileLink> : picture;
}

function AvatarPicture({ name, size, value, className = '' }: Omit<AvatarProps, 'profile'>) {
  const avatars = useContext(AvatarContext);
  const pick = value !== undefined ? value : avatars[name];
  const style = { width: size, height: size };
  const base = `rounded-full shrink-0 flex items-center justify-center overflow-hidden ${className}`;

  if (pick?.startsWith('emoji:')) {
    const emoji = pick.slice('emoji:'.length);
    return (
      <div className={base} style={{ ...style, background: backgroundFor(emoji), fontSize: size * 0.55, lineHeight: 1 }} aria-label={name}>
        <span aria-hidden="true">{emoji}</span>
      </div>
    );
  }
  if (pick) {
    return <img src={pick} alt={name} className={`${base} object-cover`} style={style} />;
  }
  return (
    <div
      className={`${base} bg-gradient-to-br from-brand-400 to-brand-700 text-white`}
      style={{ ...style, fontSize: Math.max(9, size * 0.36) }}
      aria-label={name}
    >
      {initialsFor(name)}
    </div>
  );
}
