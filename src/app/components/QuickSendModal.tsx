import { useState } from 'react';
import { Link, Music, Video, Type, Send, X } from 'lucide-react';
import type { ReminderType, Reminder } from '../App';

interface QuickSendModalProps {
  recipient: string;
  onClose: () => void;
  onSubmit: (reminder: Omit<Reminder, 'id' | 'createdAt' | 'sender' | 'checkedOut'>) => void;
}

export function QuickSendModal({ recipient, onClose, onSubmit }: QuickSendModalProps) {
  const [type, setType] = useState<ReminderType>('link');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [recipientInput, setRecipientInput] = useState(recipient);
  const [isSaveToSelf, setIsSaveToSelf] = useState(false);

  const types: { value: ReminderType; icon: typeof Link; label: string }[] = [
    { value: 'link', icon: Link, label: 'Link' },
    { value: 'music', icon: Music, label: 'Music' },
    { value: 'video', icon: Video, label: 'Video' },
    { value: 'text', icon: Type, label: 'Text' }
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Use recipientInput if recipient was empty, otherwise use passed recipient
    const finalRecipient = recipient ? recipient : (isSaveToSelf ? 'You' : recipientInput);

    if (!finalRecipient && !isSaveToSelf) return;

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
                <input
                  id="quick-recipient"
                  type="text"
                  value={recipientInput}
                  onChange={(e) => setRecipientInput(e.target.value)}
                  placeholder="Friend's name"
                  disabled={isSaveToSelf}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>

              {/* Save to Self Checkbox */}
              <div className="flex items-center">
                <input
                  id="save-to-self"
                  type="checkbox"
                  checked={isSaveToSelf}
                  onChange={(e) => setIsSaveToSelf(e.target.checked)}
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
              className="flex-1 py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
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
