import { useState } from 'react';
import { Send } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import nudgeLogo from '../../imports/image-3.png';

interface OnboardingProps {
  onSubmit: (name: string) => void;
}

export function Onboarding({ onSubmit }: OnboardingProps) {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-4">
      <div className="w-full max-w-sm text-center">
        <ImageWithFallback
          src={nudgeLogo}
          alt="Nudge"
          className="h-20 w-auto object-contain mx-auto mb-2"
        />
        <p className="text-gray-600 italic mb-8">
          Because "I'll check it out later" is a lie.
        </p>
        <p className="text-gray-700 mb-4">
          Send links, music, and videos to people you know — they check them out whenever they get a chance. What should we call you?
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full px-4 py-3 border-2 border-indigo-600 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-3 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            Get started
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-6">
          No password — just a name. Anyone can type any name, so only share this app with people you trust.
        </p>
      </div>
    </div>
  );
}
