import { useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../utils/supabase/client';
import { PasswordInput } from './AuthScreen';

// Change your password while you're signed in — no email needed.
export function ChangePassword({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) { setError('Use at least 6 characters.'); return; }
    if (password !== again) { setError("Those don't match. Type the same password twice."); return; }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(/same|different/i.test(updateError.message) ? 'Pick a password you haven’t used before.' : updateError.message || "Couldn't save it. Try again.");
      return;
    }
    setDone(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl px-6 pt-4 shadow-xl"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Change password"
      >
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold text-stone-900">Change password</p>
          <button onClick={onClose} className="p-1.5 -mr-2 text-stone-400 hover:text-stone-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        {done ? (
          <div className="py-6 text-center">
            <p className="text-stone-800">Your password is changed.</p>
            <p className="text-sm text-stone-500 mt-1">Use it next time you sign in, including the Chrome add-on.</p>
            <button onClick={onClose} className="mt-5 w-full h-12 rounded-xl bg-brand-600 text-white active:bg-brand-700">Done</button>
          </div>
        ) : (
          <form onSubmit={save} className="mt-3 space-y-3">
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" autoComplete="new-password"
              className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <PasswordInput value={again} onChange={(e) => setAgain(e.target.value)} placeholder="Type it again" autoComplete="new-password"
              className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500" />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={saving} className="w-full h-12 rounded-xl bg-brand-600 text-white active:bg-brand-700 disabled:opacity-60">
              {saving ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
