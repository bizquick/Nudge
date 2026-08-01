import { useState } from 'react';
import { ReminderCard } from './ReminderCard';
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
  onToggleCurated: (id: string) => void;
  onAddMessage: (reminderId: string, text: string) => void;
  onToggleReaction: (reminderId: string, emoji: string) => void;
  reorderable?: boolean;
  onReorder?: (orderedIds: string[]) => void;
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
  onToggleCurated,
  onAddMessage,
  onToggleReaction,
  reorderable,
  onReorder
}: ReminderListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (reminders.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">
          {reorderable
            ? "Nothing curated yet. Open a reminder and tap \"Add to Curated\" to start building your list."
            : viewType === 'received'
              ? 'No reminders yet. Your friends will send you cool stuff to check out!'
              : 'You haven\'t sent any reminders yet. Send your first one above!'}
        </p>
      </div>
    );
  }

  const handleSelect = (id: string) => {
    onSelectId(selectedId === id ? null : id);
  };

  const handleDrop = (dropIndex: number) => {
    if (dragIndex === null || dragIndex === dropIndex || !onReorder) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const reordered = [...reminders];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    onReorder(reordered.map(r => r.id));
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="space-y-2">
      {reminders.map((reminder, index) => (
        <div
          key={reminder.id}
          onDragOver={(e) => {
            if (!reorderable) return;
            e.preventDefault();
            if (overIndex !== index) setOverIndex(index);
          }}
          onDrop={(e) => {
            if (!reorderable) return;
            e.preventDefault();
            handleDrop(index);
          }}
          className={reorderable && overIndex === index && dragIndex !== null && dragIndex !== index ? 'border-t-2 border-indigo-400' : ''}
        >
          <ReminderCard
            reminder={reminder}
            viewType={viewType}
            currentUser={currentUser}
            messages={messages.filter(m => m.reminderId === reminder.id)}
            onToggleCheckedOut={onToggleCheckedOut}
            onArchive={onArchive}
            onToggleFavorite={onToggleFavorite}
            onToggleCurated={onToggleCurated}
            onAddMessage={onAddMessage}
            onToggleReaction={onToggleReaction}
            isSelected={selectedId === reminder.id}
            onSelect={handleSelect}
            dragHandleProps={
              reorderable
                ? {
                    draggable: true,
                    onDragStart: () => setDragIndex(index),
                    onDragEnd: () => { setDragIndex(null); setOverIndex(null); }
                  }
                : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}
