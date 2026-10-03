import { useRef, useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { Avatar, PRESET_AVATARS } from './Avatar';
import { supabase } from '../utils/supabase/client';

interface AvatarPickerProps {
  name: string;
  current: string | null;
  onSave: (value: string | null) => Promise<void>;
  onClose: () => void;
}

// Shrink a photo to a small square before uploading — profile pictures are tiny,
// so this keeps uploads fast and storage small no matter how big the original is.
async function toSquareJpeg(file: File, size = 320): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process that photo'))), 'image/jpeg', 0.85)
  );
}

export function AvatarPicker({ name, current, onSave, onClose }: AvatarPickerProps) {
  const [choice, setChoice] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await toSquareJpeg(file);
      const path = `${name}/avatar-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage.from('nudge-uploads').upload(path, blob, { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;
      setChoice(supabase.storage.from('nudge-uploads').getPublicUrl(path).data.publicUrl);
    } catch (err) {
      console.error(err);
      setError("Couldn't upload that photo — try another.");
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    await onSave(choice);
    setBusy(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4"
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      onClick={onClose}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-full flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3.5 border-b border-stone-200 flex items-center justify-between shrink-0">
          <h3 className="text-lg">Your picture</h3>
          <button onClick={onClose} className="p-1 -mr-1 text-stone-500" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 overflow-y-auto min-h-0">
          <div className="flex flex-col items-center gap-3 mb-5">
            <Avatar name={name} size={96} value={choice} />
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
            <div className="flex gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 text-white text-sm disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                Upload a photo
              </button>
              {choice && (
                <button onClick={() => setChoice(null)} className="px-4 py-2 rounded-lg border border-stone-300 text-sm text-stone-600">
                  Use initials
                </button>
              )}
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          <p className="text-xs text-stone-500 mb-2">Or pick one</p>
          <div className="grid grid-cols-6 gap-2">
            {PRESET_AVATARS.map(emoji => {
              const value = `emoji:${emoji}`;
              return (
                <button
                  key={emoji}
                  onClick={() => setChoice(value)}
                  className={`rounded-full p-0.5 ${choice === value ? 'ring-2 ring-orange-500' : ''}`}
                  aria-label={`Use ${emoji}`}
                  aria-pressed={choice === value}
                >
                  <Avatar name={name} size={44} value={value} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 pt-2 pb-4 shrink-0">
          <button
            onClick={save}
            disabled={busy || choice === current}
            className="w-full py-2.5 rounded-xl bg-orange-600 text-white disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
