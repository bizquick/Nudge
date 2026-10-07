import { createContext, useContext, useEffect, useRef } from 'react';
import { toast } from 'sonner';

// Emoji reactions on chat messages, like tapbacks in Messages: double-tap a message
// (or hold it) to pick one. One reaction per person per message — pick another to
// change it, or tap yours again to take it off.

export const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥', '👎'];

export interface MessageReaction { emoji: string; users: string[] }

interface MessageReactionsValue {
  /** message id -> reactions on it */
  reactions: Record<string, MessageReaction[]>;
  react: (messageId: string, emoji: string) => void;
  currentUser: string;
}

export const MessageReactionsContext = createContext<MessageReactionsValue>({
  reactions: {},
  react: () => {},
  currentUser: '',
});

export function useMessageReactions() {
  return useContext(MessageReactionsContext);
}

/** The row of emojis that pops up under a message */
export function ReactionPicker({ messageId, onClose, alignRight }: { messageId: string; onClose: () => void; alignRight: boolean }) {
  const { reactions, react, currentUser } = useMessageReactions();
  const mine = reactions[messageId]?.find(r => r.users.includes(currentUser))?.emoji;
  const ref = useRef<HTMLDivElement>(null);

  // Tapping anywhere else closes it
  useEffect(() => {
    const close = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => document.addEventListener('pointerdown', close), 0);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', close); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`mt-1 flex gap-0.5 rounded-full bg-white border border-stone-200 shadow-lg px-1.5 py-1 ${alignRight ? 'self-end' : 'self-start'}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      role="menu"
      aria-label="React to this message"
    >
      {QUICK_REACTIONS.map(emoji => (
        <button
          key={emoji}
          type="button"
          onClick={() => { react(messageId, emoji); onClose(); }}
          className={`w-9 h-9 rounded-full text-[22px] leading-none flex items-center justify-center active:scale-125 transition-transform ${mine === emoji ? 'bg-blue-100' : ''}`}
          aria-label={`React ${emoji}`}
          aria-pressed={mine === emoji}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** The little reactions badge tucked under a message */
export function ReactionBadge({ messageId, alignRight }: { messageId: string; alignRight: boolean }) {
  const { reactions, react, currentUser } = useMessageReactions();
  const list = reactions[messageId];
  if (!list?.length) return null;
  const total = list.reduce((n, r) => n + r.users.length, 0);
  const mine = list.find(r => r.users.includes(currentUser))?.emoji;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        // Tap your own to take it off; otherwise see who reacted
        if (mine && list.length === 1 && total === 1) { react(messageId, mine); return; }
        toast(list.map(r => `${r.emoji} ${r.users.map(u => (u === currentUser ? 'You' : u)).join(', ')}`).join('   '));
      }}
      className={`-mt-2 z-[1] flex items-center gap-0.5 rounded-full bg-white border border-stone-200 shadow-sm px-1.5 py-0.5 text-[13px] leading-none ${alignRight ? 'self-end mr-2' : 'self-start ml-2'}`}
      aria-label={`Reactions: ${list.map(r => `${r.emoji} ${r.users.length}`).join(', ')}`}
    >
      {list.map(r => <span key={r.emoji}>{r.emoji}</span>)}
      {total > 1 && <span className="ml-0.5 text-[11px] text-stone-500">{total}</span>}
    </button>
  );
}
