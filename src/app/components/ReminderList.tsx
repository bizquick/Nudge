import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Bell, BellOff } from 'lucide-react';
import { ReminderCard, type FolderOptions } from './ReminderCard';
import { SwipeRow } from './SwipeRow';
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
  onToggleTodo?: (reminderId: string, index: number) => void;
  onTogglePriority?: (reminderId: string) => void;
  // Drag-and-drop onto other things on the page (Favorites folders). Any element
  // marked data-drop-target="<id>" becomes a place a dragged nudge can be dropped.
  allowReorder?: boolean;
  dropTargets?: boolean;
  onDragActiveChange?: (active: boolean) => void;
  onDropHover?: (targetId: string | null) => void;
  onDropOnTarget?: (reminderId: string, targetId: string) => void;
  // Chats: swipe a nudge left to silence its notifications
  swipeable?: boolean;
  mutedIds?: Set<string>;
  onToggleMute?: (reminderId: string, title: string) => void;
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
  chatLayout,
  onToggleTodo,
  onTogglePriority,
  allowReorder = true,
  dropTargets,
  onDragActiveChange,
  onDropHover,
  onDropOnTarget,
  swipeable,
  mutedIds,
  onToggleMute
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
    grabX: number; // finger distance from the card's left edge
    lastY: number;
    lastX: number;
    hoverTarget: string | null; // drop target (e.g. a folder) under the finger
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
    // Over a folder, shrink toward the fingertip so the highlighted folder shows underneath
    // (uses the separate CSS translate/scale properties so the shrink doesn't also shrink the move)
    el.style.transformOrigin = `${d.grabX}px ${d.grabOffset}px`;
    el.style.transition = 'scale 150ms ease-out, opacity 150ms ease-out';
    el.style.transform = '';
    el.style.translate = `0 ${desiredTop - el.offsetTop}px`;
    // Where it can be dropped into a folder, it's smaller from the moment it's picked up
    el.style.scale = d.hoverTarget ? '0.35' : dropTargets ? '0.6' : '1.02';
    el.style.opacity = d.hoverTarget ? '0.85' : '';
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

    // Over a drop target (a folder)? Then this drop files it there instead of reordering.
    if (dropTargets) {
      let hovered: string | null = null;
      document.querySelectorAll<HTMLElement>('[data-drop-target]').forEach(el => {
        const r = el.getBoundingClientRect();
        if (d.lastX >= r.left && d.lastX <= r.right && d.lastY >= r.top && d.lastY <= r.bottom) {
          hovered = el.dataset.dropTarget ?? null;
        }
      });
      if (hovered !== d.hoverTarget) {
        d.hoverTarget = hovered;
        onDropHover?.(hovered);
        if (hovered) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      }
    }

    if (center != null && allowReorder && !d.hoverTarget) {
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
    if (!drag.current) return;
    drag.current.lastY = e.clientY;
    drag.current.lastX = e.clientX;
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
    const droppedOn = d.hoverTarget;
    // Dropped on a folder: everything glides back to where it was, and the nudge is filed
    const changed = !droppedOn && allowReorder && d.order.join('|') !== d.startOrder.join('|');
    const visual = new Map<string, DOMRect>();
    d.startOrder.forEach(id => {
      const el = itemRefs.current.get(id);
      if (!el) return;
      visual.set(id, el.getBoundingClientRect());
      // Dropped back in its own spot: just glide home. Otherwise FLIP takes over below.
      el.style.transition = changed
        ? 'none'
        : 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1), translate 200ms cubic-bezier(0.22, 1, 0.36, 1), scale 200ms ease-out, opacity 200ms ease-out';
      el.style.transform = '';
      el.style.translate = '';
      el.style.scale = '';
      el.style.opacity = '';
    });
    prevRects.current = visual;

    setDraggingId(null);
    onDragActiveChange?.(false);
    if (droppedOn) {
      onDropHover?.(null);
      onDropOnTarget?.(d.id, droppedOn);
    }
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 400);
    if (changed) {
      setOrder(d.order);
      onReorder?.(d.order);
    }
  };

  const startDrag = (id: string, clientY: number, clientX = 0) => {
    if (drag.current) endDrag(); // clear anything left over, just in case
    const el = itemRefs.current.get(id);
    if (!el) return;
    el.style.transition = 'none';
    const next = el.nextElementSibling as HTMLElement | null;
    const gap = next ? next.offsetTop - (el.offsetTop + el.offsetHeight) : 8;
    drag.current = {
      id,
      grabOffset: clientY - el.getBoundingClientRect().top,
      grabX: clientX - el.getBoundingClientRect().left,
      lastY: clientY,
      lastX: clientX,
      hoverTarget: null,
      order: displayOrder,
      startOrder: displayOrder,
      scrollEl: el.closest('.overflow-y-auto') as HTMLElement | null,
      frame: null,
      slotSize: el.offsetHeight + Math.max(gap, 0)
    };
    setDraggingId(id);
    onDragActiveChange?.(true);
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
          if (p) startDrag(p.id, p.y, p.x);
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
        const muted = mutedIds?.has('nudge:' + reminder.id) ?? false;
        const card = (
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
            onToggleTodo={onToggleTodo}
            onTogglePriority={onTogglePriority}
            muted={muted}
            flipped={chatLayout && sentByMe}
            dragHandleProps={
              reorderable
                ? {
                    onPointerDown: (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelPress();
                      startDrag(reminder.id, e.clientY, e.clientX);
                    },
                    style: { touchAction: 'none' }
                  }
                : undefined
            }
          />
        );
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
            {swipeable ? (
              <SwipeRow
                disabled={selectedId === reminder.id}
                actions={[
                  {
                    key: 'mute',
                    label: muted ? 'Unmute' : 'Silence',
                    icon: muted ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />,
                    onClick: () => onToggleMute?.(reminder.id, reminder.title),
                    className: 'bg-indigo-500 text-white',
                  },
                ]}
              >
                {card}
              </SwipeRow>
            ) : card}
          </div>
        );
      })}
    </div>
  );
}
