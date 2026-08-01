import { useState, useEffect, useRef, useCallback } from 'react';
import { ReminderList } from './components/ReminderList';
import { QuickSendModal } from './components/QuickSendModal';
import { AuthScreen } from './components/AuthScreen';
import { Send, Archive, LogOut } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { ImageWithFallback } from './components/figma/ImageWithFallback';
import nudgeLogo from '../imports/image-3.png';
import { supabase } from './utils/supabase/client';

export type ReminderType = 'link' | 'music' | 'video' | 'text';

export interface Message {
  id: string;
  reminderId: string;
  sender: string;
  text: string;
  createdAt: Date;
}

export interface Reaction {
  emoji: string;
  users: string[];
}

export interface Reminder {
  id: string;
  type: ReminderType;
  title: string;
  content: string;
  url?: string;
  sender: string;
  recipient: string;
  checkedOut: boolean;
  archived: boolean;
  favorited: boolean;
  reactions: Reaction[];
  createdAt: Date;
}

function rowToReminder(row: any, reactions: Reaction[] = []): Reminder {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    url: row.url || undefined,
    sender: row.sender,
    recipient: row.recipient,
    checkedOut: row.checked_out,
    archived: row.archived,
    favorited: row.favorited,
    reactions,
    createdAt: new Date(row.created_at)
  };
}

function rowToMessage(row: any): Message {
  return {
    id: row.id,
    reminderId: row.reminder_id,
    sender: row.sender,
    text: row.text,
    createdAt: new Date(row.created_at)
  };
}

function groupReactions(rows: any[]): Record<string, Reaction[]> {
  const map: Record<string, Reaction[]> = {};
  rows.forEach(row => {
    if (!map[row.reminder_id]) map[row.reminder_id] = [];
    let bucket = map[row.reminder_id].find(r => r.emoji === row.emoji);
    if (!bucket) {
      bucket = { emoji: row.emoji, users: [] };
      map[row.reminder_id].push(bucket);
    }
    bucket.users.push(row.username);
  });
  return map;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedSender, setSelectedSender] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [quickSendTo, setQuickSendTo] = useState<string | null>(null);
  const [showNewReminderModal, setShowNewReminderModal] = useState(false);
  const [allMessagesFilter, setAllMessagesFilter] = useState<'unread' | 'favorited' | 'archived'>('unread');

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) {
      setCurrentUser(null);
      return;
    }
    setCurrentUser(data.display_name);
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const userId = data.session?.user?.id;
      if (userId) {
        loadProfile(userId).finally(() => { if (!cancelled) setAuthChecked(true); });
      } else {
        setAuthChecked(true);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setCurrentUser(null);
      }
    });

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setReminders([]);
    setMessages([]);
  };

  const [knownUsers, setKnownUsers] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    const [{ data: reminderRows, error: reminderErr }, { data: reactionRows, error: reactionErr }, { data: messageRows, error: messageErr }, { data: profileRows, error: profileErr }] = await Promise.all([
      supabase.from('reminders').select('*').order('created_at', { ascending: false }),
      supabase.from('reminder_reactions').select('*'),
      supabase.from('messages').select('*').order('created_at', { ascending: true }),
      supabase.from('profiles').select('display_name').order('display_name', { ascending: true })
    ]);

    if (reminderErr || reactionErr || messageErr || profileErr) {
      console.error(reminderErr || reactionErr || messageErr || profileErr);
      setLoadError("Couldn't reach the server. Check your connection and Supabase setup.");
      return;
    }

    const reactionMap = groupReactions(reactionRows || []);
    setReminders((reminderRows || []).map(row => rowToReminder(row, reactionMap[row.id] || [])));
    setMessages((messageRows || []).map(rowToMessage));
    setKnownUsers((profileRows || []).map(p => p.display_name));
    setLoadError(null);
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { loadData(); }, 300);
  }, [loadData]);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;

    (async () => {
      setDataLoading(true);
      await loadData();
      if (!cancelled) setDataLoading(false);
    })();

    const channel = supabase
      .channel('nudge-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminder_reactions' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, scheduleRefresh)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [currentUser, loadData, scheduleRefresh]);

  useEffect(() => {
    const goOnline = () => { setIsOnline(true); loadData(); };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [loadData]);

  const handleSignedIn = (name: string) => {
    setCurrentUser(name);
  };

  const handleAddReminder = async (reminder: Omit<Reminder, 'id' | 'createdAt' | 'sender' | 'checkedOut'>) => {
    if (!currentUser) return;
    const payload = {
      type: reminder.type,
      title: reminder.title,
      content: reminder.content,
      url: reminder.url || null,
      sender: currentUser,
      recipient: reminder.recipient,
      checked_out: false,
      archived: false,
      favorited: false
    };
    const { data, error } = await supabase.from('reminders').insert(payload).select().single();
    if (error) {
      console.error(error);
      toast('Could not send — try again');
      return;
    }
    setReminders(prev => [rowToReminder(data), ...prev]);
  };

  const handleToggleCheckedOut = async (id: string) => {
    const reminder = reminders.find(r => r.id === id);
    if (!reminder) return;
    const wasCheckedOut = reminder.checkedOut;
    const nextValue = !wasCheckedOut;
    setReminders(prev => prev.map(r => r.id === id ? { ...r, checkedOut: nextValue } : r));

    const applyValue = async (value: boolean) => {
      const { error } = await supabase.from('reminders').update({ checked_out: value }).eq('id', id);
      if (error) console.error(error);
    };
    applyValue(nextValue);

    if (!wasCheckedOut) {
      toast('Marked as read', {
        duration: 4000,
        action: {
          label: 'Undo',
          onClick: () => {
            setReminders(prev => prev.map(r => r.id === id ? { ...r, checkedOut: false } : r));
            applyValue(false);
          },
        },
      });
    }
  };

  const handleArchive = async (id: string) => {
    const reminder = reminders.find(r => r.id === id);
    if (!reminder) return;
    const nextValue = !reminder.archived;
    setReminders(prev => prev.map(r => r.id === id ? { ...r, archived: nextValue } : r));
    const { error } = await supabase.from('reminders').update({ archived: nextValue }).eq('id', id);
    if (error) console.error(error);
  };

  const handleToggleFavorite = async (id: string) => {
    const reminder = reminders.find(r => r.id === id);
    if (!reminder) return;
    const nextValue = !reminder.favorited;
    setReminders(prev => prev.map(r => r.id === id ? { ...r, favorited: nextValue } : r));
    const { error } = await supabase.from('reminders').update({ favorited: nextValue }).eq('id', id);
    if (error) console.error(error);
  };

  const handleAddMessage = async (reminderId: string, text: string) => {
    if (!currentUser) return;
    const payload = { reminder_id: reminderId, sender: currentUser, text };
    const { data, error } = await supabase.from('messages').insert(payload).select().single();
    if (error) {
      console.error(error);
      toast('Could not send that message');
      return;
    }
    setMessages(prev => [...prev, rowToMessage(data)]);
  };

  const handleToggleReaction = async (reminderId: string, emoji: string) => {
    if (!currentUser) return;
    const reminder = reminders.find(r => r.id === reminderId);
    if (!reminder) return;
    const existingReaction = reminder.reactions.find(react => react.emoji === emoji);
    const alreadyReacted = existingReaction?.users.includes(currentUser) ?? false;

    setReminders(prev => prev.map(r => {
      if (r.id !== reminderId) return r;
      const existing = r.reactions.find(react => react.emoji === emoji);
      if (existing) {
        if (existing.users.includes(currentUser)) {
          const updatedUsers = existing.users.filter(u => u !== currentUser);
          return updatedUsers.length === 0
            ? { ...r, reactions: r.reactions.filter(react => react.emoji !== emoji) }
            : { ...r, reactions: r.reactions.map(react => react.emoji === emoji ? { ...react, users: updatedUsers } : react) };
        }
        return { ...r, reactions: r.reactions.map(react => react.emoji === emoji ? { ...react, users: [...react.users, currentUser] } : react) };
      }
      return { ...r, reactions: [...r.reactions, { emoji, users: [currentUser] }] };
    }));

    if (alreadyReacted) {
      const { error } = await supabase.from('reminder_reactions').delete().match({ reminder_id: reminderId, emoji, username: currentUser });
      if (error) console.error(error);
    } else {
      const { error } = await supabase.from('reminder_reactions').insert({ reminder_id: reminderId, emoji, username: currentUser });
      if (error) console.error(error);
    }
  };

  // PWA Install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      setShowInstallPrompt(false);
    }

    setDeferredPrompt(null);
  };

  const receivedReminders = reminders.filter(r => r.recipient === currentUser);
  const sentReminders = reminders.filter(r => r.sender === currentUser);

  const myOwnReminders = reminders.filter(r => r.sender === currentUser && r.recipient === currentUser);

  const allUserReminders = reminders.filter(r =>
    (r.sender === currentUser || r.recipient === currentUser) &&
    !(r.sender === currentUser && r.recipient === currentUser)
  );

  const activeReminders = allUserReminders.filter(r => showArchived ? r.archived : !r.archived);
  const archivedCount = allUserReminders.filter(r => r.archived).length;

  const uniqueContacts = Array.from(
    new Set(
      activeReminders.map(r =>
        r.sender === currentUser ? r.recipient : r.sender
      )
    )
  ).sort();

  const allRemindersForUser = reminders.filter(r =>
    r.sender === currentUser || r.recipient === currentUser
  );

  const displayedReminders = (() => {
    if (selectedSender === 'My Reminders') {
      return reminders.filter(r => r.sender === currentUser && r.recipient === currentUser && !r.archived);
    }
    if (!selectedSender) {
      if (allMessagesFilter === 'unread') return allUserReminders.filter(r => !r.checkedOut && !r.archived);
      if (allMessagesFilter === 'favorited') return allRemindersForUser.filter(r => r.favorited && !r.archived);
      if (allMessagesFilter === 'archived') return allRemindersForUser.filter(r => r.archived);
    }
    return activeReminders.filter(r => r.sender === selectedSender || r.recipient === selectedSender);
  })();

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthScreen onSignedIn={handleSignedIn} />;
  }

  if (dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-gray-400 text-sm">Loading your reminders…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#ffffff' }}>
      <div className="max-w-7xl mx-auto p-2 sm:p-6">
        {!isOnline && (
          <div className="mb-3 p-3 bg-gray-800 text-white rounded-xl text-sm text-center">
            You're offline — showing what's already loaded
          </div>
        )}
        {loadError && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm text-center">
            {loadError}
          </div>
        )}
        {/* Install Prompt */}
        {showInstallPrompt && (
          <div className="mb-3 p-3 sm:p-4 bg-indigo-600 text-white rounded-xl shadow-lg flex items-center justify-between">
            <div>
              <p className="font-medium text-sm sm:text-base">Install Nudge</p>
              <p className="text-xs sm:text-sm text-indigo-100">Add to your home screen for quick access</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowInstallPrompt(false)}
                className="px-2 sm:px-3 py-1 bg-indigo-700 rounded-lg hover:bg-indigo-800 text-xs sm:text-sm"
              >
                Later
              </button>
              <button
                onClick={handleInstallClick}
                className="px-2 sm:px-3 py-1 bg-white text-indigo-600 rounded-lg hover:bg-indigo-50 text-xs sm:text-sm"
              >
                Install
              </button>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="mb-3 sm:mb-6 flex items-start justify-between">
          <div>
            <ImageWithFallback src={nudgeLogo} alt="Nudge" className="h-24 sm:h-28 w-auto object-contain -mb-8 -ml-3" />
            <p className="text-gray-600 text-xs sm:text-base italic pl-4 sm:pl-5">
              Because "I'll check it out later" is a lie.
            </p>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors mt-1"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{currentUser}</span>
          </button>
        </div>

        {/* Main Layout - Sidebar + Content */}
        <div className="flex gap-2 sm:gap-4 lg:gap-6">
          {/* Left Sidebar - Contacts */}
          <div className="w-16 sm:w-64 lg:w-80 shrink-0">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden sticky top-2 sm:top-6">
              {/* Send Button */}
              <div className="px-1.5 sm:px-4 py-2 sm:py-3 border-b border-gray-200 bg-gray-50">
                <button
                  onClick={() => setShowNewReminderModal(true)}
                  className="w-full flex items-center justify-center px-2 py-2.5 sm:py-2 rounded-lg transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
                  title="Send Reminder"
                >
                  <Send className="w-5 h-5 sm:w-4 sm:h-4" />
                  <span className="text-sm hidden sm:inline ml-2">Send Reminder</span>
                </button>
              </div>

              {/* Sender/Recipient List */}
              <div className="max-h-[calc(100vh-200px)] sm:max-h-[calc(100vh-300px)] overflow-y-auto">
                {/* All Messages */}
                <button
                  onClick={() => setSelectedSender(null)}
                  className={`w-full px-1.5 sm:px-4 py-3 sm:py-3 flex flex-col sm:flex-row items-center justify-center sm:justify-between hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                    selectedSender === null ? 'bg-indigo-50 border-l-4 border-l-indigo-600' : ''
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white text-xs sm:text-base">
                      All
                    </div>
                    <div className="text-center sm:text-left hidden sm:block">
                      <p className="text-sm">All Messages</p>
                      <p className="text-xs text-gray-500">
                        {activeReminders.length} reminders
                      </p>
                    </div>
                  </div>
                </button>

                {/* My Reminders */}
                {myOwnReminders.length > 0 && (
                  <button
                    onClick={() => setSelectedSender('My Reminders')}
                    className={`w-full px-1.5 sm:px-4 py-3 sm:py-3 flex flex-col sm:flex-row items-center justify-center sm:justify-between hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                      selectedSender === 'My Reminders' ? 'bg-indigo-50 border-l-4 border-l-indigo-600' : ''
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white text-xs sm:text-base">
                        Me
                      </div>
                      <div className="text-center sm:text-left hidden sm:block">
                        <p className="text-sm">My Reminders</p>
                        <p className="text-xs text-gray-500">{myOwnReminders.length} reminders</p>
                      </div>
                    </div>
                  </button>
                )}

                {/* Individual Senders/Recipients */}
                {uniqueContacts.map(contact => {
                  const count = activeReminders
                    .filter(r => r.sender === contact || r.recipient === contact)
                    .length;
                  const unreadCount = activeReminders
                    .filter(r => {
                      const match = r.sender === contact || r.recipient === contact;
                      return match && !r.checkedOut;
                    })
                    .length;

                  const initials = contact.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

                  return (
                    <div key={contact} className="relative group">
                      <button
                        onClick={() => setSelectedSender(contact)}
                        className={`w-full px-1.5 sm:px-4 py-3 sm:py-3 flex flex-col sm:flex-row items-center justify-center sm:justify-between hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                          selectedSender === contact ? 'bg-indigo-50 border-l-4 border-l-indigo-600' : ''
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3">
                          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white text-xs sm:text-sm shrink-0 relative">
                            <span className="hidden sm:inline">{initials}</span>
                            <span className="sm:hidden">{initials[0]}</span>
                            {unreadCount > 0 && (
                              <div className="absolute -top-1 -right-1 w-5 h-5 sm:w-5 sm:h-5 rounded-full bg-indigo-600 text-white text-[10px] sm:text-xs flex items-center justify-center border-2 border-white">
                                {unreadCount}
                              </div>
                            )}
                          </div>
                          <div className="text-center sm:text-left hidden sm:block">
                            <p className="text-sm">{contact}</p>
                            <p className="text-xs text-gray-500">{count} reminders</p>
                          </div>
                        </div>
                      </button>
                      {/* Quick Send Button - Only show on larger screens */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setQuickSendTo(contact);
                        }}
                        className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700"
                        title={`Send to ${contact}`}
                      >
                        <Send className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Content Area - Reminders */}
          <div className="flex-1 min-w-0">
            {!selectedSender && (
              <div className="mb-4 flex gap-2">
                {(['unread', 'favorited', 'archived'] as const).map(filter => {
                  const unreadCount = allUserReminders.filter(r => !r.checkedOut && !r.archived).length;
                  const isActive = allMessagesFilter === filter;
                  return (
                    <button
                      key={filter}
                      onClick={() => setAllMessagesFilter(filter)}
                      className={`relative px-4 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {filter === 'unread' ? 'Unread' : filter === 'favorited' ? 'Favorites' : 'Archive'}
                      {filter === 'unread' && unreadCount > 0 && (
                        <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 border-2 text-[10px] leading-none ${isActive ? 'bg-white text-indigo-600 border-indigo-600' : 'bg-indigo-600 text-white border-white'}`}>
                          {unreadCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedSender && selectedSender !== 'My Reminders' && (
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-2xl">{selectedSender}</h2>
                <button
                  onClick={() => {
                    setShowArchived(!showArchived);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    showArchived
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Archive className="w-4 h-4" />
                  <span className="text-sm">{showArchived ? 'Hide Archive' : 'View Archive'}</span>
                </button>
              </div>
            )}
            {selectedSender === 'My Reminders' && (
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-2xl">My Reminders</h2>
                <button
                  onClick={() => {
                    setShowArchived(!showArchived);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    showArchived
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Archive className="w-4 h-4" />
                  <span className="text-sm">{showArchived ? 'Hide Archive' : 'View Archive'}</span>
                </button>
              </div>
            )}
            <ReminderList
              reminders={displayedReminders}
              viewType="received"
              currentUser={currentUser}
              messages={messages}
              onToggleCheckedOut={handleToggleCheckedOut}
              onArchive={handleArchive}
              onAddMessage={handleAddMessage}
              onToggleFavorite={handleToggleFavorite}
              onToggleReaction={handleToggleReaction}
            />
          </div>
        </div>
      </div>
      {/* Quick Send Modal */}
      {quickSendTo && (
        <QuickSendModal
          recipient={quickSendTo}
          knownRecipients={knownUsers.filter(u => u !== currentUser)}
          onSubmit={handleAddReminder}
          onClose={() => setQuickSendTo(null)}
        />
      )}
      {/* New Reminder Modal */}
      {showNewReminderModal && (
        <QuickSendModal
          recipient=""
          knownRecipients={knownUsers.filter(u => u !== currentUser)}
          onSubmit={handleAddReminder}
          onClose={() => setShowNewReminderModal(false)}
        />
      )}
      <Toaster position="bottom-center" />
    </div>
  );
}
