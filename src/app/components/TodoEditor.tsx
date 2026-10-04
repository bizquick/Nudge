import { useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { Avatar, ProfileLink } from './Avatar';
import type { TodoItem } from '../App';

// A shared to-do list inside a nudge, like a shared list in Reminders: everyone in the
// nudge can tick lines, tap a line's words to reword it, delete it, or add new lines.
interface TodoEditorProps {
  items: TodoItem[];
  currentUser: string;
  /** People outside the nudge (e.g. someone else's Public list) can only look */
  canEdit: boolean;
  onToggle: (index: number) => void;
  onEdit?: (op: 'add' | 'edit' | 'delete', itemId?: string, text?: string) => void;
}

export function TodoEditor({ items, currentUser, canEdit, onToggle, onEdit }: TodoEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newItem, setNewItem] = useState('');
  const addRef = useRef<HTMLInputElement>(null);
  const editable = canEdit && !!onEdit;

  const saveEdit = (item: TodoItem) => {
    if (item.id && draft.trim() !== item.text) onEdit?.(draft.trim() ? 'edit' : 'delete', item.id, draft);
    setEditingId(null);
  };
  const addItem = () => {
    if (!newItem.trim()) return;
    onEdit?.('add', undefined, newItem);
    setNewItem('');
    addRef.current?.focus(); // keep typing the next one, like Reminders
  };

  return (
    <div className="mt-2 mb-3" onClick={(e) => e.stopPropagation()}>
      <ul className="space-y-0.5">
        {items.map((item, i) => {
          const editing = editable && !!item.id && editingId === item.id;
          return (
            <li key={item.id ?? i} className="flex items-center gap-3 py-1">
              <button
                type="button"
                role="checkbox"
                aria-checked={item.done}
                aria-label={item.done ? `Untick ${item.text}` : `Tick ${item.text}`}
                onClick={() => onToggle(i)}
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                  item.done ? 'bg-green-500 border-green-500 text-white' : 'border-stone-300 bg-white'
                }`}
              >
                {item.done && <Check className="w-3.5 h-3.5" />}
              </button>
              {editing ? (
                <>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => saveEdit(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    maxLength={300}
                    className="flex-1 min-w-0 bg-transparent border-b border-brand-400 focus:outline-none text-stone-800"
                  />
                  <button
                    type="button"
                    // onMouseDown so it runs before the text box loses focus and saves
                    onMouseDown={(e) => { e.preventDefault(); onEdit?.('delete', item.id); setEditingId(null); }}
                    className="p-1 text-stone-400 hover:text-red-500 shrink-0"
                    aria-label={`Delete ${item.text}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={!editable || !item.id}
                  onClick={() => { setEditingId(item.id!); setDraft(item.text); }}
                  className={`flex-1 min-w-0 text-left break-words ${item.done ? 'text-stone-400 line-through' : 'text-stone-800'}`}
                  title={editable ? 'Tap to edit' : undefined}
                >
                  {item.text}
                </button>
              )}
              {/* Who ticked it off */}
              {!editing && item.done && item.by && (
                <span className="shrink-0 flex items-center gap-1 text-[11px] text-stone-500" title={item.at ? new Date(item.at).toLocaleString() : undefined}>
                  <Avatar name={item.by} size={16} profile />
                  {item.by === currentUser ? 'You' : <ProfileLink name={item.by}>{item.by}</ProfileLink>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {editable && (
        <div className="flex items-center gap-3 py-1 mt-0.5">
          <span className="w-6 h-6 rounded-full border-2 border-dashed border-stone-300 flex items-center justify-center shrink-0 text-stone-400">
            <Plus className="w-3.5 h-3.5" />
          </span>
          <input
            ref={addRef}
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
            onBlur={addItem}
            placeholder="Add an item"
            maxLength={300}
            enterKeyHint="done"
            className="flex-1 min-w-0 bg-transparent focus:outline-none placeholder:text-stone-400 text-stone-800"
          />
        </div>
      )}
    </div>
  );
}
