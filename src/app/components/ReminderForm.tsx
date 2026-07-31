import { useState } from 'react';
import { Link, Music, Video, Type, Send } from 'lucide-react';
import type { Reminder, ReminderType } from '../App';

interface ReminderFormProps {
  onSubmit: (reminder: Omit<Reminder, 'id' | 'createdAt' | 'sender' | 'checkedOut'>) => void;
}

export function ReminderForm({ onSubmit }: ReminderFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<ReminderType>('link');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [recipient, setRecipient] = useState('');
  const [isSaveToSelf, setIsSaveToSelf] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title || (!recipient && !isSaveToSelf)) return;

    onSubmit({
      type,
      title,
      content,
      url: url || undefined,
      recipient: isSaveToSelf ? 'You' : recipient
    });

    // Reset form
    setTitle('');
    setContent('');
    setUrl('');
    setRecipient('');
    setIsSaveToSelf(false);
    setIsOpen(false);
  };

  const types: { value: ReminderType; label: string; icon: typeof Link }[] = [
    { value: 'link', label: 'Link', icon: Link },
    { value: 'music', label: 'Music', icon: Music },
    { value: 'video', label: 'Video', icon: Video },
    { value: 'text', label: 'Text', icon: Type }
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="w-full py-3 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
        >
          <Send className="w-5 h-5" />
          Send a Reminder
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg">New Reminder</h3>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </div>

          {/* Type Selection */}
          <div>
            <label className="block text-sm mb-2">Type</label>
            <div className="grid grid-cols-4 gap-2">
              {types.map(({ value, label, icon: Icon }) => (
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
                  <span className="text-sm">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Recipient */}
          <div>
            <label htmlFor="recipient" className="block text-sm mb-2">
              Send to
            </label>
            <input
              id="recipient"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Friend's name"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Save to Self */}
          <div>
            <label className="block text-sm mb-2">
              <input
                type="checkbox"
                checked={isSaveToSelf}
                onChange={(e) => setIsSaveToSelf(e.target.checked)}
                className="mr-2"
              />
              Save to Self
            </label>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="title" className="block text-sm mb-2">
              Title
            </label>
            <input
              id="title"
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
            <label htmlFor="content" className="block text-sm mb-2">
              Description (optional)
            </label>
            <textarea
              id="content"
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
              <label htmlFor="url" className="block text-sm mb-2">
                URL {type === 'text' && '(optional)'}
              </label>
              <input
                id="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            className="w-full py-3 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
          >
            <Send className="w-5 h-5" />
            Send Reminder
          </button>
        </form>
      )}
    </div>
  );
}