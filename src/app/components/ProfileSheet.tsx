import { Send, X } from 'lucide-react';
import { Avatar } from './Avatar';

// Someone's profile: for now just their picture, their username, and a way to send them a nudge.
interface ProfileSheetProps {
  name: string;
  isYou: boolean;
  onSendNudge: () => void;
  onClose: () => void;
}

export function ProfileSheet({ name, isYou, onSendNudge, onClose }: ProfileSheetProps) {
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
        <p className="text-sm text-stone-500 mt-0.5">{isYou ? 'This is you' : 'On Addly'}</p>
        {!isYou && (
          <button
            onClick={onSendNudge}
            className="mt-5 w-full h-12 rounded-xl bg-brand-600 text-white flex items-center justify-center gap-2 active:bg-brand-700"
          >
            <Send className="w-4 h-4" />
            Send {name} a nudge
          </button>
        )}
      </div>
    </div>
  );
}
