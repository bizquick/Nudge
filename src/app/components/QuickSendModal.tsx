import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Globe, Music, Video, Type as TypeIcon, Sparkles, UtensilsCrossed, Lightbulb, Send, X, Paperclip, Loader2, Link2, Bookmark, ListChecks, Plus, FileText, Users } from 'lucide-react';
import type { ReminderType, NewNudge, Attachment } from '../App';
import { supabase } from '../utils/supabase/client';
import { guessCategory } from '../utils/guessCategory';
import { Avatar } from './Avatar';
import nudgeLogo from '../../imports/image-3.png';

// lucide-react doesn't have a literal money-bag glyph, so this renders the
// emoji instead, sized/centered to sit alongside the other category icons.
function MoneyBagIcon({ className }: { className?: string }) {
  return (
    <span className={`${className ?? ''} inline-flex items-center justify-center leading-none`} style={{ fontSize: '1.05em' }}>
      💰
    </span>
  );
}

interface QuickSendModalProps {
  recipient: string;
  knownRecipients: string[];
  /** Your existing group chats, so a nudge can go to a whole group at once */
  knownGroups?: { key: string; label: string; members: string[]; picture?: string }[];
  currentUser: string;
  onClose: () => void;
  onSubmit: (reminder: NewNudge) => void;
  /** Pre-fill the "To" line (e.g. "Nudge group" from inside a group chat) */
  initialRecipients?: string[];
  initialValues?: {
    type: ReminderType | null;
    title: string;
    content: string;
    url: string;
    previewImage?: string;
    attachments?: Attachment[];
  };
}

const MAX_ATTACHMENTS = 10;

// People type links the short way ("nytimes.com"). Add the https:// for them
// so the link opens and the title/preview lookup works.
// Pasted photos arrive full-size (often as huge PNGs). Shrink to at most 2400px
// on the long side and save as a JPEG so they upload quickly and fit the 15MB limit.
async function toUploadableImage(blob: Blob): Promise<File> {
  const bitmapUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = bitmapUrl;
    });
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!jpeg) throw new Error('could not encode');
    return new File([jpeg], `Pasted photo ${new Date().toLocaleDateString().replace(/\//g, '-')}.jpg`, { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`;
}

export function QuickSendModal({ recipient, knownRecipients, knownGroups = [], currentUser, onClose, onSubmit, initialValues, initialRecipients }: QuickSendModalProps) {
  const [type, setType] = useState<ReminderType | null>(initialValues?.type ?? null);
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [content, setContent] = useState(initialValues?.content ?? '');
  const [url, setUrl] = useState(initialValues?.url ?? '');
  const [previewImage, setPreviewImage] = useState(initialValues?.previewImage);
  const [recipientQuery, setRecipientQuery] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>(initialRecipients ?? []);
  const [prioritized, setPrioritized] = useState(false);
  // To-do list mode: a title plus checklist lines instead of a link and description
  const [isTodo, setIsTodo] = useState(false);
  const [todoLines, setTodoLines] = useState<string[]>(['']);
  const todoItems = todoLines.map(t => t.trim()).filter(Boolean);
  // With 2+ people picked: one shared group thread, or a separate 1-on-1 nudge to each person
  const [sendMode, setSendMode] = useState<'group' | 'individual'>('group');
  const [isSaveToSelf, setIsSaveToSelf] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Photos and files: several allowed, and they sit alongside the link (never replace it)
  const [attachments, setAttachments] = useState<Attachment[]>(initialValues?.attachments ?? []);
  const [uploadingCount, setUploadingCount] = useState(0);
  const uploading = uploadingCount > 0;
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const matches = knownRecipients.filter(u =>
    u.toLowerCase().includes(recipientQuery.toLowerCase()) && !selectedRecipients.includes(u)
  );
  // Groups whose name (or a member's name) matches what you typed
  const groupMatches = recipientQuery.trim()
    ? knownGroups.filter(g => g.label.toLowerCase().includes(recipientQuery.trim().toLowerCase())
        || g.members.some(m => m.toLowerCase().includes(recipientQuery.trim().toLowerCase())))
    : [];
  // Picking a group adds everyone in it, sent as one group nudge (it lands in that group chat)
  const addGroup = (members: string[]) => {
    setSelectedRecipients(prev => Array.from(new Set([...prev, ...members])));
    setSendMode('group');
    setRecipientQuery('');
  };

  // Someone you haven't nudged before: if what you typed is their exact Nudge name,
  // the server confirms it. (Nobody can browse or search the full list of users.)
  const [exactMatch, setExactMatch] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  useEffect(() => {
    setExactMatch(null);
    const q = recipientQuery.trim();
    if (q.length < 2 || knownRecipients.some(u => u.toLowerCase() === q.toLowerCase())) return;
    setLookingUp(true);
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('find_profile', { p_name: q });
      setLookingUp(false);
      if (error) {
        console.warn('Name lookup unavailable:', error);
        return;
      }
      if (typeof data === 'string' && data !== currentUser && !selectedRecipients.includes(data)) setExactMatch(data);
    }, 350);
    return () => { clearTimeout(timer); setLookingUp(false); };
  }, [recipientQuery]);

  // "Save to My Nudges" adds you to the recipient list so the nudge also shows
  // in My Nudges, but you don't count toward making it a group.
  const hasMultipleRecipients = selectedRecipients.filter(r => r !== currentUser).length > 1;

  const categories: { value: ReminderType; icon: typeof Globe; label: string }[] = [
    { value: 'website', icon: Globe, label: 'Website' },
    { value: 'music', icon: Music, label: 'Music' },
    { value: 'video', icon: Video, label: 'Video' },
    { value: 'text', icon: TypeIcon, label: 'Text' },
    { value: 'unnecessary', icon: MoneyBagIcon, label: 'Do we need this?!' },
    { value: 'interesting', icon: Sparkles, label: 'Interesting' },
    { value: 'food', icon: UtensilsCrossed, label: 'Food' },
    { value: 'lifehack', icon: Lightbulb, label: 'Life Hack' }
  ];

  // Same light colors used when viewing nudges, so a category looks
  // consistent whether you're picking it here or seeing it on a card later.
  const categoryColors: Record<ReminderType, string> = {
    website: 'bg-blue-100 text-blue-600',
    music: 'bg-purple-100 text-purple-600',
    video: 'bg-red-100 text-red-600',
    text: 'bg-stone-100 text-stone-600',
    unnecessary: 'bg-pink-100 text-pink-600',
    interesting: 'bg-teal-100 text-teal-600',
    food: 'bg-green-100 text-green-600',
    lifehack: 'bg-amber-100 text-amber-600'
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow selecting the same file again later
    files.forEach(f => attachPasted(f));
  };

  // A photo or file pasted anywhere in the form (e.g. ⌘V on a computer) gets attached
  const pastedFiles = (data: DataTransfer | null): File[] => {
    const files = Array.from(data?.files ?? []);
    if (files.length) return files;
    return Array.from(data?.items ?? [])
      .filter(i => i.kind === 'file')
      .map(i => i.getAsFile())
      .filter((f): f is File => !!f);
  };
  const attachPasted = async (file: File) => {
    if (file.type.startsWith('image/') && file.size > 4 * 1024 * 1024) { uploadFile(await toUploadableImage(file)); return; }
    // iPhone names every pasted picture "image.jpeg" — give it a friendlier name
    const generic = /^image\.\w+$/i.test(file.name);
    uploadFile(generic ? new File([file], `Pasted photo.${file.name.split('.').pop()}`, { type: file.type }) : file);
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.defaultPrevented || isTodo) return; // the link box already handled it
    const files = pastedFiles(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    files.forEach(f => attachPasted(f));
  };

  // The link box: hold it and tap Paste, like in Messages. A copied photo becomes an
  // attachment; a copied link or text is typed in. (It's a "rich" text box under the
  // hood, because iPhone only offers Paste for photos in rich text boxes.)
  const linkBoxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = linkBoxRef.current;
    if (el && el.innerText.trim() !== url) el.textContent = url;
  });
  const handleLinkBoxInput = () => {
    const el = linkBoxRef.current;
    if (!el) return;
    const text = el.innerText.replace(/\s*\n\s*/g, ' ').trim();
    if (!text) el.innerHTML = ''; // so the placeholder comes back
    setUrl(text);
    setPreviewImage(undefined);
  };
  const handleLinkBoxPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault(); // never let a picture or formatting land inside the box itself
    setUploadError(null);
    const files = pastedFiles(e.clipboardData);
    if (files.length) { files.forEach(f => attachPasted(f)); return; }
    const text = e.clipboardData.getData('text/plain').trim();
    if (text) {
      document.execCommand('insertText', false, text);
      return;
    }
    // A picture copied from a web page sometimes comes only as a web address
    const src = /<img[^>]+src="(https?:[^"]+)"/i.exec(e.clipboardData.getData('text/html'))?.[1];
    if (src) setAttachments(prev => [...prev, { url: src, name: 'Photo', type: 'image/jpeg' }]);
  };

  const attachmentCount = useRef(attachments.length);
  attachmentCount.current = attachments.length;
  const uploadFile = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      setUploadError('That file is too big — please keep it under 15MB.');
      return;
    }
    if (attachmentCount.current >= MAX_ATTACHMENTS) {
      setUploadError(`Up to ${MAX_ATTACHMENTS} photos or files per nudge.`);
      return;
    }
    attachmentCount.current += 1;

    setUploadingCount(n => n + 1);
    setUploadError(null);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${currentUser}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`;

    const { error } = await supabase.storage.from('nudge-uploads').upload(path, file, { contentType: file.type || undefined });
    if (error) {
      console.error(error);
      setUploadError("Couldn't upload that file — try again.");
      attachmentCount.current -= 1;
      setUploadingCount(n => n - 1);
      return;
    }

    const { data } = supabase.storage.from('nudge-uploads').getPublicUrl(path);
    setAttachments(prev => [...prev, { url: data.publicUrl, name: file.name, type: file.type || 'application/octet-stream' }]);
    setUploadingCount(n => n - 1);
  };

  const addRecipient = (name: string) => {
    setSelectedRecipients(prev => [...prev, name]);
    setRecipientQuery('');
  };
  const removeRecipient = (name: string) => {
    setSelectedRecipients(prev => prev.filter(r => r !== name));
  };

  // If no title was given, try to pull one — and a preview image — from the
  // link itself. Browsers can't read another site's HTML directly (CORS),
  // so this goes through a public link-unfurling API; if that fails for any
  // reason, we fall back to a cleaned-up hostname instead of leaving it blank.
  const resolveTitleAndPreview = async (): Promise<{ title: string; previewImage?: string }> => {
    const trimmed = title.trim();
    const trimmedUrl = isTodo ? '' : normalizeUrl(url);

    if (trimmed && (previewImage || !trimmedUrl)) {
      return { title: trimmed, previewImage };
    }

    if (trimmedUrl) {
      try {
        const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(trimmedUrl)}`);
        const json = await res.json();
        const fetchedTitle = json?.data?.title as string | undefined;
        const fetchedImage = (json?.data?.image?.url || json?.data?.logo?.url) as string | undefined;
        return {
          title: trimmed || (fetchedTitle && fetchedTitle.trim()) || fallbackTitleFromUrl(trimmedUrl),
          previewImage: previewImage || fetchedImage
        };
      } catch {
        return { title: trimmed || fallbackTitleFromUrl(trimmedUrl), previewImage };
      }
    }

    if (trimmed) return { title: trimmed, previewImage };
    if (attachments.length) {
      const photos = attachments.filter(a => a.type.startsWith('image/')).length;
      const title = photos === attachments.length
        ? (photos === 1 ? 'Photo' : `${photos} photos`)
        : attachments.length === 1 ? attachments[0].name : `${attachments.length} files`;
      return { title, previewImage };
    }
    if (content.trim()) return { title: content.trim().split('\n')[0].slice(0, 80), previewImage };
    return { title: 'Untitled nudge', previewImage };
  };

  const fallbackTitleFromUrl = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return u;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const people = recipient ? [recipient] : selectedRecipients.filter(r => r !== currentUser);
    const saveToSelf = !recipient && (isSaveToSelf || selectedRecipients.includes(currentUser));
    if (people.length === 0 && !saveToSelf) return;

    // Each entry becomes one nudge. "Individually" sends a separate 1-on-1 nudge per
    // person (landing in their existing chat with you); otherwise it's one nudge to
    // everyone. A My Nudges copy rides along on the first nudge so it's saved only once.
    const sendIndividually = people.length > 1 && sendMode === 'individual';
    const batches = sendIndividually ? people.map(p => [p]) : [people];
    if (saveToSelf) batches[0] = [...batches[0], currentUser];

    setSubmitting(true);
    const resolved = await resolveTitleAndPreview();

    // No category picked? Work one out from the link and the words.
    const finalType = type ?? (isTodo ? null : guessCategory({
      url: normalizeUrl(url) || undefined,
      title: resolved.title,
      content,
      attachments,
    }));

    batches.forEach(recipients => onSubmit({
      type: finalType,
      title: resolved.title,
      // Just words? The first line is the title; anything after it is the note
      content: isTodo ? '' : (!normalizeUrl(url) && !attachments.length && !title.trim())
        ? content.trim().split('\n').slice(1).join('\n').trim() || (content.trim().length > 80 ? content.trim() : '')
        : content.trim(),
      url: isTodo ? undefined : (normalizeUrl(url) || undefined),
      // The card's thumbnail: the link's preview, or else the first attached photo
      previewImage: isTodo ? undefined : (resolved.previewImage || attachments.find(a => a.type.startsWith('image/'))?.url),
      attachments: isTodo ? [] : attachments,
      todoItems: isTodo ? todoItems.map(text => ({ text, done: false })) : null,
      prioritized,
      recipients,
      groupName: null, // named from inside the group chat; App reuses the group's existing name
      isPublic,
      isSponsored: false,
      voters: [],
      archived: false,
      favorited: false,
      curated: false,
      curatedOrder: null,
      manualOrder: null,
      reactions: []
    }));
    setSubmitting(false);
    onClose();
  };

  const people = recipient ? [recipient] : selectedRecipients.filter(r => r !== currentUser);
  const willSaveToSelf = !recipient && isSaveToSelf;
  const hasContent = isTodo ? !!title.trim() && todoItems.length > 0 : !!(title.trim() || url.trim() || attachments.length || content.trim());
  const canSend = !submitting && !uploading && (people.length > 0 || willSaveToSelf) && hasContent;
  const sendLabel = submitting
    ? 'Sending…'
    : people.length > 1
      ? `Send to ${people.length} people`
      : people.length === 1
        ? `Send to ${people[0]}`
        : willSaveToSelf
          ? 'Save to My Nudges'
          : 'Send';

  const removeAttachment = (index: number) => setAttachments(prev => prev.filter((_, i) => i !== index));

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      // Keep the form clear of the notch/clock and the home indicator
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onPaste={handlePaste}
        className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-full flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-stone-200 flex items-center justify-between shrink-0">
          {initialValues ? (
            <h3 className="text-lg">Forward nudge</h3>
          ) : (
            <h3 className="h-8 flex items-center">
              <img src={nudgeLogo} alt="New nudge" className="h-7 w-auto object-contain" />
            </h3>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1 -mr-1 text-stone-500 hover:bg-stone-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="px-4 py-3.5 space-y-3.5 overflow-y-auto min-h-0">
          {/* To — who it's going to, first, like a message */}
          <div className="pb-3 border-b border-stone-200">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-stone-500">To</span>
              {recipient ? (
                <span className="px-2.5 py-1 rounded-full bg-brand-50 text-brand-800 text-sm">{recipient}</span>
              ) : (
                <>
                  {selectedRecipients.map(name => (
                    <span key={name} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-brand-50 text-brand-800 text-sm">
                      {name}
                      <button
                        type="button"
                        onClick={() => removeRecipient(name)}
                        className="text-brand-400 hover:text-brand-700"
                        aria-label={`Remove ${name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                  <input
                    id="quick-recipient"
                    type="text"
                    value={recipientQuery}
                    onChange={(e) => setRecipientQuery(e.target.value)}
                    placeholder={selectedRecipients.length > 0 ? 'Add…' : "Friend's name"}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="flex-1 min-w-[80px] py-1 text-sm bg-transparent focus:outline-none placeholder:text-stone-400"
                  />
                  {/* Only matters once 2+ people are picked */}
                  {hasMultipleRecipients && (
                    <div className="ml-auto flex rounded-lg border border-stone-300 p-0.5 text-xs" role="radiogroup" aria-label="How to send">
                      {([['individual', 'Individually'], ['group', 'Group']] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={sendMode === mode}
                          onClick={() => setSendMode(mode)}
                          className={`px-2.5 py-1 rounded-md transition-colors ${
                            sendMode === mode ? 'bg-brand-600 text-white' : 'text-stone-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Your groups, one tap to address the whole group */}
            {!recipient && !recipientQuery && selectedRecipients.filter(r => r !== currentUser).length === 0 && knownGroups.length > 0 && (
              <div className="mt-2 -mx-4 px-4 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {knownGroups.slice(0, 12).map(g => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => addGroup(g.members)}
                    className="shrink-0 flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border border-stone-300 text-xs text-stone-700 active:bg-stone-100"
                    title={g.members.join(', ')}
                  >
                    {g.picture ? <Avatar name={g.label} size={20} value={g.picture} /> : (
                      <span className="w-5 h-5 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Users className="w-3 h-3" /></span>
                    )}
                    <span className="max-w-[140px] truncate">{g.label}</span>
                  </button>
                ))}
              </div>
            )}

            {recipientQuery && (
              <div className="mt-2 border border-stone-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {groupMatches.map(g => (
                  <button
                    key={'g:' + g.key}
                    type="button"
                    onClick={() => addGroup(g.members)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-stone-50 border-b border-stone-100 flex items-center gap-2"
                  >
                    <Users className="w-4 h-4 text-brand-600 shrink-0" />
                    <span className="min-w-0 truncate">{g.label}</span>
                    <span className="ml-auto text-xs text-stone-400 shrink-0">group · {g.members.length + 1}</span>
                  </button>
                ))}
                {matches.map(u => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => addRecipient(u)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-stone-50 border-b border-stone-100 last:border-b-0"
                  >
                    {u}
                  </button>
                ))}
                {exactMatch && (
                  <button
                    type="button"
                    onClick={() => addRecipient(exactMatch)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-stone-50 border-b border-stone-100 last:border-b-0"
                  >
                    {exactMatch} <span className="text-xs text-stone-400">· new contact</span>
                  </button>
                )}
                {matches.length === 0 && groupMatches.length === 0 && !exactMatch && (
                  <p className="px-3 py-2 text-xs text-stone-500">
                    {lookingUp ? 'Looking…' : "No one by that name. To add someone new, type their exact username, or ask them for their Addly link."}
                  </p>
                )}
              </div>
            )}

          </div>

          {/* Link box, with the paperclip built in. Photos and files (pasted, dropped, or
              picked) collect underneath it, so a nudge can have a link AND attachments.
              To-do lists don't have either. */}
          <div className={isTodo ? 'hidden' : ''}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,application/pdf"
              onChange={handleFileSelected}
              className="hidden"
            />
            <div className="flex items-center gap-2 border border-stone-300 rounded-xl px-3 py-2.5 focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-transparent">
              {previewImage ? (
                <img src={previewImage} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
              ) : (
                <Link2 className="w-[18px] h-[18px] text-stone-400 shrink-0" />
              )}
              <div
                id="quick-url"
                ref={linkBoxRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="Link or photo"
                data-placeholder={attachments.length ? 'Add a link (optional)' : 'Paste a link or photo'}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onInput={handleLinkBoxInput}
                onPaste={handleLinkBoxPaste}
                onDrop={(e) => {
                  const files = pastedFiles(e.dataTransfer);
                  if (files.length) { e.preventDefault(); files.forEach(f => attachPasted(f)); }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                className="flex-1 min-w-0 text-base leading-6 break-all max-h-24 overflow-y-auto bg-transparent focus:outline-none cursor-text empty:before:content-[attr(data-placeholder)] empty:before:text-stone-400 empty:before:pointer-events-none"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-brand-600 hover:text-brand-700 shrink-0"
                aria-label="Add photos or files"
              >
                <Paperclip className="w-[18px] h-[18px]" />
              </button>
            </div>
            {(attachments.length > 0 || uploading) && (
              <div className="mt-0.5 pt-2.5 pr-2 flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {attachments.map((a, i) => (
                  <div key={a.url} className="relative shrink-0">
                    {a.type.startsWith('image/') ? (
                      <img src={a.url} alt={a.name} className="w-20 h-20 rounded-xl object-cover border border-stone-200" />
                    ) : (
                      <div className="w-20 h-20 rounded-xl border border-stone-200 bg-stone-50 flex flex-col items-center justify-center gap-1 px-1.5">
                        <FileText className="w-6 h-6 text-stone-500" />
                        <span className="text-[10px] text-stone-600 truncate w-full text-center">{a.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-stone-800 text-white flex items-center justify-center shadow"
                      aria-label={`Remove ${a.name}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {Array.from({ length: uploadingCount }, (_, i) => (
                  <div key={'up' + i} className="w-20 h-20 shrink-0 rounded-xl border border-dashed border-stone-300 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-stone-400 animate-spin" />
                  </div>
                ))}
              </div>
            )}
            {uploadError && <p className="text-xs text-red-500 mt-1">{uploadError}</p>}
          </div>

          {/* One writing space (to-do lists also get a title for the list) */}
          <div>
            {isTodo && (
              <input
                id="quick-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="List title"
                className="w-full pb-2.5 text-base font-medium bg-transparent border-b border-stone-200 focus:outline-none focus:border-brand-400 placeholder:text-stone-400 placeholder:font-normal"
              />
            )}
            {/* A divider line under the title makes it clear where each field starts */}
            {isTodo ? (
              <div className="mt-2 space-y-1">
                {todoLines.map((line, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className="w-5 h-5 rounded-full border-2 border-stone-300 shrink-0" aria-hidden="true" />
                    <input
                      type="text"
                      value={line}
                      onChange={(e) => setTodoLines(prev => prev.map((l, j) => j === i ? e.target.value : l))}
                      onKeyDown={(e) => {
                        // Return adds the next line instead of sending the nudge
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (line.trim()) setTodoLines(prev => [...prev.slice(0, i + 1), '', ...prev.slice(i + 1)]);
                        }
                      }}
                      autoFocus={i > 0 && i === todoLines.length - 1 && !line}
                      placeholder={i === 0 ? 'First thing to do' : 'Next thing'}
                      aria-label={`To-do item ${i + 1}`}
                      className="flex-1 min-w-0 py-1.5 text-sm bg-transparent focus:outline-none placeholder:text-stone-400"
                    />
                    {todoLines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setTodoLines(prev => prev.filter((_, j) => j !== i))}
                        className="p-1 text-stone-400 hover:text-stone-600 shrink-0"
                        aria-label={`Remove item ${i + 1}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTodoLines(prev => [...prev, ''])}
                  className="flex items-center gap-1.5 pt-1 text-sm text-brand-600"
                >
                  <Plus className="w-4 h-4" /> Add item
                </button>
              </div>
            ) : (
              <textarea
                id="quick-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={url.trim() || attachments.length ? 'Say something about it (optional)' : "What's on your mind?"}
                rows={3}
                className="w-full text-base text-stone-800 bg-transparent focus:outline-none resize-none placeholder:text-stone-400"
              />
            )}
          </div>

          {/* Categories — one swipeable row */}
          <div className="-mx-4 px-4 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                onClick={() => setType(type === value ? null : value)}
                className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs whitespace-nowrap ring-inset transition-shadow ${categoryColors[value]} ${
                  type === value ? 'ring-2 ring-brand-600' : ''
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Options as tap-to-toggle chips — one row you can swipe sideways, like the categories */}
          <div className="-mx-4 px-4 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {!recipient && (
              <button
                type="button"
                aria-pressed={isSaveToSelf}
                onClick={() => setIsSaveToSelf(v => !v)}
                className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                  isSaveToSelf ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-stone-300 text-stone-600'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" />
                Save to My Nudges
              </button>
            )}
            <button
              type="button"
              aria-pressed={isPublic}
              onClick={() => setIsPublic(v => !v)}
              className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                isPublic ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-stone-300 text-stone-600'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Public
            </button>
            <button
              type="button"
              aria-pressed={prioritized}
              onClick={() => setPrioritized(v => !v)}
              className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                prioritized ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-stone-300 text-stone-600'
              }`}
            >
              <span aria-hidden="true">🤯</span>
              Prioritize
            </button>
            <button
              type="button"
              aria-pressed={isTodo}
              onClick={() => setIsTodo(v => !v)}
              className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                isTodo ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-stone-300 text-stone-600'
              }`}
            >
              <ListChecks className="w-3.5 h-3.5" />
              To-do list
            </button>
          </div>
        </div>

        {/* Send — always visible at the bottom */}
        <div className="px-4 pt-2 pb-4 shrink-0">
          <button
            type="submit"
            disabled={!canSend}
            className="w-full py-2.5 px-4 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            <span className="truncate">{sendLabel}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
