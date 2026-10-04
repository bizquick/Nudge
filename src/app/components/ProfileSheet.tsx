import { Send, X } from 'lucide-react';
import { Avatar } from './Avatar';

// Someone's profile: for now just their picture, their username, and a way to send them a nudge.
interface ProfileSheetProps {
  name: string;
  isYou: boolean;
  onSendNudge: () => void;
  onClose: () => void;
  blocked?: boolean;
  onBlock?: () => void;
  onUnblock?: () => void;
}

export function ProfileSheet({ name, isYou, onSendNudge, onClose, blocked, onBlock, onUnblock }: ProfileSheetProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl px-6 pt-4 text-center shadow-xl"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${name}'s profile`}
      >
        <div className="flex justify-end">
          <button onClick={onClose} className="p-1.5 -mr-2 text-stone-400 hover:text-stone-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex justify-center">
          <Avatar name={name} size={96} />
        </div>
        <p className="mt-3 text-2xl text-stone-900 break-words">{name}</p>
        <p className="text-sm text-stone-500 mt-0.5">{isYou ? 'This is you' : blocked ? 'Blocked' : 'On Addly'}</p>
        {!isYou && !blocked && (
          <button
            onClick={onSendNudge}
            className="mt-5 w-full h-12 rounded-xl bg-brand-600 text-white flex items-center justify-center gap-2 active:bg-brand-700"
          >
            <Send className="w-4 h-4" />
            Send {name} a nudge
          </button>
        )}
        {/* Blocking: you won't get their nudges, messages, or notifications. They aren't told. */}
        {!isYou && (blocked ? onUnblock : onBlock) && (
          <button
            onClick={() => {
              if (blocked) { onUnblock?.(); onClose(); return; }
              if (confirm(`Block ${name}? You won't get nudges, messages, or notifications from them. They won't be told.`)) { onBlock?.(); onClose(); }
            }}
            className={`mt-3 w-full h-11 rounded-xl text-sm ${blocked ? 'border border-stone-300 text-stone-700' : 'text-red-600'}`}
          >
            {blocked ? `Unblock ${name}` : `Block ${name}`}
          </button>
        )}
      </div>
    </div>
  );
}
