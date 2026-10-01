import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { ReminderCard, type FolderOptions } from './ReminderCard';
import type { Reminder, Message } from '../App';

interface ReminderListProps {
  reminders: Reminder[];
  viewType: 'sent' | 'received';
  currentUser: string;
  messages: Message[];
  selectedId: string | null;
  onSelectId: (id: string | null) => void;
  onToggleCheckedOut: (id: string) => void;
  onArchive: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onForward: (reminder: Reminder) => void;
  onUpvote?: (id: string) => void;
  onAddMessage: (reminderId: string, text: string) => void;
  onToggleReaction: (reminderId: string, emoji: string) => void;
  reorderable?: boolean;
  onReorder?: (orderedIds: string[]) => void;
  emptyMessage?: string;
  folderOptions?: FolderOptions;
  // Chat threads: nudges you sent sit narrower on the right, received ones on the left
  chatLayout?: boolean;
}

export function ReminderList({
  reminders,
  viewType,
  currentUser,
  messages,
  selectedId,
  onSelectId,
  onToggleCheckedOut,
  onArchive,
  onToggleFavorite,
  onUpdateTitle,
  onForward,
  onUpvote,
  onAddMessage,
  onToggleReaction,
  reorderable,
  onReorder,
  emptyMessage,
  folderOptions,
  chatLayout
}: ReminderListProps) {
  // Drag to reorder. Pick a card up by pressing and holding anywhere on it
  // (or instantly from the grab strip at its top); it then follows your
  // finger, the others slide out of the way, and the list scrolls when you
  // drag near its top or bottom edge. Built on Pointer Events because native
  // HTML5 drag-and-drop doesn't work on touchscreens.
  const [order, setOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    grabOffset: number; // finger distance from the card's top edge
    lastY: number;
    order: string[];
    startOrder: string[];
    scrollEl: HTMLElement | null;
    frame: number | null;
    slotSize: number; // dragged card's height plus the gap below it
  } | null>(null);
  const press = useRef<{ id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const suppressClick = useRef(false);

  const displayOrder = order ?? reminders.map(r => r.id);
  const orderedReminders = displayOrder
    .map(id => reminders.find(r => r.id === id))
    .filter((r): r is Reminder => !!r);
  // Catch any items not yet reflected in a stale `order` (e.g. after a refresh)
  reminders.forEach(r => { if (!displayOrder.includes(r.id)) orderedReminders.push(r); });

  // When the list itself changes order (e.g. a new sort), drop the local drag order
  const incomingKey = reminders.map(r => r.id).join('|');
  useEffect(() => {
    if (!drag.current) setOrder(null);
  }, [incomingKey]);

  // Places the dragged card under the finger. offsetTop is the card's slot in
  // the layout (unaffected by transforms), so the difference is how far to shift it.
  const positionDragged = () => {
    const d = drag.current;
    const container = containerRef.current;
    const el = d && itemRefs.current.get(d.id);
    if (!d || !container || !el) return null;
    const desiredTop = d.lastY - d.grabOffset - container.getBoundingClientRect().top;
    el.style.transform = `translateY(${desiredTop - el.offsetTop}px) scale(1.02)`;
    return desiredTop + el.offsetHeight / 2;
  };

  // Smoothly slide cards to new positions whenever the order changes (FLIP)
  const prevRects = useRef<Map<string, DOMRect>>(new Map());
  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    orderedReminders.forEach(r => {
      const el = itemRefs.current.get(r.id);
      if (el) nextRects.set(r.id, el.getBoundingClientRect());
    });
    orderedReminders.forEach(r => {
      if (r.id === drag.current?.id) return;
      const el = itemRefs.current.get(r.id);
      const prev = prevRects.current.get(r.id);
      const next = nextRects.get(r.id);
      if (!el || !prev || !next) return;
      const deltaY = prev.top - next.top;
      if (Math.abs(deltaY) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${deltaY}px)`;
      void el.offsetHeight; // force reflow so the start position registers
      requestAnimationFrame(() => {
        el.style.transition = 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = '';
      });
    });
    prevRects.current = nextRects;
  }, [displayOrder.join('|')]);

  // While dragging, stop the page from scrolling under the finger (this has
  // to be a non-passive listener, which React's onTouchMove can't be).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const block = (e: TouchEvent) => { if (drag.current) e.preventDefault(); };
    container.addEventListener('touchmove', block, { passive: false });
    return () => container.removeEventListener('touchmove', block);
  }, [reorderable]);

  // After a drag, the finger lifting also counts as a tap — swallow it so the card doesn't open
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const swallow = (e: MouseEvent) => {
      if (suppressClick.current) {
        e.stopPropagation();
        e.preventDefault();
        suppressClick.current = false;
      }
    };
    container.addEventListener('click', swallow, true);
    return () => container.removeEventListener('click', swallow, true);
  }, [reorderable]);

  // IMPORTANT: the cards are never reordered on the page during a drag — iOS
  // stops reporting a finger whose card gets moved mid-touch, which used to
  // leave a drag stuck forever. Instead the other cards just slide aside
  // visually, and the real reorder happens once the finger lifts.
  const tick = () => {
    const d = drag.current;
    if (!d) return;

    // Auto-scroll near the edges, faster the closer you get
    if (d.scrollEl) {
      const r = d.scrollEl.getBoundingClientRect();
      const edge = 70;
      if (d.lastY < r.top + edge) d.scrollEl.scrollTop -= Math.ceil((r.top + edge - d.lastY) / 6);
      else if (d.lastY > r.bottom - edge) d.scrollEl.scrollTop += Math.ceil((d.lastY - (r.bottom - edge)) / 6);
    }

    const center = positionDragged();
    if (center != null) {
      // New slot = how many other cards' (unmoved) middles are above the dragged card's middle
      const others = d.startOrder.filter(id => id !== d.id);
      const target = others.filter(id => {
        const el = itemRefs.current.get(id);
        return el ? el.offsetTop + el.offsetHeight / 2 < center : false;
      }).length;
      const next = [...others.slice(0, target), d.id, ...others.slice(target)];
      if (next.join('|') !== d.order.join('|')) {
        d.order = next;
        // Slide the cards between the old and new slot up or down by one card
        const from = d.startOrder.indexOf(d.id);
        d.startOrder.forEach((id, i) => {
          if (id === d.id) return;
          const el = itemRefs.current.get(id);
          if (!el) return;
          const shift = from < target && i > from && i <= target ? -d.slotSize
            : from > target && i >= target && i < from ? d.slotSize
            : 0;
          el.style.transition = 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)';
          el.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      }
    }
    d.frame = requestAnimationFrame(tick);
  };

  const onWindowMove = (e: PointerEvent) => {
    if (drag.current) drag.current.lastY = e.clientY;
  };

  const endDrag = () => {
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    window.removeEventListener('touchend', endDrag);
    window.removeEventListener('touchcancel', endDrag);
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.frame != null) cancelAnimationFrame(d.frame);

    // Remember where every card is on screen right now, so the FLIP animation
    // glides them from here into their new places once the order is committed.
    const changed = d.order.join('|') !== d.startOrder.join('|');
    const visual = new Map<string, DOMRect>();
    d.startOrder.forEach(id => {
      const el = itemRefs.current.get(id);
      if (!el) return;
      visual.set(id, el.getBoundingClientRect());
      // Dropped back in its own spot: just glide home. Otherwise FLIP takes over below.
      el.style.transition = changed ? 'none' : 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = '';
    });
    prevRects.current = visual;

    setDraggingId(null);
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 400);
    if (changed) {
      setOrder(d.order);
      onReorder?.(d.order);
    }
  };

  const startDrag = (id: string, clientY: number) => {
    if (drag.current) endDrag(); // clear anything left over, just in case
    const el = itemRefs.current.get(id);
    if (!el) return;
    el.style.transition = 'none';
    const next = el.nextElementSibling as HTMLElement | null;
    const gap = next ? next.offsetTop - (el.offsetTop + el.offsetHeight) : 8;
    drag.current = {
      id,
      grabOffset: clientY - el.getBoundingClientRect().top,
      lastY: clientY,
      order: displayOrder,
      startOrder: displayOrder,
      scrollEl: el.closest('.overflow-y-auto') as HTMLElement | null,
      frame: null,
      slotSize: el.offsetHeight + Math.max(gap, 0)
    };
    setDraggingId(id);
    // A light tap you can feel, so you know the card is picked up (no-op where unsupported)
    try {
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    } catch {
      // haptics unavailable — dragging works the same without it
    }
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    // Backup in case iOS reports the finger lifting only as a touch event
    window.addEventListener('touchend', endDrag);
    window.addEventListener('touchcancel', endDrag);
    drag.current.frame = requestAnimationFrame(tick);
  };

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  // Press-and-hold anywhere on a closed card. Moving more than a few pixels
  // first means you're scrolling, so the pickup is cancelled.
  const cardPressHandlers = (id: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (drag.current) endDrag(); // a new touch means any earlier drag is over
      if (!reorderable || selectedId === id || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button, a, input, textarea')) return;
      cancelPress();
      const y = e.clientY;
      press.current = {
        id, x: e.clientX, y,
        timer: setTimeout(() => {
          const p = press.current;
          press.current = null;
          if (p) startDrag(p.id, p.y);
        }, 200)
      };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) cancelPress();
      else if (p) p.y = e.clientY;
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress
  });

  if (reminders.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-stone-500">
          {emptyMessage
            ? emptyMessage
            : reorderable
              ? 'Nothing here yet — drag nudges into the order you want once you have some.'
              : viewType === 'received'
                ? 'No nudges yet. Your friends will send you cool stuff to check out!'
                : 'You haven\'t sent any nudges yet. Send your first one above!'}
        </p>
      </div>
    );
  }

  const handleSelect = (id: string) => {
    onSelectId(selectedId === id ? null : id);
  };

  return (
    <div ref={containerRef} className="space-y-2 relative">
      {orderedReminders.map((reminder) => {
        const isDragging = draggingId === reminder.id;
        const sentByMe = reminder.sender === currentUser;
        return (
          <div
            key={reminder.id}
            ref={(el) => {
              if (el) itemRefs.current.set(reminder.id, el);
              else itemRefs.current.delete(reminder.id);
            }}
            {...cardPressHandlers(reminder.id)}
            className={`relative ${isDragging ? 'z-20 shadow-xl rounded-xl' : ''} ${chatLayout ? `w-[85%] ${sentByMe ? 'ml-auto' : ''}` : ''}`}
            // Stop iOS's text-selection/callout from fighting the press-and-hold
            style={reorderable ? { WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties : undefined}
          >
            <ReminderCard
              reminder={reminder}
              viewType={viewType}
              currentUser={currentUser}
              messages={messages.filter(m => m.reminderId === reminder.id)}
              onToggleCheckedOut={onToggleCheckedOut}
              onArchive={onArchive}
              onToggleFavorite={onToggleFavorite}
              onUpdateTitle={onUpdateTitle}
              onForward={onForward}
              onUpvote={onUpvote}
              onAddMessage={onAddMessage}
              onToggleReaction={onToggleReaction}
              isSelected={selectedId === reminder.id}
              onSelect={handleSelect}
              folderOptions={folderOptions}
              flipped={chatLayout && sentByMe}
              dragHandleProps={
                reorderable
                  ? {
                      onPointerDown: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        cancelPress();
                        startDrag(reminder.id, e.clientY);
                      },
                      style: { touchAction: 'none' }
                    }
                  : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
}
