import { useRef, useState } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Clipboard } from '@capacitor/clipboard';
import { toast } from 'sonner';

// A message's text: hold it for a moment to copy the whole thing, or select part of it
// to copy just that. Links inside open in the browser, and long unbroken text
// (links, "hahahahaha...") wraps instead of running off the edge.

const LINK = /(https?:\/\/[^\s<>"']+)/gi;

function linkify(text: string) {
  return text.split(LINK).map((part, i) => {
    if (i % 2 === 0) return part;
    const url = part.replace(/[),.;!?]+$/, '');
    const trailing = part.slice(url.length);
    return (
      <span key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>{url}</a>
        {trailing}
      </span>
    );
  });
}

export function MessageText({ text, className = '' }: { text: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const handedOff = useRef(false);
  const [flash, setFlash] = useState(false);

  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const copyAll = async () => {
    timer.current = null;
    // iOS took over the touch: that's either its text selection (copy) or a scroll (don't)
    if (handedOff.current) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !box.current?.contains(sel.anchorNode)) return;
    }
    try {
      await Clipboard.write({ string: text });
    } catch {
      return; // copying isn't allowed here — the text is still selectable
    }
    // Select the whole message too, so the handles can be dragged to copy just part of it
    const sel = window.getSelection();
    if (sel && box.current) {
      const range = document.createRange();
      range.selectNodeContents(box.current);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    setFlash(true);
    window.setTimeout(() => setFlash(false), 450);
    toast('Copied message');
  };

  return (
    <div
      ref={box}
      className={`select-text whitespace-pre-wrap [overflow-wrap:anywhere] transition-opacity ${flash ? 'opacity-60' : ''} ${className}`}
      style={{ WebkitUserSelect: 'text', WebkitTouchCallout: 'default' } as React.CSSProperties}
      // Keep presses on a message from starting a swipe on the card behind it
      onPointerDown={(e) => {
        e.stopPropagation();
        start.current = { x: e.clientX, y: e.clientY };
        cancel();
        handedOff.current = false;
        timer.current = window.setTimeout(copyAll, 550);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) cancel();
      }}
      onPointerUp={cancel}
      // iOS "cancels" the touch the moment its own text selection kicks in; the hold still counts
      onPointerCancel={() => { handedOff.current = true; }}
    >
      {linkify(text)}
    </div>
  );
}
