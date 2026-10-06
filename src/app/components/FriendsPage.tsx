import { useState } from 'react';
import { ChevronLeft, Send, UserPlus, MoreHorizontal, Loader2, Search } from 'lucide-react';
import { Avatar } from './Avatar';

// Your friends: everyone you've swapped nudges with (plus anyone you've added).
// Add someone by their exact username, send them a nudge, remove them, or block them.

export interface Friend {
  name: string;
  /** Nudges you've sent each other */
  count: number;
}

interface FriendsPageProps {
  friends: Friend[];
  onClose: () => void;
  /** Returns an error message, or null when they were added */
  onAdd: (username: string) => Promise<string | null>;
  onSend: (name: string) => void;
  onRemove: (name: string) => void;
  onBlock: (name: string) => void;
  onOpenProfile: (name: string) => void;
}

export function FriendsPage({ friends, onClose, onAdd, onSend, onRemove, onBlock, onOpenProfile }: FriendsPageProps) {
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    setAddError(null);
    const problem = await onAdd(username.trim());
    setBusy(false);
    if (problem) { setAddError(problem); return; }
    setUsername('');
    setAdding(false);
  };

  const q = query.trim().toLowerCase();
  const shown = [...friends]
    .filter(f => !q || f.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col"
      style={{ background: '#FBF6EC', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      onClick={() => setMenuFor(null)}
    >
      <div className="shrink-0 max-w-2xl mx-auto w-full px-4 pt-1 pb-2 flex items-center gap-2">
        <button onClick={onClose} className="-ml-2 p-1.5 rounded-lg active:bg-stone-200" aria-label="Back">
          <ChevronLeft className="w-6 h-6 text-stone-700" />
        </button>
        <h1 className="tab-title text-[28px] leading-tight text-stone-900 flex-1">Friends</h1>
        <button
          onClick={() => { setAdding(v => !v); setAddError(null); }}
          className="flex items-center gap-1.5 px-3 h-9 rounded-full bg-brand-600 text-white text-sm active:bg-brand-700"
        >
          <UserPlus className="w-4 h-4" /> Add
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="max-w-2xl mx-auto w-full px-4 pb-8">
          {adding && (
            <form onSubmit={add} className="mb-4 bg-white rounded-2xl border border-stone-200 p-4" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm text-stone-600">Type their exact Addly username.</p>
              <div className="mt-2 flex gap-2">
                <input
                  autoFocus
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setAddError(null); }}
                  placeholder="Username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button type="submit" disabled={busy || !username.trim()} className="px-4 rounded-xl bg-brand-600 text-white disabled:opacity-50">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
                </button>
              </div>
              {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}
              <p className="mt-2 text-xs text-stone-500">Friends can send you nudges without a request.</p>
            </form>
          )}

          {friends.length > 8 && (
            <div className="mb-3 flex items-center gap-2 px-3 rounded-xl bg-white border border-stone-200">
              <Search className="w-4 h-4 text-stone-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search friends" className="flex-1 py-2.5 bg-transparent focus:outline-none" />
            </div>
          )}

          {shown.length === 0 ? (
            <p className="text-center text-stone-500 pt-12 px-6">
              {q ? 'No friends match that.' : 'No friends yet. Send someone a nudge, or tap Add to add them by username.'}
            </p>
          ) : (
            <div className="bg-white rounded-2xl border border-stone-200 divide-y divide-stone-100">
              {shown.map(f => (
                <div key={f.name} className="relative flex items-center gap-3 px-3.5 py-3">
                  <button onClick={() => onOpenProfile(f.name)} className="shrink-0" aria-label={`${f.name}'s profile`}>
                    <Avatar name={f.name} size={44} />
                  </button>
                  <button onClick={() => onOpenProfile(f.name)} className="flex-1 min-w-0 text-left">
                    <span className="block text-[16px] text-stone-900 truncate">{f.name}</span>
                    <span className="block text-[13px] text-stone-500">
                      {f.count ? `${f.count} nudge${f.count === 1 ? '' : 's'} together` : 'Added'}
                    </span>
                  </button>
                  <button onClick={() => onSend(f.name)} className="p-2.5 rounded-full text-brand-600 active:bg-brand-50" aria-label={`Send ${f.name} a nudge`}>
                    <Send className="w-5 h-5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === f.name ? null : f.name); }}
                    className="p-2.5 -mr-1 rounded-full text-stone-500 active:bg-stone-100"
                    aria-label={`More for ${f.name}`}
                  >
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                  {menuFor === f.name && (
                    <div className="absolute right-3 top-14 z-10 w-56 bg-white rounded-xl shadow-lg border border-stone-200 py-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setMenuFor(null);
                          if (confirm(`Remove ${f.name} from your friends? You'll keep what they've already sent, but anything new from them will come as a nudge request.`)) onRemove(f.name);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm text-stone-800 active:bg-stone-50"
                      >
                        Remove friend
                      </button>
                      <button
                        onClick={() => {
                          setMenuFor(null);
                          if (confirm(`Block ${f.name}? You won't get nudges, messages, or notifications from them. They won't be told.`)) onBlock(f.name);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm text-red-600 active:bg-stone-50"
                      >
                        Block
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
