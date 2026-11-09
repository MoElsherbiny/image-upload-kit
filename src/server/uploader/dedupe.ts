import type { UploadedImageData } from '../../types';

export interface DedupeStore {
  get(key: string): Promise<UploadedImageData | null>;
  set(key: string, data: UploadedImageData): Promise<void>;
  delete?(key: string): Promise<void>;
  deleteByUrl?(url: string): Promise<void>;
}

export type ImageDedupeStore = DedupeStore;

export type DeduplicateOptions =
  | {
      store?: DedupeStore;
      verifyExists?: boolean;
      enabled?: boolean;
    }
  | boolean;

const CANONICAL_SETTING_KEYS = [
  'bucket',
  'folder',
  'preset',
  'maxDimensions',
  'aspectRatio',
  'crop',
  'outputFormat',
  'quality',
  'variantWidths',
  'includeBlurHash',
  'customFilename',
] as const;

export async function computeSha256Hex(buffer: Uint8Array): Promise<string> {
  const view =
    buffer.buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new Uint8Array(buffer);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', view);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function canonicalizeValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const out: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) {
      out[key] = canonicalizeValue(v);
    }
  }
  return out;
}

/**
 * Computes a deterministic deduplication key from the raw image bytes and
 * canonicalized upload/optimization settings.
 */
export async function computeDedupeKey(
  buffer: Buffer | Uint8Array,
  settings: Record<string, unknown>,
  precomputedBufferHash?: string,
): Promise<string> {
  const picked: Record<string, unknown> = {};
  for (const key of CANONICAL_SETTING_KEYS) {
    if (settings[key] !== undefined) {
      picked[key] =
        key === 'variantWidths' && Array.isArray(settings[key])
          ? [...new Set((settings[key] as number[]).map((n) => Math.floor(n)))].sort(
              (a, b) => a - b,
            )
          : settings[key];
    }
  }
  for (const key of Object.keys(settings).sort()) {
    if (!(key in picked) && settings[key] !== undefined) {
      picked[key] = settings[key];
    }
  }

  const canonicalJson = JSON.stringify(canonicalizeValue(picked));
  const [bufferHash, settingsHash] = await Promise.all([
    precomputedBufferHash ?? computeSha256Hex(buffer),
    computeSha256Hex(new TextEncoder().encode(canonicalJson)),
  ]);

  return `${bufferHash}:${settingsHash}`;
}

function cloneUploadedData(data: UploadedImageData): UploadedImageData {
  return {
    ...data,
    ...(data.metadata ? { metadata: { ...data.metadata } } : {}),
    ...(data.variants ? { variants: data.variants.map((v) => ({ ...v })) } : {}),
  };
}

/**
 * Creates a bounded in-memory LRU `DedupeStore` with reverse indexes on `url`
 * and `storagePath` so deletions evict cached deduplication entries.
 */
export function createMemoryDedupeStore(options?: {
  maxEntries?: number;
}): DedupeStore {
  const maxEntries = Math.max(1, options?.maxEntries ?? 500);
  const entries = new Map<string, UploadedImageData>();
  const urlToKeys = new Map<string, Set<string>>();
  const pathToKeys = new Map<string, Set<string>>();

  const addReverseIndex = (
    index: Map<string, Set<string>>,
    lookup: string | undefined,
    dedupeKey: string,
  ) => {
    if (!lookup) return;
    let set = index.get(lookup);
    if (!set) {
      set = new Set<string>();
      index.set(lookup, set);
    }
    set.add(dedupeKey);
  };

  const removeReverseIndex = (
    index: Map<string, Set<string>>,
    lookup: string | undefined,
    dedupeKey: string,
  ) => {
    if (!lookup) return;
    const set = index.get(lookup);
    if (!set) return;
    set.delete(dedupeKey);
    if (set.size === 0) index.delete(lookup);
  };

  const removeKey = (dedupeKey: string) => {
    const existing = entries.get(dedupeKey);
    if (!existing) return;
    entries.delete(dedupeKey);
    removeReverseIndex(urlToKeys, existing.url, dedupeKey);
    if (existing.storagePath) {
      const cleanPath = existing.storagePath.replace(/^\/+/, '');
      removeReverseIndex(pathToKeys, cleanPath, dedupeKey);
      if (existing.bucket) {
        removeReverseIndex(pathToKeys, `${existing.bucket}:${cleanPath}`, dedupeKey);
      }
    }
  };

  return {
    async get(key: string): Promise<UploadedImageData | null> {
      const hit = entries.get(key);
      if (!hit) return null;
      // Refresh LRU position
      entries.delete(key);
      entries.set(key, hit);
      return cloneUploadedData(hit);
    },

    async set(key: string, data: UploadedImageData): Promise<void> {
      if (entries.has(key)) {
        removeKey(key);
      } else if (entries.size >= maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) {
          removeKey(oldestKey);
        }
      }

      const stored = cloneUploadedData(data);
      entries.set(key, stored);
      addReverseIndex(urlToKeys, stored.url, key);
      if (stored.storagePath) {
        const cleanPath = stored.storagePath.replace(/^\/+/, '');
        addReverseIndex(pathToKeys, cleanPath, key);
        if (stored.bucket) {
          addReverseIndex(pathToKeys, `${stored.bucket}:${cleanPath}`, key);
        }
      }
    },

    async delete(keyOrPath: string): Promise<void> {
      if (entries.has(keyOrPath)) {
        removeKey(keyOrPath);
      }
      const clean = keyOrPath.replace(/^\/+/, '');
      const byPath = pathToKeys.get(clean) ?? pathToKeys.get(keyOrPath);
      if (byPath) {
        for (const k of [...byPath]) {
          removeKey(k);
        }
      }
    },

    async deleteByUrl(url: string): Promise<void> {
      const byUrl = urlToKeys.get(url);
      if (byUrl) {
        for (const k of [...byUrl]) {
          removeKey(k);
        }
      }
    },
  };
}
