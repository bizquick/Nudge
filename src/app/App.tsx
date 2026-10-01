import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ReminderList } from './components/ReminderList';
import { QuickSendModal } from './components/QuickSendModal';
import { SortMenu, sortReminders, loadSortSetting, saveSortSetting, type SortSetting } from './components/SortMenu';
import { FolderBar, type Folder } from './components/FolderBar';
import { AuthScreen } from './components/AuthScreen';
import { Send, Archive, ArchiveX, Trash2, LogOut, Inbox as InboxIcon, Users, User, ChevronLeft, ChevronDown, TrendingUp, Pencil } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { ImageWithFallback } from './components/figma/ImageWithFallback';
import nudgeLogo from '../imports/image-3.png';
import nIconTonal from '../imports/n-icon-tonal.png';
import { supabase } from './utils/supabase/client';

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
}

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
  const selectSender = (sender: string | null) => {
    setSelectedSender(sender);
    setExpandedId(null);
    setEditingGroupName(false);
  };

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

  const handleAddReminder = async (reminder: Omit<Reminder, 'id' | 'createdAt' | 'sender' | 'checkedOut'>) => {
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

  const handleArchiveContact = (name: string) => setContactStatus(name, 'archived');
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
  const groups = (() => {
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

  const allRemindersForUser = reminders.filter(r =>
    r.sender === currentUser || r.recipients.includes(currentUser)
  );

  const selectedGroupKey = selectedSender?.startsWith('group:') ? selectedSender.slice('group:'.length) : null;
  const selectedGroupMeta = selectedGroupKey ? groups.find(g => g.key === selectedGroupKey) : null;

  const displayedReminders = (() => {
    if (selectedSender === 'My Reminders') {
      return reminders.filter(r => isSavedToSelf(r, currentUser) && !r.archived);
    }
    if (selectedGroupKey) {
      return activeReminders.filter(r => groupKeyFor(r) === selectedGroupKey);
    }
    if (!selectedSender) {
      const sort = sortSettings[allMessagesFilter];
      if (allMessagesFilter === 'unread') {
        return sortReminders(inboxReminders.filter(r => (!r.checkedOut || r.id === expandedId) && !r.archived), sort);
      }
      if (allMessagesFilter === 'favorited') {
        const favorites = allRemindersForUser.filter(r => r.favorited && !r.archived);
        return sortReminders(activeFolder ? favorites.filter(r => folderOfReminder[r.id] === activeFolder) : favorites, sort);
      }
      if (allMessagesFilter === 'archived') return sortReminders(allRemindersForUser.filter(r => r.archived), sort);
    }
    return activeReminders.filter(r =>
      !isGroupReminder(r) && (r.sender === selectedSender || realRecipients(r)[0] === selectedSender)
    );
  })();

  // Popular is shared by everyone. (Archiving only tidies your own inbox — it no
  // longer pulls a public nudge out of Popular for everybody.)
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
  const exploreReminders = useMemo(() => {
    const shuffled = publicReminders.filter(r => r.sender !== currentUser && !r.voters.includes(currentUser));
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploreSeed, publicReminders.map(r => r.id).join(',')]);

  if (!authChecked) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-white">
        <ImageWithFallback src={nudgeLogo} alt="Nudge" className="h-16 w-auto object-contain" />
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
        <ImageWithFallback src={nudgeLogo} alt="Nudge" className="h-16 w-auto object-contain" />
        <p className="text-stone-400 text-sm">Loading your nudges…</p>
      </div>
    );
  }

  return (
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
            <>
              <button
                onClick={() => selectSender(null)}
                className="p-2 -ml-2 rounded-lg hover:bg-stone-100 transition-colors shrink-0"
                title="Back"
              >
                <ChevronLeft className="w-5 h-5 text-stone-700" />
              </button>
              {selectedGroupKey ? (
                editingGroupName ? (
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
                  <button
                    onClick={() => {
                      setGroupNameDraft(selectedGroupMeta?.groupName || '');
                      setEditingGroupName(true);
                    }}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left"
                  >
                    <h1 className="text-lg truncate">
                      {selectedGroupMeta?.groupName || selectedGroupMeta?.participants.join(', ') || 'Group'}
                    </h1>
                    <Pencil className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                  </button>
                )
              ) : (
                <h1 className="text-lg truncate flex-1">
                  {selectedSender === 'My Reminders' ? 'My Nudges' : selectedSender}
                </h1>
              )}
            </>
          ) : (
            // Large left-aligned screen title, iOS style (the logo lives on the sign-in and loading screens)
            <h1 className="tab-title pt-1 text-[30px] leading-tight text-stone-800">
              {mobileTab === 'inbox' ? 'Home' : mobileTab === 'people' ? 'Nudges' : mobileTab === 'popular' ? 'Popular' : 'You'}
            </h1>
          )}
        </div>

        {/* Secondary control row: View Archive (thread) or filter tabs (inbox) */}
        {selectedSender ? (
          <div className="mb-3 flex justify-end">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
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
                  className={`relative flex-1 px-2 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-orange-600 text-white'
                      : 'bg-white border border-stone-300 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  {labels[filter]}
                  {filter === 'unread' && unreadCount > 0 && (
                    <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 border-2 text-[10px] leading-none ${isActive ? 'bg-white text-orange-600 border-orange-600' : 'bg-orange-600 text-white border-white'}`}>
                      {unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Scrollable content — only this area scrolls */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="max-w-2xl mx-auto px-4 pb-4 w-full">
          {selectedSender ? (
            <ReminderList
              chatLayout={selectedSender !== 'My Reminders'}
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
            />
          ) : mobileTab === 'inbox' ? (
            <>
            {allMessagesFilter === 'favorited' && foldersReady && (() => {
              const favorites = allRemindersForUser.filter(r => r.favorited && !r.archived);
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
                />
              );
            })()}
            <div className="flex justify-end -mr-1 mb-1">
              <SortMenu value={sortSettings[allMessagesFilter]} onChange={(s) => changeSort(allMessagesFilter, s)} />
            </div>
            <ReminderList
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
              reorderable={sortSettings[allMessagesFilter].key === 'custom'}
              onReorder={handleReorderUnread}
              emptyMessage={
                allMessagesFilter === 'unread'
                  ? "You're all caught up. New nudges from friends will show up here."
                  : allMessagesFilter === 'archived'
                    ? 'Nothing archived. Nudges you archive will wait here.'
                    : activeFolder
                      ? 'This folder is empty. Open a favorite and tap its folder button to file it here.'
                      : 'No favorites yet. Open a nudge and tap the star to save it here.'
              }
              folderOptions={allMessagesFilter === 'favorited' && foldersReady
                ? { folders, folderOf: (id) => folderOfReminder[id] ?? null, onMove: handleMoveToFolder }
                : undefined}
            />
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
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-sm shrink-0">
                    Me
                  </div>
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-sm">My Nudges</p>
                    <p className="text-xs text-stone-500">{myOwnReminders.length} nudges</p>
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

                const initials = contact.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

                return (
                  <div key={contact} className="flex items-center gap-1 rounded-xl hover:bg-stone-50">
                    <button
                      onClick={() => selectSender(contact)}
                      className="flex-1 min-w-0 px-3 py-3 flex items-center gap-3 active:bg-stone-100 transition-colors rounded-xl text-left"
                    >
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-white text-sm shrink-0 relative">
                        {initials}
                        {unreadCount > 0 && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-orange-600 text-white text-[10px] flex items-center justify-center border-2 border-white">
                            {unreadCount}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{contact}</p>
                        <p className="text-xs text-stone-500">{count} nudges</p>
                      </div>
                    </button>
                    {/* Always-visible actions (no hover-only controls — this is a touchscreen) */}
                    <div className="flex items-center gap-1 pr-1 shrink-0">
                      <button
                        onClick={() => setQuickSendTo(contact)}
                        className="p-2.5 rounded-lg text-orange-600 hover:bg-orange-50 active:bg-orange-100"
                        title={`Send to ${contact}`}
                      >
                        <Send className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleArchiveContact(contact)}
                        className="p-2.5 rounded-lg text-stone-500 hover:bg-stone-100 active:bg-stone-200"
                        title={`Archive ${contact}`}
                      >
                        <ArchiveX className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Remove ${contact} from your contact list? Your nudges with them are kept — this just hides them from People.`)) {
                            handleDeleteContact(contact);
                          }
                        }}
                        className="p-2.5 rounded-lg text-red-500 hover:bg-red-50 active:bg-red-100"
                        title={`Delete ${contact}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Groups */}
              {groups.map(group => {
                const displayName = group.groupName || group.participants.join(', ');
                const initials = group.participants.slice(0, 3).map(p => p[0]?.toUpperCase() ?? '?');
                return (
                  <button
                    key={group.key}
                    onClick={() => selectSender('group:' + group.key)}
                    className="w-full px-3 py-3 flex items-center gap-3 hover:bg-stone-50 active:bg-stone-100 transition-colors rounded-xl text-left"
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
                      <p className="text-sm truncate">{displayName}</p>
                      <p className="text-xs text-stone-500">{group.count} nudges &middot; {group.participants.length + 1} people</p>
                    </div>
                  </button>
                );
              })}

              {/* Archived Contacts */}
              {archivedContactNames.length > 0 && (
                <div className="pt-3 mt-3 border-t border-stone-100">
                  <button
                    onClick={() => setShowArchivedContacts(!showArchivedContacts)}
                    className="w-full px-3 py-2.5 flex items-center justify-between text-sm text-stone-500 hover:bg-stone-50 rounded-lg transition-colors"
                  >
                    <span>Archived contacts ({archivedContactNames.length})</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${showArchivedContacts ? 'rotate-180' : ''}`} />
                  </button>
                  {showArchivedContacts && archivedContactNames.map(name => (
                    <div key={name} className="px-3 py-2.5 flex items-center justify-between">
                      <span className="text-sm text-stone-600">{name}</span>
                      <button
                        onClick={() => handleRestoreContact(name)}
                        className="text-xs text-orange-600 hover:text-orange-700 underline"
                        title={`Restore ${name}`}
                      >
                        Restore
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
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-xl shrink-0">
                  {currentUser.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{currentUser}</p>
                  <p className="text-xs text-stone-500">Signed in</p>
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
  );
}
