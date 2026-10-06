import { useState } from 'react';
import { ChevronLeft, Search, MessageCircle, ListChecks } from 'lucide-react';
import type { Reminder, Message } from '../App';
import { linkImage } from '../utils/platform';

// Every message you've written, newest first, with the nudge it was about.
// Tap one to jump to that nudge's conversation.

interface ChatHistoryProps {
  messages: Message[];
  reminders: Reminder[];
  currentUser: string;
  onOpen: (reminderId: string) => void;
  onClose: () => void;
}

function when(d: Date) {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function ChatHistory({ messages, reminders, currentUser, onOpen, onClose }: ChatHistoryProps) {
  const [query, setQuery] = useState('');
  const byId = new Map(reminders.map(r => [r.id, r]));
  const q = query.trim().toLowerCase();
  const mine = messages
    .filter(m => m.sender === currentUser && byId.has(m.reminderId))
    .filter(m => !q || m.text.toLowerCase().includes(q) || byId.get(m.reminderId)!.title.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 300);

  const withWhom = (r: Reminder) => {
    const others = Array.from(new Set([r.sender, ...r.recipients])).filter(p => p !== currentUser);
    if (r.groupName) return r.groupName;
    if (others.length === 0) return 'My Nudges';
    return others.length > 2 ? `${others.slice(0, 2).join(', ')} +${others.length - 2}` : others.join(', ');
  };

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col"
      style={{ background: '#FBF6EC', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="shrink-0 max-w-2xl mx-auto w-full px-4 pt-1 pb-2 flex items-center gap-2">
        <button onClick={onClose} className="-ml-2 p-1.5 rounded-lg active:bg-stone-200" aria-label="Back">
          <ChevronLeft className="w-6 h-6 text-stone-700" />
        </button>
        <h1 className="tab-title text-[28px] leading-tight text-stone-900 flex-1">Chat history</h1>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="max-w-2xl mx-auto w-full px-4 pb-8">
          <div className="mb-3 flex items-center gap-2 px-3 rounded-xl bg-white border border-stone-200">
            <Search className="w-4 h-4 text-stone-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your messages" className="flex-1 py-2.5 bg-transparent focus:outline-none" />
          </div>

          {mine.length === 0 ? (
            <p className="text-center text-stone-500 pt-12 px-6">
              {q ? 'No messages match that.' : "Messages you write on nudges will show up here."}
            </p>
          ) : (
            <div className="space-y-2">
              {mine.map(m => {
                const r = byId.get(m.reminderId)!;
                const thumb = linkImage(r.url, r.previewImage) ?? r.attachments.find(a => a.type.startsWith('image/'))?.url ?? null;
                return (
                  <button
                    key={m.id}
                    onClick={() => onOpen(r.id)}
                    className="w-full text-left bg-white rounded-2xl border border-stone-200 p-3 active:bg-stone-50"
                  >
                    {/* The nudge it's about */}
                    <span className="flex items-center gap-2.5">
                      <span className="w-9 h-9 shrink-0 rounded-lg overflow-hidden bg-stone-100 text-stone-500 flex items-center justify-center">
                        {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : r.todoItems ? <ListChecks className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] text-stone-900 truncate">{r.title}</span>
                        <span className="block text-[12px] text-stone-500 truncate">{withWhom(r) === 'My Nudges' ? 'in My Nudges' : `with ${withWhom(r)}`}</span>
                      </span>
                      <span className="shrink-0 self-start text-[11px] text-stone-400">{when(m.createdAt)}</span>
                    </span>
                    {/* What you said */}
                    <span className="mt-2 flex justify-end">
                      <span className="max-w-[85%] px-3.5 py-2 rounded-[18px] rounded-br-md bg-blue-500 text-white text-[15px] leading-[20px] line-clamp-4 [overflow-wrap:anywhere] whitespace-pre-wrap">
                        {m.text || '📷 Photo'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
