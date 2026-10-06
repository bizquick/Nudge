import { useEffect, type ReactNode } from 'react';
import { Check, ListChecks, MessageCircle, X, Play } from 'lucide-react';
import type { Reminder, ReminderType } from '../App';
import { Avatar } from './Avatar';
import { PlatformBadge } from './LinkCard';
import { categoryOf, CATEGORY_ICON } from './HomeQueue';
import { platformOf, linkImage } from '../utils/platform';

// Nudges as a grid of tiles, so you can tell what each one is at a glance: its picture,
// the app it's from (TikTok, Spotify…), a to-do's progress, or a note's first words.
// Tapping a tile opens the normal nudge.

// Soft backgrounds for tiles without a picture
const NOTE_COLORS: Record<ReminderType, string> = {
  website: 'bg-blue-100 text-blue-900', music: 'bg-purple-100 text-purple-900', video: 'bg-red-100 text-red-900',
  text: 'bg-amber-50 text-stone-800', unnecessary: 'bg-pink-100 text-pink-900', interesting: 'bg-teal-100 text-teal-900',
  food: 'bg-green-100 text-green-900', lifehack: 'bg-amber-100 text-amber-900',
};

interface NudgeGridProps {
  reminders: Reminder[];
  currentUser: string;
  onOpen: (id: string) => void;
  hasNewMessage?: (id: string) => boolean;
  emptyMessage?: string;
}

export function NudgeGrid({ reminders, currentUser, onOpen, hasNewMessage, emptyMessage }: NudgeGridProps) {
  if (reminders.length === 0) {
    return <p className="text-center text-stone-500 pt-10 px-6">{emptyMessage ?? 'Nothing here yet.'}</p>;
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {reminders.map(r => (
        <Tile key={r.id} r={r} currentUser={currentUser} isNew={!!hasNewMessage?.(r.id)} onOpen={() => onOpen(r.id)} />
      ))}
    </div>
  );
}

function Tile({ r, currentUser, isNew, onOpen }: { r: Reminder; currentUser: string; isNew: boolean; onOpen: () => void }) {
  const photo = r.attachments.find(a => a.type.startsWith('image/'))?.url;
  const image = linkImage(r.url, r.previewImage) ?? photo ?? null;
  const platform = platformOf(r.url);
  const type = categoryOf(r);
  const Icon = type ? CATEGORY_ICON[type] : MessageCircle;
  const todos = r.todoItems;
  const who = r.groupName || (r.sender === currentUser ? 'You' : r.sender);

  let body: ReactNode;
  if (image) {
    body = (
      <>
        <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        {platform?.kind === 'video' && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-8 h-8 rounded-full bg-black/45 text-white flex items-center justify-center"><Play className="w-4 h-4 fill-white" /></span>
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 to-transparent" />
        <span className="absolute inset-x-0 bottom-0 p-2 text-white text-[12px] leading-[15px] line-clamp-2 [overflow-wrap:anywhere]">{r.title}</span>
      </>
    );
  } else if (todos) {
    const done = todos.filter(t => t.done).length;
    body = (
      <span className="absolute inset-0 bg-white p-2 pt-8 flex flex-col">
        <span className="text-[12px] leading-[15px] text-stone-900 line-clamp-2 [overflow-wrap:anywhere]">{r.title}</span>
        <span className="mt-auto flex items-center gap-1 text-[11px] text-stone-500">
          <ListChecks className="w-3.5 h-3.5" /> {done}/{todos.length}
        </span>
        <span className="mt-1 h-1 rounded-full bg-stone-100 overflow-hidden">
          <span className="block h-full bg-brand-600" style={{ width: `${todos.length ? (done / todos.length) * 100 : 0}%` }} />
        </span>
      </span>
    );
  } else if (platform) {
    body = (
      <span className="absolute inset-0 p-2 pt-8 flex flex-col" style={{ background: platform.color, color: platform.on }}>
        <span className="text-[12px] leading-[15px] line-clamp-3 [overflow-wrap:anywhere]">{r.title}</span>
        <PlatformBadge platform={platform} className="mt-auto self-start !bg-white/20" />
      </span>
    );
  } else {
    // A note: its words are what it is
    const more = r.content && r.content !== r.title ? r.content : '';
    body = (
      <span className={`absolute inset-0 p-2 pt-8 flex flex-col ${type ? NOTE_COLORS[type] : 'bg-amber-50 text-stone-800'}`}>
        <span className="text-[13px] leading-[16px] font-semibold line-clamp-2 [overflow-wrap:anywhere]">{r.title}</span>
        {more && <span className="mt-0.5 text-[12px] leading-[15px] opacity-75 line-clamp-2 [overflow-wrap:anywhere]">{more}</span>}
        <Icon className="mt-auto w-4 h-4 opacity-50" />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative aspect-square rounded-2xl overflow-hidden border text-left active:scale-[0.97] transition-transform ${
        r.checkedOut ? 'border-green-400' : 'border-stone-200'
      }`}
      aria-label={`${r.title} from ${who}`}
    >
      {body}
      {/* Who it's from, and anything to notice */}
      <span className="absolute top-1.5 left-1.5 rounded-full ring-2 ring-white/90"><Avatar name={r.sender} size={22} /></span>
      <span className="absolute top-1.5 right-1.5 flex gap-1">
        {r.prioritizedAt && <span className="text-[14px] leading-none drop-shadow">🤯</span>}
        {isNew && <span className="w-3 h-3 mt-0.5 rounded-full bg-blue-500 ring-2 ring-white" aria-label="New message" />}
        {r.checkedOut && (
          <span className="w-5 h-5 rounded-full bg-green-600 text-white flex items-center justify-center ring-2 ring-white" aria-label="Checked">
            <Check className="w-3 h-3" strokeWidth={3} />
          </span>
        )}
      </span>
    </button>
  );
}

/** The normal nudge, opened from a tile: slides up over the grid */
export function NudgeSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[92%] flex flex-col rounded-t-3xl bg-[#FBF6EC] shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 relative flex justify-center h-11 pt-2">
          <span className="w-10 h-1.5 rounded-full bg-stone-300" />
          <button onClick={onClose} className="absolute right-3 top-2 w-8 h-8 rounded-full bg-stone-200/80 text-stone-600 flex items-center justify-center" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-1 pb-4">{children}</div>
      </div>
    </div>
  );
}
