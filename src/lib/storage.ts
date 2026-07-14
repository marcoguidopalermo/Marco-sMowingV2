// Shared Firebase Storage upload helpers. The FIRST Storage surface is
// repair photos; fleet documents, policy PDFs, and duty-completion photos
// reuse this exact lib. Design rules:
//   - Firestore holds METADATA only (StoredFile); bytes live in Storage.
//   - Images are compressed client-side before upload (a 4-8 MB phone
//     photo becomes ~200-400 KB). PDFs upload untouched.
//   - Every upload reports progress and surfaces errors — never silent.
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage, auth } from './firebase';
import type { StoredFile } from '../types';

// Compression target: longest edge, JPEG quality. A raw phone photo
// (4000x3000, 4-8 MB) resizes to ~1600px and re-encodes to ~200-400 KB.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

export function isImage(file: { type: string }): boolean {
  return /^image\//.test(file.type);
}
export function isPdf(file: { type: string }): boolean {
  return file.type === 'application/pdf';
}
function kindOf(contentType: string): StoredFile['kind'] {
  if (/^image\//.test(contentType)) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  return 'other';
}

// Strip path separators / unsafe chars from a user filename so it can't
// escape its directory or break the Storage path.
export function sanitizeFilename(name: string): string {
  const cleaned = (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned.slice(-80) || 'file';
}

// Build a convention-compliant object path: `${dir}/${timestamp}-${name}`.
// Callers pass the surface dir, e.g. `repairs/${taskId}`.
export function buildStoragePath(dir: string, filename: string): string {
  const clean = dir.replace(/\/+$/, '');
  return `${clean}/${Date.now()}-${sanitizeFilename(filename)}`;
}

// Draw an image file onto a canvas at <= MAX_EDGE and re-encode as JPEG.
// Returns a Blob + the derived filename/contentType. GIFs and already-tiny
// images still pass through (re-encode is cheap and normalizes format).
export async function compressImage(file: File): Promise<{ blob: Blob; name: string; contentType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Could not read image file.'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Could not decode image file.'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable — cannot compress image.');
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('Image compression failed.');
  const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
  return { blob, name: `${base}.jpg`, contentType: 'image/jpeg' };
}

export interface UploadOptions {
  onProgress?: (pct: number) => void;
  uploadedBy?: { email: string; name: string };
  phase?: StoredFile['phase'];
  // Skip compression (already a Blob you prepared, or a non-image).
  skipCompression?: boolean;
}

// Compress (if image) → upload with progress → return metadata. `dir` is
// the surface directory (e.g. `repairs/${taskId}`); the timestamped
// filename is appended here so callers don't have to.
export async function uploadFile(dir: string, file: File, opts: UploadOptions = {}): Promise<StoredFile> {
  let body: Blob = file;
  let name = file.name || 'file';
  let contentType = file.type || 'application/octet-stream';

  if (isImage(file) && !opts.skipCompression) {
    const c = await compressImage(file);
    body = c.blob;
    name = c.name;
    contentType = c.contentType;
  }

  const path = buildStoragePath(dir, name);
  const objectRef = ref(storage, path);
  const task = uploadBytesResumable(objectRef, body, { contentType });

  await new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (snap) => {
        if (opts.onProgress && snap.totalBytes > 0) {
          opts.onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        }
      },
      (err) => reject(new Error(`Upload failed: ${err.message || err}`)),
      () => resolve(),
    );
  });

  const url = await getDownloadURL(objectRef);
  const uploadedBy = opts.uploadedBy || {
    email: auth.currentUser?.email || 'unknown',
    name: auth.currentUser?.displayName || auth.currentUser?.email || 'unknown',
  };
  return {
    url,
    path,
    name,
    size: body.size,
    contentType,
    uploadedAt: Date.now(),
    uploadedBy,
    kind: kindOf(contentType),
    phase: opts.phase,
  };
}

// Remove an object from Storage by its stored path. Swallows the
// not-found case (already gone) so metadata cleanup is idempotent; other
// errors propagate so the caller can surface them.
export async function deleteFile(path: string): Promise<void> {
  try {
    await deleteObject(ref(storage, path));
  } catch (err: any) {
    if (err?.code === 'storage/object-not-found') return;
    throw new Error(`Delete failed: ${err?.message || err}`);
  }
}
