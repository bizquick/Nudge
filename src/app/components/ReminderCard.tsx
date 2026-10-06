import { Globe, Music, Video, Type as TypeIcon, Sparkles, UtensilsCrossed, Lightbulb, ExternalLink, Check, MessageCircle, Send, Archive, Star, SmilePlus, Pencil, Forward, Heart, Globe2, FolderInput, BellOff, ListChecks, FileText, ImagePlus, Loader2, X, ArrowUp, Smile, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Reminder, Message } from '../App';
import type { Folder } from './FolderBar';
import { Avatar, ProfileLink } from './Avatar';
import { CATEGORY_LABELS } from './SortMenu';
import { PhotoViewer } from './PhotoViewer';
import { TodoEditor } from './TodoEditor';
import { LinkCard } from './LinkCard';
import { EmojiPicker, insertAtCursor } from './EmojiPicker';
import { MessageText } from './MessageText';
import { ChatScreen } from './ChatScreen';
import { createPortal } from 'react-dom';
import { guessCategory } from '../utils/guessCategory';
import { uploadAttachment } from '../utils/upload';
import type { Attachment } from '../App';

// lucide-react doesn't have a literal money-bag glyph, so this renders the
// emoji instead, matching the one used in the send/compose screen.
function MoneyBagIcon({ className }: { className?: string }) {
  return (
    <span className={`${className ?? ''} inline-flex items-center justify-center leading-none`} style={{ fontSize: '1.05em' }}>
      💰
    </span>
  );
}

interface ReminderCardProps {
  reminder: Reminder;
  viewType: 'sent' | 'received';
  currentUser: string;
  messages: Message[];
  onToggleCheckedOut: (id: string) => void;
  onArchive: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onForward: (reminder: Reminder) => void;
  onUpvote?: (id: string) => void;
  onAddMessage: (reminderId: string, text: string, attachments?: Attachment[]) => void;
  onToggleReaction: (reminderId: string, emoji: string) => void;
  isSelected: boolean;
  onSelect: (id: string) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  folderOptions?: FolderOptions;
  // Mirror the layout (avatar on the left, title/category on the right) for nudges you sent, in chats
  flipped?: boolean;
  onToggleTodo?: (reminderId: string, index: number) => void;
  onTogglePriority?: (reminderId: string) => void;
  /** You've silenced notifications for this nudge */
  muted?: boolean;
  /** Home-screen style: big preview tile, plus who/when/what on a second line */
  rich?: boolean;
  /** Favorites: no check mark (they're personal) — the sent/checked times say it all */
  hideCheck?: boolean;
  /** A checked nudge with messages you haven't seen yet */
  hasNewMessages?: boolean;
  onToggleTodoComplete?: (reminderId: string) => void;
  onTodoEdit?: (reminderId: string, op: 'toggle' | 'add' | 'edit' | 'delete', itemId?: string, text?: string) => void;
  /** Popular/Explore: anyone can check (privately, just for themselves) and favorite */
  anyoneCanCheck?: boolean;
  /** You sent this, and these people haven't accepted your nudge request yet */
  pendingRecipients?: string[];
  onWithdraw?: (reminderId: string) => void;
  /** Open the messages straight away (came from a message notification) */
  openMessages?: boolean;
  /** Everyone who has checked this nudge (each person's check is their own) */
  checkedBy?: string[];
  /** Shown under the big "Up next" card: only what that card doesn't already show */
  compact?: boolean;
}

// "Today 6:45 PM", "Yesterday 9:02 AM", "Sep 3, 6:45 PM", "Sep 3, 2025, 6:45 PM"
function stampTime(date: Date) {
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  const day = date.toLocaleDateString(undefined, date.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
  return `${day}, ${time}`;
}

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Lets a favorited nudge be filed into one of your Favorites folders
export interface FolderOptions {
  folders: Folder[];
  folderOf: (reminderId: string) => string | null;
  onMove: (reminderId: string, folderId: string | null) => void;
}

export function ReminderCard({ 
  reminder, 
  viewType, 
  currentUser,
  messages,
  onToggleCheckedOut,
  onArchive,
  onToggleFavorite,
  onUpdateTitle,
  onForward,
  onUpvote,
  onAddMessage,
  onToggleReaction,
  isSelected,
  onSelect,
  dragHandleProps,
  folderOptions,
  flipped,
  onToggleTodo,
  onTogglePriority,
  muted,
  rich,
  hideCheck,
  hasNewMessages: hasUnseenMessages,
  onToggleTodoComplete,
  onTodoEdit,
  anyoneCanCheck,
  pendingRecipients,
  onWithdraw,
  openMessages,
  checkedBy,
  compact
}: ReminderCardProps) {
  const todos = reminder.todoItems;
  const todosDone = todos ? todos.filter(t => t.done).length : 0;
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  // Attached photos show big when the nudge is open; tapping one goes full screen
  const photos = reminder.attachments.filter(a => a.type.startsWith('image/')).map(a => a.url);
  const files = reminder.attachments.filter(a => !a.type.startsWith('image/'));
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Saved to your own My Nudges — tinted light gold so you can tell it's from you
  const fromMe = reminder.sender === currentUser && reminder.recipients.includes(currentUser);
  // Sent by you to other people (not just saved to My Nudges) — tinted light blue
  const sentByMe = reminder.sender === currentUser && !fromMe;
  // Only people in a nudge can change it (mark read, favorite, archive) — on someone
  // else's public nudge in Popular those buttons are hidden, since they couldn't save.
  const isParticipant = reminder.sender === currentUser || reminder.recipients.includes(currentUser);
  // To-do lists: everyone in it taps Complete; it's checked once all of them have
  const everyone = Array.from(new Set([reminder.sender, ...reminder.recipients]));
  const iCompleted = reminder.completedBy.includes(currentUser);
  // Checks are personal: you check what was sent to you. On something you only sent,
  // "Checked" appears once the people you sent it to have checked it.
  const sentOnlyByMe = reminder.sender === currentUser && !reminder.recipients.includes(currentUser);
  const canCheck = (isParticipant || !!anyoneCanCheck) && !(sentOnlyByMe && !anyoneCanCheck);
  const waitingOn = reminder.sender === currentUser ? (pendingRecipients ?? []) : [];

  // Small line at the top of the card: when it was sent, and when it was checked
  const stampLine = (
    <p className={`text-[11px] leading-4 text-stone-400 truncate ${rich ? 'mb-1.5' : 'mb-1'} ${flipped ? 'text-right' : ''}`}>
      {[
        `Sent ${stampTime(reminder.createdAt)}`,
        (isParticipant || anyoneCanCheck) && reminder.checkedOut
          ? `${todos ? 'Completed' : '✓ Checked'}${reminder.checkedAt ? ' ' + stampTime(reminder.checkedAt) : ''}`
          : null,
      ].filter(Boolean).join(' · ')}
      {hasUnseenMessages && <span className="ml-1.5 px-1.5 py-px rounded-full bg-notify text-white text-[10px]">New message</span>}
    </p>
  );
  const liked = reminder.voters.includes(currentUser);
  const likeButton = (size: 'sm' | 'md') => onUpvote && (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onUpvote(reminder.id);
      }}
      className={`rounded-full border transition-all flex items-center gap-1 shrink-0 ${size === 'sm' ? 'px-2 py-0.5' : 'px-2 py-1 hover:scale-110'} ${
        liked ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-white border-stone-300 hover:bg-stone-100 text-stone-600'
      }`}
      title={liked ? 'Unlike' : 'Like'}
      aria-pressed={liked}
    >
      <Heart className={`w-4 h-4 ${liked ? 'fill-rose-500 text-rose-500' : ''}`} />
      <span className="text-xs">{reminder.voters.length}</span>
    </button>
  );
  const [showMessages, setShowMessages] = useState(false);
  // Photos in the conversation: ones waiting to send, and the full-screen viewer
  const [msgPhotos, setMsgPhotos] = useState<Attachment[]>([]);
  const [msgUploading, setMsgUploading] = useState(0);
  const [msgViewer, setMsgViewer] = useState<{ photos: string[]; index: number } | null>(null);
  const msgFileRef = useRef<HTMLInputElement>(null);
  const msgBoxRef = useRef<HTMLTextAreaElement>(null);
  const [showMsgEmoji, setShowMsgEmoji] = useState(false);
  const addMessagePhotos = (files: File[]) => {
    files.filter(f => f.type.startsWith('image/')).slice(0, 6).forEach(async f => {
      setMsgUploading(n => n + 1);
      try {
        const a = await uploadAttachment(f, currentUser);
        setMsgPhotos(prev => [...prev, a]);
      } catch (err) {
        console.error(err);
        alert("Couldn't add that photo. Try a smaller one.");
      } finally {
        setMsgUploading(n => n - 1);
      }
    });
  };
  useEffect(() => { if (openMessages && isSelected) setShowMessages(true); }, [openMessages, isSelected]);
  const [newMessage, setNewMessage] = useState('');
  // The message box grows with each new line (up to about five), like iMessage
  useEffect(() => {
    const el = msgBoxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [newMessage]);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(reminder.title);

  const icons = {
    website: Globe,
    music: Music,
    video: Video,
    text: TypeIcon,
    unnecessary: MoneyBagIcon,
    interesting: Sparkles,
    food: UtensilsCrossed,
    lifehack: Lightbulb
  };

  const colors = {
    website: 'bg-blue-100 text-blue-600',
    music: 'bg-purple-100 text-purple-600',
    video: 'bg-red-100 text-red-600',
    text: 'bg-stone-100 text-stone-600',
    unnecessary: 'bg-pink-100 text-pink-600',
    interesting: 'bg-teal-100 text-teal-600',
    food: 'bg-green-100 text-green-600',
    lifehack: 'bg-amber-100 text-amber-600'
  };

  // No category picked? Show the one the content most looks like
  const effectiveType = reminder.type ?? (todos ? null : guessCategory({ url: reminder.url, title: reminder.title, content: reminder.content, attachments: reminder.attachments }));
  const Icon = effectiveType ? icons[effectiveType] : null;
  
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
    if (msgUploading) return;
    if (newMessage.trim() || msgPhotos.length) {
      onAddMessage(reminder.id, newMessage.trim(), msgPhotos);
      setNewMessage('');
      setMsgPhotos([]);
      setShowMsgEmoji(false);
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

  // The sender listed as their own recipient is a "Save to My Nudges" copy, not a group member.
  const isGroup = reminder.recipients.filter(p => p !== reminder.sender).length > 1;
  const otherParticipants = Array.from(new Set([reminder.sender, ...reminder.recipients])).filter(p => p !== currentUser);

  const handleTitleSave = () => {
    if (titleDraft.trim() && titleDraft.trim() !== reminder.title) {
      onUpdateTitle(reminder.id, titleDraft.trim());
    }
    setEditingTitle(false);
  };

  return (
    // Selected = the card's own border turns orange (not an outer ring, which
    // neighboring elements and the scroll area's edges could cover up)
    <div className={compact ? 'border-t border-stone-200' : `${rich ? 'rounded-2xl' : 'rounded-xl'} shadow-sm border-2 transition-all ${
      isSelected
        ? 'border-brand-400'
        : rich && reminder.prioritizedAt && !reminder.checkedOut
          ? 'border-gold-300 !bg-gold-50'
          : reminder.checkedOut
          // Checked: a green edge, but the fill still says who sent it (blue = you, green = them)
          ? (sentByMe ? 'border-green-500 border-dashed' : 'border-green-500')
          : fromMe
            ? 'border-gold-200'
            : sentByMe
              ? 'border-sky-200'
              : 'border-stone-200 hover:border-stone-300'
    } ${reminder.checkedOut
          ? (fromMe ? 'bg-gold-50' : sentByMe ? 'bg-sky-100' : 'bg-green-100')
          : fromMe ? 'bg-gold-50' : sentByMe ? 'bg-sky-50' : 'bg-white'}`}>
      {compact ? (
        // Under the big card: just what it doesn't show (more photos, files, who's checked)
        <div className="px-4 pt-3 empty:hidden" onClick={(e) => e.stopPropagation()}>
          {photos.length > 1 && (
            <div className="mb-3 grid grid-cols-3 gap-1.5">
              {photos.slice(1).map((src, i) => (
                <button key={src} type="button" onClick={() => setViewerIndex(i + 1)} className="aspect-square overflow-hidden rounded-xl bg-stone-100" aria-label={`View photo ${i + 2}`}>
                  <img src={src} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
          {files.map(f => (
            <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer" className="mb-2 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-sm text-stone-700">
              <FileText className="w-5 h-5 text-stone-500 shrink-0" />
              <span className="truncate flex-1">{f.name}</span>
              <ExternalLink className="w-4 h-4 text-stone-400 shrink-0" />
            </a>
          ))}
          {viewerIndex !== null && <PhotoViewer photos={photos} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />}
        </div>
      ) : (<>
      {dragHandleProps && !rich && (
        <div
          {...dragHandleProps}
          className="flex items-center justify-center py-2.5 cursor-grab active:cursor-grabbing hover:bg-stone-50 rounded-t-xl transition-colors"
          title="Drag to reorder"
        >
          <div className="w-9 h-1 rounded-full bg-stone-200" />
        </div>
      )}
      <div 
        className={`cursor-pointer transition-all ${isSelected ? 'p-4 sm:p-5' : 'p-3 sm:p-4'}`}
        onClick={() => onSelect(reminder.id)}
      >
        {stampLine}
        {/* Sent to someone who hasn't accepted you yet: they can't see it until they do */}
        {waitingOn.length > 0 && (
          <div className="mb-2 -mt-0.5 flex items-center gap-2 rounded-lg bg-request-50 border border-request-300 px-2.5 py-1.5" onClick={(e) => e.stopPropagation()}>
            <p className="flex-1 min-w-0 text-[12px] leading-4 text-request-700">
              {waitingOn.length === 1 ? waitingOn[0] : waitingOn.join(', ')} {waitingOn.length === 1 ? "hasn't" : "haven't"} accepted your nudge request yet
            </p>
            {onWithdraw && (
              <button
                type="button"
                onClick={() => { if (confirm('Withdraw this nudge? It will be deleted for everyone.')) onWithdraw(reminder.id); }}
                className="shrink-0 text-[12px] font-medium text-request-700 underline"
              >
                Withdraw
              </button>
            )}
          </div>
        )}
        {!isSelected && rich ? (
          <div className="flex items-center gap-3">
            {/* Big tile: the link's preview image, or the category / to-do icon */}
            <div className={`relative w-[52px] h-[52px] rounded-xl shrink-0 overflow-hidden flex items-center justify-center ${
              reminder.previewImage ? '' : todos ? 'bg-stone-100 text-stone-600' : Icon && effectiveType ? colors[effectiveType] : 'bg-stone-100 text-stone-500'
            }`}>
              {reminder.previewImage ? (
                <img src={reminder.previewImage} alt="" className="w-full h-full object-cover" />
              ) : todos ? (
                <ListChecks className="w-6 h-6" />
              ) : Icon && effectiveType ? (
                <Icon className="w-6 h-6" />
              ) : (
                <MessageCircle className="w-6 h-6" />
              )}
              {hasUnreadMessages && (
                <div className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-notify border-2 border-white" aria-label="New message"></div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-medium truncate">
                {reminder.prioritizedAt && <span className="mr-1.5" title="Priority">🤯</span>}
                {displayText}
              </h3>
              <p className="text-xs text-stone-500 truncate flex items-center gap-1">
                <span className="truncate">
                  {[
                    isGroup && reminder.groupName ? reminder.groupName : reminder.sender === currentUser ? 'You' : reminder.sender,
                    todos ? `To-do ${todosDone}/${todos.length}` : reminder.url ? domainOf(reminder.url) : effectiveType ? CATEGORY_LABELS[effectiveType] : null,
                    todos && !reminder.checkedOut && reminder.completedBy.length > 0
                      ? (iCompleted ? 'Waiting on others'
                        : reminder.completedBy.length === 1 ? `${reminder.completedBy[0]} completed` : `${reminder.completedBy.length} of ${everyone.length} completed`)
                      : null,
                  ].filter(Boolean).join(' · ')}
                </span>
                {muted && <BellOff className="w-3 h-3 text-stone-400 shrink-0" aria-label="Silenced" />}
              </p>
            </div>
          </div>
        ) : !isSelected ? (
          /* Collapsed view — single clean centered row, no checkbox yet */
          <div className={`flex items-center gap-3 ${flipped ? 'flex-row-reverse' : ''}`}>
            {reminder.previewImage ? (
              <img src={reminder.previewImage} alt="" className="rounded-lg object-cover shrink-0 border border-stone-200" style={{ width: '32px', height: '32px' }} />
            ) : Icon && effectiveType ? (
              <div className={`p-2 rounded-lg shrink-0 ${colors[effectiveType!]}`}>
                <Icon className="w-4 h-4" />
              </div>
            ) : null}
            <h3 className={`flex-1 min-w-0 truncate text-base ${flipped ? 'text-right' : ''}`}>
              {reminder.prioritizedAt && <span className="mr-1.5" title="Priority">🤯</span>}
              {displayText}
            </h3>
            {todos && (
              <span className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 text-xs" title="To-do list">
                <ListChecks className="w-3.5 h-3.5" />
                {todosDone}/{todos.length}
              </span>
            )}
            {muted && <BellOff className="w-3.5 h-3.5 text-stone-400 shrink-0" aria-label="Silenced" />}
            {/* Popular tab: like count visible (and tappable) without opening the card */}
            {likeButton('sm')}
            {isGroup ? (
              <div className="relative shrink-0 flex items-center gap-1">
                {reminder.groupName ? (
                  <span className="px-2 py-1 rounded-full bg-stone-100 text-stone-600 text-[11px] max-w-[90px] truncate">
                    {reminder.groupName}
                  </span>
                ) : (
                  <div className="relative w-8 h-8">
                    {otherParticipants.slice(0, 2).map((p, i) => (
                      <div key={p} className="absolute rounded-full border-2 border-white" style={{ left: i * 8, top: i === 1 ? 6 : 0, zIndex: 2 - i }}>
                        <Avatar name={p} size={20} profile />
                      </div>
                    ))}
                    <div className="absolute w-5 h-5 rounded-full bg-stone-300 flex items-center justify-center text-white text-[8px] border-2 border-white" style={{ left: 16, top: 6, zIndex: 0 }}>
                      +
                    </div>
                  </div>
                )}
                {hasUnreadMessages && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-notify border-2 border-white"></div>
                )}
              </div>
            ) : (
              <div className="relative shrink-0">
                <Avatar name={viewType === 'received' ? reminder.sender : reminder.recipients[0]} size={32} profile />
                {hasUnreadMessages && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-notify border-2 border-white"></div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Expanded view — checkmark, type icon, and avatar as a normal row (nothing absolutely positioned, so nothing can overlap) */
          <>
            <div className={`flex items-center gap-3 mb-3 ${flipped ? 'flex-row-reverse' : ''}`}>
              {/* To-do lists use the Complete buttons below instead */}
              {canCheck && !hideCheck && !todos && <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCheckedOut(reminder.id);
                }}
                className={`h-10 px-3.5 rounded-xl shrink-0 flex items-center gap-1.5 text-sm transition-colors ${
                  reminder.checkedOut
                    ? 'bg-green-600 text-white'
                    : 'bg-white border-2 border-stone-300 text-stone-600 active:bg-stone-50'
                }`}
                title={reminder.checkedOut ? 'Tap to un-check' : 'Mark as checked'}
                aria-pressed={reminder.checkedOut}
              >
                <Check className="w-4 h-4" /> Checked
              </button>}

              {Icon && effectiveType && (
                <div className={`p-2 sm:p-3 rounded-lg shrink-0 ${colors[effectiveType]}`}>
                  <Icon className="w-5 h-5" />
                </div>
              )}

              {reminder.isPublic && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-teal-100 text-teal-700 text-[11px] shrink-0" title="Anyone can see this in Popular">
                  <Globe2 className="w-3 h-3" />
                  Public
                </span>
              )}

              {isGroup ? (
                <div className={`${flipped ? 'mr-auto' : 'ml-auto'} flex items-center gap-1.5 shrink-0`} title={otherParticipants.join(', ')}>
                  {reminder.groupName && (
                    <span className="px-2 py-1 rounded-full bg-stone-100 text-stone-600 text-xs max-w-[100px] truncate">
                      {reminder.groupName}
                    </span>
                  )}
                  <div className="relative w-9 h-9 sm:w-10 sm:h-10">
                    {otherParticipants.slice(0, 2).map((p, i) => (
                      <div key={p} className="absolute rounded-full border-2 border-white" style={{ left: i * 10, top: i === 1 ? 8 : 0, zIndex: 2 - i }}>
                        <Avatar name={p} size={24} profile />
                      </div>
                    ))}
                    {otherParticipants.length > 2 && (
                      <div className="absolute w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-stone-300 flex items-center justify-center text-white text-[9px] border-2 border-white" style={{ left: 20, top: 8, zIndex: 0 }}>
                        +{otherParticipants.length - 1}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className={flipped ? 'mr-auto' : 'ml-auto'}>
                  <Avatar name={viewType === 'received' ? reminder.sender : reminder.recipients[0]} size={38} profile />
                </div>
              )}
            </div>

            {/* The link, as a card you can tap — styled like the app it's from (YouTube, Spotify…) */}
            {reminder.url && (
              <div className="-mx-1">
                <LinkCard
                  url={reminder.url}
                  image={reminder.previewImage && !photos.includes(reminder.previewImage) ? reminder.previewImage : undefined}
                  title={reminder.title}
                />
              </div>
            )}

            {photos.length > 0 && (
              <div className="mb-3 -mx-1" onClick={(e) => e.stopPropagation()}>
                {photos.length === 1 ? (
                  <button type="button" onClick={() => setViewerIndex(0)} className="block w-full" aria-label="View photo full screen">
                    <img src={photos[0]} alt="" className="w-full h-auto max-h-[65vh] object-cover rounded-xl border border-stone-200 bg-stone-100" />
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {photos.slice(0, 4).map((src, i) => (
                      <button
                        key={src}
                        type="button"
                        onClick={() => setViewerIndex(i)}
                        // With 3 photos, the first runs the full width so the grid has no gap
                        className={`relative overflow-hidden rounded-xl border border-stone-200 bg-stone-100 ${
                          i === 0 && photos.length === 3 ? 'col-span-2 aspect-[2/1]' : 'aspect-square'
                        }`}
                        aria-label={`View photo ${i + 1} full screen`}
                      >
                        <img src={src} alt="" className="w-full h-full object-cover" />
                        {i === 3 && photos.length > 4 && (
                          <span className="absolute inset-0 bg-black/45 text-white text-2xl flex items-center justify-center">+{photos.length - 4}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {files.length > 0 && (
              <div className="mb-3 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                {files.map(f => (
                  <a
                    key={f.url}
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-sm text-stone-700"
                  >
                    <FileText className="w-5 h-5 text-stone-500 shrink-0" />
                    <span className="truncate flex-1">{f.name}</span>
                    <ExternalLink className="w-4 h-4 text-stone-400 shrink-0" />
                  </a>
                ))}
              </div>
            )}
            {viewerIndex !== null && (
              <PhotoViewer photos={photos} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
            )}

            {editingTitle ? (
              <div className="flex items-center gap-2 mb-1" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); }}
                  className="flex-1 text-lg border-b-2 border-brand-500 focus:outline-none"
                />
                <button onClick={handleTitleSave} className="text-brand-600 text-sm shrink-0">Save</button>
              </div>
            ) : (
              // The link card above already shows the title, so it isn't repeated here
              // (group nudges keep it, for the rename pencil)
              (reminder.url && !isGroup && !reminder.prioritizedAt && !muted) ? null :
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-lg sm:text-lg flex-1 min-w-0 [overflow-wrap:anywhere]">
                  {reminder.prioritizedAt && <span className="mr-1.5" title="Priority">🤯</span>}
                  {reminder.title}
                </h3>
                {muted && <BellOff className="w-4 h-4 text-stone-400 shrink-0" aria-label="Silenced" />}
                {isGroup && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setTitleDraft(reminder.title); setEditingTitle(true); }}
                    className="text-stone-400 hover:text-stone-600 shrink-0"
                    title="Edit title"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            {/* Group nudges: who still hasn't checked it (to-do lists show Complete buttons instead) */}
            {isGroup && isParticipant && !todos && checkedBy && (() => {
              const shouldCheck = reminder.recipients.filter(p => p !== reminder.sender);
              const notYet = shouldCheck.filter(p => !checkedBy.includes(p));
              const label = (p: string) => (p === currentUser ? 'You' : p);
              return (
                <p className="mb-2 text-[12px] leading-4 text-stone-500" onClick={(e) => e.stopPropagation()}>
                  {notYet.length === 0 ? (
                    <span className="text-green-700">✓ Everyone has checked it</span>
                  ) : (
                    <>
                      <span className="text-stone-600">Not checked yet: </span>
                      {notYet.map((p, i) => (
                        <span key={p}>
                          {i > 0 && ', '}
                          {p === currentUser ? 'You' : <ProfileLink name={p} className="text-stone-700 underline decoration-stone-300">{p}</ProfileLink>}
                        </span>
                      ))}
                      {shouldCheck.length - notYet.length > 0 && (
                        <span> · Checked: {shouldCheck.filter(p => checkedBy.includes(p)).map(label).join(', ')}</span>
                      )}
                    </>
                  )}
                </p>
              );
            })()}
            {todos ? (
              <TodoEditor
                items={todos}
                currentUser={currentUser}
                canEdit={isParticipant}
                onToggle={(i) => onToggleTodo?.(reminder.id, i)}
                onEdit={onTodoEdit ? (op, itemId, text) => onTodoEdit(reminder.id, op, itemId, text) : undefined}
              />
            ) : reminder.content ? (
              <MessageText text={reminder.content} className="text-stone-700 mb-3" />
            ) : null}

            {/* One Complete button per person. Yours you can tap; the others show whether
                that person has completed it. It moves to Checked once everyone has. */}
            {todos && (
              <div className="flex flex-wrap gap-2 mb-3" onClick={(e) => e.stopPropagation()}>
                {[currentUser, ...everyone.filter(p => p !== currentUser)].filter(p => everyone.includes(p)).map(person => {
                  const done = reminder.completedBy.includes(person);
                  const mine = person === currentUser;
                  return (
                    <button
                      key={person}
                      type="button"
                      disabled={!mine || !onToggleTodoComplete}
                      aria-pressed={done}
                      onClick={() => mine && onToggleTodoComplete?.(reminder.id)}
                      className={`flex-1 min-w-[130px] h-10 px-3 rounded-xl border flex items-center justify-center gap-1.5 text-sm transition-colors ${
                        done
                          ? 'bg-green-600 border-green-600 text-white'
                          : mine
                            ? 'bg-white border-brand-600 text-brand-700 active:bg-brand-50'
                            : 'bg-stone-50 border-stone-200 text-stone-400'
                      }`}
                      title={mine ? (done ? 'Tap to undo' : 'Mark complete') : done ? `${person} completed it` : `${person} hasn't completed it yet`}
                    >
                      {done && <Check className="w-4 h-4 shrink-0" />}
                      <span className="truncate">
                        {mine ? (done ? 'You completed' : 'Complete') : done ? `${person} completed` : `${person}: not yet`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

          </>
        )}
      </div>
      </>)}

      {/* Messages: a row that opens the conversation full screen, like a chat in Messages */}
      {isSelected && (
        <div className="border-t border-stone-200">
          <button
            onClick={(e) => { e.stopPropagation(); setShowMessages(true); }}
            className="w-full px-5 py-3.5 flex items-center gap-3 text-left active:bg-stone-50 transition-colors"
          >
            <span className={`relative w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${messages.length ? 'bg-blue-500 text-white' : 'bg-stone-100 text-stone-500'}`}>
              <MessageCircle className="w-[18px] h-[18px]" />
            </span>
            <span className="flex-1 min-w-0">
              {lastMessage ? (
                <>
                  <span className="block text-[15px] text-stone-900">
                    {messages.length} message{messages.length === 1 ? '' : 's'}
                  </span>
                  <span className="block text-[13px] text-stone-500 truncate">
                    {lastMessage.sender === currentUser ? 'You' : lastMessage.sender}: {lastMessage.text || '📷 Photo'}
                  </span>
                </>
              ) : (
                <>
                  <span className="block text-[15px] text-stone-900">Start a conversation</span>
                  <span className="block text-[13px] text-stone-500">Talk about this nudge</span>
                </>
              )}
            </span>
            <ChevronRight className="w-5 h-5 text-stone-400 shrink-0" />
          </button>

          {showMessages && createPortal(
            <ChatScreen
              title={reminder.title || displayText || 'Nudge'}
              subtitle={isGroup || reminder.isPublic
                ? (reminder.groupName || otherParticipants.slice(0, 4).join(', ') + (otherParticipants.length > 4 ? ` +${otherParticipants.length - 4}` : ''))
                : `with ${otherParticipants[0] ?? 'yourself'}`}
              thumb={reminder.previewImage || photos[0] || null}
              ThumbIcon={todos ? ListChecks : Icon ?? MessageCircle}
              onClose={() => { setShowMessages(false); setShowMsgEmoji(false); }}
              scrollKey={`${messages.length}:${msgPhotos.length}:${msgUploading}`}
              pinned={
                <div className="mx-auto w-full max-w-sm rounded-2xl bg-white border border-stone-200 shadow-sm p-3">
                  <p className="text-[12px] text-stone-500 mb-2">
                    {reminder.sender === currentUser ? 'You' : reminder.sender} sent this · {formatDate(reminder.createdAt)}
                  </p>
                  {reminder.url ? (
                    <LinkCard url={reminder.url} image={reminder.previewImage} title={reminder.title} />
                  ) : (
                    <p className="text-[16px] text-stone-900 [overflow-wrap:anywhere]">{reminder.title}</p>
                  )}
                  {reminder.content && reminder.content !== reminder.title && (
                    <MessageText text={reminder.content} className="mt-2 text-[15px] text-stone-700" />
                  )}
                </div>
              }
              composer={
                <>
                  {/* Photos waiting to be sent with the next message */}
                  {(msgPhotos.length > 0 || msgUploading > 0) && (
                    <div className="mb-2 pt-1.5 flex gap-2 overflow-x-auto">
                      {msgPhotos.map((a, i) => (
                        <div key={a.url} className="relative shrink-0">
                          <img src={a.url} alt="" className="w-16 h-16 rounded-xl object-cover" />
                          <button type="button" onClick={() => setMsgPhotos(prev => prev.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-800 text-white flex items-center justify-center" aria-label="Remove photo">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {Array.from({ length: msgUploading }, (_, i) => (
                        <div key={'u' + i} className="w-16 h-16 shrink-0 rounded-xl border border-dashed border-stone-300 flex items-center justify-center">
                          <Loader2 className="w-4 h-4 text-stone-400 animate-spin" />
                        </div>
                      ))}
                    </div>
                  )}
                  {showMsgEmoji && (
                    <div className="mb-2"><EmojiPicker onPick={(e) => setNewMessage(v => insertAtCursor(msgBoxRef.current, v, e))} /></div>
                  )}
                  {/* Message box, like iMessage: photo and emoji buttons, a rounded box that grows
                      with each new line, and a round blue send arrow */}
                  <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                    <input
                      ref={msgFileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => { addMessagePhotos(Array.from(e.target.files ?? [])); e.target.value = ''; }}
                    />
                    <button
                      type="button"
                      onClick={() => msgFileRef.current?.click()}
                      className="w-10 h-10 shrink-0 rounded-full bg-stone-200/70 text-stone-600 flex items-center justify-center active:bg-stone-300"
                      aria-label="Add a photo"
                    >
                      <ImagePlus className="w-5 h-5" />
                    </button>
                    <div className="flex-1 min-w-0 flex items-end rounded-[22px] border border-stone-300 bg-white pl-4 pr-1 py-1 focus-within:border-blue-400">
                      <textarea
                        ref={msgBoxRef}
                        rows={1}
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onPaste={(e) => {
                          const pasted = Array.from(e.clipboardData?.files ?? []);
                          if (pasted.length) { e.preventDefault(); addMessagePhotos(pasted); }
                        }}
                        placeholder="Message"
                        enterKeyHint="send"
                        className="flex-1 min-w-0 py-[7px] text-base leading-[22px] bg-transparent resize-none focus:outline-none placeholder:text-stone-400"
                        aria-label="Message"
                      />
                      <button
                        type="button"
                        onClick={() => setShowMsgEmoji(v => !v)}
                        className={`w-8 h-8 shrink-0 mb-[3px] rounded-full flex items-center justify-center ${showMsgEmoji ? 'text-blue-500' : 'text-stone-400'}`}
                        aria-label="Emoji"
                        aria-pressed={showMsgEmoji}
                      >
                        <Smile className="w-5 h-5" />
                      </button>
                      <button
                        type="submit"
                        disabled={(!newMessage.trim() && !msgPhotos.length) || msgUploading > 0}
                        className="w-8 h-8 shrink-0 mb-[3px] rounded-full bg-blue-500 text-white flex items-center justify-center disabled:bg-stone-300 transition-colors"
                        aria-label="Send"
                      >
                        <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
                      </button>
                    </div>
                  </form>
                </>
              }
            >
              {messages.length === 0 ? (
                <p className="text-center text-[14px] text-stone-500 pt-6">No messages yet. Say something about it!</p>
              ) : (
                <div className="space-y-1">
                  {/* iMessage style: your messages blue on the right, everyone else's white on the left.
                      In group and Public nudges, each message shows who wrote it, like a group chat. */}
                  {messages.map((message, i) => {
                    const mine = message.sender === currentUser;
                    const showWho = !mine && (isGroup || reminder.isPublic);
                    const prev = messages[i - 1];
                    const next = messages[i + 1];
                    // A new day (or a long pause) gets a time label in the middle, like Messages
                    const showTime = !prev || message.createdAt.getTime() - prev.createdAt.getTime() > 60 * 60 * 1000;
                    const sameAsBefore = !showTime && prev?.sender === message.sender;
                    const lastInRun = !next || next.sender !== message.sender || next.createdAt.getTime() - message.createdAt.getTime() > 60 * 60 * 1000;
                    const pics = message.attachments.filter(a => a.type.startsWith('image/')).map(a => a.url);
                    return (
                      <div key={message.id}>
                        {showTime && (
                          <p className="text-center text-[11px] text-stone-400 pt-3 pb-1">
                            {formatDate(message.createdAt)} {formatTime(message.createdAt)}
                          </p>
                        )}
                        <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'} ${sameAsBefore ? '' : 'pt-1.5'}`}>
                          {showWho && !sameAsBefore && (
                            <ProfileLink name={message.sender} className="ml-11 mb-0.5 text-[12px] text-stone-500">{message.sender}</ProfileLink>
                          )}
                          <div className={`flex items-end gap-2 max-w-[80%] ${mine ? 'flex-row-reverse' : ''}`}>
                            {showWho && (
                              <span className={`w-[30px] shrink-0 ${lastInRun ? '' : 'invisible'}`}>
                                <Avatar name={message.sender} size={30} profile />
                              </span>
                            )}
                            <div className={`min-w-0 flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
                              {pics.length > 0 && (
                                <div className={`grid gap-1 ${pics.length > 1 ? 'grid-cols-2' : ''}`}>
                                  {pics.map((src, pi) => (
                                    <button key={src} type="button" onClick={() => setMsgViewer({ photos: pics, index: pi })} aria-label="View photo">
                                      <img src={src} alt="" className={`rounded-2xl object-cover bg-stone-100 ${pics.length > 1 ? 'w-32 h-32' : 'max-w-[240px] max-h-[300px]'}`} />
                                    </button>
                                  ))}
                                </div>
                              )}
                              {message.text && (
                                <MessageText
                                  text={message.text}
                                  className={`min-w-0 max-w-full px-4 py-2 text-[16px] leading-[22px] rounded-[20px] ${
                                    mine
                                      ? `bg-blue-500 text-white ${lastInRun ? 'rounded-br-md' : ''}`
                                      : `bg-white text-stone-900 border border-stone-200 ${lastInRun ? 'rounded-bl-md' : ''}`
                                  }`}
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {msgViewer && <PhotoViewer photos={msgViewer.photos} startIndex={msgViewer.index} onClose={() => setMsgViewer(null)} />}
            </ChatScreen>,
            document.body
          )}
        </div>
      )}

      {/* Reactions Section - Only show when expanded */}
      {isSelected && (
        <div className={`border-t border-stone-200 px-5 py-3 bg-stone-50 ${rich ? 'rounded-b-[14px]' : 'rounded-b-[10px]'}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
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
                      ? 'bg-brand-100 border-brand-300'
                      : 'bg-white border-stone-300 hover:bg-stone-100'
                  }`}
                  title={reaction.users.join(', ')}
                >
                  <span className="text-base">{reaction.emoji}</span>
                  {reaction.users.length > 1 && (
                    <span className="text-xs ml-1 text-stone-600">{reaction.users.length}</span>
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
                  className="px-2 py-1 rounded-full border border-stone-300 bg-white hover:bg-stone-100 transition-colors"
                  title="Add reaction"
                >
                  <SmilePlus className="w-4 h-4 text-stone-600" />
                </button>

                {/* Reaction Picker Popup */}
                {showReactionPicker && (
                  <div 
                    className="absolute bottom-full left-0 mb-2 bg-white rounded-lg shadow-lg border border-stone-200 p-2 flex gap-1 z-10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {availableEmojis.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReactionClick(emoji);
                        }}
                        className="w-8 h-8 flex items-center justify-center hover:bg-stone-100 rounded transition-colors"
                      >
                        <span className="text-lg">{emoji}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Favorite Button */}
              {(isParticipant || anyoneCanCheck) && <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(reminder.id);
                }}
                className={`px-2 py-1 rounded-full border transition-all hover:scale-110 ${
                  reminder.favorited
                    ? 'bg-amber-100 border-amber-300'
                    : 'bg-white border-stone-300 hover:bg-stone-100'
                }`}
                title={reminder.favorited ? 'Unfavorite' : 'Favorite'}
              >
                <Star className={`w-4 h-4 ${reminder.favorited ? 'fill-amber-500 text-amber-500' : 'text-stone-600'}`} />
              </button>}

              {/* Priority — sender or receiver can bump it to the top of everyone's list */}
              {isParticipant && onTogglePriority && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePriority(reminder.id);
                  }}
                  className={`px-2 py-1 rounded-full border transition-all hover:scale-110 text-sm leading-4 ${
                    reminder.prioritizedAt ? 'bg-gold-100 border-gold-300' : 'bg-white border-stone-300 hover:bg-stone-100 grayscale opacity-70'
                  }`}
                  title={reminder.prioritizedAt ? 'Remove priority' : 'Prioritize'}
                  aria-pressed={!!reminder.prioritizedAt}
                >
                  <span aria-hidden="true">🤯</span>
                  <span className="sr-only">{reminder.prioritizedAt ? 'Remove priority' : 'Prioritize'}</span>
                </button>
              )}

              {/* Forward Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onForward(reminder);
                }}
                className="px-2 py-1 rounded-full border border-stone-300 bg-white text-stone-600 hover:bg-stone-100 transition-all hover:scale-110"
                title="Forward this nudge"
              >
                <Forward className="w-4 h-4" />
              </button>

              {/* Move to folder — favorites only */}
              {folderOptions && reminder.favorited && (() => {
                const currentFolder = folderOptions.folderOf(reminder.id);
                const currentName = folderOptions.folders.find(f => f.id === currentFolder)?.name;
                return (
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowFolderMenu(!showFolderMenu);
                      }}
                      className={`px-2 py-1 rounded-full border transition-all flex items-center gap-1 text-xs ${
                        currentFolder ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-stone-300 text-stone-600 hover:bg-stone-100'
                      }`}
                      title="Move to folder"
                    >
                      <FolderInput className="w-4 h-4" />
                      {currentName && <span className="max-w-[90px] truncate">{currentName}</span>}
                    </button>

                    {showFolderMenu && (
                      <div
                        className="absolute bottom-full left-0 mb-2 w-48 bg-white rounded-lg shadow-lg border border-stone-200 py-1 z-20"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {folderOptions.folders.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-stone-500">Make a folder with "New folder" at the top of Favorites first.</p>
                        ) : (
                          [{ id: null as string | null, name: 'No folder' }, ...folderOptions.folders].map(f => (
                            <button
                              key={f.id ?? 'none'}
                              onClick={() => {
                                folderOptions.onMove(reminder.id, f.id);
                                setShowFolderMenu(false);
                              }}
                              className="w-full flex items-center justify-between px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
                            >
                              <span className="truncate">{f.name}</span>
                              {currentFolder === f.id && <Check className="w-4 h-4 text-brand-600 shrink-0" />}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Like button — only present where likes count (the Popular tab) */}
              {likeButton('md')}
            </div>

            {/* Archive Button - bottom right, across from Favorite */}
            {isParticipant && <button
              onClick={(e) => {
                e.stopPropagation();
                onArchive(reminder.id);
              }}
              className="px-2 py-1 rounded-full border border-stone-300 bg-white text-stone-600 hover:bg-stone-100 transition-all hover:scale-110 shrink-0"
              title={reminder.archived ? 'Unarchive' : 'Archive'}
            >
              <Archive className="w-4 h-4" />
            </button>}
          </div>
        </div>
      )}
    </div>
  );
}