import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { ReminderList } from './components/ReminderList';
import { QuickSendModal } from './components/QuickSendModal';
import { SortMenu, sortReminders, loadSortSetting, saveSortSetting, type SortSetting } from './components/SortMenu';
import { FolderBar, type Folder } from './components/FolderBar';
import { SwipeRow } from './components/SwipeRow';
import { Avatar, AvatarContext, ProfileContext, ProfileLink } from './components/Avatar';
import { ProfileSheet } from './components/ProfileSheet';
import { GroupInfoSheet } from './components/GroupInfoSheet';
import { HomeQueue } from './components/HomeQueue';
import { ChangePassword } from './components/ChangePassword';
import { AvatarPicker } from './components/AvatarPicker';
import { AuthScreen } from './components/AuthScreen';
import { Insights } from './components/Insights';
import { Send, Archive, LogOut, Share2, Inbox as InboxIcon, Users, User, ChevronLeft, ChevronDown, TrendingUp, Pencil, BellOff, Bell, Trash2, StarOff, CheckCheck, Star, BarChart3, ChevronRight, RefreshCw, Info, KeyRound } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { ImageWithFallback } from './components/figma/ImageWithFallback';
import nudgeLogo from '../imports/image-3.png';
import nIconTonal from '../imports/n-icon-tonal.png';
import { supabase } from './utils/supabase/client';
import { registerPush, unregisterPush, setBadge, type PushTarget } from './utils/push';
import { syncShareMenu, clearShareMenu } from './utils/shareBridge';
import { App as CapacitorApp } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export type ReminderType = 'website' | 'music' | 'video' | 'text' | 'unnecessary' | 'interesting' | 'food' | 'lifehack';

export interface Message {
  id: string;
  reminderId: string;
  sender: string;
  text: string;
  createdAt: Date;
  /** Photos sent in the conversation */
  attachments: Attachment[];
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
  /** When it was checked off (for a to-do list: when the last person tapped Complete) */
  checkedAt: Date | null;
  /** To-do lists: everyone who has tapped Complete. It counts as checked once all of them have. */
  completedBy: string[];
  /** Photos and files attached to the nudge */
  attachments: Attachment[];
  /** Who last renamed the group this nudge is in, and when (shown for a day) */
  groupRenamedBy: string | null;
  groupRenamedAt: Date | null;
  /** Sent to you by someone you haven't accepted yet (only possible for Public nudges) */
  awaitingMyAcceptance?: boolean;
}

/** Your own (or a fellow participant's) personal state for one nudge */
export interface NudgeState {
  owner_name: string;
  reminder_id: string;
  checked_at: string | null;
  archived_at: string | null;
  popular_checked_at: string | null;
  explore_shown_at: string | null;
  explore_done_at: string | null;
}

export interface Connection {
  other_name: string;
  status: 'accepted' | 'declined' | 'blocked';
  declined_at: string | null;
}

export interface NudgeRequest {
  sender: string;
  waiting: number;
  latest: string;
}

/** A photo or file attached to a nudge (several allowed, alongside a link) */
export interface Attachment {
  url: string;
  name: string;
  /** e.g. "image/jpeg", "video/mp4", "application/pdf" */
  type: string;
}

const UPLOAD_PATH = '/nudge-uploads/';
// "New messages" tracking started here; older unopened messages don't suddenly resurface
const NEW_MESSAGES_SINCE = new Date('2026-10-04T07:00:00Z');

// Older nudges kept a single upload in the link field. Treat that as an attachment
// so it shows big like new ones, and keep only real web links as the link.
function splitLegacyUpload(row: any): { url?: string; attachments: Attachment[] } {
  const list: Attachment[] = Array.isArray(row.attachments) ? row.attachments : [];
  const url: string | undefined = row.url || undefined;
  if (url && url.includes(UPLOAD_PATH) && list.length === 0) {
    const name = decodeURIComponent(url.split('/').pop() || 'File').replace(/^\d+-/, '');
    const isImage = row.preview_image === url || /\.(jpe?g|png|gif|webp|heic)$/i.test(url);
    return { url: undefined, attachments: [{ url, name, type: isImage ? 'image/jpeg' : 'application/octet-stream' }] };
  }
  return { url, attachments: list };
}

export interface TodoItem {
  /** Permanent id, so people editing the same list don't trip over each other */
  id?: string;
  text: string;
  done: boolean;
  /** Who ticked it off, and when (only while it's ticked) */
  by?: string;
  at?: string;
}

/** What the New Nudge form hands back: a nudge to create, plus the "prioritize" choice */
export type NewNudge = Omit<Reminder, 'id' | 'createdAt' | 'sender' | 'checkedOut' | 'prioritizedAt' | 'checkedAt' | 'completedBy' | 'groupRenamedBy' | 'groupRenamedAt'> & { prioritized: boolean };

function rowToReminder(row: any, reactions: Reaction[] = [], voters: string[] = []): Reminder {
  const { url, attachments } = splitLegacyUpload(row);
  return {
    id: row.id,
    type: row.type ?? null,
    title: row.title,
    content: row.content,
    url,
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
    todoItems: Array.isArray(row.todo_items) ? row.todo_items : null,
    checkedAt: row.checked_at ? new Date(row.checked_at) : null,
    completedBy: Array.isArray(row.completed_by) ? row.completed_by : [],
    attachments,
    groupRenamedBy: row.group_renamed_by ?? null,
    groupRenamedAt: row.group_renamed_at ? new Date(row.group_renamed_at) : null
  };
}

function rowToMessage(row: any): Message {
  return {
    id: row.id,
    reminderId: row.reminder_id,
    sender: row.sender,
    text: row.text,
    createdAt: new Date(row.created_at),
    attachments: Array.isArray(row.attachments) ? row.attachments : []
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

// Chat order, like Messages: 🤯 priorities pinned at the top (oldest priority
// first), then everything else oldest → newest, so the newest nudge sits at the bottom.
function chatOrder(list: Reminder[]): Reminder[] {
  const priorities = list.filter(r => r.prioritizedAt)
    .sort((a, b) => a.prioritizedAt!.getTime() - b.prioritizedAt!.getTime());
  const rest = list.filter(r => !r.prioritizedAt)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return [...priorities, ...rest];
}

// Done with: checked off, or archived. These live in a chat's Checked view and
// Home's Checked list. (A to-do list only counts as checked once everyone taps Complete.)
function isDone(r: Reminder): boolean {
  return r.checkedOut || r.archived;
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
  // Inside a chat: showing its Checked nudges instead of the open ones
  const [showChecked, setShowChecked] = useState(false);
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
    setShowChecked(false);
    setExpandedId(null);
    setEditingGroupName(false);
    setEditingNote(false);
  };

  const [rawReminders, setReminders] = useState<Reminder[]>([]);
  // Nudges you just deleted: hidden right away, really deleted once the Undo window passes
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const deleteTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // When you last opened each nudge (yours only) — a checked nudge with a newer
  // message from someone else comes back to the top of Home
  const [seenAt, setSeenAt] = useState<Record<string, Date>>({});
  // Your own favorites (null until loaded, or if the favorites table isn't set up yet —
  // then the old shared "favorited" switch is used as a fallback)
  const [favoriteIds, setFavoriteIds] = useState<Set<string> | null>(null);
  // Personal state per nudge (yours, plus fellow participants' checks). null = not set up
  // in the database yet, in which case the old shared switches are used.
  const [nudgeStates, setNudgeStates] = useState<NudgeState[] | null>(null);
  // Whom you've accepted, declined, or blocked
  const [connections, setConnections] = useState<Connection[] | null>(null);
  // People waiting for you to accept their nudges
  const [requests, setRequests] = useState<NudgeRequest[]>([]);
  // Nudges you sent that someone hasn't accepted yet: nudge id -> who
  const [pendingSent, setPendingSent] = useState<Record<string, string[]>>({});

  const myStates = useMemo(() => {
    const map = new Map<string, NudgeState>();
    (nudgeStates ?? []).forEach(st => { if (st.owner_name === currentUser) map.set(st.reminder_id, st); });
    return map;
  }, [nudgeStates, currentUser]);
  // When each person in a nudge checked it (for "Checked" on nudges you sent)
  const checksByNudge = useMemo(() => {
    const map = new Map<string, Map<string, Date>>();
    (nudgeStates ?? []).forEach(st => {
      if (!st.checked_at) return;
      if (!map.has(st.reminder_id)) map.set(st.reminder_id, new Map());
      map.get(st.reminder_id)!.set(st.owner_name, new Date(st.checked_at));
    });
    return map;
  }, [nudgeStates]);
  const checkedByNames = useMemo(() => {
    const out: Record<string, string[]> = {};
    checksByNudge.forEach((people, id) => { out[id] = Array.from(people.keys()); });
    return out;
  }, [checksByNudge]);
  const connectionOf = useMemo(() => new Map((connections ?? []).map(c => [c.other_name, c])), [connections]);
  const blockedNames = useMemo(() => new Set((connections ?? []).filter(c => c.status === 'blocked').map(c => c.other_name)), [connections]);

  // Each nudge as *you* see it: favorited, checked, and archived are yours alone
  const reminders = useMemo(
    () => {
      const visible = pendingDeletes.size ? rawReminders.filter(r => !pendingDeletes.has(r.id)) : rawReminders;
      return visible.map(r => {
        const next = { ...r };
        if (favoriteIds) next.favorited = favoriteIds.has(r.id);
        if (nudgeStates && currentUser) {
          const mine = myStates.get(r.id);
          next.archived = !!mine?.archived_at;
          const amRecipient = r.recipients.includes(currentUser);
          if (r.todoItems) {
            // to-do lists: checked once everyone taps Complete (shared on purpose)
          } else if (amRecipient) {
            next.checkedOut = !!mine?.checked_at;
            next.checkedAt = mine?.checked_at ? new Date(mine.checked_at) : null;
          } else if (r.sender === currentUser) {
            // Nudges you sent: "Checked" once everyone you sent it to has checked it
            const others = r.recipients.filter(p => p !== r.sender);
            const checks = checksByNudge.get(r.id);
            const times = others.map(p => checks?.get(p)).filter((d): d is Date => !!d);
            next.checkedOut = others.length > 0 && times.length === others.length;
            next.checkedAt = next.checkedOut ? new Date(Math.max(...times.map(d => d.getTime()))) : null;
          } else {
            next.checkedOut = false; // a stranger's Public nudge: Popular keeps its own checks
            next.checkedAt = null;
          }
        }
        // A Public nudge sent to you by someone you haven't accepted: Popular only, not your feed
        if (connections && currentUser && r.recipients.includes(currentUser) && r.sender !== currentUser) {
          const c = connectionOf.get(r.sender);
          const accepted = c?.status === 'accepted' && (!c.declined_at || r.createdAt > new Date(c.declined_at));
          if (!accepted) next.awaitingMyAcceptance = true;
        }
        return next;
      });
    },
    [rawReminders, favoriteIds, pendingDeletes, nudgeStates, myStates, checksByNudge, connections, connectionOf, currentUser]
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [chatNotes, setChatNotes] = useState<Record<string, string>>({});
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  // The app's owner sees an Insights page (the database decides who that is)
  const [isAdmin, setIsAdmin] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  // Whose profile card is open (tap anyone's picture or name)
  const [profileName, setProfileName] = useState<string | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  // Group pictures (anyone in a group can set one; everyone in it sees it): group key -> picture
  const [groupAvatars, setGroupAvatars] = useState<Record<string, string>>({});
  const [groupPictureFor, setGroupPictureFor] = useState<string | null>(null);
  // Favorites and Checked now live under the Nudges tab (Home is just your queue)
  const [savedView, setSavedView] = useState<'favorited' | 'archived' | null>(null);
  // Explore: which nudge is the big card up top (picking one never reorders anything)
  const [exploreHeroId, setExploreHeroId] = useState<string | null>(null);
  // Home: showing only one friend's (or group's) nudges — tap their picture at the top
  const [queuePerson, setQueuePerson] = useState<string | null>(null);
  const [showRequests, setShowRequests] = useState(false);
  // "Later": nudges you pushed to the back of your queue (kept on this phone)
  const [laterAt, setLaterAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('addly.later') || '{}'); } catch { return {}; }
  });
  const saveLater = (next: Record<string, number>) => {
    setLaterAt(next);
    try { localStorage.setItem('addly.later', JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  // Someone's invite link (addlyapp.com/add?u=Name, or the older flagem.app / nudgem.app ones) was opened — start a nudge to them once signed in
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pullRef = useRef<HTMLDivElement>(null);
  const pullIconRef = useRef<HTMLDivElement>(null);

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
    await clearShareMenu(); // the Share menu stops being able to send as you
    await supabase.auth.signOut();
    setCurrentUser(null);
    setReminders([]);
    setMessages([]);
    setIsAdmin(false);
    setShowInsights(false);
  };

  const [hiddenContacts, setHiddenContacts] = useState<{ name: string; status: 'archived' | 'deleted' }[]>([]);
  const [showArchivedContacts, setShowArchivedContacts] = useState(false);

  const loadData = useCallback(async () => {
    const [{ data: reminderRows, error: reminderErr }, { data: reactionRows, error: reactionErr }, { data: messageRows, error: messageErr }, { data: contactPrefRows, error: contactPrefErr }, { data: voteRows, error: voteErr }] = await Promise.all([
      supabase.from('reminders').select('*').order('created_at', { ascending: false }),
      supabase.from('reminder_reactions').select('*'),
      supabase.from('messages').select('*').order('created_at', { ascending: true }),
      supabase.from('contact_prefs').select('contact_name, status'),
      supabase.from('reminder_votes').select('*')
    ]);

    if (reminderErr || reactionErr || messageErr || contactPrefErr || voteErr) {
      console.error(reminderErr || reactionErr || messageErr || contactPrefErr || voteErr);
      setLoadError("Couldn't reach the server. Check your connection and Supabase setup.");
      return;
    }

    const reactionMap = groupReactions(reactionRows || []);
    const voteMap = groupVotes(voteRows || []);
    setReminders((reminderRows || []).map(row => rowToReminder(row, reactionMap[row.id] || [], voteMap[row.id] || [])));
    setMessages((messageRows || []).map(rowToMessage));
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
      // Only pictures of people you know come back (the database limits it)
      supabase.from('profiles').select('display_name, avatar').not('avatar', 'is', null),
      supabase.from('chat_notes').select('chat_key, note'),
    ]);
    if (favErr) console.warn('Personal favorites unavailable:', favErr);
    else setFavoriteIds(new Set((favRows || []).map(f => f.reminder_id)));
    if (avatarErr) console.warn('Pictures unavailable:', avatarErr);
    else setAvatars(Object.fromEntries((avatarRows || []).map(a => [a.display_name, a.avatar])));
    if (noteErr) console.warn('Chat descriptions unavailable:', noteErr);
    else setChatNotes(Object.fromEntries((noteRows || []).map(n => [n.chat_key, n.note])));

    const { data: readRows, error: readErr } = await supabase.from('nudge_reads').select('reminder_id, seen_at');
    if (readErr) console.warn('Read times unavailable:', readErr);
    else setSeenAt(Object.fromEntries((readRows || []).map(r => [r.reminder_id, new Date(r.seen_at)])));

    // Personal checks, connections, requests, and who hasn't accepted your nudges yet
    const [{ data: stateRows, error: stateErr }, { data: connRows, error: connErr }, { data: reqRows }, { data: pendRows }] = await Promise.all([
      supabase.from('nudge_user_state').select('owner_name, reminder_id, checked_at, archived_at, popular_checked_at, explore_shown_at, explore_done_at'),
      supabase.from('connections').select('other_name, status, declined_at'),
      supabase.rpc('my_nudge_requests'),
      supabase.rpc('my_pending_recipients'),
    ]);
    if (stateErr) console.warn('Personal state unavailable:', stateErr); else setNudgeStates((stateRows || []) as NudgeState[]);
    if (connErr) console.warn('Connections unavailable:', connErr); else setConnections((connRows || []) as Connection[]);
    setRequests(((reqRows || []) as NudgeRequest[]).map(q => ({ ...q, waiting: Number(q.waiting) })));
    const pend: Record<string, string[]> = {};
    ((pendRows || []) as { reminder_id: string; recipient: string }[]).forEach(p => { (pend[p.reminder_id] ??= []).push(p.recipient); });
    setPendingSent(pend);

    const { data: groupPicRows, error: groupPicErr } = await supabase.from('group_avatars').select('group_key, avatar');
    if (groupPicErr) console.warn('Group pictures unavailable:', groupPicErr);
    else setGroupAvatars(Object.fromEntries((groupPicRows || []).filter(g => g.avatar).map(g => [g.group_key, g.avatar])));

    const { data: adminFlag } = await supabase.rpc('is_admin');
    setIsAdmin(adminFlag === true);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nudge_user_state' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'connections' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_avatars' }, scheduleRefresh)
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
    const newKey = groupKeyFor({ ...reminder, sender: currentUser } as unknown as Reminder);
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
      ...(reminder.todoItems ? { todo_items: reminder.todoItems } : {}),
      ...(reminder.attachments.length ? { attachments: reminder.attachments } : {})
    };
    const { data, error } = await supabase.from('reminders').insert(payload).select().single();
    if (error) {
      console.error(error);
      toast('Could not send — try again');
      return;
    }
    setReminders(prev => [rowToReminder(data), ...prev]);
    // One notice even when "Individually" sends several at once
    const savedOnly = reminder.recipients.every(p => p === currentUser);
    toast(savedOnly ? 'Saved to My Nudges' : 'Nudge sent!', { id: 'nudge-sent', duration: 2000 });
    // Someone new? Their acceptance status comes from the server
    if (!savedOnly) scheduleRefresh();
  };

  const handleUpdateGroupName = async (groupKey: string, name: string) => {
    const memberIds = reminders.filter(r => groupKeyFor(r) === groupKey).map(r => r.id);
    if (memberIds.length === 0) return;
    const now = new Date();
    setReminders(prev => prev.map(r => memberIds.includes(r.id) ? { ...r, groupName: name || null, groupRenamedBy: currentUser, groupRenamedAt: now } : r));
    // Remember who renamed it and when, for the "renamed the group" notice in the chat
    let { error } = await supabase.from('reminders')
      .update({ group_name: name || null, group_renamed_by: currentUser, group_renamed_at: now.toISOString() })
      .in('id', memberIds);
    if (error) ({ error } = await supabase.from('reminders').update({ group_name: name || null }).in('id', memberIds));
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

  // Save part of your personal state for a nudge (checked, archived, Popular progress)
  const setMyState = async (id: string, patch: Partial<Omit<NudgeState, 'owner_name' | 'reminder_id'>>) => {
    if (!currentUser) return;
    setNudgeStates(prev => {
      const list = prev ?? [];
      const existing = list.find(st => st.owner_name === currentUser && st.reminder_id === id);
      const blank: NudgeState = { owner_name: currentUser, reminder_id: id, checked_at: null, archived_at: null, popular_checked_at: null, explore_shown_at: null, explore_done_at: null };
      const updated = { ...(existing ?? blank), ...patch };
      return existing ? list.map(st => st === existing ? updated : st) : [...list, updated];
    });
    const { error } = await supabase.from('nudge_user_state')
      .upsert({ owner_name: currentUser, reminder_id: id, ...patch }, { onConflict: 'owner_name,reminder_id' });
    if (error) {
      console.error(error);
      toast('Could not save that');
    }
  };

  // The same personal-state change for several nudges at once (one trip to the server)
  const setMyStates = async (ids: string[], patch: Partial<Omit<NudgeState, 'owner_name' | 'reminder_id'>>) => {
    if (!currentUser || !ids.length) return;
    setNudgeStates(prev => {
      const list = [...(prev ?? [])];
      ids.forEach(id => {
        const i = list.findIndex(st => st.owner_name === currentUser && st.reminder_id === id);
        const blank: NudgeState = { owner_name: currentUser, reminder_id: id, checked_at: null, archived_at: null, popular_checked_at: null, explore_shown_at: null, explore_done_at: null };
        if (i >= 0) list[i] = { ...list[i], ...patch }; else list.push({ ...blank, ...patch });
      });
      return list;
    });
    const { error } = await supabase.from('nudge_user_state')
      .upsert(ids.map(id => ({ owner_name: currentUser, reminder_id: id, ...patch })), { onConflict: 'owner_name,reminder_id' });
    if (error) console.error(error);
  };

  const handleToggleCheckedOut = async (id: string) => {
    const reminder = reminders.find(r => r.id === id);
    if (!reminder) return;
    const wasCheckedOut = reminder.checkedOut;

    // Your check is yours alone (the sender sees "Checked" once you've checked it)
    const applyValue = async (value: boolean) => {
      const checkedAt = value ? new Date() : null;
      if (nudgeStates) {
        setMyState(id, { checked_at: checkedAt ? checkedAt.toISOString() : null });
        if (value) markSeen(id);
        return;
      }
      setReminders(prev => prev.map(r => r.id === id ? { ...r, checkedOut: value, checkedAt } : r));
      const { error } = await supabase.from('reminders')
        .update({ checked_out: value, checked_at: checkedAt ? checkedAt.toISOString() : null })
        .eq('id', id);
      if (error) console.error(error);
    };
    applyValue(!wasCheckedOut);

    if (!wasCheckedOut) {
      toast('Checked', {
        duration: 4000,
        action: { label: 'Undo', onClick: () => applyValue(false) },
      });
    }
  };

  const handleArchive = async (id: string) => {
    const reminder = reminders.find(r => r.id === id);
    if (!reminder) return;
    const nextValue = !reminder.archived;
    // Archiving only tidies your own lists
    const apply = async (value: boolean) => {
      if (nudgeStates) { setMyState(id, { archived_at: value ? new Date().toISOString() : null }); return; }
      setReminders(prev => prev.map(r => r.id === id ? { ...r, archived: value } : r));
      const { error } = await supabase.from('reminders').update({ archived: value }).eq('id', id);
      if (error) console.error(error);
    };
    apply(nextValue);
    if (nextValue) {
      toast('Archived', { duration: 4000, action: { label: 'Undo', onClick: () => apply(false) } });
    }
  };

  // The sender deletes a nudge for everyone in it. It disappears right away; the real
  // delete happens once the Undo window is over (so Undo needs no rebuilding).
  const handleDeleteNudge = (id: string) => {
    setPendingDeletes(prev => new Set(prev).add(id));
    if (expandedId === id) setExpandedId(null);
    const restore = () => setPendingDeletes(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    const timer = setTimeout(async () => {
      deleteTimers.current.delete(id);
      const { error } = await supabase.rpc('delete_my_nudge', { p_id: id });
      if (error) {
        console.error(error);
        toast('Could not delete that nudge');
        restore();
        return;
      }
      setReminders(prev => prev.filter(r => r.id !== id));
      restore();
    }, 4500);
    deleteTimers.current.set(id, timer);
    toast('Nudge deleted', {
      duration: 4000,
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(deleteTimers.current.get(id));
          deleteTimers.current.delete(id);
          restore();
        },
      },
    });
  };

  // To-do lists: tap Complete (or tap again to undo). The database flips the list to
  // checked once everyone in it has completed it.
  const handleToggleTodoComplete = async (id: string) => {
    if (!currentUser) return;
    const reminder = reminders.find(r => r.id === id);
    if (!reminder?.todoItems) return;
    const mine = reminder.completedBy.includes(currentUser);
    const completedBy = mine ? reminder.completedBy.filter(n => n !== currentUser) : [...reminder.completedBy, currentUser];
    const everyone = Array.from(new Set([reminder.sender, ...reminder.recipients]));
    const allDone = everyone.every(n => completedBy.includes(n));
    setReminders(prev => prev.map(r => r.id === id
      ? { ...r, completedBy, checkedOut: allDone, checkedAt: allDone ? (r.checkedAt ?? new Date()) : null }
      : r));
    const { data, error } = await supabase.rpc('toggle_todo_complete', { p_id: id });
    if (error || !data) {
      console.error(error);
      toast('Could not update that to-do list');
      setReminders(prev => prev.map(r => r.id === id ? reminder : r));
      return;
    }
    setReminders(prev => prev.map(r => r.id === id ? rowToReminder(data, r.reactions, r.voters) : r));
  };

  // Remember that you've seen a nudge's latest messages (only written when it matters)
  const markSeen = async (id: string) => {
    const now = new Date();
    setSeenAt(prev => ({ ...prev, [id]: now }));
    const { error } = await supabase.from('nudge_reads')
      .upsert({ reminder_id: id, seen_at: now.toISOString() }, { onConflict: 'owner_id,reminder_id' });
    if (error) console.warn('Could not save read time', error);
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

  // Tick or untick one line of a to-do list nudge (everyone in the nudge sees it,
  // along with who ticked it). The server flips just that one line, so two people
  // ticking different lines at the same moment don't undo each other.
  // Shared to-do lists: anyone in the list can tick, add, reword, or delete lines.
  // Each change is applied on the server one at a time, so two people editing
  // together never undo each other (like a shared list in Reminders).
  const handleTodoEdit = async (id: string, op: 'toggle' | 'add' | 'edit' | 'delete', itemId?: string, text?: string) => {
    if (!currentUser) return;
    const reminder = reminders.find(r => r.id === id);
    if (!reminder?.todoItems) return;
    const items = reminder.todoItems;
    let next = items;
    if (op === 'add' && text?.trim()) next = [...items, { id: 'tmp-' + Date.now(), text: text.trim(), done: false }];
    if (op === 'delete' || (op === 'edit' && !text?.trim())) next = items.filter(i => i.id !== itemId);
    if (op === 'edit' && text?.trim()) next = items.map(i => i.id === itemId ? { ...i, text: text.trim() } : i);
    if (op === 'toggle') next = items.map(i => i.id !== itemId ? i
      : i.done ? { id: i.id, text: i.text, done: false } : { ...i, done: true, by: currentUser, at: new Date().toISOString() });
    setReminders(prev => prev.map(r => r.id === id
      ? { ...r, todoItems: next, ...(op === 'add' ? { completedBy: [], checkedOut: false, checkedAt: null } : {}) }
      : r));
    const { data, error } = await supabase.rpc('todo_edit', { p_id: id, p_op: op, p_item: itemId ?? null, p_text: text ?? null });
    if (error || !data) {
      console.error(error);
      toast('Could not update that list');
      setReminders(prev => prev.map(r => r.id === id ? { ...r, todoItems: items } : r));
      return;
    }
    setReminders(prev => prev.map(r => r.id === id ? rowToReminder(data, r.reactions, r.voters) : r));
  };
  const handleToggleTodo = async (id: string, index: number) => {
    const item = reminders.find(r => r.id === id)?.todoItems?.[index];
    if (!item) return;
    if (item.id) { handleTodoEdit(id, 'toggle', item.id); return; }
    // Lines from before ids existed (the database step adds them): the older one-line tick
    const { data, error } = await supabase.rpc('toggle_todo_item', { p_id: id, p_index: index });
    if (error || !data) { console.error(error); toast('Could not update that to-do'); return; }
    setReminders(prev => prev.map(r => r.id === id ? rowToReminder(data, r.reactions, r.voters) : r));
  };

  // ---- Nudge requests and blocking ----
  const setConnection = async (name: string, status: Connection['status'], extra: Partial<Connection> = {}) => {
    if (!currentUser) return;
    const existing = connectionOf.get(name);
    const row = { other_name: name, status, declined_at: existing?.declined_at ?? null, ...extra };
    setConnections(prev => [...(prev ?? []).filter(c => c.other_name !== name), row]);
    const { error } = await supabase.from('connections').upsert(
      { owner_name: currentUser, ...row, updated_at: new Date().toISOString() },
      { onConflict: 'owner_name,other_name' }
    );
    if (error) {
      console.error(error);
      toast('Could not save that');
    }
    loadData(); // accepting reveals their nudges; declining or blocking hides them
  };
  const handleAcceptRequest = (name: string) => {
    setRequests(prev => prev.filter(q => q.sender !== name));
    setConnection(name, 'accepted');
    toast(`You'll now get nudges from ${name}`);
  };
  // Declining quietly drops what they sent (they're never told); new nudges ask again
  const handleDeclineRequest = (name: string) => {
    setRequests(prev => prev.filter(q => q.sender !== name));
    setConnection(name, 'declined', { declined_at: new Date().toISOString() });
  };
  const handleBlock = (name: string) => {
    setRequests(prev => prev.filter(q => q.sender !== name));
    if (selectedSender === name) selectSender(null);
    setConnection(name, 'blocked');
    toast(`Blocked ${name}. You won't see anything from them.`);
  };
  // Unblocking starts fresh: nothing old comes back, and their next nudge is a request
  const handleUnblock = (name: string) => {
    setConnection(name, 'declined', { declined_at: new Date().toISOString() });
    toast(`Unblocked ${name}`);
  };

  // ---- Popular and Explore: your own checks, separate from your feed ----
  const handleTogglePopularCheck = (id: string) => {
    const st = myStates.get(id);
    setMyState(id, { popular_checked_at: st?.popular_checked_at ? null : new Date().toISOString() });
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
  const handleToggleFavorite = (id: string) => {
    const reminder = reminders.find(r => r.id === id);
    if (reminder) setFavorite(id, !reminder.favorited);
  };

  // Swipe left in Favorites: take it out of your Favorites, with Undo
  const handleRemoveFavorite = (id: string) => {
    setFavorite(id, false);
    toast('Removed from Favorites', {
      duration: 4000,
      action: { label: 'Undo', onClick: () => setFavorite(id, true) },
    });
  };

  const setFavorite = async (id: string, nextValue: boolean) => {
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

  // A group's picture, set by anyone in it (everyone in the group sees the change)
  const handleSaveGroupAvatar = async (key: string, value: string | null) => {
    if (!currentUser) return;
    setGroupAvatars(prev => {
      const next = { ...prev };
      if (value) next[key] = value; else delete next[key];
      return next;
    });
    const { error } = await supabase.from('group_avatars').upsert(
      { group_key: key, avatar: value, updated_by: currentUser, updated_at: new Date().toISOString() },
      { onConflict: 'group_key' }
    );
    if (error) {
      console.error(error);
      toast("Couldn't save the group picture");
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

  const handleAddMessage = async (reminderId: string, text: string, attachments: Attachment[] = []) => {
    if (!currentUser) return;
    const payload = { reminder_id: reminderId, sender: currentUser, text, ...(attachments.length ? { attachments } : {}) };
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

  // Your feed: leaves out nudges from people you haven't accepted (Public ones still show
  // in Popular) and anything from people you've blocked
  const feedReminders = reminders.filter(r => !r.awaitingMyAcceptance && !(r.sender !== currentUser && blockedNames.has(r.sender)));
  const shownMessages = blockedNames.size ? messages.filter(m => !blockedNames.has(m.sender)) : messages;
  const receivedReminders = feedReminders.filter(r => r.recipients.includes(currentUser));
  const sentReminders = feedReminders.filter(r => r.sender === currentUser);

  const myOwnReminders = feedReminders.filter(r => isSavedToSelf(r, currentUser) && !r.archived);

  const allUserReminders = feedReminders.filter(r =>
    r.sender === currentUser || r.recipients.includes(currentUser)
  );

  // "To" suggestions: only people you've already sent nudges to or received them from.
  // Anyone else is found by typing their exact Nudge name (the server checks it).
  const contacts = Array.from(new Set(allUserReminders.flatMap(r => [r.sender, ...r.recipients])))
    .filter(name => name && name !== currentUser && !blockedNames.has(name))
    .sort((a, b) => a.localeCompare(b));

  // Home's Unread list: only nudges sent to you, plus ones you saved to My Nudges
  // (those list you as a recipient too) — not ones you only sent to others.
  const inboxReminders = feedReminders.filter(r => r.recipients.includes(currentUser));
  // A to-do list you've already opened isn't "new" any more (it stays on Home until it's done)
  const isNewToMe = (r: Reminder) => !r.checkedOut && !r.archived && !(r.todoItems && seenAt[r.id]);
  const unreadCount = inboxReminders.filter(isNewToMe).length;
  // To-do lists are shared work, so ones you sent stay on your Home too until everyone completes them
  const homeReminders = feedReminders.filter(r => r.recipients.includes(currentUser) || (r.sender === currentUser && r.todoItems));

  // A checked nudge that got a message from someone else since you checked it
  // (or last opened it): it stays checked, but comes back to the top of Home.
  const latestOtherMessage = new Map<string, Date>();
  shownMessages.forEach(m => {
    if (m.sender === currentUser) return;
    const prev = latestOtherMessage.get(m.reminderId);
    if (!prev || m.createdAt > prev) latestOtherMessage.set(m.reminderId, m.createdAt);
  });
  // A message counts as new until YOU open the nudge — someone else checking it doesn't
  // hide it from you. (Nudges you never opened before this feature only count newer messages.)
  const hasNewMessages = (id: string) => {
    const r = reminders.find(x => x.id === id);
    const latest = latestOtherMessage.get(id);
    if (!r || !latest || !isDone(r)) return false;
    return latest > (seenAt[id] ?? NEW_MESSAGES_SINCE);
  };
  const reopenedReminders = allUserReminders.filter(r => hasNewMessages(r.id));
  // The red number on Home and the app icon: new nudges plus checked ones with new messages
  const homeBadge = unreadCount + reopenedReminders.length + requests.filter(q => !blockedNames.has(q.sender)).length;
  // Pull to refresh: drag the list down from the very top and let go to reload
  // everything. Built by hand (iPhone apps don't get the browser's version), and it
  // moves the page directly rather than re-rendering, so it stays smooth.
  useEffect(() => {
    const el = scrollRef.current;
    const bar = pullRef.current;
    const icon = pullIconRef.current;
    if (!el || !bar || !icon) return;
    const THRESHOLD = 64, MAX = 110;
    let startY: number | null = null, startX = 0, pulling = false, dist = 0, armed = false, busy = false;

    const show = (height: number, animate: boolean) => {
      bar.style.transition = animate ? 'height 250ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
      bar.style.height = `${height}px`;
      icon.style.opacity = busy ? '1' : String(Math.min(1, height / THRESHOLD));
      if (!busy) icon.style.transform = `rotate(${height * 3}deg)`;
    };
    const onStart = (e: TouchEvent) => {
      // Not while scrolled down, already refreshing, or dragging a nudge around
      if (busy || el.scrollTop > 0 || document.body.dataset.nudgeDragging) { startY = null; return; }
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      pulling = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      if (document.body.dataset.nudgeDragging) { startY = null; if (pulling) show(0, true); pulling = false; return; }
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (!pulling) {
        if (dy > 8 && dy > Math.abs(dx) * 1.5 && el.scrollTop <= 0) pulling = true;
        else { if (dy < 0 || Math.abs(dx) > 10) startY = null; return; }
      }
      e.preventDefault(); // we're pulling, not scrolling (also stops iPhone's rubber-band)
      dist = Math.min(MAX, Math.max(0, dy - 8) * 0.5);
      show(dist, false);
      const nowArmed = dist >= THRESHOLD;
      if (nowArmed && !armed) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      armed = nowArmed;
    };
    const onEnd = async () => {
      if (startY === null || !pulling) { startY = null; return; }
      startY = null;
      pulling = false;
      if (!armed) { show(0, true); return; }
      armed = false;
      busy = true;
      show(52, true);
      icon.classList.add('animate-spin');
      try { await loadData(); } catch { /* the error banner covers it */ }
      icon.classList.remove('animate-spin');
      busy = false;
      show(0, true);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [dataLoading, currentUser, loadData]);

  // Opening a nudge and then closing it counts as seeing its new messages (it stays
  // in place while open, then settles back into Checked)
  const lastExpanded = useRef<string | null>(null);
  useEffect(() => {
    const closed = lastExpanded.current;
    lastExpanded.current = expandedId;
    if (closed && closed !== expandedId && hasNewMessages(closed)) markSeen(closed);
    // Opening a to-do list counts as having seen it
    const opened = expandedId ? reminders.find(r => r.id === expandedId) : null;
    if (opened?.todoItems && !seenAt[opened.id]) markSeen(opened.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId]);

  // Chats list every nudge you're in; each chat splits them into open and Checked
  const activeReminders = allUserReminders;

  const hiddenContactNames = new Set(hiddenContacts.map(h => h.name));
  const archivedContactNames = hiddenContacts.filter(h => h.status === 'archived').map(h => h.name).sort();

  const uniqueContacts = Array.from(
    new Set(
      activeReminders
        .filter(r => !isGroupReminder(r))
        .map(r => r.sender === currentUser ? realRecipients(r)[0] : r.sender)
    )
  ).filter((name): name is string => !!name && !hiddenContactNames.has(name) && !blockedNames.has(name)).sort();

  // Group threads: identified by their exact participant set, so every nudge
  // sent among the same people threads together regardless of who sent it.
  const allGroups = (() => {
    const map = new Map<string, { key: string; participants: string[]; groupName: string | null; count: number; unread: number }>();
    activeReminders.filter(isGroupReminder).forEach(r => {
      const key = groupKeyFor(r)!;
      const participants = Array.from(new Set([r.sender, ...r.recipients])).filter(p => p !== currentUser);
      const existing = map.get(key);
      const isUnread = r.recipients.includes(currentUser) && !r.checkedOut && !r.archived;
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
  // Your group chats, offered in the New Nudge "To" box so you can send to a whole group
  const composeGroups = allGroups
    .filter(g => !g.participants.some(p => blockedNames.has(p)))
    .map(g => ({ key: g.key, label: groupLabel(g), members: g.participants, picture: groupAvatars[g.key] }));
  // Archived group chats are stored like archived contacts, under 'group:<key>'
  const groups = allGroups.filter(g => !hiddenContactNames.has('group:' + g.key));
  const chatLabel = (name: string) => {
    if (!name.startsWith('group:')) return name;
    const g = allGroups.find(x => 'group:' + x.key === name);
    return g ? groupLabel(g) : 'Group';
  };

  const allRemindersForUser = feedReminders.filter(r =>
    r.sender === currentUser || r.recipients.includes(currentUser)
  );

  const selectedGroupKey = selectedSender?.startsWith('group:') ? selectedSender.slice('group:'.length) : null;
  const selectedGroupMeta = selectedGroupKey ? allGroups.find(g => g.key === selectedGroupKey) : null;
  // Key used for your private description of the open chat (none for My Nudges)
  const selectedChatKey = !selectedSender || selectedSender === 'My Reminders'
    ? null
    : selectedGroupKey ? 'group:' + selectedGroupKey : 'contact:' + selectedSender;

  // The nudges in the open chat (both open and checked)
  const inSelectedChat = (r: Reminder) =>
    selectedSender === 'My Reminders' ? isSavedToSelf(r, currentUser)
      : selectedGroupKey ? groupKeyFor(r) === selectedGroupKey
      : !isGroupReminder(r) && (r.sender === selectedSender || realRecipients(r)[0] === selectedSender);
  const chatReminders = selectedSender ? allUserReminders.filter(inSelectedChat) : [];
  const chatCheckedCount = chatReminders.filter(isDone).length;
  const chatHasNewInChecked = chatReminders.some(r => hasNewMessages(r.id));

  const displayedReminders = (() => {
    if (selectedSender) {
      // A nudge you have open stays put until you close it, even if you just checked it
      return chatOrder(chatReminders.filter(r => r.id === expandedId || (showChecked ? isDone(r) : !isDone(r))));
    }
    const sort = sortSettings[allMessagesFilter];
    if (allMessagesFilter === 'unread') {
      return withPrioritiesFirst(sortReminders(homeReminders.filter(r => (!isDone(r) || r.id === expandedId)), sort), expandedId, false);
    }
    if (allMessagesFilter === 'favorited') {
      const favorites = allRemindersForUser.filter(r => r.favorited);
      return sortReminders(activeFolder ? favorites.filter(r => folderOfReminder[r.id] === activeFolder) : favorites, sort);
    }
    // Checked: everything you've checked off or archived
    return sortReminders(allRemindersForUser.filter(r => r.archived || (r.checkedOut && homeReminders.includes(r))), sort);
  })();

  // Chats open at the bottom, where the newest nudge is (and jump there when one arrives)
  const chatCount = selectedSender ? displayedReminders.length : 0;
  const lastChatView = useRef('');
  useLayoutEffect(() => {
    const view = `${selectedSender}|${showChecked}`;
    const el = scrollRef.current;
    if (!selectedSender || !el) { lastChatView.current = ''; return; }
    const isNewView = view !== lastChatView.current;
    lastChatView.current = view;
    if (isNewView || !expandedId) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSender, showChecked, chatCount]);


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

  // Swipe-left buttons on a nudge inside a chat: silence it, and (sender only) delete it
  const nudgeSwipeActions = (r: Reminder) => {
    const muted = mutes.has('nudge:' + r.id);
    return [
      {
        key: 'mute',
        label: muted ? 'Unmute' : 'Silence',
        icon: muted ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />,
        onClick: () => handleToggleMute('nudge:' + r.id, `"${r.title}"`),
        className: 'bg-indigo-500 text-white',
      },
      ...(r.sender === currentUser ? [{
        key: 'delete',
        label: 'Delete',
        icon: <Trash2 className="w-5 h-5" />,
        onClick: () => handleDeleteNudge(r.id),
        className: 'bg-red-500 text-white',
      }] : []),
    ];
  };

  // Swipe left on a favorite: take it out of your Favorites
  const favoriteSwipeActions = (r: Reminder) => [{
    key: 'unfavorite',
    label: 'Remove',
    icon: <StarOff className="w-5 h-5" />,
    onClick: () => handleRemoveFavorite(r.id),
    className: 'bg-red-500 text-white',
  }];

  const publicReminders = reminders.filter(r => r.isPublic && !blockedNames.has(r.sender));
  // In Popular and Explore, "checked" is your own Popular check — it never touches the
  // nudge anywhere else (your feed, the sender's view, or anyone else's Popular)
  const asPopular = (r: Reminder): Reminder => {
    const st = myStates.get(r.id);
    return { ...r, checkedOut: !!st?.popular_checked_at, checkedAt: st?.popular_checked_at ? new Date(st.popular_checked_at) : null, archived: false };
  };

  // Most Popular: the top 100 by likes; ties go to the newer nudge
  const topReminders = [...publicReminders].sort((a, b) => {
    if (a.isSponsored !== b.isSponsored) return a.isSponsored ? -1 : 1;
    if (b.voters.length !== a.voters.length) return b.voters.length - a.voters.length;
    return b.createdAt.getTime() - a.createdAt.getTime();
  }).slice(0, 100).map(asPopular);

  // Explore: 10 random Public nudges at a time, just for you. Once you've checked all 10,
  // "Show 10 more" drops the ones you didn't favorite and deals a fresh 10.
  const explorePool = publicReminders.filter(r => r.sender !== currentUser);
  const exploreBatch = explorePool
    .filter(r => { const st = myStates.get(r.id); return !!st?.explore_shown_at && !st.explore_done_at; })
    .sort((a, b) => (myStates.get(a.id)!.explore_shown_at! < myStates.get(b.id)!.explore_shown_at! ? -1 : 1))
    .map(asPopular);
  const exploreFresh = explorePool.filter(r => !myStates.get(r.id)?.explore_shown_at);
  const exploreAllChecked = exploreBatch.length > 0 && exploreBatch.every(r => r.checkedOut);
  const dealExplore = async (exclude: Set<string> = new Set()) => {
    if (!currentUser) return;
    const fresh = exploreFresh.filter(r => !exclude.has(r.id));
    for (let i = fresh.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
    }
    const pick = fresh.slice(0, 10);
    if (!pick.length) return;
    await setMyStates(pick.map(r => r.id), { explore_shown_at: new Date().toISOString() });
  };
  const handleExploreMore = async () => {
    const leaving = exploreBatch.filter(r => !r.favorited).map(r => r.id);
    if (leaving.length) await setMyStates(leaving, { explore_done_at: new Date().toISOString() });
    dealExplore(new Set(leaving));
  };
  // First visit (or an empty batch): deal the first 10
  const dealing = useRef(false);
  useEffect(() => {
    if (mobileTab !== 'popular' || popularSubTab !== 'explore' || !nudgeStates || dealing.current) return;
    if (exploreBatch.length === 0 && exploreFresh.length > 0) {
      dealing.current = true;
      dealExplore().finally(() => { dealing.current = false; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileTab, popularSubTab, nudgeStates, exploreBatch.length, exploreFresh.length]);

  // Explore: public nudges in random order, minus ones you sent or already liked.
  // Worked out when you shuffle (or new nudges arrive) — liking one doesn't make it
  // vanish mid-scroll; it drops out on the next shuffle.
  // iPhone notifications: once signed in, ask permission (first time) and register this phone.
  // Tapping a notification brings you to Home → Unread.
  useEffect(() => {
    if (!currentUser) return;
    registerPush(currentUser, (target) => setPendingOpen(target), () => scheduleRefresh());
  }, [currentUser, scheduleRefresh]);

  // iPhone pauses the app's live connection while it's in the background, so anything
  // that arrived meanwhile would be missed. Reload whenever the app comes back.
  useEffect(() => {
    if (!currentUser) return;
    const listener = CapacitorApp.addListener('appStateChange', ({ isActive }) => { if (isActive) scheduleRefresh(); });
    return () => { listener.then(l => l.remove()).catch(() => {}); };
  }, [currentUser, scheduleRefresh]);

  // Tapped a notification: reload, then open the nudge (and its messages) it was about
  const [pendingOpen, setPendingOpen] = useState<PushTarget | null>(null);
  const [openMessagesId, setOpenMessagesId] = useState<string | null>(null);
  const awaitingOpenLoad = useRef(false);
  useEffect(() => {
    if (!pendingOpen || !currentUser || dataLoading || awaitingOpenLoad.current) return;
    awaitingOpenLoad.current = true;
    loadData().finally(() => { awaitingOpenLoad.current = false; setOpenTarget(pendingOpen); setPendingOpen(null); });
  }, [pendingOpen, currentUser, dataLoading, loadData]);
  const [openTarget, setOpenTarget] = useState<PushTarget | null>(null);
  useEffect(() => {
    if (!openTarget || !currentUser) return;
    const target = openTarget;
    setOpenTarget(null);
    setProfileName(null);
    const r = feedReminders.find(x => x.id === target.nudgeId);
    if (!r || target.kind === 'request') {
      // A request (or something not visible yet): Home, where requests sit at the top
      setSelectedSender(null);
      setMobileTab('inbox');
      setAllMessagesFilter('unread');
      return;
    }
    const key = groupKeyFor(r);
    const chat = key ? 'group:' + key
      : realRecipients(r).length === 0 ? 'My Reminders'
      : r.sender === currentUser ? realRecipients(r)[0] : r.sender;
    selectSender(chat);
    setShowChecked(isDone(r));
    setExpandedId(r.id);
    setOpenMessagesId(target.kind === 'message' ? r.id : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTarget]);

  // Invite links open the app (iPhone "Universal Links"): read the name out of the link
  useEffect(() => {
    const handleUrl = (url: string) => {
      try {
        const link = new URL(url);
        const name = link.searchParams.get('u');
        if (link.pathname.replace(/\/$/, '').endsWith('/add') && name) setPendingInvite(name.trim().slice(0, 60));
      } catch {
        // not a link we understand
      }
    };
    const listener = CapacitorApp.addListener('appUrlOpen', ({ url }) => handleUrl(url));
    CapacitorApp.getLaunchUrl().then(launch => { if (launch?.url) handleUrl(launch.url); }).catch(() => {});
    return () => { listener.then(l => l.remove()).catch(() => {}); };
  }, []);

  useEffect(() => {
    if (!pendingInvite || !currentUser || dataLoading) return;
    const name = pendingInvite;
    setPendingInvite(null);
    if (name.toLowerCase() === currentUser.toLowerCase()) {
      toast("That's your own Addly link — send it to a friend!");
      return;
    }
    // Confirm the person exists (exact name), then open a new nudge addressed to them
    supabase.rpc('find_profile', { p_name: name }).then(({ data, error }) => {
      if (error || typeof data !== 'string') {
        toast(`Couldn't find anyone named ${name} on Addly`);
        return;
      }
      setSelectedSender(null);
      setQuickSendTo(data);
    });
  }, [pendingInvite, currentUser, dataLoading]);

  // Share your link through Messages (or any app): opens Nudge for friends who have it
  const handleShareLink = async () => {
    if (!currentUser) return;
    const url = `https://addlyapp.com/add?u=${encodeURIComponent(currentUser)}`;
    try {
      await Share.share({
        title: 'Send me a nudge',
        text: `Send me a nudge! My username on Addly is ${currentUser}.`,
        url,
        dialogTitle: 'Share your Addly link',
      });
    } catch (err) {
      // Closing the share sheet without picking anything also lands here — only fall back if sharing isn't available
      if (!String(err).toLowerCase().includes('cancel')) {
        try {
          await navigator.clipboard.writeText(url);
          toast('Link copied — paste it into a message');
        } catch {
          toast(url);
        }
      }
    }
  };

  // The iPhone Share menu: your send-key and the people you nudge, most recent first
  const shareContacts = (() => {
    const seen: string[] = [];
    [...allUserReminders].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).forEach(r => {
      [r.sender, ...r.recipients].forEach(p => {
        if (p && p !== currentUser && !blockedNames.has(p) && !seen.includes(p)) seen.push(p);
      });
    });
    return seen;
  })();
  const shareContactsKey = shareContacts.join('|');
  useEffect(() => {
    if (currentUser && !dataLoading) syncShareMenu(currentUser, shareContacts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, dataLoading, shareContactsKey]);

  // Keep the red number on the app icon equal to your unread count
  useEffect(() => {
    if (currentUser && !dataLoading) setBadge(homeBadge);
  }, [currentUser, dataLoading, homeBadge]);

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
  const renderHomeList = (list: Reminder[], emptyMessage?: string, opts: { openIds?: Set<string>; compact?: boolean } = {}) => (
            <ReminderList
              richCards
              openIds={opts.openIds}
              compact={opts.compact}
              reminders={list}
              viewType="received"
              currentUser={currentUser}
              messages={shownMessages}
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
              onToggleTodoComplete={handleToggleTodoComplete}
              onTodoEdit={handleTodoEdit}
              pendingSent={pendingSent}
              onWithdraw={handleDeleteNudge}
              checkedBy={nudgeStates ? checkedByNames : undefined}
              onTogglePriority={handleTogglePriority}
              // Favorites are personal: no check mark there, just when it was sent and checked
              hideCheck={allMessagesFilter === 'favorited'}
              swipeActionsFor={allMessagesFilter === 'favorited' ? favoriteSwipeActions : undefined}
              // Favorites can always be held and dragged (to file into a folder); rearranging
              // by dropping between cards only happens in Custom order
              reorderable={!opts.openIds && (sortSettings[allMessagesFilter].key === 'custom' || (allMessagesFilter === 'favorited' && foldersReady))}
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
                    ? 'Nothing checked yet. Nudges you check off will wait here.'
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

  // ---- Home queue ----
  // Everything waiting for you, in your chosen order (🤯 priorities first). Nudges you
  // tapped "Later" on go to the back, in the order you pushed them there.
  // Who a nudge is "from" on Home: the group it's in, or the person who sent it
  const queueKeyOf = (r: Reminder) => { const g = groupKeyFor(r); return g ? 'group:' + g : 'contact:' + r.sender; };
  const fullQueue = (() => {
    const base = withPrioritiesFirst(
      sortReminders(homeReminders.filter(r =>
        (!isDone(r) || r.id === expandedId)
        && !reopenedReminders.includes(r)
        // A to-do list leaves YOUR queue once you've tapped Complete (it stays for the others)
        && !(r.todoItems && r.completedBy.includes(currentUser) && r.id !== expandedId)
      ), sortSettings.unread),
      expandedId, false
    );
    const now = base.filter(r => !laterAt[r.id]);
    const later = base.filter(r => laterAt[r.id]).sort((a, b) => laterAt[a.id] - laterAt[b.id]);
    return [...now, ...later];
  })();
  const homeQueue = queuePerson ? fullQueue.filter(r => queueKeyOf(r) === queuePerson) : fullQueue;

  // The friends (and groups) with something in your queue, most first
  const queuePeople = (() => {
    const map = new Map<string, { key: string; label: string; avatar: string; pic?: string; count: number }>();
    [...fullQueue, ...reopenedReminders].forEach(r => {
      const key = queueKeyOf(r);
      const existing = map.get(key);
      if (existing) { existing.count++; return; }
      const g = groupKeyFor(r);
      const group = g ? allGroups.find(x => x.key === g) : null;
      const label = group ? groupLabel(group) : r.sender === currentUser ? 'You' : r.sender;
      map.set(key, { key, label, avatar: group ? label : r.sender, pic: g ? groupAvatars[g] : undefined, count: 1 });
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  })();
  const peopleRow = queuePeople.length > 1 || queuePerson ? (
    <div className="-mx-4 px-4 mb-3 flex gap-3.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {queuePeople.map(p => {
        const active = queuePerson === p.key;
        return (
          <button
            key={p.key}
            onClick={() => { setQueuePerson(active ? null : p.key); setExpandedId(null); }}
            className={`shrink-0 w-[58px] flex flex-col items-center transition-opacity ${queuePerson && !active ? 'opacity-45' : ''}`}
            aria-pressed={active}
            aria-label={`${p.label}: ${p.count} waiting${active ? ' (showing only these)' : ''}`}
          >
            <span className={`relative rounded-full p-[2px] ${active ? 'bg-brand-600' : 'bg-transparent'}`}>
              <span className="block rounded-full p-[1.5px] bg-[#FBF6EC]"><Avatar name={p.avatar} size={46} value={p.pic} /></span>
              <span className="absolute -top-0.5 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-notify text-white text-[11px] flex items-center justify-center border-2 border-[#FBF6EC]">
                {p.count}
              </span>
            </span>
            <span className="mt-1 text-[11px] text-stone-700 truncate w-full text-center">{p.label}</span>
          </button>
        );
      })}
    </div>
  ) : null;
  const queueLeft = fullQueue.filter(r => !isDone(r)).length + reopenedReminders.length;

  // Your checks by day (for "done today", the week dots, and your streak)
  const checkDays = new Set(
    Array.from(myStates.values()).map(st => st.checked_at && new Date(st.checked_at).toDateString()).filter(Boolean) as string[]
  );
  const doneToday = Array.from(myStates.values()).filter(st => st.checked_at && isToday(new Date(st.checked_at))).length;
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return checkDays.has(d.toDateString());
  });
  const streak = (() => {
    let count = 0;
    const d = new Date();
    if (!checkDays.has(d.toDateString())) d.setDate(d.getDate() - 1); // today isn't over yet
    while (checkDays.has(d.toDateString())) { count++; d.setDate(d.getDate() - 1); }
    return count;
  })();

  const handleQueueDone = (id: string) => {
    const r = reminders.find(x => x.id === id);
    if (r && !r.checkedOut) handleToggleCheckedOut(id);
    if (laterAt[id]) { const next = { ...laterAt }; delete next[id]; saveLater(next); }
    if (expandedId === id) setExpandedId(null);
  };
  const handleLater = (id: string) => {
    const before = laterAt;
    saveLater({ ...laterAt, [id]: Date.now() });
    if (expandedId === id) setExpandedId(null);
    toast('Moved to the back of the line', {
      duration: 3000,
      action: { label: 'Undo', onClick: () => saveLater(before) },
    });
  };
  // Nudge requests: a slim banner at the top of Home that opens to Accept / Decline
  const liveRequests = requests.filter(q => !blockedNames.has(q.sender));
  const requestsBanner = liveRequests.length > 0 ? (
    <>
      <button
        onClick={() => setShowRequests(v => !v)}
        className="w-full mb-3 flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-request-50 border border-request-300 text-left"
      >
        <span className="flex -space-x-2">
          {liveRequests.slice(0, 3).map(q => <span key={q.sender} className="rounded-full ring-2 ring-request-50"><Avatar name={q.sender} size={24} /></span>)}
        </span>
        <span className="flex-1 text-sm text-request-700">
          {liveRequests.length} nudge request{liveRequests.length === 1 ? '' : 's'}
        </span>
        <ChevronDown className={`w-4 h-4 text-request-700 transition-transform ${showRequests ? 'rotate-180' : ''}`} />
      </button>
            {showRequests && (
              <div className="mb-3 space-y-2">
                {requests.filter(q => !blockedNames.has(q.sender)).map(q => (
                  <div key={q.sender} className="rounded-2xl border-2 border-request-300 bg-request-50 p-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={q.sender} size={44} profile />
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-medium text-stone-900 truncate">
                          <ProfileLink name={q.sender}>{q.sender}</ProfileLink> wants to send you nudges
                        </p>
                        <p className="text-xs text-request-700">
                          {q.waiting} nudge{q.waiting === 1 ? '' : 's'} waiting · accept to see {q.waiting === 1 ? 'it' : 'them'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => handleAcceptRequest(q.sender)} className="flex-1 h-10 rounded-xl bg-brand-600 text-white text-sm active:bg-brand-700">
                        Accept
                      </button>
                      <button onClick={() => handleDeclineRequest(q.sender)} className="flex-1 h-10 rounded-xl border border-request-300 bg-white text-stone-700 text-sm active:bg-request-100">
                        Decline
                      </button>
                    </div>
                    <button
                      onClick={() => { if (confirm(`Block ${q.sender}? You won't get nudges, messages, or notifications from them. They won't be told.`)) handleBlock(q.sender); }}
                      className="mt-2 w-full text-center text-xs text-stone-500"
                    >
                      Block {q.sender}
                    </button>
                  </div>
                ))}
              </div>
            )}
    </>
  ) : null;

  // Unread: "New from" bubbles, then Priority / Today / Earlier sections
  const renderUnreadHome = () => {
    // Checked nudges with new messages get their own section at the very top
    // (still counts as new while you have it open, so it doesn't jump away mid-read)
    const reopened = sortReminders(reopenedReminders, sortSettings.unread);
    const list = displayedReminders.filter(r => !reopened.includes(r));
    if (list.length === 0 && reopened.length === 0) {
      return (
        <div className="text-center pt-16 pb-8 px-6">
          <div className="text-5xl mb-3" aria-hidden="true">🎉</div>
          <p className="text-lg text-stone-800">You're all caught up</p>
          <p className="text-sm text-stone-500 mt-1">New nudges from friends will show up here.</p>
          <button
            onClick={() => setMobileTab('popular')}
            className="mt-5 px-5 py-2.5 rounded-full bg-brand-600 text-white text-sm active:bg-brand-700"
          >
            Explore Popular
          </button>
        </div>
      );
    }

    // Whose nudges are waiting, newest first — tap a bubble to open that chat
    const newFrom: { key: string; label: string; avatarName: string; open: string }[] = [];
    [...inboxReminders]
      .filter(r => isNewToMe(r) && r.sender !== currentUser)
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
    // "Up next": the first regular nudge waiting for you sits already open at the top.
    // Check it off and the next one moves up. (To-do lists stay in the list below.)
    const ordered = [...list.filter(r => r.prioritizedAt && stillOpen(r)), ...list.filter(r => !(r.prioritizedAt && stillOpen(r)))];
    const upNext = ordered.find(r => !r.todoItems && !r.checkedOut && r.recipients.includes(currentUser));
    const remaining = upNext ? list.filter(r => r !== upNext) : list;
    const priority = remaining.filter(r => r.prioritizedAt && stillOpen(r));
    const rest = remaining.filter(r => !priority.includes(r));
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
                  <div className="rounded-full p-[2.5px] bg-notify">
                    <div className="rounded-full p-[2px] bg-[#FBF6EC]">
                      <Avatar name={n.avatarName} size={50} />
                    </div>
                  </div>
                  <span className="mt-1 text-[11px] text-stone-700 truncate w-full text-center">{n.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {reopened.length > 0 && <>{sectionTitle('New messages')}{renderHomeList(reopened)}</>}
        {upNext && (
          <>
            <p className="text-xs font-medium text-brand-700 mt-4 mb-1.5">Up next:</p>
            {renderHomeList([upNext], undefined, { openIds: new Set([upNext.id]) })}
            {remaining.length > 0 && <div className="mt-5 border-t border-stone-300/50" aria-hidden="true" />}
          </>
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
        <ImageWithFallback src={nudgeLogo} alt="Addly" className="h-20 w-auto object-contain" />
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
        <ImageWithFallback src={nudgeLogo} alt="Addly" className="h-20 w-auto object-contain" />
        <p className="text-stone-400 text-sm">Loading your nudges…</p>
      </div>
    );
  }

  return (
    <AvatarContext.Provider value={avatars}>
    <ProfileContext.Provider value={setProfileName}>
    <div
      className="flex flex-col overflow-hidden"
      style={{ height: '100%', width: '100%', background: '#FBF6EC', paddingTop: 'env(safe-area-inset-top)' }}
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
          <div className="mb-3 p-3 sm:p-4 bg-brand-600 text-white rounded-xl shadow-lg flex items-center justify-between">
            <div>
              <p className="font-medium text-sm sm:text-base">Install Addly</p>
              <p className="text-xs sm:text-sm text-brand-100">Add to your home screen for quick access</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowInstallPrompt(false)}
                className="px-2 sm:px-3 py-1 bg-brand-700 rounded-lg hover:bg-brand-800 text-xs sm:text-sm"
              >
                Later
              </button>
              <button
                onClick={handleInstallClick}
                className="px-2 sm:px-3 py-1 bg-white text-brand-600 rounded-lg hover:bg-brand-50 text-xs sm:text-sm"
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
                  className="flex-1 min-w-0 text-lg border-b-2 border-brand-500 focus:outline-none bg-transparent"
                />
                <button type="submit" className="text-brand-600 text-sm shrink-0">Save</button>
              </form>
            ) : (
              <>
                {/* Back arrow (a big target); in a 1-on-1 chat, the picture and name open their profile */}
                <button
                  onClick={() => selectSender(null)}
                  className="-ml-2 p-1.5 rounded-lg hover:bg-stone-100 active:bg-stone-200 transition-colors shrink-0"
                  title="Back"
                  aria-label="Back"
                >
                  <ChevronLeft className="w-6 h-6 text-stone-700" />
                </button>
                {!selectedGroupKey && selectedSender !== 'My Reminders' ? (
                  <ProfileLink name={selectedSender} className="-ml-1 py-1 pr-1 flex items-center gap-1.5 min-w-0 max-w-[55%] shrink-0 rounded-lg active:bg-stone-200">
                    <Avatar name={selectedSender} size={28} />
                    <h1 className="text-lg truncate">{selectedSender}</h1>
                  </ProfileLink>
                ) : (
                  <>
                  {/* The group's picture: tap it to see who's in the group (and change it) */}
                  {selectedGroupKey && (
                    <button onClick={() => setShowGroupInfo(true)} className="-ml-1 shrink-0" aria-label="Group info">
                      {groupAvatars[selectedGroupKey]
                        ? <Avatar name={selectedGroupMeta?.groupName || 'Group'} size={28} value={groupAvatars[selectedGroupKey]} />
                        : <span className="w-7 h-7 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Users className="w-4 h-4" /></span>}
                    </button>
                  )}
                  <button onClick={() => selectSender(null)} className="-ml-1 py-1 min-w-0 max-w-[60%] shrink-0 text-left">
                    <h1 className="text-lg truncate">
                      {selectedGroupKey
                        ? (selectedGroupMeta?.groupName || selectedGroupMeta?.participants.join(', ') || 'Group')
                        : 'My Nudges'}
                    </h1>
                  </button>
                  </>
                )}
                {selectedGroupKey && (
                  <button
                    onClick={() => setShowGroupInfo(true)}
                    className="p-1.5 -ml-1 text-brand-600 hover:text-brand-700 shrink-0"
                    title="Who's in this group"
                    aria-label="Group info: who's in this group"
                  >
                    <Info className="w-[18px] h-[18px]" />
                  </button>
                )}
                {selectedGroupKey && (
                  <button
                    onClick={() => {
                      setGroupNameDraft(selectedGroupMeta?.groupName || '');
                      setEditingGroupName(true);
                    }}
                    className="p-1.5 -ml-1.5 text-stone-400 hover:text-stone-600 shrink-0"
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
                      className="flex-1 min-w-0 text-sm border-b border-brand-400 focus:outline-none bg-transparent"
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
              // Home: just today's date
              <div className="pt-1 w-full">
                <h1 className="tab-title text-[30px] leading-tight text-stone-900">
                  {new Date().toLocaleDateString(undefined, { weekday: 'long' })}
                </h1>
                <p className="text-[15px] font-medium text-stone-500">
                  {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
                </p>
              </div>
            ) : mobileTab === 'people' && savedView ? (
              <div className="pt-1 flex items-center gap-1 -ml-2">
                <button onClick={() => { setSavedView(null); setAllMessagesFilter('unread'); setExpandedId(null); }} className="p-1.5 rounded-lg active:bg-stone-200" aria-label="Back to Nudges">
                  <ChevronLeft className="w-6 h-6 text-stone-700" />
                </button>
                <h1 className="tab-title text-[30px] leading-tight text-stone-800">{savedView === 'favorited' ? 'Favorites' : 'Checked'}</h1>
              </div>
            ) : (
              <h1 className="tab-title pt-1 text-[30px] leading-tight text-stone-800">
                {mobileTab === 'people' ? 'Nudges' : mobileTab === 'popular' ? 'Popular' : 'You'}
              </h1>
            )
          )}
        </div>

      </div>

      {/* Scrollable content — only this area scrolls */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
        // Tapping anywhere outside an open nudge closes it (a checked nudge then leaves Unread)
        onClick={(e) => {
          if (expandedId && !(e.target as HTMLElement).closest('[data-nudge-card], button, a, input, textarea')) setExpandedId(null);
        }}
      >
        {/* Pull-to-refresh spinner: grows as you drag down from the top */}
        <div ref={pullRef} className="h-0 overflow-hidden flex items-end justify-center" aria-hidden="true">
          <div ref={pullIconRef} className="mb-3 w-8 h-8 rounded-full bg-white shadow flex items-center justify-center text-brand-600" style={{ opacity: 0 }}>
            <RefreshCw className="w-4 h-4" />
          </div>
        </div>
        {/* In a chat, a short thread sits at the bottom by the buttons, like Messages */}
        <div className={`max-w-2xl mx-auto px-4 pb-4 w-full ${selectedSender ? 'min-h-full flex flex-col justify-end' : ''}`}>
          {selectedSender ? (
            <>
            {showChecked && (
              <p className="text-xs text-stone-500 text-center mb-2">Checked nudges</p>
            )}
            <ReminderList
              chatLayout={selectedSender !== 'My Reminders'}
              swipeActionsFor={nudgeSwipeActions}
              mutedIds={mutes}
              newMessageIds={new Set(reopenedReminders.map(r => r.id))}
              emptyMessage={showChecked ? 'Nothing checked in this chat yet.' : 'All caught up here. Checked nudges are under Checked below.'}
              reminders={displayedReminders}
              viewType="received"
              currentUser={currentUser}
              messages={shownMessages}
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
              onToggleTodoComplete={handleToggleTodoComplete}
              onTodoEdit={handleTodoEdit}
              pendingSent={pendingSent}
              onWithdraw={handleDeleteNudge}
              openMessagesId={openMessagesId}
              checkedBy={nudgeStates ? checkedByNames : undefined}
              onTogglePriority={handleTogglePriority}
            />
            {/* "Alison renamed the group" — shown for a day after a rename */}
            {selectedGroupKey && (() => {
              const latest = chatReminders
                .filter(r => r.groupRenamedAt && r.groupRenamedBy)
                .sort((a, b) => b.groupRenamedAt!.getTime() - a.groupRenamedAt!.getTime())[0];
              if (!latest || Date.now() - latest.groupRenamedAt!.getTime() > 24 * 3600e3) return null;
              const who = latest.groupRenamedBy === currentUser ? 'You' : latest.groupRenamedBy;
              const time = latest.groupRenamedAt!.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
              const when = isToday(latest.groupRenamedAt!) ? time : `Yesterday ${time}`;
              return (
                <p className="mt-3 text-center text-[12px] text-stone-500">
                  {who} {latest.groupName ? <>named the group <span className="text-stone-700">“{latest.groupName}”</span></> : 'removed the group name'} · {when}
                </p>
              );
            })()}
            </>
          ) : mobileTab === 'inbox' ? (
            <HomeQueue
              currentUser={currentUser}
              queue={homeQueue}
              withNewMessages={queuePerson ? reopenedReminders.filter(r => queueKeyOf(r) === queuePerson) : reopenedReminders}
              messageCount={(id) => shownMessages.filter(m => m.reminderId === id).length}
              hasNewMessage={hasNewMessages}
              expandedId={expandedId}
              onExpand={setExpandedId}
              renderFull={(r, compact) => renderHomeList([r], undefined, { openIds: new Set([r.id]), compact })}
              onDone={handleQueueDone}
              onLater={handleLater}
              requestsBanner={requestsBanner}
              peopleRow={peopleRow}
              sortControl={<SortMenu value={sortSettings.unread} onChange={(st) => changeSort('unread', st)} />}
              doneToday={doneToday}
              week={week}
              streak={streak}
              onExplore={() => { setMobileTab('popular'); setPopularSubTab('explore'); }}
            />
          ) : mobileTab === 'people' && savedView ? (
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
              <SortMenu value={sortSettings[allMessagesFilter]} onChange={(st) => changeSort(allMessagesFilter, st)} />
            </div>
            {renderHomeList(displayedReminders)}
            </>
          ) : mobileTab === 'popular' ? (
            <div>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setPopularSubTab('top')}
                  className={`flex-1 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    popularSubTab === 'top'
                      ? 'bg-brand-600 text-white'
                      : 'bg-white border border-stone-300 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  Top 100
                </button>
                <button
                  onClick={() => setPopularSubTab('explore')}
                  className={`flex-1 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    popularSubTab === 'explore'
                      ? 'bg-brand-600 text-white'
                      : 'bg-white border border-stone-300 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  Explore
                </button>
              </div>

              {popularSubTab === 'explore' && nudgeStates ? (
                <HomeQueue
                  mode="explore"
                  currentUser={currentUser}
                  queue={exploreBatch}
                  withNewMessages={[]}
                  heroId={exploreHeroId}
                  onSelect={(id) => { setExploreHeroId(id); setExpandedId(null); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  messageCount={(id) => shownMessages.filter(m => m.reminderId === id).length}
                  hasNewMessage={() => false}
                  expandedId={expandedId}
                  onExpand={setExpandedId}
                  renderFull={(r) => (
                    <ReminderList
                      richCards
                      compact
                      openIds={new Set([r.id])}
                      anyoneCanCheck
                      reminders={[r]}
                      viewType="received"
                      currentUser={currentUser}
                      messages={shownMessages}
                      selectedId={expandedId}
                      onSelectId={() => {}}
                      onToggleCheckedOut={handleTogglePopularCheck}
                      onArchive={handleArchive}
                      onAddMessage={handleAddMessage}
                      onToggleFavorite={handleToggleFavorite}
                      onUpdateTitle={handleUpdateTitle}
                      onForward={setForwardingReminder}
                      onToggleReaction={handleToggleReaction}
                      onUpvote={handleToggleVote}
                    />
                  )}
                  // Checking from the big card moves you to the next unchecked one; the list never reorders
                  onDone={(id) => {
                    const r = exploreBatch.find(x => x.id === id);
                    handleTogglePopularCheck(id);
                    if (r && !r.checkedOut) {
                      const i = exploreBatch.indexOf(r);
                      const next = [...exploreBatch.slice(i + 1), ...exploreBatch.slice(0, i)].find(x => !x.checkedOut);
                      if (next && (exploreHeroId === id || !exploreHeroId || exploreBatch.find(x => x.id === exploreHeroId)?.id === id)) setExploreHeroId(next.id);
                    }
                  }}
                  onLater={() => {}}
                  requestsBanner={null}
                  sortControl={null}
                  doneToday={0}
                  week={[]}
                  streak={0}
                  onExplore={() => {}}
                  footer={
                    exploreBatch.length === 0 && exploreFresh.length === 0 ? (
                      <div className="text-center pt-14 px-6">
                        <div className="text-5xl mb-3" aria-hidden="true">🌟</div>
                        <p className="text-lg text-stone-800">You've seen it all!</p>
                        <p className="text-sm text-stone-500 mt-1">Come back later to see more cool stuff.</p>
                      </div>
                    ) : exploreBatch.length === 0 ? (
                      <p className="text-center text-sm text-stone-500 pt-10">Dealing your first 10…</p>
                    ) : exploreAllChecked ? (
                      exploreFresh.length > 0 ? (
                        <button onClick={() => { setExploreHeroId(null); handleExploreMore(); }} className="mt-5 w-full h-12 rounded-2xl bg-brand-600 text-white active:bg-brand-700">
                          Show me 10 more
                        </button>
                      ) : (
                        <p className="mt-6 text-center text-sm text-stone-500">You've seen it all! Come back later to see more cool stuff.</p>
                      )
                    ) : (
                      <p className="mt-4 text-center text-xs text-stone-500">Check all {exploreBatch.length} to get 10 more. Anything you favorite stays.</p>
                    )
                  }
                />
              ) : (
              <>
              <ReminderList
                reminders={popularSubTab === 'top' ? topReminders : nudgeStates ? exploreBatch : exploreReminders.map(asPopular)}
                anyoneCanCheck
                viewType="received"
                currentUser={currentUser}
                messages={shownMessages}
                selectedId={expandedId}
                onSelectId={setExpandedId}
                onToggleCheckedOut={handleTogglePopularCheck}
                onArchive={handleArchive}
                onAddMessage={handleAddMessage}
                onToggleFavorite={handleToggleFavorite}
                onUpdateTitle={handleUpdateTitle}
                onForward={setForwardingReminder}
                onToggleReaction={handleToggleReaction}
                onToggleTodo={handleToggleTodo}
                onTodoEdit={handleTodoEdit}
                onUpvote={handleToggleVote}
                emptyMessage={
                  popularSubTab === 'top'
                    ? "No public nudges yet. Mark a nudge \"public\" when sending one to see it show up here."
                    : 'Dealing your first 10…'
                }
              />
              </>
              )}
            </div>
          ) : mobileTab === 'people' ? (
            <div className="divide-y divide-stone-100">
              {/* Favorites and Checked (they used to be filters on Home) */}
              <div className="grid grid-cols-2 gap-2 pb-3">
                {([
                  { view: 'favorited' as const, label: 'Favorites', icon: <Star className="w-[18px] h-[18px] text-gold-500" />, count: allRemindersForUser.filter(r => r.favorited).length },
                  { view: 'archived' as const, label: 'Checked', icon: <CheckCheck className="w-[18px] h-[18px] text-brand-600" />, count: allRemindersForUser.filter(r => r.archived || (r.checkedOut && homeReminders.includes(r))).length },
                ]).map(v => (
                  <button
                    key={v.view}
                    onClick={() => { setSavedView(v.view); setAllMessagesFilter(v.view); setExpandedId(null); setActiveFolder(null); }}
                    className="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl bg-white border border-stone-200 text-left active:bg-stone-50"
                  >
                    {v.icon}
                    <span className="flex-1 text-[15px] text-stone-800">{v.label}</span>
                    <span className="text-sm text-stone-400">{v.count}</span>
                  </button>
                ))}
              </div>
              {/* My Nudges */}
              {myOwnReminders.length > 0 && (
                <button
                  onClick={() => selectSender('My Reminders')}
                  className="w-full px-3 py-3 flex items-center gap-3 hover:bg-stone-50 active:bg-stone-100 transition-colors rounded-xl"
                >
                  <Avatar name={currentUser} size={48} />
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-lg">My Nudges</p>
                    <p className="text-[15px] text-stone-500">{myOwnReminders.length} nudge{myOwnReminders.length === 1 ? '' : 's'}</p>
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
                    return match && r.recipients.includes(currentUser) && !isDone(r);
                  })
                  .length;


                return (
                  <SwipeRow key={contact} actions={chatSwipeActions('contact:' + contact, contact, contact)}>
                    <div className="flex items-center gap-1 rounded-xl" style={{ background: '#FBF6EC' }}>
                      <button
                        onClick={() => selectSender(contact)}
                        className="flex-1 min-w-0 px-3 py-3 flex items-center gap-3 active:bg-stone-100 transition-colors rounded-xl text-left"
                      >
                        <div className="relative shrink-0">
                          <Avatar name={contact} size={48} profile />
                          {unreadCount > 0 && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-notify text-white text-[10px] flex items-center justify-center border-2 border-white">
                              {unreadCount}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-lg truncate flex items-center gap-1.5">
                            <span className="truncate">{contact}</span>
                            {mutes.has('contact:' + contact) && <BellOff className="w-4 h-4 text-stone-400 shrink-0" aria-label="Silenced" />}
                          </p>
                          <p className="text-[15px] text-stone-500 truncate">
                            {chatNotes['contact:' + contact] && <span className="italic">{chatNotes['contact:' + contact]} · </span>}
                            {count} nudge{count === 1 ? '' : 's'}
                          </p>
                        </div>
                      </button>
                      {/* Silence and Archive live behind a swipe left */}
                      <button
                        onClick={() => setQuickSendTo(contact)}
                        className="p-2.5 mr-1 rounded-lg text-brand-600 hover:bg-brand-50 active:bg-brand-100 shrink-0"
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
                  <div className="flex items-center gap-1 rounded-xl" style={{ background: '#FBF6EC' }}>
                  <button
                    onClick={() => selectSender('group:' + group.key)}
                    className="flex-1 min-w-0 px-3 py-3 flex items-center gap-3 active:bg-stone-100 transition-colors rounded-xl text-left"
                  >
                    <div className="relative shrink-0 w-11 h-11">
                      {groupAvatars[group.key] ? (
                        <Avatar name={displayName} size={44} value={groupAvatars[group.key]} />
                      ) : initials.map((letter, i) => (
                        <div
                          key={i}
                          className="absolute w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center text-white text-[10px] border-2 border-white"
                          style={{ left: i * 10, top: i === 1 ? 10 : 0, zIndex: 3 - i }}
                        >
                          {letter}
                        </div>
                      ))}
                      {!groupAvatars[group.key] && group.participants.length > 3 && (
                        <div className="absolute w-7 h-7 rounded-full bg-stone-300 flex items-center justify-center text-white text-[10px] border-2 border-white" style={{ left: 30, top: 10, zIndex: 0 }}>
                          +{group.participants.length - 2}
                        </div>
                      )}
                      {group.unread > 0 && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-notify text-white text-[10px] flex items-center justify-center border-2 border-white z-10">
                          {group.unread}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-lg truncate flex items-center gap-1.5">
                        <span className="truncate">{displayName}</span>
                        {mutes.has('group:' + group.key) && <BellOff className="w-4 h-4 text-stone-400 shrink-0" aria-label="Silenced" />}
                      </p>
                      <p className="text-[15px] text-stone-500 truncate">
                        {chatNotes['group:' + group.key] && <span className="italic">{chatNotes['group:' + group.key]} · </span>}
                        {group.count} nudge{group.count === 1 ? '' : 's'} &middot; {group.participants.length + 1} people
                      </p>
                    </div>
                  </button>
                  {/* Send the whole group a nudge */}
                  <button
                    onClick={() => setQuickSendGroup(group.participants)}
                    className="p-2.5 mr-1 rounded-lg text-brand-600 hover:bg-brand-50 active:bg-brand-100 shrink-0"
                    title={`Send to ${displayName}`}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                  </div>
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
                    <span className="text-[15px]">Archived chats ({archivedContactNames.length})</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${showArchivedContacts ? 'rotate-180' : ''}`} />
                  </button>
                  {showArchivedContacts && archivedContactNames.map(name => (
                    <div key={name} className="px-3 py-2.5 flex items-center justify-between gap-3">
                      <span className="text-sm text-stone-600 truncate flex-1 min-w-0">{chatLabel(name)}</span>
                      <button
                        onClick={() => handleRestoreContact(name)}
                        className="text-xs text-brand-600 hover:text-brand-700 underline shrink-0"
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
                  <button onClick={() => setShowAvatarPicker(true)} className="text-sm text-brand-600">
                    Change picture
                  </button>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-stone-200 p-5">
                <p className="text-base">Invite friends</p>
                <p className="text-sm text-stone-500 mt-1">
                  Send your Addly link in Messages. Friends with Addly tap it to open a new nudge already addressed to you.
                </p>
                <button
                  onClick={handleShareLink}
                  className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-600 text-white active:bg-brand-700"
                >
                  <Share2 className="w-4 h-4" />
                  Share my Addly link
                </button>
              </div>
              {blockedNames.size > 0 && (
                <div className="bg-white rounded-xl border border-stone-200 p-5">
                  <p className="text-base">Blocked</p>
                  <p className="text-sm text-stone-500 mt-1">You don't get nudges, messages, or notifications from these people.</p>
                  <div className="mt-2 divide-y divide-stone-100">
                    {Array.from(blockedNames).sort().map(name => (
                      <div key={name} className="py-2.5 flex items-center gap-3">
                        <Avatar name={name} size={32} />
                        <span className="flex-1 min-w-0 truncate">{name}</span>
                        <button onClick={() => handleUnblock(name)} className="text-sm text-brand-600">Unblock</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {isAdmin && (
                <button
                  onClick={() => setShowInsights(true)}
                  className="w-full bg-white rounded-xl border border-stone-200 p-4 flex items-center gap-3 text-left active:bg-stone-50"
                >
                  <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                    <BarChart3 className="w-5 h-5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-base">Insights</span>
                    <span className="block text-sm text-stone-500">App-wide numbers. Only you can see this.</span>
                  </span>
                  <ChevronRight className="w-5 h-5 text-stone-400 shrink-0" />
                </button>
              )}
              <button
                onClick={() => setShowChangePassword(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 transition-colors"
              >
                <KeyRound className="w-4 h-4" />
                Change password
              </button>
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

      {/* Chat buttons, like a message bar: send a new nudge here, or flip to the Checked ones */}
      {selectedSender && (
        <div className="shrink-0 border-t border-stone-200 px-4 py-2.5" style={{ background: '#FBF6EC' }}>
          <div className="max-w-2xl mx-auto flex gap-2">
            {selectedSender !== 'My Reminders' && (
              <button
                onClick={() => selectedGroupMeta ? setQuickSendGroup(selectedGroupMeta.participants) : setQuickSendTo(selectedSender)}
                className="flex-1 min-w-0 h-11 flex items-center justify-center gap-2 px-3 rounded-xl bg-brand-600 text-white active:bg-brand-700 transition-colors"
              >
                <Send className="w-4 h-4 shrink-0" />
                <span className="text-sm truncate">Send to {selectedGroupMeta ? (selectedGroupMeta.groupName || 'group') : selectedSender}</span>
              </button>
            )}
            <button
              onClick={() => { setShowChecked(v => !v); setExpandedId(null); }}
              aria-pressed={showChecked}
              className={`relative flex-1 min-w-0 h-11 flex items-center justify-center gap-2 px-3 rounded-xl border transition-colors ${
                showChecked
                  ? 'bg-brand-100 border-brand-300 text-brand-800'
                  : 'bg-white border-stone-300 text-stone-700 active:bg-stone-100'
              }`}
            >
              <CheckCheck className="w-4 h-4 shrink-0" />
              <span className="text-sm">Checked{chatCheckedCount > 0 ? ` (${chatCheckedCount})` : ''}</span>
              {chatHasNewInChecked && !showChecked && (
                <span className="absolute top-1.5 right-2 w-2.5 h-2.5 rounded-full bg-notify" aria-label="New messages" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Bottom Tab Bar — a normal flex child now, not fixed, so the scroll area above sizes correctly */}
      <div
        className="shrink-0 bg-white border-t border-stone-200 flex z-20"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
      {([
        { id: 'inbox' as const, label: 'Home', icon: InboxIcon, badge: homeBadge },
        { id: 'people' as const, label: 'Nudges', icon: Users, badge: 0 },
      ]).map(tab => (
        <button
          key={tab.id}
          onClick={() => { selectSender(null); setMobileTab(tab.id); setSavedView(null); setAllMessagesFilter('unread'); }}
          className={`flex-1 flex flex-col items-center gap-1 py-2.5 relative transition-colors ${
            !selectedSender && mobileTab === tab.id ? 'text-brand-600' : 'text-stone-400'
          }`}
        >
          <tab.icon className="w-5 h-5" />
          <span className="text-[11px]">{tab.label}</span>
          {tab.badge > 0 && (
            <span className="absolute top-1 right-[calc(50%-22px)] min-w-[16px] h-[16px] rounded-full bg-notify text-white text-[9px] flex items-center justify-center px-1">
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
        <span className="w-11 h-11 rounded-full bg-brand-600 flex items-center justify-center -mt-4 shadow-lg shadow-brand-600/30 active:bg-brand-700 transition-colors">
          <img src={nIconTonal} alt="" className="w-6 h-6 object-contain" />
        </span>
      </button>

      <button
        onClick={() => { selectSender(null); setMobileTab('popular'); }}
        className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors ${
          !selectedSender && mobileTab === 'popular' ? 'text-brand-600' : 'text-stone-400'
        }`}
      >
        <TrendingUp className="w-5 h-5" />
        <span className="text-[11px]">Popular</span>
      </button>

      <button
        onClick={() => { selectSender(null); setMobileTab('you'); }}
        className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors ${
          !selectedSender && mobileTab === 'you' ? 'text-brand-600' : 'text-stone-400'
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
          knownRecipients={contacts}
          knownGroups={composeGroups}
          currentUser={currentUser}
          onSubmit={handleAddReminder}
          onClose={() => setQuickSendTo(null)}
        />
      )}
      {showInsights && <Insights onClose={() => setShowInsights(false)} />}
      {showChangePassword && <ChangePassword onClose={() => setShowChangePassword(false)} />}
      {groupPictureFor && (() => {
        const g = allGroups.find(x => x.key === groupPictureFor);
        return (
          <AvatarPicker
            title="Group picture"
            name={g ? groupLabel(g) : 'Group'}
            uploadOwner={currentUser}
            current={groupAvatars[groupPictureFor] ?? null}
            onSave={(value) => handleSaveGroupAvatar(groupPictureFor, value)}
            onClose={() => setGroupPictureFor(null)}
          />
        );
      })()}
      {showGroupInfo && selectedGroupKey && (
        <GroupInfoSheet
          title={selectedGroupMeta?.groupName || selectedGroupMeta?.participants.join(', ') || 'Group'}
          members={selectedGroupMeta?.participants ?? []}
          currentUser={currentUser}
          onOpenProfile={setProfileName}
          onRename={() => { setGroupNameDraft(selectedGroupMeta?.groupName || ''); setEditingGroupName(true); }}
          onClose={() => setShowGroupInfo(false)}
          picture={groupAvatars[selectedGroupKey] ?? null}
          onChangePicture={() => setGroupPictureFor(selectedGroupKey)}
        />
      )}
      {profileName && (
        <ProfileSheet
          name={profileName}
          isYou={profileName === currentUser}
          onSendNudge={() => { setQuickSendTo(profileName); setProfileName(null); }}
          onClose={() => setProfileName(null)}
          blocked={blockedNames.has(profileName)}
          onBlock={() => handleBlock(profileName)}
          onUnblock={() => handleUnblock(profileName)}
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
          knownRecipients={contacts}
          knownGroups={composeGroups}
          currentUser={currentUser}
          onSubmit={handleAddReminder}
          onClose={() => setQuickSendGroup(null)}
        />
      )}
      {/* New Reminder Modal */}
      {showNewReminderModal && (
        <QuickSendModal
          recipient=""
          knownRecipients={contacts}
          knownGroups={composeGroups}
          currentUser={currentUser}
          onSubmit={handleAddReminder}
          onClose={() => setShowNewReminderModal(false)}
        />
      )}
      {/* Forward Modal — a fresh nudge from you, prefilled from the original */}
      {forwardingReminder && (
        <QuickSendModal
          recipient=""
          knownRecipients={contacts}
          knownGroups={composeGroups}
          currentUser={currentUser}
          onSubmit={handleAddReminder}
          onClose={() => setForwardingReminder(null)}
          initialValues={{
            type: forwardingReminder.type,
            title: forwardingReminder.title,
            content: forwardingReminder.content,
            url: forwardingReminder.url || '',
            previewImage: forwardingReminder.previewImage,
            attachments: forwardingReminder.attachments
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
    </ProfileContext.Provider>
    </AvatarContext.Provider>
  );
}
