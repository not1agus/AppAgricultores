import { decode } from 'base64-arraybuffer';
// expo-file-system v19 reorganizó el top-level (cacheDirectory / EncodingType
// quedaron fuera). El subpath `/legacy` mantiene la API anterior 1:1; cuando
// reescribamos a la API nueva (Paths.cache, File.write...) podremos quitarla.
import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/services/supabase';

const TICKETS_BUCKET = 'tickets';
const ACTIVIDADES_BUCKET = 'actividades';

function guessContentType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}

function extFromContentType(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/heic') return 'heic';
  return 'jpg';
}

/**
 * Reads a local image URI (from expo-image-picker), uploads it to the given
 * Supabase Storage bucket under "<auth.uid()>/<timestamp>-<rand>.<ext>" and
 * returns its public URL. Storage RLS rejects anything outside that folder.
 *
 * Each caller (tickets, actividades) gets its own thin wrapper below so it's
 * obvious at the call site which bucket is being written to.
 */
async function uploadImage(bucket: string, localUri: string): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) throw new Error('Not authenticated');

  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const contentType = guessContentType(localUri);
  const ext = extFromContentType(contentType);
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, decode(base64), {
      contentType,
      upsert: false,
    });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export function uploadTicketImage(localUri: string): Promise<string> {
  return uploadImage(TICKETS_BUCKET, localUri);
}

export function uploadActividadImage(localUri: string): Promise<string> {
  return uploadImage(ACTIVIDADES_BUCKET, localUri);
}
