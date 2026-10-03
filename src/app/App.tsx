import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ReminderList } from './components/ReminderList';
import { QuickSendModal } from './components/QuickSendModal';
import { SortMenu, sortReminders, loadSortSetting, saveSortSetting, type SortSetting } from './components/SortMenu';
import { FolderBar, type Folder } from './components/FolderBar';
import { SwipeRow } from './components/SwipeRow';
import { Avatar, AvatarContext } from './components/Avatar';
import { AvatarPicker } from './components/AvatarPicker';
import { AuthScreen } from './components/AuthScreen';
import { Send, Archive, LogOut, Inbox as InboxIcon, Users, User, ChevronLeft, ChevronDown, TrendingUp, Pencil, BellOff, Bell } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { ImageWithFallback } from './components/figma/ImageWithFallback';
import nudgeLogo from '../imports/image-3.png';
import nIconTonal from '../imports/n-icon-tonal.png';
import { supabase } from './utils/supabase/client';
import { registerPush, unregisterPush, setBadge } from './utils/push';

export type ReminderType = 'website' | 'music' | 'video' | 'text' | 'unnecessary' | 'interesting' | 'food' | 'lifehack';

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
  type: ReminderType | null;
  title: string;
  content: string;
  url?: string;
  previewImage?: string;
  sender: string;
  recipients: string[];
  groupName: string | null;
  checkedOut: boolean;
  archived: boolean;
  favorited: boolean;
  curated: boolean;
  curatedOrder: number | null;
  manualOrder: number | null;
  isPublic: boolean;
  isSponsored: boolean;
  voters: string[];
  reactions: Reaction[];
  createdAt: Date;
  /** When the sender marked it a priority (🤯) — null if not prioritized */
  prioritizedAt: Date | null;
  /** To-do list nudges carry their checklist here — null for ordinary nudges */
  todoItems: TodoItem[] | null;
}

export interface TodoItem {
  text: string;
  done: boolean;
}

/** What the New Nudge form hands back: a nudge to create, plus the "prioritize" choice */
export type NewNudge = Omit<Reminder, 'id' | 'createdAt' | 'sender' | 'checkedOut' | 'prioritizedAt'> & { prioritized: boolean };

function rowToReminder(row: any, reactions: Reaction[] = [], voters: string[] = []): Reminder {
  return {
    id: row.id,
    type: row.type ?? null,
    title: row.title,
    content: row.content,
    url: row.url || undefined,
    previewImage: row.preview_image || undefined,
    sender: row.sender,
    recipients: (row.recipients && row.recipients.length > 0) ? row.recipients : [row.recipient],
    groupName: row.group_name ?? null,
    checkedOut: row.checked_out,
    archived: row.archived,
    favorited: row.favorited,
    curated: row.curated ?? false,
    curatedOrder: row.curated_order ?? null,
    isPublic: row.is_public ?? false,
    isSponsored: row.is_sponsored ?? false,
    voters,
    manualOrder: row.manual_order ?? null,
    reactions,
    createdAt: new Date(row.created_at),
    prioritizedAt: row.prioritized_at ? new Date(row.prioritized_at) : null,
    todoItems: Array.isArray(row.todo_items) ? row.todo_items : null
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

function groupVotes(rows: any[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  rows.forEach(row => {
    if (!map[row.reminder_id]) map[row.reminder_id] = [];
    map[row.reminder_id].push(row.voter_name);
  });
  return map;
}

// A "group" is identified by its exact set of participants (sender + all
// recipients), regardless of who happened to send any individual nudge —
// that way every nudge sent among the same set of people threads together.
// Recipients other than the sender. "Save to My Nudges" adds the sender to
// their own recipient list — that's a personal copy, not another group member.
function realRecipients(r: Reminder): string[] {
  return r.recipients.filter(p => p !== r.sender);
}

function isGroupReminder(r: Reminder): boolean {
  return realRecipients(r).length > 1;
}

// Shared list order: 🤯 priorities first (oldest priority on top), then everything
// still unchecked, then checked ones at the bottom. A nudge you have open keeps
// its place until you close it, so it doesn't jump away mid-read.
function withPrioritiesFirst(list: Reminder[], openId: string | null, sinkChecked: boolean): Reminder[] {
  const isDone = (r: Reminder) => sinkChecked && r.checkedOut && r.id !== openId;
  const rank = (r: Reminder) => (isDone(r) ? 2 : r.prioritizedAt ? 0 : 1);
  return list
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ra = rank(a.r), rb = rank(b.r);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return a.r.prioritizedAt!.getTime() - b.r.prioritizedAt!.getTime();
      return a.i - b.i; // otherwise keep the order the list came in
    })
    .map(x => x.r);
}

// Saved to the sender's own My Nudges (alone or alongside real recipients).
function isSavedToSelf(r: Reminder, user: string): boolean {
  return r.sender === user && r.recipients.includes(user);
}

function groupKeyFor(r: Reminder): string | null {
  if (!isGroupReminder(r)) return null;
  const participants = Array.from(new Set([r.sender, ...r.recipients])).sort();
  return participants.join('|');
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedSender, setSelectedSender] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'inbox' | 'people' | 'popular' | 'you'>('inbox');
  const [popularSubTab, setPopularSubTab] = useState<'top' | 'explore'>('top');
  const [exploreSeed, setExploreSeed] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [quickSendTo, setQuickSendTo] = useState<string | null>(null);
  const [showNewReminderModal, setShowNewReminderModal] = useState(false);
  const [forwardingReminder, setForwardingReminder] = useState<Reminder | null>(null);
  const [allMessagesFilter, setAllMessagesFilter] = useState<'unread' | 'favorited' | 'archived'>('unread');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');

  const selectFilter = (filter: 'unread' | 'favorited' | 'archived') => {
    setAllMessagesFilter(filter);
    setExpandedId(null);
  };

  // Each Home list (Unread / Favorites / Archive) remembers its own sort choice
  const [sortSettings, setSortSettings] = useState<Record<'unread' | 'favorited' | 'archived', SortSetting>>(() => ({
    unread: loadSortSetting('unread'),
    favorited: loadSortSetting('favorited'),
    archived: loadSortSetting('archived')
  }));
  const changeSort = (list: 'unread' | 'favorited' | 'archived', setting: SortSetting) => {
    setSortSettings(prev => ({ ...prev, [list]: setting }));
    saveSortSetting(list, setting);
  };

  // Favorites folders (personal — each person has their own). `foldersReady`
  // stays false until the folder tables exist in the database.
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderOfReminder, setFolderOfReminder] = useState<Record<string, string>>({});
  const [foldersReady, setFoldersReady] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  // Dragging a favorite onto a folder: whether a drag is underway, and which folder it's over
  const [favoriteDragging, setFavoriteDragging] = useState(false);
  const [dropFolder, setDropFolder] = useState<string | null>(null);

  // Silenced notifications. Each entry is 'contact:<name>', 'group:<key>' or 'nudge:<id>'.
  const [mutes, setMutes] = useState<Set<string>>(new Set());
  const [quickSendGroup, setQuickSendGroup] = useState<string[] | null>(null);
  const selectSender = (sender: string | null) => {
    setSelectedSender(sender);
    setExpandedId(null);
    setEditingGroupName(false);
    setEditingNote(false);
  };

  const [rawReminders, setReminders] = useState<Reminder[]>([]);
  // Your own favorites (null until loaded, or if the favorites table isn't set up yet —
  // then the old shared "favorited" switch is used as a fallback)
  const [favoriteIds, setFavoriteIds] = useState<Set<string> | null>(null);
  // Each nudge as *you* see it: favorited means favorited by you, nobody else
  const reminders = useMemo(
    () => favoriteIds ? rawReminders.map(r => ({ ...r, favorited: favoriteIds.has(r.id) })) : rawReminders,
    [rawReminders, favoriteIds]
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [chatNotes, setChatNotes] = useState<Record<string, string>>({});
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
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
    await unregisterPush(); // before signing out, while we're still allowed to remove this phone's token
    await supabase.auth.signOut();
    setCurrentUser(null);
    setReminders([]);
    setMessages([]);
  };

  const [knownUsers, setKnownUsers] = useState<string[]>([]);
  const [hiddenContacts, setHiddenContacts] = useState<{ name: string; status: 'archived' | 'deleted' }[]>([]);
  const [showArchivedContacts, setShowArchivedContacts] = useState(false);

  const loadData = useCallback(async () => {
    const [{ data: reminderRows, error: reminderErr }, { data: reactionRows, error: reactionErr }, { data: messageRows, error: messageErr }, { data: profileRows, error: profileErr }, { data: contactPrefRows, error: contactPrefErr }, { data: voteRows, error: voteErr }] = await Promise.all([
      supabase.from('reminders').select('*').order('created_at', { ascending: false }),
      supabase.from('reminder_reactions').select('*'),
      supabase.from('messages').select('*').order('created_at', { ascending: true }),
      supabase.from('profiles').select('display_name').order('display_name', { ascending: true }),
      supabase.from('contact_prefs').select('contact_name, status'),
      supabase.from('reminder_votes').select('*')
    ]);

    if (reminderErr || reactionErr || messageErr || profileErr || contactPrefErr || voteErr) {
      console.error(reminderErr || reactionErr || messageErr || profileErr || contactPrefErr || voteErr);
      setLoadError("Couldn't reach the server. Check your connection and Supabase setup.");
      return;
    }

    const reactionMap = groupReactions(reactionRows || []);
    const voteMap = groupVotes(voteRows || []);
    setReminders((reminderRows || []).map(row => rowToReminder(row, reactionMap[row.id] || [], voteMap[row.id] || [])));
    setMessages((messageRows || []).map(rowToMessage));
    setKnownUsers((profileRows || []).map(p => p.display_name));
    setHiddenContacts((contactPrefRows || []).map(c => ({ name: c.contact_name, status: c.status as 'archived' | 'deleted' })));
    setLoadError(null);

    const [{ data: folderRows, error: folderErr }, { data: folderItemRows, error: folderItemErr }] = await Promise.all([
      supabase.from('favorite_folders').select('id, name').order('created_at', { ascending: true }),
      supabase.from('favorite_folder_items').select('reminder_id, folder_id')
    ]);
    if (folderErr || folderItemErr) {
      // Most likely the one-time folder setup hasn't been run in Supabase yet
      console.warn('Folders unavailable:', folderErr || folderItemErr);
      setFoldersReady(false);
    } else {
      setFolders(folderRows || []);
      setFolderOfReminder(Object.fromEntries((folderItemRows || []).map(i => [i.reminder_id, i.folder_id])));
      setFoldersReady(true);
    }

    const { data: { session } } = await supabase.auth.getSession();
    setCurrentUserId(session?.user?.id ?? null);

    const [{ data: favRows, error: favErr }, { data: avatarRows, error: avatarErr }, { data: noteRows, error: noteErr }] = await Promise.all([
      supabase.from('user_favorites').select('reminder_id'),
      supabase.from('profiles').select('display_name, avatar').not('avatar', 'is', null),
      supabase.from('chat_notes').select('chat_key, note'),
    ]);
    if (favErr) console.warn('Personal favorites unavailable:', favErr);
    else setFavoriteIds(new Set((favRows || []).map(f => f.reminder_id)));
    if (avatarErr) console.warn('Pictures unavailable:', avatarErr);
    else setAvatars(Object.fromEntries((avatarRows || []).map(a => [a.display_name, a.avatar])));
    if (noteErr) console.warn('Chat descriptions unavailable:', noteErr);
    else setChatNotes(Object.fromEntries((noteRows || []).map(n => [n.chat_key, n.note])));

    const { data: muteRows, error: muteErr } = await supabase.from('mutes').select('target');
    if (muteErr) console.warn('Mutes unavailable:', muteErr);
    else setMutes(new Set((muteRows || []).map(m => m.target)));
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_prefs' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminder_votes' }, scheduleRefresh)
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

  const handleAddReminder = async (reminder: NewNudge) => {
    if (!currentUser) return;
    // Groups are named from inside the group chat, so a new nudge to an existing
    // group carries that group's current name along with it.
    const newKey = groupKeyFor({ ...reminder, sender: currentUser } as Reminder);
    const existingGroupName = newKey
      ? reminders.find(r => r.groupName && groupKeyFor(r) === newKey)?.groupName ?? null
      : null;
    const payload = {
      type: reminder.type,
      title: reminder.title,
      content: reminder.content,
      url: reminder.url || null,
      preview_image: reminder.previewImage || null,
      sender: currentUser,
      recipient: reminder.recipients[0],
      recipients: reminder.recipients,
      group_name: reminder.groupName || existingGroupName,
      is_public: reminder.isPublic || false,
      checked_out: false,
      archived: false,
      favorited: false,
      ...(reminder.prioritized ? { prioritized_at: new Date().toISOString() } : {}),
      ...(reminder.todoItems ? { todo_items: reminder.todoItems } : {})
    };
    const { data, error } = await supabase.from('reminders').insert(payload).select().single();
    if (error) {
      console.error(error);
      toast('Could not send — try again');
      return;
    }
    setReminders(prev => [rowToReminder(data), ...prev]);
  };

  const handleUpdateGroupName = async (groupKey: string, name: string) => {
    const memberIds = reminders.filter(r => groupKeyFor(r) === groupKey).map(r => r.id);
    if (memberIds.length === 0) return;
    setReminders(prev => prev.map(r => memberIds.includes(r.id) ? { ...r, groupName: name || null } : r));
    const { error } = await supabase.from('reminders').update({ group_name: name || null }).in('id', memberIds);
    if (error) {
      console.error(error);
      toast('Could not update the group name');
    }
  };

  const handleUpdateTitle = async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setReminders(prev => prev.map(r => r.id === id ? { ...r, title: trimmed } : r));
    const { error } = await supabase.from('reminders').update({ title: trimmed }).eq('id', id);
    if (error) {
      console.error(error);
      toast('Could not update the title');
    }
  };

  const handleToggleVote = async (id: string) => {
    if (!currentUser) return;
    const reminder = reminders.find(r => r.id === id);
    if (!reminder) return;
    const hasVoted = reminder.voters.includes(currentUser);

    setReminders(prev => prev.map(r => r.id === id
      ? { ...r, voters: hasVoted ? r.voters.filter(v => v !== currentUser) : [...r.voters, currentUser] }
      : r
    ));

    if (hasVoted) {
      const { error } = await supabase.from('reminder_votes').delete().match({ reminder_id: id, voter_name: currentUser });
      if (error) console.error(error);
    } else {
      const { error } = await supabase.from('reminder_votes').insert({ reminder_id: id, voter_name: currentUser });
      if (error) console.error(error);
    }
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
    const apply = async (value: boolean) => {
      setReminders(prev => prev.map(r => r.id === id ? { ...r, archived: value } : r));
      const { error } = await supabase.from('reminders').update({ archived: value }).eq('id', id);
      if (error) console.error(error);
    };
    apply(nextValue);
    if (nextValue) {
      toast('Archived', { duration: 4000, action: { label: 'Undo', onClick: () => apply(false) } });
    }
  };

  // 🤯 Priority on or off for a nudge that's already been sent — anyone in the
  // nudge can do it. Turning it on puts it at the back of the priority queue
  // (oldest priority stays on top).
  const handleTogglePriority = async (id: string) => {
    const reminder = reminders.find(r => r.id === id);
    if (!reminder) return;
    const next = reminder.prioritizedAt ? null : new Date();
    setReminders(prev => prev.map(r => r.id === id ? { ...r, prioritizedAt: next } : r));
    const { error } = await supabase.from('reminders').update({ prioritized_at: next ? next.toISOString() : null }).eq('id', id);
    if (error) {
      console.error(error);
      toast('Could not change priority');
    }
  };

  // Tick or untick one line of a to-do list nudge (everyone in the nudge sees it)
  const handleToggleTodo = async (id: string, index: number) => {
    const reminder = reminders.find(r => r.id === id);
    if (!reminder?.todoItems) return;
    const next = reminder.todoItems.map((item, i) => i === index ? { ...item, done: !item.done } : item);
    setReminders(prev => prev.map(r => r.id === id ? { ...r, todoItems: next } : r));
    const { error } = await supabase.from('reminders').update({ todo_items: next }).eq('id', id);
    if (error) {
      console.error(error);
      toast('Could not update that to-do');
    }
  };

  // Silence or un-silence notifications for a person, a group, or a single nudge
  const handleToggleMute = async (target: string, label: string) => {
    if (!currentUser) return;
    const wasMuted = mutes.has(target);
    const apply = async (mute: boolean) => {
      setMutes(prev => {
        const next = new Set(prev);
        if (mute) next.add(target); else next.delete(target);
        return next;
      });
      const { error } = mute
        ? await supabase.from('mutes').upsert({ owner_name: currentUser, target }, { onConflict: 'owner_name,target' })
        : await supabase.from('mutes').delete().match({ owner_name: currentUser, target });
      if (error) {
        console.error(error);
        toast('Could not change notifications');
      }
    };
    apply(!wasMuted);
    toast(wasMuted ? `Notifications on for ${label}` : `Silenced ${label}`, {
      duration: 4000,
      action: { label: 'Undo', onClick: () => apply(wasMuted) },
    });
  };

  // Favorites are personal: favoriting only adds it to *your* Favorites
  const handleToggleFavorite = async (id: string) => {
    const reminder = reminders.find(r => r.id === id);
    if (!reminder) return;
    const nextValue = !reminder.favorited;
    if (!favoriteIds) {
      // Favorites table not set up yet — fall back to the old shared switch
      setReminders(prev => prev.map(r => r.id === id ? { ...r, favorited: nextValue } : r));
      const { error } = await supabase.from('reminders').update({ favorited: nextValue }).eq('id', id);
      if (error) console.error(error);
      return;
    }
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (nextValue) next.add(id); else next.delete(id);
      return next;
    });
    const { error } = nextValue
      ? await supabase.from('user_favorites').upsert({ reminder_id: id }, { onConflict: 'owner_id,reminder_id' })
      : await supabase.from('user_favorites').delete().match({ owner_id: currentUserId, reminder_id: id });
    if (error) {
      console.error(error);
      toast('Could not update favorites');
    }
  };

  // Your private short description of a chat, shown next to its name
  const handleSaveChatNote = async (chatKey: string, note: string) => {
    const trimmed = note.trim().slice(0, 80);
    setChatNotes(prev => {
      const next = { ...prev };
      if (trimmed) next[chatKey] = trimmed; else delete next[chatKey];
      return next;
    });
    const { error } = trimmed
      ? await supabase.from('chat_notes').upsert({ chat_key: chatKey, note: trimmed, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,chat_key' })
      : await supabase.from('chat_notes').delete().match({ owner_id: currentUserId, chat_key: chatKey });
    if (error) {
      console.error(error);
      toast('Could not save that description');
    }
  };

  // Your picture: a photo address, an "emoji:…" pick, or null for initials
  const handleSaveAvatar = async (value: string | null) => {
    if (!currentUser || !currentUserId) return;
    setAvatars(prev => {
      const next = { ...prev };
      if (value) next[currentUser] = value; else delete next[currentUser];
      return next;
    });
    const { error } = await supabase.from('profiles').update({ avatar: value }).eq('id', currentUserId);
    if (error) {
      console.error(error);
      toast('Could not save your picture');
    }
  };

  const handleReorderPopular = async (orderedIds: string[]) => {
    setReminders(prev => {
      const orderMap = new Map(orderedIds.map((id, index) => [id, index]));
      return prev.map(r => orderMap.has(r.id) ? { ...r, curatedOrder: orderMap.get(r.id)! } : r);
    });
    const updates = orderedIds.map((id, index) =>
      supabase.from('reminders').update({ curated_order: index }).eq('id', id)
    );
    const results = await Promise.all(updates);
    const failed = results.find(r => r.error);
    if (failed?.error) console.error(failed.error);
  };

  const handleReorderUnread = async (orderedIds: string[]) => {
    setReminders(prev => {
      const orderMap = new Map(orderedIds.map((id, index) => [id, index]));
      return prev.map(r => orderMap.has(r.id) ? { ...r, manualOrder: orderMap.get(r.id)! } : r);
    });
    const updates = orderedIds.map((id, index) =>
      supabase.from('reminders').update({ manual_order: index }).eq('id', id)
    );
    const results = await Promise.all(updates);
    const failed = results.find(r => r.error);
    if (failed?.error) console.error(failed.error);
  };

  const setContactStatus = async (name: string, status: 'archived' | 'deleted') => {
    if (!currentUser) return;
    setHiddenContacts(prev => [...prev.filter(h => h.name !== name), { name, status }]);
    if (selectedSender === name) selectSender(null);
    const { error } = await supabase
      .from('contact_prefs')
      .upsert({ owner_name: currentUser, contact_name: name, status }, { onConflict: 'owner_name,contact_name' });
    if (error) {
      console.error(error);
      toast('Could not update that contact');
    }
  };

  const handleCreateFolder = async (name: string) => {
    if (!currentUser) return;
    const { data, error } = await supabase.from('favorite_folders').insert({ owner_name: currentUser, name }).select('id, name').single();
    if (error || !data) {
      console.error(error);
      toast('Could not create that folder');
      return;
    }
    setFolders(prev => [...prev, data]);
    setActiveFolder(data.id);
  };

  const handleRenameFolder = async (id: string, name: string) => {
    setFolders(prev => prev.map(f => f.id === id ? { ...f, name } : f));
    const { error } = await supabase.from('favorite_folders').update({ name }).eq('id', id);
    if (error) {
      console.error(error);
      toast('Could not rename that folder');
    }
  };

  const handleDeleteFolder = async (id: string) => {
    setFolders(prev => prev.filter(f => f.id !== id));
    setFolderOfReminder(prev => Object.fromEntries(Object.entries(prev).filter(([, f]) => f !== id)));
    if (activeFolder === id) setActiveFolder(null);
    // Removing the folder also removes its entries (database cascade); the nudges stay favorited
    const { error } = await supabase.from('favorite_folders').delete().eq('id', id);
    if (error) {
      console.error(error);
      toast('Could not delete that folder');
    }
  };

  const handleMoveToFolder = async (reminderId: string, folderId: string | null) => {
    if (!currentUser) return;
    setFolderOfReminder(prev => {
      const next = { ...prev };
      if (folderId) next[reminderId] = folderId;
      else delete next[reminderId];
      return next;
    });
    const { error } = folderId
      ? await supabase.from('favorite_folder_items').upsert(
          { owner_name: currentUser, reminder_id: reminderId, folder_id: folderId },
          { onConflict: 'owner_name,reminder_id' }
        )
      : await supabase.from('favorite_folder_items').delete().match({ owner_name: currentUser, reminder_id: reminderId });
    if (error) {
      console.error(error);
      toast('Could not move that nudge');
    }
  };

  // Archive a whole chat (a person, or a group as 'group:<key>') — with Undo
  // A favorite was dragged onto a folder chip
  const handleDropIntoFolder = (reminderId: string, folderId: string) => {
    const previous = folderOfReminder[reminderId] ?? null;
    if (previous === folderId) return;
    handleMoveToFolder(reminderId, folderId);
    const name = folders.find(f => f.id === folderId)?.name ?? 'folder';
    toast(`Moved to ${name}`, {
      duration: 4000,
      action: { label: 'Undo', onClick: () => handleMoveToFolder(reminderId, previous) },
    });
  };

  const handleArchiveContact = (name: string, label: string = name) => {
    setContactStatus(name, 'archived');
    toast(`Archived chat with ${label}`, {
      duration: 4000,
      action: { label: 'Undo', onClick: () => handleRestoreContact(name) },
    });
  };

  const handleDeleteContact = (name: string) => setContactStatus(name, 'deleted');

  const handleRestoreContact = async (name: string) => {
    if (!currentUser) return;
    setHiddenContacts(prev => prev.filter(h => h.name !== name));
    const { error } = await supabase
      .from('contact_prefs')
      .delete()
      .match({ owner_name: currentUser, contact_name: name });
    if (error) {
      console.error(error);
      toast('Could not restore that contact');
    }
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

  const receivedReminders = reminders.filter(r => r.recipients.includes(currentUser));
  const sentReminders = reminders.filter(r => r.sender === currentUser);

  const myOwnReminders = reminders.filter(r => isSavedToSelf(r, currentUser) && !r.archived);

  const allUserReminders = reminders.filter(r =>
    r.sender === currentUser || r.recipients.includes(currentUser)
  );

  // Home's Unread list: only nudges sent to you, plus ones you saved to My Nudges
  // (those list you as a recipient too) — not ones you only sent to others.
  const inboxReminders = reminders.filter(r => r.recipients.includes(currentUser));
  const unreadCount = inboxReminders.filter(r => !r.checkedOut && !r.archived).length;

  const activeReminders = allUserReminders.filter(r => showArchived ? r.archived : !r.archived);
  const archivedCount = allUserReminders.filter(r => r.archived).length;

  const hiddenContactNames = new Set(hiddenContacts.map(h => h.name));
  const archivedContactNames = hiddenContacts.filter(h => h.status === 'archived').map(h => h.name).sort();

  const uniqueContacts = Array.from(
    new Set(
      activeReminders
        .filter(r => !isGroupReminder(r))
        .map(r => r.sender === currentUser ? realRecipients(r)[0] : r.sender)
    )
  ).filter((name): name is string => !!name && !hiddenContactNames.has(name)).sort();

  // Group threads: identified by their exact participant set, so every nudge
  // sent among the same people threads together regardless of who sent it.
  const allGroups = (() => {
    const map = new Map<string, { key: string; participants: string[]; groupName: string | null; count: number; unread: number }>();
    activeReminders.filter(isGroupReminder).forEach(r => {
      const key = groupKeyFor(r)!;
      const participants = Array.from(new Set([r.sender, ...r.recipients])).filter(p => p !== currentUser);
      const existing = map.get(key);
      const isUnread = r.recipients.includes(currentUser) && !r.checkedOut;
      if (existing) {
        existing.count += 1;
        if (isUnread) existing.unread += 1;
        if (r.groupName) existing.groupName = r.groupName;
      } else {
        map.set(key, { key, participants, groupName: r.groupName, count: 1, unread: isUnread ? 1 : 0 });
      }
    });
    return Array.from(map.values()).sort((a, b) => (a.groupName || a.participants.join()).localeCompare(b.groupName || b.participants.join()));
  })();
  const groupLabel = (g: { groupName: string | null; participants: string[] }) => g.groupName || g.participants.join(', ');
  // Archived group chats are stored like archived contacts, under 'group:<key>'
  const groups = allGroups.filter(g => !hiddenContactNames.has('group:' + g.key));
  const chatLabel = (name: string) => {
    if (!name.startsWith('group:')) return name;
    const g = allGroups.find(x => 'group:' + x.key === name);
    return g ? groupLabel(g) : 'Group';
  };

  const allRemindersForUser = reminders.filter(r =>
    r.sender === currentUser || r.recipients.includes(currentUser)
  );

  const selectedGroupKey = selectedSender?.startsWith('group:') ? selectedSender.slice('group:'.length) : null;
  const selectedGroupMeta = selectedGroupKey ? allGroups.find(g => g.key === selectedGroupKey) : null;
  // Key used for your private description of the open chat (none for My Nudges)
  const selectedChatKey = !selectedSender || selectedSender === 'My Reminders'
    ? null
    : selectedGroupKey ? 'group:' + selectedGroupKey : 'contact:' + selectedSender;

  const displayedReminders = (() => {
    if (selectedSender === 'My Reminders') {
      return withPrioritiesFirst(reminders.filter(r => isSavedToSelf(r, currentUser) && !r.archived), expandedId, true);
    }
    if (selectedGroupKey) {
      return withPrioritiesFirst(activeReminders.filter(r => groupKeyFor(r) === selectedGroupKey), expandedId, true);
    }
    if (!selectedSender) {
      const sort = sortSettings[allMessagesFilter];
      if (allMessagesFilter === 'unread') {
        return withPrioritiesFirst(sortReminders(inboxReminders.filter(r => (!r.checkedOut || r.id === expandedId) && !r.archived), sort), expandedId, false);
      }
      if (allMessagesFilter === 'favorited') {
        const favorites = allRemindersForUser.filter(r => r.favorited);
        return sortReminders(activeFolder ? favorites.filter(r => folderOfReminder[r.id] === activeFolder) : favorites, sort);
      }
      if (allMessagesFilter === 'archived') return sortReminders(allRemindersForUser.filter(r => r.archived), sort);
    }
    return withPrioritiesFirst(activeReminders.filter(r =>
      !isGroupReminder(r) && (r.sender === selectedSender || realRecipients(r)[0] === selectedSender)
    ), expandedId, true);
  })();

  // Popular is shared by everyone. (Archiving only tidies your own inbox — it no
  // longer pulls a public nudge out of Popular for everybody.)
  // Swipe-left buttons on a chat row: silence notifications, or archive the chat
  const chatSwipeActions = (target: string, archiveName: string, label: string) => {
    const muted = mutes.has(target);
    return [
      {
        key: 'mute',
        label: muted ? 'Unmute' : 'Silence',
        icon: muted ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />,
        onClick: () => handleToggleMute(target, label),
        className: 'bg-indigo-500 text-white',
      },
      {
        key: 'archive',
        label: 'Archive',
        icon: <Archive className="w-5 h-5" />,
        onClick: () => handleArchiveContact(archiveName, label),
        className: 'bg-stone-500 text-white',
      },
    ];
  };

  const publicReminders = reminders.filter(r => r.isPublic);

  // Most Popular: most likes first; ties go to the newer nudge
  const topReminders = [...publicReminders].sort((a, b) => {
    if (a.isSponsored !== b.isSponsored) return a.isSponsored ? -1 : 1;
    if (b.voters.length !== a.voters.length) return b.voters.length - a.voters.length;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  // Explore: public nudges in random order, minus ones you sent or already liked.
  // Worked out when you shuffle (or new nudges arrive) — liking one doesn't make it
  // vanish mid-scroll; it drops out on the next shuffle.
  // iPhone notifications: once signed in, ask permission (first time) and register this phone.
  // Tapping a notification brings you to Home → Unread.
  useEffect(() => {
    if (!currentUser) return;
    registerPush(currentUser, () => {
      setSelectedSender(null);
      setMobileTab('inbox');
      setAllMessagesFilter('unread');
    });
  }, [currentUser]);

  // Keep the red number on the app icon equal to your unread count
  useEffect(() => {
    if (currentUser && !dataLoading) setBadge(unreadCount);
  }, [currentUser, dataLoading, unreadCount]);

  const exploreReminders = useMemo(() => {
    const shuffled = publicReminders.filter(r => r.sender !== currentUser && !r.voters.includes(currentUser));
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploreSeed, publicReminders.map(r => r.id).join(',')]);

  // ---- Home screen pieces ----
  const hour = new Date().getHours();
  const greeting = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening';
  const unreadPriorityCount = inboxReminders.filter(r => r.prioritizedAt && !r.checkedOut && !r.archived).length;

  // One Home list (rich cards). Unread uses several of these — one per section.
  const renderHomeList = (list: Reminder[], emptyMessage?: string) => (
            <ReminderList
              richCards
              reminders={list}
              viewType="received"
              currentUser={currentUser}
              messages={messages}
              selectedId={expandedId}
              onSelectId={setExpandedId}
              onToggleCheckedOut={handleToggleCheckedOut}
              onArchive={handleArchive}
              onAddMessage={handleAddMessage}
              onToggleFavorite={handleToggleFavorite}
              onUpdateTitle={handleUpdateTitle}
              onForward={setForwardingReminder}
              onToggleReaction={handleToggleReaction}
              onToggleTodo={handleToggleTodo}
              onTogglePriority={handleTogglePriority}
              // Favorites can always be held and dragged (to file into a folder); rearranging
              // by dropping between cards only happens in Custom order
              reorderable={sortSettings[allMessagesFilter].key === 'custom' || (allMessagesFilter === 'favorited' && foldersReady)}
              allowReorder={sortSettings[allMessagesFilter].key === 'custom'}
              dropTargets={allMessagesFilter === 'favorited' && foldersReady}
              onDragActiveChange={setFavoriteDragging}
              onDropHover={setDropFolder}
              onDropOnTarget={handleDropIntoFolder}
              onReorder={handleReorderUnread}
              emptyMessage={emptyMessage ?? (
                allMessagesFilter === 'unread'
                  ? "You're all caught up. New nudges from friends will show up here."
                  : allMessagesFilter === 'archived'
                    ? 'Nothing archived. Nudges you archive will wait here.'
                    : activeFolder
                      ? 'This folder is empty. Go to All, then hold a favorite and drag it onto this folder.'
                      : 'No favorites yet. Open a nudge and tap the star to save it here.'
              )}
              folderOptions={allMessagesFilter === 'favorited' && foldersReady
                ? { folders, folderOf: (id) => folderOfReminder[id] ?? null, onMove: handleMoveToFolder }
                : undefined}
            />
  );

  const isToday = (d: Date) => d.toDateString() === new Date().toDateString();

  // Unread: "New from" bubbles, then Priority / Today / Earlier sections
  const renderUnreadHome = () => {
    const list = displayedReminders;
    if (list.length === 0) {
      return (
        <div className="text-center pt-16 pb-8 px-6">
          <div className="text-5xl mb-3" aria-hidden="true">🎉</div>
          <p className="text-lg text-stone-800">You're all caught up</p>
          <p className="text-sm text-stone-500 mt-1">New nudges from friends will show up here.</p>
          <button
            onClick={() => setMobileTab('popular')}
            className="mt-5 px-5 py-2.5 rounded-full bg-orange-600 text-white text-sm active:bg-orange-700"
          >
            Explore Popular
          </button>
        </div>
      );
    }

    // Whose nudges are waiting, newest first — tap a bubble to open that chat
    const newFrom: { key: string; label: string; avatarName: string; open: string }[] = [];
    [...inboxReminders]
      .filter(r => !r.checkedOut && !r.archived && r.sender !== currentUser)
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
      .forEach(r => {
        const groupKey = groupKeyFor(r);
        const key = groupKey ? 'group:' + groupKey : 'contact:' + r.sender;
        if (newFrom.some(n => n.key === key)) return;
        const group = groupKey ? allGroups.find(g => g.key === groupKey) : null;
        const label = group ? groupLabel(group) : r.sender;
        newFrom.push({ key, label, avatarName: group ? label : r.sender, open: groupKey ? 'group:' + groupKey : r.sender });
      });

    const stillOpen = (r: Reminder) => !r.checkedOut || r.id === expandedId;
    const priority = list.filter(r => r.prioritizedAt && stillOpen(r));
    const rest = list.filter(r => !priority.includes(r));
    const today = rest.filter(r => isToday(r.createdAt));
    const earlier = rest.filter(r => !isToday(r.createdAt));
    const sectionTitle = (text: string) => <p className="text-xs text-stone-500 mt-4 mb-1.5">{text}</p>;

    return (
      <>
        {newFrom.length > 0 && (
          <div className="mb-1">
            <p className="text-xs text-stone-500 mb-2">New from</p>
            <div className="-mx-4 px-4 flex gap-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {newFrom.map(n => (
                <button key={n.key} onClick={() => selectSender(n.open)} className="shrink-0 w-[60px] flex flex-col items-center">
                  <div className="rounded-full p-[2.5px] bg-orange-500">
                    <div className="rounded-full p-[2px] bg-[#FEFBF6]">
                      <Avatar name={n.avatarName} size={50} />
                    </div>
                  </div>
                  <span className="mt-1 text-[11px] text-stone-700 truncate w-full text-center">{n.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {priority.length > 0 && <>{sectionTitle('🤯 Priority')}{renderHomeList(priority)}</>}
        {today.length > 0 && <>{sectionTitle('Today')}{renderHomeList(today)}</>}
        {earlier.length > 0 && <>{sectionTitle('Earlier')}{renderHomeList(earlier)}</>}
      </>
    );
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-white">
        <ImageWithFallback src={nudgeLogo} alt="Nudge" className="h-[300px] w-auto object-contain -my-[90px]" />
        <p className="text-stone-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthScreen onSignedIn={handleSignedIn} />;
  }

  if (dataLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-white">
        <ImageWithFallback src={nudgeLogo} alt="Nudge" className="h-[300px] w-auto object-contain -my-[90px]" />
        <p className="text-stone-400 text-sm">Loading your nudges…</p>
      </div>
    );
  }

  return (
    <AvatarContext.Provider value={avatars}>
    <div
      className="flex flex-col overflow-hidden"
      style={{ height: '100%', width: '100%', background: '#FEFBF6', paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Sticky header area — does not scroll */}
      <div className="shrink-0 max-w-2xl mx-auto px-4 w-full">
        {!isOnline && (
          <div className="mb-3 p-3 bg-stone-800 text-white rounded-xl text-sm text-center">
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
          <div className="mb-3 p-3 sm:p-4 bg-orange-600 text-white rounded-xl shadow-lg flex items-center justify-between">
            <div>
              <p className="font-medium text-sm sm:text-base">Install Nudge</p>
              <p className="text-xs sm:text-sm text-orange-100">Add to your home screen for quick access</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowInstallPrompt(false)}
                className="px-2 sm:px-3 py-1 bg-orange-700 rounded-lg hover:bg-orange-800 text-xs sm:text-sm"
              >
                Later
              </button>
              <button
                onClick={handleInstallClick}
                className="px-2 sm:px-3 py-1 bg-white text-orange-600 rounded-lg hover:bg-orange-50 text-xs sm:text-sm"
              >
                Install
              </button>
            </div>
          </div>
        )}

        {/* Top Bar */}
        <div className="mb-3 flex items-center gap-2">
          {selectedSender ? (
            selectedGroupKey && editingGroupName ? (
              <form
                className="flex-1 flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleUpdateGroupName(selectedGroupKey, groupNameDraft);
                  setEditingGroupName(false);
                }}
              >
                <input
                  autoFocus
                  value={groupNameDraft}
                  onChange={(e) => setGroupNameDraft(e.target.value)}
                  placeholder="Name this group"
                  className="flex-1 min-w-0 text-lg border-b-2 border-orange-500 focus:outline-none bg-transparent"
                />
                <button type="submit" className="text-orange-600 text-sm shrink-0">Save</button>
              </form>
            ) : (
              <>
                {/* The arrow AND the name are one big back button — easier to hit */}
                <button
                  onClick={() => selectSender(null)}
                  className="-ml-2 pl-1 pr-2 py-1.5 rounded-lg hover:bg-stone-100 active:bg-stone-200 transition-colors flex items-center gap-1.5 min-w-0 max-w-[60%] shrink-0"
                  title="Back"
                >
                  <ChevronLeft className="w-6 h-6 text-stone-700 shrink-0" />
                  {!selectedGroupKey && selectedSender !== 'My Reminders' && <Avatar name={selectedSender} size={28} />}
                  <h1 className="text-lg truncate">
                    {selectedGroupKey
                      ? (selectedGroupMeta?.groupName || selectedGroupMeta?.participants.join(', ') || 'Group')
                      : selectedSender === 'My Reminders' ? 'My Nudges' : selectedSender}
                  </h1>
                </button>
                {selectedGroupKey && (
                  <button
                    onClick={() => {
                      setGroupNameDraft(selectedGroupMeta?.groupName || '');
                      setEditingGroupName(true);
                    }}
                    className="p-1.5 -ml-1 text-stone-400 hover:text-stone-600 shrink-0"
                    title="Rename group"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                {/* Your own short description of this chat, to the right of the name */}
                {selectedChatKey && (editingNote ? (
                  <form
                    className="flex-1 min-w-0 flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveChatNote(selectedChatKey, noteDraft);
                      setEditingNote(false);
                    }}
                  >
                    <input
                      autoFocus
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onBlur={() => { handleSaveChatNote(selectedChatKey, noteDraft); setEditingNote(false); }}
                      maxLength={80}
                      placeholder="e.g. college roommate"
                      className="flex-1 min-w-0 text-sm border-b border-orange-400 focus:outline-none bg-transparent"
                    />
                  </form>
                ) : (
                  <button
                    onClick={() => { setNoteDraft(chatNotes[selectedChatKey] ?? ''); setEditingNote(true); }}
                    className={`flex-1 min-w-0 text-left text-sm truncate ${chatNotes[selectedChatKey] ? 'text-stone-500 italic' : 'text-stone-400'}`}
                    title="Edit description"
                  >
                    {chatNotes[selectedChatKey] ?? '+ Add description'}
                  </button>
                ))}
              </>
            )
          ) : (
            // Large left-aligned screen title, iOS style (the logo lives on the sign-in and loading screens)
            mobileTab === 'inbox' ? (
              // Home greets you by name, with a one-line summary of what's waiting
              <div className="pt-1">
                <h1 className="tab-title text-[28px] leading-tight text-stone-800">
                  {greeting}, {currentUser.split(' ')[0]}
                </h1>
                <p className="text-sm text-stone-500 mt-0.5">
                  {unreadCount === 0
                    ? "You're all caught up"
                    : [
                        `${unreadCount} new nudge${unreadCount === 1 ? '' : 's'}`,
                        unreadPriorityCount ? `${unreadPriorityCount} priority` : null,
                      ].filter(Boolean).join(' · ')}
                </p>
              </div>
            ) : (
              <h1 className="tab-title pt-1 text-[30px] leading-tight text-stone-800">
                {mobileTab === 'people' ? 'Nudges' : mobileTab === 'popular' ? 'Popular' : 'You'}
              </h1>
            )
          )}
        </div>

        {/* Secondary control row: View Archive (thread) or filter tabs (inbox) */}
        {selectedSender ? (
          <div className="mb-3 flex items-center justify-between gap-2">
            {selectedSender === 'My Reminders' ? <span /> : (
              <button
                onClick={() => selectedGroupMeta ? setQuickSendGroup(selectedGroupMeta.participants) : setQuickSendTo(selectedSender)}
                className="min-w-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 text-white active:bg-orange-700 transition-colors"
              >
                <Send className="w-4 h-4 shrink-0" />
                <span className="text-sm truncate">Nudge {selectedGroupMeta ? (selectedGroupMeta.groupName || 'group') : selectedSender}</span>
              </button>
            )}
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                showArchived
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              <Archive className="w-4 h-4" />
              <span className="text-sm">{showArchived ? 'Hide Archive' : 'View Archive'}</span>
            </button>
          </div>
        ) : mobileTab === 'inbox' ? (
          <div className="mb-1 flex gap-2 pt-1 pb-1">
            {(['unread', 'favorited', 'archived'] as const).map(filter => {
              const isActive = allMessagesFilter === filter;
              const labels = { unread: 'Unread', favorited: 'Favorites', archived: 'Archive' };
              return (
                <button
                  key={filter}
                  onClick={() => selectFilter(filter)}
                  className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                    isActive
                      ? 'bg-orange-600 text-white'
                      : 'bg-white border border-stone-300 text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {labels[filter]}
                  {filter === 'unread' && unreadCount > 0 && <span className="ml-1.5 opacity-80">{unreadCount}</span>}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Scrollable content — only this area scrolls */}
      <div
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
        // Tapping anywhere outside an open nudge closes it (a checked nudge then leaves Unread)
        onClick={(e) => {
          if (expandedId && !(e.target as HTMLElement).closest('[data-nudge-card], button, a, input, textarea')) setExpandedId(null);
        }}
      >
        <div className="max-w-2xl mx-auto px-4 pb-4 w-full">
          {selectedSender ? (
            <ReminderList
              chatLayout={selectedSender !== 'My Reminders'}
              swipeable
              mutedIds={mutes}
              onToggleMute={(id, title) => handleToggleMute('nudge:' + id, `"${title}"`)}
              reminders={displayedReminders}
              viewType="received"
              currentUser={currentUser}
              messages={messages}
              selectedId={expandedId}
              onSelectId={setExpandedId}
              onToggleCheckedOut={handleToggleCheckedOut}
              onArchive={handleArchive}
              onAddMessage={handleAddMessage}
              onToggleFavorite={handleToggleFavorite}
              onUpdateTitle={handleUpdateTitle}
              onForward={setForwardingReminder}
              onToggleReaction={handleToggleReaction}
              onToggleTodo={handleToggleTodo}
              onTogglePriority={handleTogglePriority}
            />
          ) : mobileTab === 'inbox' ? (
            <>
            {allMessagesFilter === 'favorited' && foldersReady && (() => {
              const favorites = allRemindersForUser.filter(r => r.favorited);
              const counts: Record<string, number> = {};
              favorites.forEach(r => { const f = folderOfReminder[r.id]; if (f) counts[f] = (counts[f] ?? 0) + 1; });
              return (
                <FolderBar
                  folders={folders}
                  counts={counts}
                  totalCount={favorites.length}
                  active={activeFolder}
                  onSelect={(id) => { setActiveFolder(id); setExpandedId(null); }}
                  onCreate={handleCreateFolder}
                  onRename={handleRenameFolder}
                  onDelete={handleDeleteFolder}
                  dragActive={favoriteDragging}
                  hoverId={dropFolder}
                />
              );
            })()}
            <div className="flex justify-end -mr-1 mb-1">
              <SortMenu value={sortSettings[allMessagesFilter]} onChange={(s) => changeSort(allMessagesFilter, s)} />
            </div>
            {allMessagesFilter === 'unread' ? renderUnreadHome() : renderHomeList(displayedReminders)}
            </>
          ) : mobileTab === 'popular' ? (
            <div>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setPopularSubTab('top')}
                  className={`flex-1 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    popularSubTab === 'top'
                      ? 'bg-orange-600 text-white'
                      : 'bg-white border border-stone-300 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  Most Popular Nudges
                </button>
                <button
                  onClick={() => { setPopularSubTab('explore'); setExploreSeed(s => s + 1); }}
                  className={`flex-1 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    popularSubTab === 'explore'
                      ? 'bg-orange-600 text-white'
                      : 'bg-white border border-stone-300 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  Explore
                </button>
              </div>

              {popularSubTab === 'explore' && (
                <button
                  onClick={() => setExploreSeed(s => s + 1)}
                  className="mb-3 flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-700"
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  Shuffle
                </button>
              )}

              <ReminderList
                reminders={popularSubTab === 'top' ? topReminders : exploreReminders}
                viewType="received"
                currentUser={currentUser}
                messages={messages}
                selectedId={expandedId}
                onSelectId={setExpandedId}
                onToggleCheckedOut={handleToggleCheckedOut}
                onArchive={handleArchive}
                onAddMessage={handleAddMessage}
                onToggleFavorite={handleToggleFavorite}
                onUpdateTitle={handleUpdateTitle}
                onForward={setForwardingReminder}
                onToggleReaction={handleToggleReaction}
              onToggleTodo={handleToggleTodo}
              onTogglePriority={handleTogglePriority}
                onUpvote={handleToggleVote}
                emptyMessage={
                  popularSubTab === 'top'
                    ? "No public nudges yet. Mark a nudge \"public\" when sending one to see it show up here."
                    : "You're all caught up. Nudges you've liked move to Most Popular. Check back later for new ones, or mark one of your own \"Public\" to share it here."
                }
              />
            </div>
          ) : mobileTab === 'people' ? (
            <div className="divide-y divide-stone-100">
              {/* My Nudges */}
              {myOwnReminders.length > 0 && (
                <button
                  onClick={() => selectSender('My Reminders')}
                  className="w-full px-3 py-3 flex items-center gap-3 hover:bg-stone-50 active:bg-stone-100 transition-colors rounded-xl"
                >
                  <Avatar name={currentUser} size={48} />
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-base">My Nudges</p>
                    <p className="text-sm text-stone-500">{myOwnReminders.length} nudges</p>
                  </div>
                </button>
              )}

              {/* Individual Contacts */}
              {uniqueContacts.length === 0 && myOwnReminders.length === 0 && (
                <p className="text-center text-stone-500 py-12 text-sm">
                  No one here yet. Send someone a nudge to see them show up.
                </p>
              )}
              {uniqueContacts.map(contact => {
                const count = activeReminders
                  .filter(r => !isGroupReminder(r) && (r.sender === contact || realRecipients(r)[0] === contact))
                  .length;
                const unreadCount = activeReminders
                  .filter(r => {
                    const match = !isGroupReminder(r) && (r.sender === contact || realRecipients(r)[0] === contact);
                    return match && !r.checkedOut;
                  })
                  .length;


                return (
                  <SwipeRow key={contact} actions={chatSwipeActions('contact:' + contact, contact, contact)}>
                    <div className="flex items-center gap-1 rounded-xl" style={{ background: '#FEFBF6' }}>
                      <button
                        onClick={() => selectSender(contact)}
                        className="flex-1 min-w-0 px-3 py-3 flex items-center gap-3 active:bg-stone-100 transition-colors rounded-xl text-left"
                      >
                        <div className="relative shrink-0">
                          <Avatar name={contact} size={48} />
                          {unreadCount > 0 && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-orange-600 text-white text-[10px] flex items-center justify-center border-2 border-white">
                              {unreadCount}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-base truncate flex items-center gap-1.5">
                            <span className="truncate">{contact}</span>
                            {mutes.has('contact:' + contact) && <BellOff className="w-4 h-4 text-stone-400 shrink-0" aria-label="Silenced" />}
                          </p>
                          <p className="text-sm text-stone-500 truncate">
                            {chatNotes['contact:' + contact] && <span className="italic">{chatNotes['contact:' + contact]} · </span>}
                            {count} nudges
                          </p>
                        </div>
                      </button>
                      {/* Silence and Archive live behind a swipe left */}
                      <button
                        onClick={() => setQuickSendTo(contact)}
                        className="p-2.5 mr-1 rounded-lg text-orange-600 hover:bg-orange-50 active:bg-orange-100 shrink-0"
                        title={`Send to ${contact}`}
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </SwipeRow>
                );
              })}

              {/* Groups */}
              {groups.map(group => {
                const displayName = groupLabel(group);
                const initials = group.participants.slice(0, 3).map(p => p[0]?.toUpperCase() ?? '?');
                return (
                  <SwipeRow key={group.key} actions={chatSwipeActions('group:' + group.key, 'group:' + group.key, displayName)}>
                  <button
                    onClick={() => selectSender('group:' + group.key)}
                    className="w-full px-3 py-3 flex items-center gap-3 active:bg-stone-100 transition-colors rounded-xl text-left"
                    style={{ background: '#FEFBF6' }}
                  >
                    <div className="relative shrink-0 w-11 h-11">
                      {initials.map((letter, i) => (
                        <div
                          key={i}
                          className="absolute w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-white text-[10px] border-2 border-white"
                          style={{ left: i * 10, top: i === 1 ? 10 : 0, zIndex: 3 - i }}
                        >
                          {letter}
                        </div>
                      ))}
                      {group.participants.length > 3 && (
                        <div className="absolute w-7 h-7 rounded-full bg-stone-300 flex items-center justify-center text-white text-[10px] border-2 border-white" style={{ left: 30, top: 10, zIndex: 0 }}>
                          +{group.participants.length - 2}
                        </div>
                      )}
                      {group.unread > 0 && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-orange-600 text-white text-[10px] flex items-center justify-center border-2 border-white z-10">
                          {group.unread}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-base truncate flex items-center gap-1.5">
                        <span className="truncate">{displayName}</span>
                        {mutes.has('group:' + group.key) && <BellOff className="w-4 h-4 text-stone-400 shrink-0" aria-label="Silenced" />}
                      </p>
                      <p className="text-sm text-stone-500 truncate">
                        {chatNotes['group:' + group.key] && <span className="italic">{chatNotes['group:' + group.key]} · </span>}
                        {group.count} nudges &middot; {group.participants.length + 1} people
                      </p>
                    </div>
                  </button>
                  </SwipeRow>
                );
              })}

              {/* Archived Contacts */}
              {archivedContactNames.length > 0 && (
                <div className="pt-3 mt-3 border-t border-stone-100">
                  <button
                    onClick={() => setShowArchivedContacts(!showArchivedContacts)}
                    className="w-full px-3 py-2.5 flex items-center justify-between text-sm text-stone-500 hover:bg-stone-50 rounded-lg transition-colors"
                  >
                    <span>Archived chats ({archivedContactNames.length})</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${showArchivedContacts ? 'rotate-180' : ''}`} />
                  </button>
                  {showArchivedContacts && archivedContactNames.map(name => (
                    <div key={name} className="px-3 py-2.5 flex items-center justify-between gap-3">
                      <span className="text-sm text-stone-600 truncate flex-1 min-w-0">{chatLabel(name)}</span>
                      <button
                        onClick={() => handleRestoreContact(name)}
                        className="text-xs text-orange-600 hover:text-orange-700 underline shrink-0"
                        title={`Restore ${chatLabel(name)}`}
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete your chat with ${chatLabel(name)}? It disappears from your Nudges tab for good. The nudges themselves aren't deleted for the other people in them.`)) {
                            handleDeleteContact(name);
                          }
                        }}
                        className="text-xs text-red-600 hover:text-red-700 underline shrink-0"
                        title={`Delete ${chatLabel(name)}`}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* You tab */
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-stone-200 p-5 flex items-center gap-4">
                <button onClick={() => setShowAvatarPicker(true)} className="shrink-0" aria-label="Change your picture">
                  <Avatar name={currentUser} size={64} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{currentUser}</p>
                  <button onClick={() => setShowAvatarPicker(true)} className="text-sm text-orange-600">
                    Change picture
                  </button>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Tab Bar — a normal flex child now, not fixed, so the scroll area above sizes correctly */}
      <div
        className="shrink-0 bg-white border-t border-stone-200 flex z-20"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
      {([
        { id: 'inbox' as const, label: 'Home', icon: InboxIcon, badge: unreadCount },
        { id: 'people' as const, label: 'Nudges', icon: Users, badge: 0 },
      ]).map(tab => (
        <button
          key={tab.id}
          onClick={() => { selectSender(null); setMobileTab(tab.id); }}
          className={`flex-1 flex flex-col items-center gap-1 py-2.5 relative transition-colors ${
            !selectedSender && mobileTab === tab.id ? 'text-orange-600' : 'text-stone-400'
          }`}
        >
          <tab.icon className="w-5 h-5" />
          <span className="text-[11px]">{tab.label}</span>
          {tab.badge > 0 && (
            <span className="absolute top-1 right-[calc(50%-22px)] min-w-[16px] h-[16px] rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center px-1">
              {tab.badge}
            </span>
          )}
        </button>
      ))}

      <button
        onClick={() => setShowNewReminderModal(true)}
        className="flex-1 flex flex-col items-center justify-center"
        title="Send a nudge"
      >
        <span className="w-11 h-11 rounded-full bg-orange-600 flex items-center justify-center -mt-4 shadow-lg shadow-orange-600/30 active:bg-orange-700 transition-colors">
          <img src={nIconTonal} alt="" className="w-6 h-6 object-contain" />
        </span>
      </button>

      <button
        onClick={() => { selectSender(null); setMobileTab('popular'); }}
        className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors ${
          !selectedSender && mobileTab === 'popular' ? 'text-orange-600' : 'text-stone-400'
        }`}
      >
        <TrendingUp className="w-5 h-5" />
        <span className="text-[11px]">Popular</span>
      </button>

      <button
        onClick={() => { selectSender(null); setMobileTab('you'); }}
        className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors ${
          !selectedSender && mobileTab === 'you' ? 'text-orange-600' : 'text-stone-400'
        }`}
      >
        <User className="w-5 h-5" />
        <span className="text-[11px]">You</span>
      </button>
    </div>

      {/* Quick Send Modal */}
      {quickSendTo && (
        <QuickSendModal
          recipient={quickSendTo}
          knownRecipients={knownUsers.filter(u => u !== currentUser)}
          currentUser={currentUser}
          onSubmit={handleAddReminder}
          onClose={() => setQuickSendTo(null)}
        />
      )}
      {showAvatarPicker && (
        <AvatarPicker
          name={currentUser}
          current={avatars[currentUser] ?? null}
          onSave={handleSaveAvatar}
          onClose={() => setShowAvatarPicker(false)}
        />
      )}
      {/* "Nudge group" from inside a group chat — everyone pre-filled, sent as a group */}
      {quickSendGroup && (
        <QuickSendModal
          recipient=""
          initialRecipients={quickSendGroup}
          knownRecipients={knownUsers.filter(u => u !== currentUser)}
          currentUser={currentUser}
          onSubmit={handleAddReminder}
          onClose={() => setQuickSendGroup(null)}
        />
      )}
      {/* New Reminder Modal */}
      {showNewReminderModal && (
        <QuickSendModal
          recipient=""
          knownRecipients={knownUsers.filter(u => u !== currentUser)}
          currentUser={currentUser}
          onSubmit={handleAddReminder}
          onClose={() => setShowNewReminderModal(false)}
        />
      )}
      {/* Forward Modal — a fresh nudge from you, prefilled from the original */}
      {forwardingReminder && (
        <QuickSendModal
          recipient=""
          knownRecipients={knownUsers.filter(u => u !== currentUser)}
          currentUser={currentUser}
          onSubmit={handleAddReminder}
          onClose={() => setForwardingReminder(null)}
          initialValues={{
            type: forwardingReminder.type,
            title: forwardingReminder.title,
            content: forwardingReminder.content,
            url: forwardingReminder.url || '',
            previewImage: forwardingReminder.previewImage
          }}
        />
      )}
      {/* Notices (like "Marked as read · Undo") sit just above the tab bar, within thumb reach */}
      <Toaster
        position="bottom-center"
        offset={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}
        mobileOffset={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}
      />
    </div>
    </AvatarContext.Provider>
  );
}
