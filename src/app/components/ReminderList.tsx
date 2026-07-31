import { useState } from 'react';
import { ReminderCard } from './ReminderCard';
import type { Reminder, Message } from '../App';

interface ReminderListProps {
  reminders: Reminder[];
  viewType: 'sent' | 'received';
  currentUser: string;
  messages: Message[];
  onToggleCheckedOut: (id: string) => void;
  onArchive: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onAddMessage: (reminderId: string, text: string) => void;
  onToggleReaction: (reminderId: string, emoji: string) => void;
}

export function ReminderList({ 
  reminders, 
  viewType, 
  currentUser,
  messages,
  onToggleCheckedOut,
  onArchive,
  onToggleFavorite,
  onAddMessage,
  onToggleReaction
}: ReminderListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (reminders.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">
          {viewType === 'received' 
            ? 'No reminders yet. Your friends will send you cool stuff to check out!'
            : 'You haven\'t sent any reminders yet. Send your first one above!'}
        </p>
      </div>
    );
  }

  const handleSelect = (id: string) => {
    setSelectedId(selectedId === id ? null : id);
  };

  return (
    <div className="space-y-2">
      {reminders.map(reminder => (
        <ReminderCard
          key={reminder.id}
          reminder={reminder}
          viewType={viewType}
          currentUser={currentUser}
          messages={messages.filter(m => m.reminderId === reminder.id)}
          onToggleCheckedOut={onToggleCheckedOut}
          onArchive={onArchive}
          onToggleFavorite={onToggleFavorite}
          onAddMessage={onAddMessage}
          onToggleReaction={onToggleReaction}
          isSelected={selectedId === reminder.id}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
}