import { ChevronRight, Pencil, X } from 'lucide-react';
import { Avatar } from './Avatar';

// Who's in a group chat. Tap anyone to open their profile.
interface GroupInfoSheetProps {
  title: string;
  /** Everyone in the group except you */
  members: string[];
  currentUser: string;
  onOpenProfile: (name: string) => void;
  onRename: () => void;
  onClose: () => void;
}

export function GroupInfoSheet({ title, members, currentUser, onOpenProfile, onRename, onClose }: GroupInfoSheetProps) {
  const everyone = [...[...members].sort((a, b) => a.localeCompare(b)), currentUser];
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[80%] bg-white rounded-t-3xl sm:rounded-3xl pt-4 shadow-xl flex flex-col"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Group info"
      >
        <div className="px-6 flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xl text-stone-900 break-words">{title}</p>
            <p className="text-sm text-stone-500">{everyone.length} people</p>
          </div>
          <button onClick={onClose} className="p-1.5 -mr-2 text-stone-400 hover:text-stone-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <button
          onClick={() => { onClose(); onRename(); }}
          className="mx-6 mt-3 flex items-center gap-2 text-sm text-brand-600"
        >
          <Pencil className="w-3.5 h-3.5" />
          Rename group
        </button>
        <div className="mt-3 overflow-y-auto divide-y divide-stone-100 border-t border-stone-100">
          {everyone.map(name => {
            const isYou = name === currentUser;
            return (
              <button
                key={name}
                onClick={() => { onClose(); onOpenProfile(name); }}
                className="w-full px-6 py-3 flex items-center gap-3 text-left active:bg-stone-50"
              >
                <Avatar name={name} size={40} />
                <span className="flex-1 min-w-0 truncate text-base text-stone-900">
                  {name}{isYou && <span className="text-stone-400"> (you)</span>}
                </span>
                <ChevronRight className="w-4 h-4 text-stone-300 shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
