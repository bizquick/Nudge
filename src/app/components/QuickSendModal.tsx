import { useState } from 'react';
import { Link, Music, Video, Type, Send, X, Check } from 'lucide-react';
import type { ReminderType, Reminder } from '../App';

interface QuickSendModalProps {
  recipient: string;
  knownRecipients: string[];
  onClose: () => void;
  onSubmit: (reminder: Omit<Reminder, 'id' | 'createdAt' | 'sender' | 'checkedOut'>) => void;
}

export function QuickSendModal({ recipient, knownRecipients, onClose, onSubmit }: QuickSendModalProps) {
  const [type, setType] = useState<ReminderType>('link');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [recipientQuery, setRecipientQuery] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState('');
  const [isSaveToSelf, setIsSaveToSelf] = useState(false);

  const matches = knownRecipients.filter(u =>
    u.toLowerCase().includes(recipientQuery.toLowerCase()) && u !== selectedRecipient
  );

  const types: { value: ReminderType; icon: typeof Link; label: string }[] = [
    { value: 'link', icon: Link, label: 'Link' },
    { value: 'music', icon: Music, label: 'Music' },
    { value: 'video', icon: Video, label: 'Video' },
    { value: 'text', icon: Type, label: 'Text' }
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const finalRecipient = recipient ? recipient : (isSaveToSelf ? 'You' : selectedRecipient);

    if (!finalRecipient) return;

    onSubmit({
      type,
      title,
      content,
      url: url || undefined,
      recipient: finalRecipient,
      archived: false,
      favorited: false,
      reactions: []
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg">{recipient ? `Send to ${recipient}` : 'New Reminder'}</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Type Selection */}
          <div>
            <label className="block text-sm mb-2">Type</label>
            <div className="grid grid-cols-4 gap-2">
              {types.map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                    type === value
                      ? 'border-indigo-600 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="quick-title" className="block text-sm mb-2">
              Title
            </label>
            <input
              id="quick-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give it a catchy title"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          {/* Content */}
          <div>
            <label htmlFor="quick-content" className="block text-sm mb-2">
              Description (optional)
            </label>
            <textarea
              id="quick-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Tell them why they should check this out"
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          {/* URL (optional for text type) */}
          {type !== 'text' && (
            <div>
              <label htmlFor="quick-url" className="block text-sm mb-2">
                URL {type === 'text' && '(optional)'}
              </label>
              <input
                id="quick-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {/* Recipient Input - Only show if no recipient was passed */}
          {!recipient && (
            <>
              <div>
                <label htmlFor="quick-recipient" className="block text-sm mb-2">
                  Send to
                </label>

                {selectedRecipient && !isSaveToSelf ? (
                  <div className="flex items-center justify-between px-4 py-2 border border-indigo-600 bg-indigo-50 rounded-lg">
                    <span className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-indigo-600" />
                      {selectedRecipient}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setSelectedRecipient(''); setRecipientQuery(''); }}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      id="quick-recipient"
                      type="text"
                      value={recipientQuery}
                      onChange={(e) => setRecipientQuery(e.target.value)}
                      placeholder="Start typing a friend's name..."
                      disabled={isSaveToSelf}
                      autoComplete="off"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    />
                    {!isSaveToSelf && recipientQuery && (
                      <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                        {matches.length > 0 ? (
                          matches.map(u => (
                            <button
                              key={u}
                              type="button"
                              onClick={() => { setSelectedRecipient(u); setRecipientQuery(''); }}
                              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                            >
                              {u}
                            </button>
                          ))
                        ) : (
                          <p className="px-4 py-2 text-xs text-gray-500">
                            No account with that name yet. They'll need to sign up before you can send to them.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  Only real, registered accounts show up here — no more guessing if the name's right.
                </p>
              </div>

              {/* Save to Self Checkbox */}
              <div className="flex items-center">
                <input
                  id="save-to-self"
                  type="checkbox"
                  checked={isSaveToSelf}
                  onChange={(e) => {
                    setIsSaveToSelf(e.target.checked);
                    if (e.target.checked) { setSelectedRecipient(''); setRecipientQuery(''); }
                  }}
                  className="mr-2"
                />
                <label htmlFor="save-to-self" className="text-sm">
                  Save to Self
                </label>
              </div>
            </>
          )}

          {/* Submit Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!recipient && !isSaveToSelf && !selectedRecipient}
              className="flex-1 py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
