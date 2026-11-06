import { moveItem, promoteToCover } from '../../client/reorder';
import type { UploadedImageData } from '../../types';
import type { UploadTranslations } from '../i18n';
import type { ImagePreview } from '../types';
import { collectUploadedData } from './uploadQueue';

export interface ReorderMutationResult {
  next: ImagePreview[];
  uploaded: UploadedImageData[];
  announcement: string;
}

export function reorderPreviewList(
  current: readonly ImagePreview[],
  fromIndex: number,
  toIndex: number,
  ui: Pick<UploadTranslations, 'reorderedAnnouncement'>,
): ReorderMutationResult | null {
  const len = current.length;
  if (len <= 1) return null;
  const clampedFrom = Math.max(0, Math.min(len - 1, Math.trunc(fromIndex)));
  const clampedTo = Math.max(0, Math.min(len - 1, Math.trunc(toIndex)));
  if (clampedFrom === clampedTo) return null;

  const next = moveItem(current, clampedFrom, clampedTo);
  const uploaded = collectUploadedData(next, true);
  const announcement = ui.reorderedAnnouncement
    .replace('{pos}', String(clampedTo + 1))
    .replace('{total}', String(len));

  return { next, uploaded, announcement };
}

export function promotePreviewToCover(
  current: readonly ImagePreview[],
  index: number,
  ui: Pick<UploadTranslations, 'coverSetAnnouncement'>,
): ReorderMutationResult | null {
  const len = current.length;
  if (len <= 1) return null;
  const clamped = Math.max(0, Math.min(len - 1, Math.trunc(index)));
  if (clamped === 0) return null;

  const next = promoteToCover(current, clamped);
  const uploaded = collectUploadedData(next, true);
  const announcement = ui.coverSetAnnouncement.replace('{total}', String(len));

  return { next, uploaded, announcement };
}

export function applyPreviewPatchByIdOrFile(
  current: readonly ImagePreview[],
  uploadId: string | undefined,
  file: File | undefined,
  patch: Partial<ImagePreview>,
  revokePreview: (url: string | null) => void,
): ImagePreview[] {
  return current.map((p) => {
    if (!(uploadId ? p.id === uploadId : p.file === file)) return p;
    if (patch.url && p.url && p.url !== patch.url) revokePreview(p.url);
    return { ...p, ...patch };
  });
}

export function filterRemovedPreviews(
  current: readonly ImagePreview[],
  ids: ReadonlySet<string>,
  abortUpload: (idOrFile: string | File) => void,
  revokePreview: (url: string | null) => void,
  uncommittedIds: Set<string>,
): ImagePreview[] {
  for (const p of current) {
    if (ids.has(p.id)) {
      abortUpload(p.id);
      if (p.file) abortUpload(p.file);
      revokePreview(p.url);
      uncommittedIds.delete(p.id);
    }
  }
  return current.filter((p) => !ids.has(p.id));
}

export function toggleSelectedId(
  prev: ReadonlySet<string>,
  id: string,
): Set<string> {
  const copy = new Set(prev);
  if (copy.has(id)) copy.delete(id);
  else copy.add(id);
  return copy;
}

export function markPreviewsForRetry(
  current: readonly ImagePreview[],
  ids: ReadonlySet<string>,
  retryingLabel: string,
): ImagePreview[] {
  return current.map((p) =>
    ids.has(p.id)
      ? {
          ...p,
          error: undefined,
          isUploading: true,
          progress: 0,
          uploadMessage: retryingLabel,
        }
      : p,
  );
}

let tempIdCounter = 0;

export async function createBatchFilePreviews(
  files: File[],
  createPreview: (file: File) => Promise<string>,
  initialMessage: string,
  failedForTemplate: string,
): Promise<{ items?: ImagePreview[]; error?: string }> {
  const items: ImagePreview[] = [];
  for (const file of files) {
    try {
      const url = await createPreview(file);
      tempIdCounter += 1;
      items.push({
        id: `temp-${Date.now()}-${tempIdCounter}`,
        url,
        file,
        fileName: file.name,
        uploadMessage: initialMessage,
        originalSize: file.size,
        optimizedSize: null,
        isUploading: true,
        progress: 0,
      });
    } catch {
      return { error: failedForTemplate.replace('{file}', file.name) };
    }
  }
  return { items };
}
