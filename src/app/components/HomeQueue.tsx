import { useRef, useState, type ReactNode } from 'react';
import { Check, Clock, ListChecks, MessageCircle, Globe, Music, Video, Type as TypeIcon, Sparkles, UtensilsCrossed, Lightbulb, ExternalLink, ChevronDown, Compass } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import type { Reminder, ReminderType } from '../App';
import { Avatar, ProfileLink } from './Avatar';
import { CATEGORY_LABELS } from './SortMenu';
import { PhotoViewer } from './PhotoViewer';

// Home as a queue: one big "Up next" nudge to deal with, then a simple list of
// what's after it. Done checks it off; Later sends it to the back of the line.

// One color per category, used for the little dots in the list
const CATEGORY_DOT: Record<ReminderType, string> = {
  website: '#378ADD', music: '#7F77DD', video: '#E24B4A', text: '#888780',
  unnecessary: '#D4537E', interesting: '#1D9E75', food: '#639922', lifehack: '#EF9F27',
};
const CATEGORY_TILE: Record<ReminderType, string> = {
  website: 'bg-blue-50 text-blue-600', music: 'bg-purple-50 text-purple-600', video: 'bg-red-50 text-red-600',
  text: 'bg-stone-100 text-stone-600', unnecessary: 'bg-pink-50 text-pink-600', interesting: 'bg-teal-50 text-teal-600',
  food: 'bg-green-50 text-green-700', lifehack: 'bg-amber-50 text-amber-600',
};
const CATEGORY_ICON = { website: Globe, music: Music, video: Video, text: TypeIcon, unnecessary: Sparkles, interesting: Sparkles, food: UtensilsCrossed, lifehack: Lightbulb };

// "now", "5m", "2h", "Tue", "Sep 3"
function ago(date: Date) {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 24 * 6) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const haptic = () => { try { Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); } catch { /* no haptics */ } };

interface HomeQueueProps {
  currentUser: string;
  /** Up next first, then the rest, in queue order */
  queue: Reminder[];
  /** Checked nudges with new messages (shown at the top of the list) */
  withNewMessages: Reminder[];
  messageCount: (id: string) => number;
  hasNewMessage: (id: string) => boolean;
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  /** The full nudge (messages, reactions, everything), shown when opened */
  renderFull: (r: Reminder) => ReactNode;
  onDone: (id: string) => void;
  onLater: (id: string) => void;
  /** Slim banner for nudge requests (or null) */
  requestsBanner: ReactNode;
  sortControl: ReactNode;
  doneToday: number;
  /** Last 7 days, oldest first: did you check anything that day? */
  week: boolean[];
  streak: number;
  onExplore: () => void;
}

export function HomeQueue(props: HomeQueueProps) {
  const { queue, withNewMessages, expandedId, onExpand, renderFull, requestsBanner } = props;
  const upNext = queue.find(r => !r.todoItems);
  const rest = [...withNewMessages, ...queue.filter(r => r !== upNext)];

  if (!upNext && rest.length === 0) {
    return (
      <>
        {requestsBanner}
        <AllCaughtUp {...props} />
      </>
    );
  }

  return (
    <div className="pb-2">
      {requestsBanner}
      {upNext && (
        <UpNextCard
          key={upNext.id}
          reminder={upNext}
          {...props}
          open={expandedId === upNext.id}
          onToggleOpen={() => onExpand(expandedId === upNext.id ? null : upNext.id)}
        />
      )}
      {upNext && expandedId === upNext.id && <div className="mt-2">{renderFull(upNext)}</div>}

      {rest.length > 0 && (
        <>
          <div className="mt-6 mb-1 flex items-center justify-between">
            <p className="text-xs text-stone-500">{upNext ? 'Then' : 'Waiting for you'}</p>
            {props.sortControl}
          </div>
          <div className="border-t border-stone-200/80">
            {rest.map(r => expandedId === r.id ? (
              <div key={r.id} className="py-2 border-b border-stone-200/80">{renderFull(r)}</div>
            ) : (
              <QueueRow key={r.id} reminder={r} {...props} onOpen={() => onExpand(r.id)} />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-stone-400">Swipe right to mark done · left for later</p>
        </>
      )}
    </div>
  );
}

function UpNextCard({ reminder: r, currentUser, onDone, onLater, messageCount, open, onToggleOpen }: HomeQueueProps & { reminder: Reminder; open: boolean; onToggleOpen: () => void }) {
  const [leaving, setLeaving] = useState<'done' | 'later' | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const photos = r.attachments.filter(a => a.type.startsWith('image/')).map(a => a.url);
  const picture = photos[0] ?? r.previewImage;
  const Icon = r.type ? CATEGORY_ICON[r.type] : MessageCircle;
  const msgs = messageCount(r.id);
  const who = r.sender === currentUser ? 'You' : r.sender;

  // Slide away, then actually check it (or move it back) so the next one rises in
  const finish = (how: 'done' | 'later') => {
    haptic();
    setLeaving(how);
    setTimeout(() => (how === 'done' ? onDone(r.id) : onLater(r.id)), 230);
  };

  return (
    <div
      className={`rounded-3xl border border-stone-200 bg-white overflow-hidden shadow-sm transition-all duration-200 animate-in fade-in slide-in-from-bottom-3 ${
        leaving === 'done' ? 'translate-x-[110%] opacity-0' : leaving === 'later' ? '-translate-x-[110%] opacity-0' : ''
      }`}
      data-nudge-card
    >
      {/* The picture (or a big category tile). Tapping it opens what was sent. */}
      {picture ? (
        photos.length ? (
          <button type="button" onClick={() => setViewer(0)} className="block w-full" aria-label="View photo">
            <img src={picture} alt="" className="w-full h-44 object-cover bg-stone-100" />
          </button>
        ) : r.url ? (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="block" aria-label="Open link">
            <img src={picture} alt="" className="w-full h-44 object-cover bg-stone-100" />
          </a>
        ) : (
          <img src={picture} alt="" className="w-full h-44 object-cover bg-stone-100" />
        )
      ) : (
        <div className={`h-28 flex items-center justify-center ${r.type ? CATEGORY_TILE[r.type] : 'bg-stone-100 text-stone-500'}`}>
          <Icon className="w-8 h-8" />
        </div>
      )}
      {viewer !== null && <PhotoViewer photos={photos} startIndex={viewer} onClose={() => setViewer(null)} />}

      <div className="p-4">
        <div className="flex items-center gap-2 text-[12px] text-stone-500">
          <Avatar name={r.sender} size={22} profile />
          <span className="truncate">
            {who === 'You' ? 'You' : <ProfileLink name={r.sender}>{who}</ProfileLink>}
            {' · '}{ago(r.createdAt)}
            {r.type ? ` · ${CATEGORY_LABELS[r.type]}` : ''}
            {r.groupName ? ` · ${r.groupName}` : ''}
          </span>
          {r.prioritizedAt && <span title="Priority">🤯</span>}
        </div>
        <p className="mt-2 text-[17px] leading-snug font-medium text-stone-900 break-words">{r.title}</p>
        {r.content && <p className="mt-1 text-[14px] text-stone-600 break-words line-clamp-3">“{r.content}”</p>}
        {r.url && (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-brand-600">
            <ExternalLink className="w-4 h-4" /> Open link
          </a>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => finish('later')}
            className="flex-1 h-12 rounded-2xl border border-stone-300 text-stone-700 flex items-center justify-center gap-1.5 active:bg-stone-100"
          >
            <Clock className="w-4 h-4" /> Later
          </button>
          <button
            type="button"
            onClick={() => finish('done')}
            className="flex-[2] h-12 rounded-2xl bg-brand-600 text-white flex items-center justify-center gap-1.5 active:bg-brand-700"
          >
            <Check className="w-5 h-5" /> Done
          </button>
        </div>
        <button type="button" onClick={onToggleOpen} className="mt-2.5 w-full flex items-center justify-center gap-1 text-[12px] text-stone-500">
          {open ? 'Hide details' : msgs ? `Details · ${msgs} message${msgs === 1 ? '' : 's'}` : 'Details, messages, and more'}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
}

// One line in the list: swipe right to mark done, left for later; tap to open it
function QueueRow({ reminder: r, currentUser, onDone, onLater, hasNewMessage, onOpen }: HomeQueueProps & { reminder: Reminder; onOpen: () => void }) {
  const todos = r.todoItems;
  const done = todos ? todos.filter(t => t.done).length : 0;
  const isNew = hasNewMessage(r.id);
  const who = r.sender === currentUser ? (todos ? 'You' : 'You') : r.sender;
  return (
    <SwipeToAct
      onRight={todos || isNew ? undefined : () => onDone(r.id)}
      onLeft={isNew ? undefined : () => onLater(r.id)}
    >
      <button type="button" onClick={onOpen} className="w-full flex items-center gap-3 py-3 text-left bg-[#FBF6EC]">
        {todos ? (
          <ListChecks className="w-4 h-4 text-stone-500 shrink-0" />
        ) : (
          <span className="w-2.5 h-2.5 rounded-full shrink-0 ml-[3px] mr-[3px]" style={{ background: r.type ? CATEGORY_DOT[r.type] : '#B4B2A9' }} />
        )}
        <span className="flex-1 min-w-0">
          <span className="block truncate text-[15px] text-stone-900">
            {r.prioritizedAt && <span className="mr-1">🤯</span>}
            {r.title}
          </span>
          {(todos || isNew) && (
            <span className="block text-[12px] text-stone-500 truncate">
              {todos ? `To-do ${done}/${todos.length}` : ''}
              {isNew && <span className="text-notify">New message</span>}
            </span>
          )}
        </span>
        {isNew && <span className="w-2.5 h-2.5 rounded-full bg-notify shrink-0" aria-label="New message" />}
        <span className="text-[12px] text-stone-400 shrink-0 max-w-[30%] truncate">{who}</span>
      </button>
    </SwipeToAct>
  );
}

// Sideways swipe on a row, like Mail: past the halfway mark it acts on release
function SwipeToAct({ onRight, onLeft, children }: { onRight?: () => void; onLeft?: () => void; children: ReactNode }) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState<'right' | 'left' | null>(null);
  const start = useRef<{ x: number; y: number; swiping: boolean } | null>(null);
  const swallow = useRef(false);
  const THRESHOLD = 90;

  return (
    <div className={`relative overflow-hidden border-b border-stone-200/80 transition-[max-height,opacity] duration-200 ${gone ? 'max-h-0 opacity-0' : 'max-h-40'}`}>
      <div className="absolute inset-0 flex items-center justify-between px-4 text-white text-sm" aria-hidden="true"
        style={{ background: dx > 0 ? '#1F5C3F' : dx < 0 ? '#A9792A' : 'transparent' }}>
        <span className="flex items-center gap-1.5" style={{ opacity: dx > 0 ? Math.min(1, dx / THRESHOLD) : 0 }}><Check className="w-4 h-4" /> Done</span>
        <span className="flex items-center gap-1.5" style={{ opacity: dx < 0 ? Math.min(1, -dx / THRESHOLD) : 0 }}>Later <Clock className="w-4 h-4" /></span>
      </div>
      <div
        className="relative"
        style={{ transform: `translateX(${gone === 'right' ? '100%' : gone === 'left' ? '-100%' : dx + 'px'})`, transition: start.current?.swiping ? 'none' : 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)', touchAction: 'pan-y' }}
        onPointerDown={(e) => { start.current = { x: e.clientX, y: e.clientY, swiping: false }; }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const mx = e.clientX - s.x, my = e.clientY - s.y;
          if (!s.swiping) {
            if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { start.current = null; return; }
            if (Math.abs(mx) < 10) return;
            s.swiping = true;
            try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* fine */ }
          }
          let x = mx;
          if (x > 0 && !onRight) x = x * 0.2;
          if (x < 0 && !onLeft) x = x * 0.2;
          setDx(x);
        }}
        onPointerUp={() => {
          const s = start.current;
          start.current = null;
          if (!s?.swiping) return;
          swallow.current = true;
          setTimeout(() => { swallow.current = false; }, 300);
          if (dx > THRESHOLD && onRight) { haptic(); setGone('right'); setTimeout(onRight, 200); }
          else if (dx < -THRESHOLD && onLeft) { haptic(); setGone('left'); setTimeout(onLeft, 200); }
          setDx(0);
        }}
        onPointerCancel={() => { start.current = null; setDx(0); }}
        onClickCapture={(e) => { if (swallow.current) { e.stopPropagation(); e.preventDefault(); } }}
      >
        {children}
      </div>
    </div>
  );
}

function AllCaughtUp({ doneToday, week, streak, onExplore }: HomeQueueProps) {
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const today = new Date().getDay();
  return (
    <div className="text-center pt-10 pb-8 px-4 animate-in fade-in">
      <div className="mx-auto w-20 h-20 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center">
        <Check className="w-9 h-9" />
      </div>
      <p className="mt-4 text-2xl text-stone-900 tab-title">All caught up</p>
      <p className="mt-1 text-sm text-stone-500">
        {doneToday ? `${doneToday} checked today` : 'Nothing waiting for you'}
        {streak > 1 ? ` · ${streak}-day streak` : ''}
      </p>
      <div className="mt-5 flex justify-center gap-2" aria-label="This week">
        {week.map((on, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center ${on ? 'bg-brand-500 text-white' : 'border-2 border-dashed border-stone-300'}`}>
              {on && <Check className="w-3.5 h-3.5" />}
            </span>
            <span className="text-[10px] text-stone-400">{days[(today - 6 + i + 7) % 7]}</span>
          </div>
        ))}
      </div>
      <button onClick={onExplore} className="mt-7 inline-flex items-center gap-2 px-5 h-11 rounded-full border border-stone-300 text-stone-700 text-sm active:bg-stone-100">
        <Compass className="w-4 h-4" /> Find something in Explore
      </button>
    </div>
  );
}
