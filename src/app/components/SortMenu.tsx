import { useEffect, useRef, useState } from 'react';
import { ArrowUpDown, Check } from 'lucide-react';
import type { Reminder, ReminderType } from '../App';

export type SortKey = 'custom' | 'date' | 'sender' | 'category';
export type SortDir = 'asc' | 'desc';
export interface SortSetting { key: SortKey; dir: SortDir }

const CATEGORY_LABELS: Record<ReminderType, string> = {
  website: 'Website',
  music: 'Music',
  video: 'Video',
  text: 'Text',
  unnecessary: 'Do we need this?!',
  interesting: 'Interesting',
  food: 'Food',
  lifehack: 'Life Hack'
};

const KEY_LABELS: Record<SortKey, string> = {
  custom: 'Custom order',
  date: 'Date received',
  sender: 'Sender',
  category: 'Category'
};

// Plain-language names for each direction ("ascending" means oldest first for dates)
function dirLabel(key: SortKey, dir: SortDir) {
  if (key === 'date') return dir === 'desc' ? 'Newest first' : 'Oldest first';
  return dir === 'asc' ? 'A to Z' : 'Z to A';
}

export function sortReminders(list: Reminder[], { key, dir }: SortSetting): Reminder[] {
  const byNewest = (a: Reminder, b: Reminder) => b.createdAt.getTime() - a.createdAt.getTime();
  const sorted = [...list];
  if (key === 'custom') {
    // Your drag order first; anything never dragged falls in newest-first after it
    return sorted.sort((a, b) => {
      const ao = a.manualOrder ?? Infinity;
      const bo = b.manualOrder ?? Infinity;
      return ao !== bo ? ao - bo : byNewest(a, b);
    });
  }
  const flip = dir === 'asc' ? 1 : -1;
  if (key === 'date') return sorted.sort((a, b) => flip * (a.createdAt.getTime() - b.createdAt.getTime()));
  const text = (r: Reminder) =>
    key === 'sender' ? r.sender : r.type ? CATEGORY_LABELS[r.type] : '';
  return sorted.sort((a, b) => {
    const ta = text(a), tb = text(b);
    // Nudges without a category always go last, whichever direction
    if (!ta !== !tb) return ta ? -1 : 1;
    return flip * ta.localeCompare(tb, undefined, { sensitivity: 'base' }) || byNewest(a, b);
  });
}

// Remembers each list's sort choice on this device
export function loadSortSetting(listName: string): SortSetting {
  try {
    const saved = JSON.parse(localStorage.getItem(`nudge.sort.${listName}`) || 'null');
    if (saved && KEY_LABELS[saved.key as SortKey] && (saved.dir === 'asc' || saved.dir === 'desc')) return saved;
  } catch {
    // storage unavailable — fall back to default
  }
  return { key: 'custom', dir: 'desc' };
}

export function saveSortSetting(listName: string, setting: SortSetting) {
  try {
    localStorage.setItem(`nudge.sort.${listName}`, JSON.stringify(setting));
  } catch {
    // storage unavailable — the choice just won't be remembered
  }
}

export function SortMenu({ value, onChange }: { value: SortSetting; onChange: (s: SortSetting) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const pickKey = (key: SortKey) => {
    // Sensible starting direction: newest first for dates, A to Z for names
    onChange({ key, dir: key === value.key ? value.dir : key === 'date' ? 'desc' : 'asc' });
    if (key === 'custom') setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-stone-600 hover:bg-stone-100 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ArrowUpDown className="w-3.5 h-3.5" />
        {value.key === 'custom' ? KEY_LABELS.custom : `${KEY_LABELS[value.key]} · ${dirLabel(value.key, value.dir)}`}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-30 w-56 bg-white rounded-xl shadow-lg border border-stone-200 py-1">
          {(Object.keys(KEY_LABELS) as SortKey[]).map(key => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={value.key === key}
              onClick={() => pickKey(key)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
            >
              <span>
                {KEY_LABELS[key]}
                {key === 'custom' && <span className="block text-[11px] text-stone-400">Drag to arrange</span>}
              </span>
              {value.key === key && <Check className="w-4 h-4 text-orange-600" />}
            </button>
          ))}

          {value.key !== 'custom' && (
            <div className="mx-3 mt-1 mb-2 flex rounded-lg border border-stone-300 p-0.5 text-xs" role="radiogroup" aria-label="Sort direction">
              {(value.key === 'date' ? (['desc', 'asc'] as const) : (['asc', 'desc'] as const))
                .map(dir => (
                  <button
                    key={dir}
                    type="button"
                    role="radio"
                    aria-checked={value.dir === dir}
                    onClick={() => onChange({ ...value, dir })}
                    className={`flex-1 px-2 py-1 rounded-md transition-colors ${
                      value.dir === dir ? 'bg-orange-600 text-white' : 'text-stone-600'
                    }`}
                  >
                    {dirLabel(value.key, dir)}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
