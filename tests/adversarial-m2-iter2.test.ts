import { describe, expect, it, vi } from 'vitest';
import type { UploadItem } from '../src/react/components/UploadProgressPanel';
import type { ImagePreview } from '../src/react/types';
import type { UploadedImageData } from '../src/types';

function makeImage(id: string, url: string): UploadedImageData {
  return {
    url,
    blurDataUrl: 'data:image/webp;base64,placeholder',
    blurColor: '#4F46E5',
    altText: `Alt for ${id}`,
    width: 800,
    height: 600,
    format: 'webp',
    size: 24000,
    originalSize: 80000,
    contentHash: `hash-${id}`,
    uploadedAt: '2026-01-01T00:00:00.000Z',
  };
}

function collectUploadedData(list: ImagePreview[], readyOnly: boolean): UploadedImageData[] {
  return list
    .filter((p) => p.data && (!readyOnly || !p.isUploading))
    .map((p) => ({
      ...p.data!,
      altText: p.altText ?? p.data!.altText,
      blurColor: p.blurColor ?? p.data!.blurColor,
    }));
}

describe('Adversarial Challenge: useMultiImageState Concurrency & previewsRef', () => {
  it('handles rapid sequential removals synchronously via previewsRef without state tearing', () => {
    const img1 = makeImage('1', 'https://example.com/1.jpg');
    const img2 = makeImage('2', 'https://example.com/2.jpg');
    const img3 = makeImage('3', 'https://example.com/3.jpg');
    const img4 = makeImage('4', 'https://example.com/4.jpg');
    const img5 = makeImage('5', 'https://example.com/5.jpg');

    const emittedChanges: UploadedImageData[][] = [];
    const onChange = (data: UploadedImageData[]) => emittedChanges.push(data);

    let previews: ImagePreview[] = [img1, img2, img3, img4, img5].map((img) => ({
      id: img.url, url: img.url, file: null, data: { ...img },
      altText: img.altText, blurColor: img.blurColor, isUploading: false,
    }));
    const previewsRef = { current: previews };

    const emitImmediateChange = (next: ImagePreview[]) => onChange(collectUploadedData(next, true));

    const removeIds = (ids: Set<string>) => {
      const next = previewsRef.current.filter((p) => !ids.has(p.id));
      previewsRef.current = next;
      previews = next;
      emitImmediateChange(next);
    };

    const handleRemove = (id: string) => removeIds(new Set([id]));

    // Sequential rapid removals
    handleRemove(img1.url);
    handleRemove(img2.url);
    handleRemove(img4.url);

    expect(previews).toHaveLength(2);
    expect(previews.map((p) => p.id)).toEqual([img3.url, img5.url]);
    expect(previewsRef.current).toHaveLength(2);
    expect(emittedChanges).toHaveLength(3);
    expect(emittedChanges[2].map((d) => d.url)).toEqual([img3.url, img5.url]);
  });

  it('guarantees in-flight upload completions do not revive removed items', () => {
    const imgExisting = makeImage('E', 'https://example.com/existing.jpg');
    const emittedChanges: UploadedImageData[][] = [];
    const onChange = (data: UploadedImageData[]) => emittedChanges.push(data);

    let previews: ImagePreview[] = [{
      id: imgExisting.url, url: imgExisting.url, file: null, data: { ...imgExisting },
      altText: imgExisting.altText, blurColor: imgExisting.blurColor, isUploading: false,
    }];
    const previewsRef = { current: previews };

    const emitImmediateChange = (next: ImagePreview[]) => onChange(collectUploadedData(next, true));

    const patchByFile = (file: File | undefined, patch: Partial<ImagePreview>, emit = false) => {
      const next = previewsRef.current.map((p) => (p.file === file ? { ...p, ...patch } : p));
      previewsRef.current = next;
      previews = next;
      if (emit) emitImmediateChange(next);
    };

    const removeIds = (ids: Set<string>) => {
      const next = previewsRef.current.filter((p) => !ids.has(p.id));
      previewsRef.current = next;
      previews = next;
      emitImmediateChange(next);
    };

    const fileA = { name: 'fileA.jpg', size: 1000 } as File;
    const fileB = { name: 'fileB.jpg', size: 2000 } as File;

    const newBatch: ImagePreview[] = [
      { id: 'temp-A', url: 'blob:A', file: fileA, isUploading: true, progress: 10 },
      { id: 'temp-B', url: 'blob:B', file: fileB, isUploading: true, progress: 10 },
    ];
    previewsRef.current = [...previewsRef.current, ...newBatch];
    previews = previewsRef.current;

    // User removes existing image while uploads are running
    removeIds(new Set([imgExisting.url]));

    // Upload A completes
    const dataA = makeImage('A', 'https://example.com/A.jpg');
    patchByFile(fileA, { url: dataA.url, data: dataA, isUploading: false, progress: 100 }, true);

    // Upload B completes
    const dataB = makeImage('B', 'https://example.com/B.jpg');
    patchByFile(fileB, { url: dataB.url, data: dataB, isUploading: false, progress: 100 }, true);

    expect(previews).toHaveLength(2);
    expect(previews.some((p) => p.id === imgExisting.url)).toBe(false);
    expect(emittedChanges[1].map((d) => d.url)).toEqual([dataA.url]);
    expect(emittedChanges[2].map((d) => d.url)).toEqual([dataA.url, dataB.url]);
  });
});

describe('Adversarial Challenge: MultiImageUpload Batch Interruption & Leakage', () => {
  function createDockRetentionSimulator() {
    let retainedItems: UploadItem[] | null = null;
    const activeBatch = new Map<string, UploadItem>();
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;
    let prevUploadingCount = 0;

    const runEffect = (
      uploadingPreviews: Array<{ id: string; url: string; fileName?: string; progress?: number; uploadMessage?: string }>,
      previews: Array<{ id: string; url: string; fileName?: string; progress?: number; uploadMessage?: string; error?: string }>,
    ) => {
      const isUploading = uploadingPreviews.length > 0;
      if (isUploading) {
        if (dismissTimer) {
          clearTimeout(dismissTimer);
          dismissTimer = null;
          activeBatch.clear();
        }
        retainedItems = null;
        for (const p of uploadingPreviews) {
          activeBatch.set(p.id, {
            id: p.id, url: p.url, fileName: p.fileName, message: p.uploadMessage, progress: p.progress,
          });
        }
      } else if (prevUploadingCount > 0 && activeBatch.size > 0) {
        const completed: UploadItem[] = Array.from(activeBatch.values()).map((it) => {
          const found = previews.find((p) => p.id === it.id);
          return {
            ...it,
            progress: found?.progress ?? 100,
            message: found?.error ? found.error : (found?.uploadMessage || undefined),
          };
        });
        retainedItems = completed;
        dismissTimer = setTimeout(() => {
          retainedItems = null;
          activeBatch.clear();
          dismissTimer = null;
        }, 2500);
      }
      prevUploadingCount = uploadingPreviews.length;
    };

    return {
      runEffect,
      getRetainedItems: () => retainedItems,
      getActiveBatchIds: () => Array.from(activeBatch.keys()),
      isTimerActive: () => dismissTimer !== null,
    };
  }

  it('completely purges Batch 1 when Batch 2 starts within 2500ms retention window', () => {
    vi.useFakeTimers();
    const sim = createDockRetentionSimulator();

    // 1. Batch 1 uploads and completes
    const b1Uploading = [{ id: 'b1-file', url: 'blob:1', fileName: '1.jpg', progress: 50 }];
    sim.runEffect(b1Uploading, b1Uploading);
    sim.runEffect([], [{ id: 'b1-file', url: 'https://cdn.example.com/1.jpg', progress: 100 }]);

    expect(sim.isTimerActive()).toBe(true);
    expect(sim.getRetainedItems()).toHaveLength(1);
    expect(sim.getRetainedItems()![0].id).toBe('b1-file');

    // 2. Advance 1000ms (< 2500ms)
    vi.advanceTimersByTime(1000);
    expect(sim.isTimerActive()).toBe(true);

    // 3. Batch 2 starts: timer cancelled, activeBatch cleared
    const b2Uploading = [{ id: 'b2-file', url: 'blob:2', fileName: '2.jpg', progress: 10 }];
    sim.runEffect(b2Uploading, b2Uploading);

    expect(sim.isTimerActive()).toBe(false);
    expect(sim.getRetainedItems()).toBeNull();
    expect(sim.getActiveBatchIds()).toEqual(['b2-file']);

    // 4. Batch 2 completes: retainedItems must contain ONLY b2-file
    sim.runEffect([], [{ id: 'b2-file', url: 'https://cdn.example.com/2.jpg', progress: 100 }]);

    const retained = sim.getRetainedItems();
    expect(retained).toHaveLength(1);
    expect(retained![0].id).toBe('b2-file');
    expect(retained!.some((it) => it.id === 'b1-file')).toBe(false);

    vi.useRealTimers();
  });
});
