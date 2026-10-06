import { useState } from 'react';

// A small emoji panel for typing: tap one to add it where you're typing.
const GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Faces', emojis: ['😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😅', '😭', '😢', '😮', '🤯', '😳', '🙄', '😬', '🤔', '🫠', '😴', '🤤', '😇', '🙃', '😏'] },
  { label: 'Hands', emojis: ['👍', '👎', '👏', '🙌', '🙏', '👀', '💪', '🤝', '👋', '✌️', '🤞', '🫶'] },
  { label: 'Hearts', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '💯', '🔥', '✨', '⭐'] },
  { label: 'Fun', emojis: ['🎉', '🎶', '🎬', '📸', '🍕', '🌮', '🍔', '🍩', '☕', '🍻', '🏖️', '✈️', '🐶', '🐱', '⚽', '🏀'] },
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [group, setGroup] = useState(0);
  return (
    <div className="rounded-2xl bg-white border border-stone-200 shadow-lg p-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex gap-1 mb-1.5">
        {GROUPS.map((g, i) => (
          <button
            key={g.label}
            type="button"
            onClick={() => setGroup(i)}
            className={`px-2.5 py-1 rounded-full text-xs ${i === group ? 'bg-brand-600 text-white' : 'text-stone-600 bg-stone-100'}`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-0.5">
        {GROUPS[group].emojis.map(e => (
          <button
            key={e}
            type="button"
            // onMouseDown keeps the keyboard up and the cursor where it was
            onMouseDown={(ev) => { ev.preventDefault(); onPick(e); }}
            className="h-10 text-2xl rounded-lg active:bg-stone-100"
            aria-label={`Add ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Put text at the cursor in a text box (or at the end), returning the new value */
export function insertAtCursor(el: HTMLTextAreaElement | HTMLInputElement | null, value: string, text: string): string {
  if (!el || el.selectionStart == null) return value + text;
  const start = el.selectionStart;
  const end = el.selectionEnd ?? start;
  const next = value.slice(0, start) + text + value.slice(end);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
  });
  return next;
}
