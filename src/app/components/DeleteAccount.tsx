import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { supabase } from '../utils/supabase/client';

// Deleting your account for good: your nudges, messages, reactions, pictures, lists,
// and sign-in. You type DELETE to make sure it isn't an accident.

interface DeleteAccountProps {
  username: string;
  onDeleted: () => void;
  onClose: () => void;
}

/** Remove the photos you uploaded (best effort — storage keeps them per person) */
async function removeMyUploads(username: string) {
  try {
    for (let round = 0; round < 20; round++) {
      const { data } = await supabase.storage.from('nudge-uploads').list(username, { limit: 100 });
      if (!data?.length) return;
      const { error } = await supabase.storage.from('nudge-uploads').remove(data.map(f => `${username}/${f.name}`));
      if (error) return;
    }
  } catch {
    // Not fatal: the account itself still gets deleted
  }
}

export function DeleteAccount({ username, onDeleted, onClose }: DeleteAccountProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim().toUpperCase() === 'DELETE';

  const remove = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    await removeMyUploads(username);
    const { error: err } = await supabase.rpc('delete_my_account');
    if (err) {
      console.error(err);
      setBusy(false);
      setError("Couldn't delete your account. Check your connection and try again, or email support@addlyapp.com.");
      return;
    }
    onDeleted();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center" onClick={busy ? undefined : onClose}>
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Trash2 className="w-5 h-5 text-red-600" />
          <p className="text-lg text-stone-900">Delete your account?</p>
        </div>
        <p className="mt-2 text-sm text-stone-600">This permanently deletes, for everyone:</p>
        <ul className="mt-1.5 ml-5 list-disc text-sm text-stone-600 space-y-0.5">
          <li>Every nudge you've sent, and its messages</li>
          <li>Your messages and reactions on other people's nudges</li>
          <li>Your pictures, favorites, folders, friends, and settings</li>
          <li>Your username ({username}) and sign-in</li>
        </ul>
        <p className="mt-2 text-sm text-stone-600">It can't be undone.</p>
        <label className="block mt-4 text-sm text-stone-700">
          Type <span className="font-semibold">DELETE</span> to confirm
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-base focus:outline-none focus:ring-2 focus:ring-red-300"
          />
        </label>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 h-12 rounded-2xl border border-stone-300 text-stone-700 active:bg-stone-50">Cancel</button>
          <button
            onClick={remove}
            disabled={!ready || busy}
            className="flex-[2] h-12 rounded-2xl bg-red-600 text-white disabled:opacity-40 flex items-center justify-center gap-2 active:bg-red-700"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete my account
          </button>
        </div>
      </div>
    </div>
  );
}
