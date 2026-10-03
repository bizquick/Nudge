import { useEffect, useRef, useState } from 'react';
import { Globe, Music, Video, Type as TypeIcon, Sparkles, UtensilsCrossed, Lightbulb, Send, X, Paperclip, Loader2, Link2, Bookmark, ListChecks, Plus } from 'lucide-react';
import type { ReminderType, NewNudge } from '../App';
import { supabase } from '../utils/supabase/client';
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
  };
}

// People type links the short way ("nytimes.com"). Add the https:// for them
// so the link opens and the title/preview lookup works.
function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`;
}

export function QuickSendModal({ recipient, knownRecipients, currentUser, onClose, onSubmit, initialValues, initialRecipients }: QuickSendModalProps) {
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const matches = knownRecipients.filter(u =>
    u.toLowerCase().includes(recipientQuery.toLowerCase()) && !selectedRecipients.includes(u)
  );

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
    const file = e.target.files?.[0];
    e.target.value = ''; // allow selecting the same file again later
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      setUploadError('That file is too big — please keep it under 15MB.');
      return;
    }

    setUploading(true);
    setUploadError(null);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${currentUser}/${Date.now()}-${safeName}`;

    const { error } = await supabase.storage.from('nudge-uploads').upload(path, file);
    if (error) {
      console.error(error);
      setUploadError("Couldn't upload that file — try again.");
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from('nudge-uploads').getPublicUrl(path);
    setUrl(data.publicUrl);
    setUploadedFileName(file.name);
    if (file.type.startsWith('image/')) {
      setPreviewImage(data.publicUrl);
    }
    setUploading(false);
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
    if (content.trim()) return { title: content.trim().slice(0, 60), previewImage };
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

    batches.forEach(recipients => onSubmit({
      type,
      title: resolved.title,
      content: isTodo ? '' : content,
      url: isTodo ? undefined : (normalizeUrl(url) || undefined),
      previewImage: isTodo ? undefined : resolved.previewImage,
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
  const hasContent = isTodo ? !!title.trim() && todoItems.length > 0 : !!(title.trim() || url.trim());
  const canSend = !submitting && (people.length > 0 || willSaveToSelf) && hasContent;
  const sendLabel = submitting
    ? 'Sending…'
    : people.length > 1
      ? `Send to ${people.length} people`
      : people.length === 1
        ? `Send to ${people[0]}`
        : willSaveToSelf
          ? 'Save to My Nudges'
          : 'Send';

  const clearAttachment = () => {
    setUrl('');
    setPreviewImage(undefined);
    setUploadedFileName(null);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      // Keep the form clear of the notch/clock and the home indicator
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-full flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-stone-200 flex items-center justify-between shrink-0">
          {initialValues ? (
            <h3 className="text-lg">Forward nudge</h3>
          ) : (
            // The logo image has empty space built in; the negative margins trim it so it sits snugly in the header
            <h3 className="h-8 flex items-center">
              <img src={nudgeLogo} alt="New nudge" className="h-[108px] w-auto object-contain -my-[38px] -ml-[27px]" />
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
                <span className="px-2.5 py-1 rounded-full bg-orange-50 text-orange-800 text-sm">{recipient}</span>
              ) : (
                <>
                  {selectedRecipients.map(name => (
                    <span key={name} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-orange-50 text-orange-800 text-sm">
                      {name}
                      <button
                        type="button"
                        onClick={() => removeRecipient(name)}
                        className="text-orange-400 hover:text-orange-700"
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
                            sendMode === mode ? 'bg-orange-600 text-white' : 'text-stone-600'
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

            {recipientQuery && (
              <div className="mt-2 border border-stone-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
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
                {matches.length === 0 && !exactMatch && (
                  <p className="px-3 py-2 text-xs text-stone-500">
                    {lookingUp ? 'Looking…' : "No one by that name. To add someone new, type their exact Nudge name, or ask them for their Nudge link."}
                  </p>
                )}
              </div>
            )}

          </div>

          {/* Link or upload — one field, paperclip built in (to-do lists don't have a link) */}
          <div className={isTodo ? 'hidden' : ''}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,application/pdf"
              onChange={handleFileSelected}
              className="hidden"
            />
            <div className="flex items-center gap-2 border border-stone-300 rounded-xl px-3 py-2.5 focus-within:ring-2 focus-within:ring-orange-500 focus-within:border-transparent">
              {previewImage ? (
                <img src={previewImage} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
              ) : (
                <Link2 className="w-[18px] h-[18px] text-stone-400 shrink-0" />
              )}
              {uploadedFileName ? (
                <>
                  <span className="flex-1 min-w-0 truncate text-sm text-stone-700">{uploadedFileName}</span>
                  <button type="button" onClick={clearAttachment} className="text-stone-400 hover:text-stone-600" aria-label="Remove file">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <input
                    id="quick-url"
                    type="text"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setPreviewImage(undefined); }}
                    placeholder="Paste a link"
                    className="flex-1 min-w-0 text-sm bg-transparent focus:outline-none placeholder:text-stone-400"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="text-orange-600 hover:text-orange-700 disabled:opacity-50 shrink-0"
                    aria-label="Upload a photo or file"
                  >
                    {uploading ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Paperclip className="w-[18px] h-[18px]" />}
                  </button>
                </>
              )}
            </div>
            {uploadError && <p className="text-xs text-red-500 mt-1">{uploadError}</p>}
          </div>

          {/* Title + description as open writing space */}
          <div>
            <input
              id="quick-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isTodo ? 'List title' : url.trim() && !uploadedFileName ? "Title (or we'll use the link's)" : 'Title'}
              className="w-full pb-2.5 text-base font-medium bg-transparent border-b border-stone-200 focus:outline-none focus:border-orange-400 placeholder:text-stone-400 placeholder:font-normal"
            />
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
                  className="flex items-center gap-1.5 pt-1 text-sm text-orange-600"
                >
                  <Plus className="w-4 h-4" /> Add item
                </button>
              </div>
            ) : (
              <textarea
                id="quick-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Why should they check it out?"
                rows={3}
                className="w-full mt-3 text-sm text-stone-700 bg-transparent focus:outline-none resize-none placeholder:text-stone-400"
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
                  type === value ? 'ring-2 ring-orange-600' : ''
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
                  isSaveToSelf ? 'border-orange-600 bg-orange-50 text-orange-700' : 'border-stone-300 text-stone-600'
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
                isPublic ? 'border-orange-600 bg-orange-50 text-orange-700' : 'border-stone-300 text-stone-600'
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
                prioritized ? 'border-orange-600 bg-orange-50 text-orange-700' : 'border-stone-300 text-stone-600'
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
                isTodo ? 'border-orange-600 bg-orange-50 text-orange-700' : 'border-stone-300 text-stone-600'
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
            className="w-full py-2.5 px-4 bg-orange-600 text-white rounded-xl hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            <span className="truncate">{sendLabel}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
