import { Link, Music, Video, Type, ExternalLink, Check, MessageCircle, Send, Archive, Star, SmilePlus, Mail } from 'lucide-react';
import { useState } from 'react';
import type { Reminder, Message } from '../App';

interface ReminderCardProps {
  reminder: Reminder;
  viewType: 'sent' | 'received';
  currentUser: string;
  messages: Message[];
  onToggleCheckedOut: (id: string) => void;
  onArchive: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onAddMessage: (reminderId: string, text: string) => void;
  onToggleReaction: (reminderId: string, emoji: string) => void;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

export function ReminderCard({ 
  reminder, 
  viewType, 
  currentUser,
  messages,
  onToggleCheckedOut,
  onArchive,
  onToggleFavorite,
  onAddMessage,
  onToggleReaction,
  isSelected,
  onSelect
}: ReminderCardProps) {
  const [showMessages, setShowMessages] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  const icons = {
    link: Link,
    music: Music,
    video: Video,
    text: Type
  };

  const colors = {
    link: 'bg-blue-100 text-blue-600',
    music: 'bg-purple-100 text-purple-600',
    video: 'bg-red-100 text-red-600',
    text: 'bg-gray-100 text-gray-600'
  };

  const Icon = icons[reminder.type];
  
  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  const formatTime = (date: Date) => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim()) {
      onAddMessage(reminder.id, newMessage);
      setNewMessage('');
    }
  };

  const availableEmojis = ['👍', '👎', '❤️', '💩', '😂', '🔥', '👏', '🎉'];

  const handleReactionClick = (emoji: string) => {
    onToggleReaction(reminder.id, emoji);
    setShowReactionPicker(false);
  };

  // Check if there are unread messages
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const hasUnreadMessages = lastMessage && lastMessage.sender !== currentUser;

  // Get display text (title or URL if no title)
  const displayText = reminder.title || reminder.url || reminder.content;

  return (
    <div className={`bg-white rounded-xl shadow-sm border-2 transition-all ${ 
      reminder.checkedOut 
        ? 'border-green-200 bg-green-50/30' 
        : 'border-gray-200 hover:border-gray-300'
    } ${isSelected ? 'ring-2 ring-indigo-400' : ''}`}>
      <div 
        className={`cursor-pointer relative transition-all ${isSelected ? 'p-4 sm:p-5' : 'p-3 sm:p-4'}`}
        onClick={() => onSelect(reminder.id)}
      >
        {/* Checkmark Button - Upper Left (Always visible, clickable) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheckedOut(reminder.id);
          }}
          className={`absolute top-3 left-3 sm:top-4 sm:left-4 ${isSelected ? 'p-2.5 sm:p-3' : 'p-2.5 sm:p-2.5'} rounded-lg shrink-0 transition-all hover:scale-110 ${
            reminder.checkedOut
              ? 'bg-green-100 text-green-600'
              : 'bg-white border-2 border-gray-300 text-gray-400 hover:bg-gray-50 hover:border-gray-400'
          }`}
          title={reminder.checkedOut ? 'Mark as unread' : 'Mark as checked out'}
        >
          <Check className="w-5 h-5" />
        </button>

        {/* Sender Avatar Bubble - Upper Right (only when expanded) */}
        {isSelected && (
          <div className="absolute top-3 right-3 sm:top-5 sm:right-5">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white text-sm sm:text-sm shrink-0">
              {viewType === 'received' 
                ? reminder.sender.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                : reminder.recipient.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
              }
            </div>
          </div>
        )}

        {/* Type Icon - Position changes based on expanded/collapsed state */}
        {isSelected ? (
          // When expanded - Middle Left (Absolute positioned)
          <div className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 p-2 sm:p-3 rounded-lg bg-opacity-100 shrink-0" style={{ backgroundColor: colors[reminder.type].split(' ')[0].replace('bg-', ''), color: colors[reminder.type].split(' ')[1].replace('text-', '') }}>
            <div className={`${colors[reminder.type]}`}>
              <Icon className="w-5 h-5 sm:w-5 sm:h-5" />
            </div>
          </div>
        ) : null}

        <div className={`flex items-start gap-2 sm:gap-4 ${isSelected ? 'pr-12 sm:pr-12 pl-14 sm:pl-14' : 'pr-20 sm:pr-28 pl-14 sm:pl-14'}`}>
          {/* Content */}
          <div className="flex-1 min-w-0">
            {!isSelected ? (
              // Collapsed view - just title/link
              <div className="flex items-center justify-between gap-2 py-1.5">
                <h3 className="text-base sm:text-base truncate">{displayText}</h3>
              </div>
            ) : (
              // Expanded view - full content
              <>
                <div className="flex items-start justify-between gap-2 sm:gap-3 mb-2">
                  <div className="flex-1">
                    <h3 className="mb-1 text-lg sm:text-lg">{reminder.title}</h3>
                  </div>
                </div>

                <p className="text-gray-700 mb-3">{reminder.content}</p>

                {/* URL Link */}
                {reminder.url && (
                  <a
                    href={reminder.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 mb-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open link
                  </a>
                )}

                {/* Action Buttons - Only show when expanded */}
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleCheckedOut(reminder.id);
                      }}
                      className={`flex-1 px-3 sm:px-4 py-2.5 sm:py-2 rounded-lg transition-colors text-sm sm:text-sm ${
                        reminder.checkedOut
                          ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {reminder.checkedOut 
                        ? 'Unchecked' 
                        : viewType === 'received' 
                          ? 'Checked out' 
                          : 'Waiting...'} 
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onArchive(reminder.id);
                      }}
                      className="px-3 sm:px-4 py-2.5 sm:py-2 rounded-lg transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-2"
                      title={reminder.archived ? 'Unarchive' : 'Archive'}
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(reminder.id);
                      }}
                      className={`px-3 sm:px-4 py-2.5 sm:py-2 rounded-lg transition-colors flex items-center gap-2 ${
                        reminder.favorited 
                          ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      title={reminder.favorited ? 'Unfavorite' : 'Favorite'}
                    >
                      <Star className={`w-4 h-4 ${reminder.favorited ? 'fill-yellow-500 text-yellow-500' : ''}`} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right side indicators - Only when collapsed */}
        {!isSelected && (
          <div className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 sm:gap-2">
            {/* Sender Initial */}
            <div className="w-8 h-8 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white text-xs shrink-0">
              {viewType === 'received' 
                ? reminder.sender[0].toUpperCase()
                : reminder.recipient[0].toUpperCase()
              }
            </div>
            
            {/* Type Icon with unread indicator */}
            <div className="relative">
              <div className={`p-2 sm:p-2 rounded-lg ${colors[reminder.type]} shrink-0`}>
                <Icon className="w-4 h-4 sm:w-4 sm:h-4" />
              </div>
              {/* Unread messages indicator */}
              {hasUnreadMessages && (
                <div className="absolute -top-1 -right-1 w-3 h-3 sm:w-3 sm:h-3 rounded-full bg-indigo-600 border-2 border-white"></div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Messages Section - Only show when expanded */}
      {isSelected && (
        <div className="border-t border-gray-200">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMessages(!showMessages);
            }}
            className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2 text-sm">
              <MessageCircle className="w-4 h-4" />
              <span>
                {messages.length === 0 
                  ? 'Add a message' 
                  : `${messages.length} message${messages.length === 1 ? '' : 's'}`}
              </span>
            </div>
            <svg
              className={`w-4 h-4 transition-transform ${showMessages ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showMessages && (
            <div className="px-5 pb-5 pt-2 bg-gray-50" onClick={(e) => e.stopPropagation()}>
              {/* Message Thread */}
              {messages.length > 0 && (
                <div className="space-y-3 mb-4">
                  {messages.map(message => (
                    <div
                      key={message.id}
                      className={`flex gap-2 ${
                        message.sender === currentUser ? 'flex-row-reverse' : ''
                      }`}
                    >
                      <div
                        className={`max-w-[75%] rounded-lg px-3 py-2 ${
                          message.sender === currentUser
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white border border-gray-200'
                        }`}
                      >
                        <p className="text-sm mb-1">{message.text}</p>
                        <div
                          className={`text-xs ${
                            message.sender === currentUser
                              ? 'text-indigo-200'
                              : 'text-gray-500'
                          }`}
                        >
                          {message.sender} • {formatTime(message.createdAt)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Message Input */}
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim()}
                  className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Reactions Section - Only show when expanded */}
      {isSelected && (
        <div className="border-t border-gray-200 px-5 py-3 bg-gray-50">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Existing Reactions */}
            {reminder.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                onClick={(e) => {
                  e.stopPropagation();
                  handleReactionClick(reaction.emoji);
                }}
                className={`px-2 py-1 rounded-full border transition-all hover:scale-110 ${
                  reaction.users.includes(currentUser)
                    ? 'bg-indigo-100 border-indigo-300'
                    : 'bg-white border-gray-300 hover:bg-gray-100'
                }`}
                title={reaction.users.join(', ')}
              >
                <span className="text-base">{reaction.emoji}</span>
                {reaction.users.length > 1 && (
                  <span className="text-xs ml-1 text-gray-600">{reaction.users.length}</span>
                )}
              </button>
            ))}

            {/* Add Reaction Button */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowReactionPicker(!showReactionPicker);
                }}
                className="px-2 py-1 rounded-full border border-gray-300 bg-white hover:bg-gray-100 transition-colors"
                title="Add reaction"
              >
                <SmilePlus className="w-4 h-4 text-gray-600" />
              </button>

              {/* Reaction Picker Popup */}
              {showReactionPicker && (
                <div 
                  className="absolute bottom-full left-0 mb-2 bg-white rounded-lg shadow-lg border border-gray-200 p-2 flex gap-1 z-10"
                  onClick={(e) => e.stopPropagation()}
                >
                  {availableEmojis.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReactionClick(emoji);
                      }}
                      className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded transition-colors"
                    >
                      <span className="text-lg">{emoji}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Star Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(reminder.id);
              }}
              className={`px-2 py-1 rounded-full border transition-all hover:scale-110 ${
                reminder.favorited
                  ? 'bg-yellow-100 border-yellow-300'
                  : 'bg-white border-gray-300 hover:bg-gray-100'
              }`}
              title={reminder.favorited ? 'Unfavorite' : 'Favorite'}
            >
              <Star className={`w-4 h-4 ${reminder.favorited ? 'fill-yellow-500 text-yellow-500' : 'text-gray-600'}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}