import { supabase } from './supabase/client';
import type { Attachment } from '../App';

// Photos from the library or the clipboard arrive full-size (3-5MB from an iPhone camera,
// huge PNGs when pasted). Shrink to at most 2048px on the long side — still sharp full
// screen — and save as a JPEG, so they upload several times faster.
export async function toUploadableImage(blob: Blob, name = 'Photo', maxSide = 2048): Promise<File> {
  const bitmapUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = bitmapUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!jpeg) throw new Error('could not encode');
    return new File([jpeg], `${name}.jpg`, { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

/** Photos get shrunk before uploading (small ones and GIFs are left alone, so GIFs keep moving) */
export async function shrinkForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 400 * 1024) return file;
  const base = /^image\.\w+$/i.test(file.name) ? 'Photo' : file.name.replace(/\.[^.]+$/, '');
  try {
    return await toUploadableImage(file, base);
  } catch {
    return file; // couldn't read it as a picture — upload it as it is
  }
}

/** Upload a photo or file to the app's storage and describe it as an attachment */
export async function uploadAttachment(file: File, owner: string): Promise<Attachment> {
  const ready = await shrinkForUpload(file);
  if (ready.size > 15 * 1024 * 1024) throw new Error('too big');
  const safeName = ready.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${owner}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`;
  const { error } = await supabase.storage.from('nudge-uploads').upload(path, ready, { contentType: ready.type || undefined });
  if (error) throw error;
  const { data } = supabase.storage.from('nudge-uploads').getPublicUrl(path);
  return { url: data.publicUrl, name: ready.name, type: ready.type || 'application/octet-stream' };
}
