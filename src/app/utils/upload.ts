import { supabase } from './supabase/client';
import type { Attachment } from '../App';

// Pasted or picked photos arrive full-size (often as huge PNGs). Shrink to at most
// 2400px on the long side and save as a JPEG so they upload quickly and fit the limit.
export async function toUploadableImage(blob: Blob, name = 'Photo'): Promise<File> {
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
    return new File([jpeg], `${name}.jpg`, { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

/** Upload a photo or file to the app's storage and describe it as an attachment */
export async function uploadAttachment(file: File, owner: string): Promise<Attachment> {
  if (file.size > 15 * 1024 * 1024) throw new Error('too big');
  const ready = file.type.startsWith('image/') && file.size > 4 * 1024 * 1024 ? await toUploadableImage(file) : file;
  const safeName = ready.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${owner}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`;
  const { error } = await supabase.storage.from('nudge-uploads').upload(path, ready, { contentType: ready.type || undefined });
  if (error) throw error;
  const { data } = supabase.storage.from('nudge-uploads').getPublicUrl(path);
  return { url: data.publicUrl, name: ready.name, type: ready.type || 'application/octet-stream' };
}
