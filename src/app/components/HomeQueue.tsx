import { useRef, useState, type ReactNode } from 'react';
import { Check, Clock, ListChecks, MessageCircle, Globe, Music, Video, Type as TypeIcon, Sparkles, UtensilsCrossed, Lightbulb, ExternalLink, ChevronDown, Compass } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import type { Reminder, ReminderType } from '../App';
import { Avatar, ProfileLink } from './Avatar';
import { CATEGORY_LABELS } from './SortMenu';
import { PhotoViewer } from './PhotoViewer';
import { guessCategory } from '../utils/guessCategory';
import { LinkHero } from './LinkCard';

// The category to show: the sender's pick, or the app's best guess from the content
const categoryOf = (r: Reminder): ReminderType | null =>
  r.type ?? (r.todoItems ? null : guessCategory({ url: r.url, title: r.title, content: r.content, attachments: r.attachments }));

// Home as a queue: one big "Up next" nudge to deal with, then a simple list of
// what's after it. Done checks it off; Later sends it to the back of the line.

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
  /** The full nudge (messages, reactions, everything), shown when opened. compact = only
      what the big card doesn't already show. */
  renderFull: (r: Reminder, compact?: boolean) => ReactNode;
  onDone: (id: string) => void;
  onLater: (id: string) => void;
  /** Explore: nothing moves when you check things; you pick which one is the big card */
  mode?: 'home' | 'explore';
  heroId?: string | null;
  onSelect?: (id: string) => void;
  /** Explore: shown under the list (progress, "Show me 10 more") */
  footer?: ReactNode;
  /** Home: friends with nudges waiting (tap one to see only theirs) */
  peopleRow?: ReactNode;
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
  const explore = props.mode === 'explore';
  // Home: the first regular nudge waiting. Explore: whichever one you've picked.
  const upNext = explore
    ? (queue.find(r => r.id === props.heroId) ?? queue.find(r => !r.checkedOut) ?? queue[0])
    : queue.find(r => !r.todoItems);
  const rest = [...withNewMessages, ...queue.filter(r => r !== upNext)];

  if (!upNext && rest.length === 0) {
    if (explore) return <>{props.footer}</>;
    return (
      <>
        {props.peopleRow}
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
          details={expandedId === upNext.id ? renderFull(upNext, true) : null}
        />
      )}

      {/* Who else has something waiting (tap a friend to see only theirs) */}
      {props.peopleRow && <div className="mt-5">{props.peopleRow}</div>}

      {rest.length > 0 && (
        <>
          <div className={`${props.peopleRow ? 'mt-1' : 'mt-5'} mb-1 flex items-center justify-end`}>
            {props.sortControl}
          </div>
          <div className="border-t border-stone-200/80">
            {rest.map(r => !explore && expandedId === r.id ? (
              <div key={r.id} className="py-2 border-b border-stone-200/80">{renderFull(r)}</div>
            ) : (
              <QueueRow
                key={r.id}
                reminder={r}
                {...props}
                // Explore: tapping a row makes it the big card (nothing gets reordered)
                onOpen={() => (explore ? props.onSelect?.(r.id) : onExpand(r.id))}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-stone-400">
            {explore ? 'Tap one to open it up top · swipe right to check it' : 'Swipe right to check · left for later'}
          </p>
        </>
      )}
      {props.footer}
    </div>
  );
}

function UpNextCard({ reminder: r, currentUser, onDone, onLater, messageCount, open, onToggleOpen, details, mode, queue, onSelect }: HomeQueueProps & { reminder: Reminder; open: boolean; onToggleOpen: () => void; details: ReactNode }) {
  const explore = mode === 'explore';
  const type = categoryOf(r);
  const [leaving, setLeaving] = useState<'done' | 'later' | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const photos = r.attachments.filter(a => a.type.startsWith('image/')).map(a => a.url);
  const picture = photos[0] ?? r.previewImage;
  const Icon = type ? CATEGORY_ICON[type] : MessageCircle;
  const msgs = messageCount(r.id);
  const who = r.sender === currentUser ? 'You' : r.sender;

  // Slide away, then actually check it (or move it back) so the next one rises in
  const finish = (how: 'done' | 'later') => {
    haptic();
    // Explore never moves anything: checking just checks it (and "Next" picks the next one)
    if (explore) {
      if (how === 'done') onDone(r.id);
      else {
        const i = queue.indexOf(r);
        const next = queue.slice(i + 1).find(x => !x.checkedOut) ?? queue.find(x => !x.checkedOut && x !== r) ?? queue[(i + 1) % queue.length];
        if (next) onSelect?.(next.id);
      }
      return;
    }
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
      {/* The picture (or a big tile). Tapping it opens what was sent — the link itself,
          shown like the app it's from (YouTube thumbnail, Spotify album art…). */}
      {!photos.length && r.url && LinkHero({ url: r.url, image: r.previewImage, title: r.title }) ? (
        <LinkHero url={r.url} image={r.previewImage} title={r.title} />
      ) : picture ? (
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
      ) : r.url ? (
        <a href={r.url} target="_blank" rel="noopener noreferrer" aria-label="Open link"
          className={`h-28 flex flex-col items-center justify-center gap-1.5 ${type ? CATEGORY_TILE[type] : 'bg-stone-100 text-stone-500'}`}>
          <Icon className="w-8 h-8" />
          <span className="text-[12px] opacity-80">Tap to open</span>
        </a>
      ) : (
        <div className={`h-28 flex items-center justify-center ${type ? CATEGORY_TILE[type] : 'bg-stone-100 text-stone-500'}`}>
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
            {type ? ` · ${CATEGORY_LABELS[type]}` : ''}
            {r.groupName ? ` · ${r.groupName}` : ''}
          </span>
          {r.prioritizedAt && <span title="Priority">🤯</span>}
        </div>
        {r.url ? (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="mt-2 block text-[17px] leading-snug font-medium text-stone-900 break-words">
            {r.title} <ExternalLink className="inline w-4 h-4 text-brand-600 align-[-2px]" />
          </a>
        ) : (
          <p className="mt-2 text-[17px] leading-snug font-medium text-stone-900 break-words">{r.title}</p>
        )}
        {r.content && r.content !== r.title && <p className="mt-1 text-[14px] text-stone-600 break-words line-clamp-3">“{r.content}”</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => finish('later')}
            className="flex-1 h-12 rounded-2xl border border-stone-300 text-stone-700 flex items-center justify-center gap-1.5 active:bg-stone-100"
          >
            {explore ? <>Next <ChevronDown className="w-4 h-4 -rotate-90" /></> : <><Clock className="w-4 h-4" /> Later</>}
          </button>
          <button
            type="button"
            onClick={() => finish('done')}
            className={`flex-[2] h-12 rounded-2xl flex items-center justify-center gap-1.5 ${
              explore && r.checkedOut ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-brand-600 text-white active:bg-brand-700'
            }`}
          >
            <Check className="w-5 h-5" /> Checked
          </button>
        </div>
        <button type="button" onClick={onToggleOpen} className="mt-2.5 w-full flex items-center justify-center gap-1 text-[12px] text-stone-500">
          {open ? 'Hide' : msgs ? `${msgs} message${msgs === 1 ? '' : 's'} · react · more` : 'Messages, reactions, and more'}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {/* Only what the card above doesn't already show: more photos, messages, reactions */}
      {details}
    </div>
  );
}

// One line in the list: swipe right to mark done, left for later; tap to open it
function QueueRow({ reminder: r, currentUser, onDone, onLater, hasNewMessage, onOpen, mode }: HomeQueueProps & { reminder: Reminder; onOpen: () => void }) {
  const explore = mode === 'explore';
  const type = categoryOf(r);
  const Icon = type ? CATEGORY_ICON[type] : MessageCircle;
  const todos = r.todoItems;
  const done = todos ? todos.filter(t => t.done).length : 0;
  const isNew = hasNewMessage(r.id);
  const who = r.sender === currentUser ? 'You' : r.sender;
  return (
    <SwipeToAct
      onRight={todos || isNew ? undefined : () => onDone(r.id)}
      onLeft={isNew || explore ? undefined : () => onLater(r.id)}
      stay={explore}
    >
      <button type="button" onClick={onOpen} className="w-full flex items-center gap-3 py-3 text-left bg-[#FBF6EC]">
        {explore && r.checkedOut ? (
          <span className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center bg-green-100 text-green-700"><Check className="w-4 h-4" /></span>
        ) : (
          <span className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center ${todos ? 'bg-stone-100 text-stone-600' : type ? CATEGORY_TILE[type] : 'bg-stone-100 text-stone-500'}`}>
            {todos ? <ListChecks className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
          </span>
        )}
        <span className="flex-1 min-w-0">
          <span className={`block truncate text-[15px] ${explore && r.checkedOut ? 'text-stone-500' : 'text-stone-900'}`}>
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
function SwipeToAct({ onRight, onLeft, stay, children }: { onRight?: () => void; onLeft?: () => void; stay?: boolean; children: ReactNode }) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState<'right' | 'left' | null>(null);
  const start = useRef<{ x: number; y: number; swiping: boolean } | null>(null);
  const swallow = useRef(false);
  const THRESHOLD = 90;

  return (
    <div className={`relative overflow-hidden border-b border-stone-200/80 transition-[max-height,opacity] duration-200 ${gone ? 'max-h-0 opacity-0' : 'max-h-40'}`}>
      <div className="absolute inset-0 flex items-center justify-between px-4 text-white text-sm" aria-hidden="true"
        style={{ background: dx > 0 ? '#1F5C3F' : dx < 0 ? '#A9792A' : 'transparent' }}>
        <span className="flex items-center gap-1.5" style={{ opacity: dx > 0 ? Math.min(1, dx / THRESHOLD) : 0 }}><Check className="w-4 h-4" /> Checked</span>
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
          if (dx > THRESHOLD && onRight && stay) { haptic(); onRight(); }
          else if (dx > THRESHOLD && onRight) { haptic(); setGone('right'); setTimeout(onRight, 200); }
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
