import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface SwipeAction {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /** Tailwind classes for the button's color, e.g. "bg-stone-500 text-white" */
  className: string;
}

const ACTION_WIDTH = 72;
const OPEN_EVENT = 'nudge-swipe-open';

// Swipe a row left to reveal action buttons behind it (like Mail or Messages).
// Vertical scrolling still works: a swipe only starts once the finger has
// clearly moved sideways. Opening one row closes any other open row.
export function SwipeRow({ actions, disabled, children }: { actions: SwipeAction[]; disabled?: boolean; children: ReactNode }) {
  const id = useId();
  const width = actions.length * ACTION_WIDTH;
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ x: number; y: number; base: number; swiping: boolean; pointerId: number } | null>(null);
  const offset = useRef(0);
  const swallowClick = useRef(false);

  const place = (x: number, animate: boolean) => {
    offset.current = x;
    const el = contentRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
    el.style.transform = x ? `translateX(${x}px)` : '';
  };

  const settle = (shouldOpen: boolean) => {
    setOpen(shouldOpen);
    place(shouldOpen ? -width : 0, true);
    if (shouldOpen) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
  };

  // Close when another row opens, or when this row stops being swipeable
  useEffect(() => {
    const onOtherOpen = (e: Event) => {
      if ((e as CustomEvent).detail !== id && offset.current !== 0) settle(false);
    };
    window.addEventListener(OPEN_EVENT, onOtherOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOtherOpen);
  });
  useEffect(() => {
    if (disabled && offset.current !== 0) settle(false);
  }, [disabled]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    gesture.current = { x: e.clientX, y: e.clientY, base: offset.current, swiping: false, pointerId: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (disabled && !g.swiping) { gesture.current = null; return; } // e.g. the card was picked up to drag
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.swiping) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { gesture.current = null; return; } // scrolling
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      g.swiping = true;
      setDragging(true);
      try { (e.currentTarget as HTMLElement).setPointerCapture(g.pointerId); } catch { /* not capturable */ }
    }
    // Follow the finger; ease off a little past the fully-open position
    let x = g.base + dx;
    if (x > 0) x = 0;
    if (x < -width) x = -width + (x + width) * 0.25;
    place(x, false);
  };

  const onPointerEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.swiping) return;
    setDragging(false);
    swallowClick.current = true;
    setTimeout(() => { swallowClick.current = false; }, 350);
    settle(offset.current < -width / 2);
  };

  const revealed = open || dragging;

  return (
    <div className="relative">
      <div
        className="absolute inset-y-0 right-0 flex items-stretch overflow-hidden rounded-xl"
        style={{ width, visibility: revealed ? 'visible' : 'hidden' }}
        aria-hidden={!open}
      >
        {actions.map(action => (
          <button
            key={action.key}
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={() => { settle(false); action.onClick(); }}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] ${action.className}`}
            style={{ width: ACTION_WIDTH }}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>
      <div
        ref={contentRef}
        className="relative"
        style={{ touchAction: disabled ? undefined : 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          // A swipe shouldn't count as a tap; and tapping an open row just closes it
          if (swallowClick.current || offset.current !== 0) {
            e.stopPropagation();
            e.preventDefault();
            if (!swallowClick.current) settle(false);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
