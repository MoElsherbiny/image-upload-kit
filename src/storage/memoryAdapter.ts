import type {
  StorageAdapter,
  StorageFileEntry,
  StorageUploadParams,
  StorageUploadResult,
} from './types';

export interface StoredMemoryObject {
  bucket: string;
  path: string;
  data: Uint8Array;
  contentType: string;
  createdAt: string;
  metadata?: Record<string, string>;
}

export interface MemoryStorageAdapter extends StorageAdapter {
  getObject(bucket: string, path: string): StoredMemoryObject | undefined;
  clear(): void;
  readonly size: number;
}

export interface MemoryStorageOptions {
  baseUrl?: string;
}

export function createMemoryStorageAdapter(
  options: MemoryStorageOptions = {},
): MemoryStorageAdapter {
  const baseUrl = (options.baseUrl || 'https://memory.local/uploads').replace(
    /\/+$/,
    '',
  );
  const store = new Map<string, StoredMemoryObject>();

  const toKey = (bucket: string, path: string) =>
    `${bucket}::${path.replace(/^\/+/, '')}`;

  const getPublicUrl = (bucket: string, path: string): string => {
    const cleanPath = path.replace(/^\/+/, '');
    return `${baseUrl}/${bucket}/${cleanPath}`;
  };

  return {
    async upload(params: StorageUploadParams): Promise<StorageUploadResult> {
      const cleanPath = params.path.replace(/^\/+/, '');
      const key = toKey(params.bucket, cleanPath);

      if (params.upsert === false && store.has(key)) {
        throw new Error(`Object already exists at ${params.bucket}/${cleanPath}`);
      }

      store.set(key, {
        bucket: params.bucket,
        path: cleanPath,
        data: new Uint8Array(params.data),
        contentType: params.contentType,
        createdAt: new Date().toISOString(),
        metadata: params.metadata,
      });

      return {
        bucket: params.bucket,
        path: cleanPath,
        url: getPublicUrl(params.bucket, cleanPath),
      };
    },

    async delete(bucket: string, path: string): Promise<void> {
      const key = toKey(bucket, path);
      store.delete(key);
    },

    getPublicUrl,

    async list(bucket: string, folder?: string): Promise<StorageFileEntry[]> {
      const cleanFolder = folder ? folder.replace(/^\/+|\/+$/g, '') : '';
      const entries: StorageFileEntry[] = [];

      for (const obj of store.values()) {
        if (obj.bucket !== bucket) continue;
        if (cleanFolder && !obj.path.startsWith(`${cleanFolder}/`)) continue;
        const name = cleanFolder
          ? obj.path.slice(cleanFolder.length + 1)
          : obj.path;
        entries.push({
          name,
          id: `${obj.bucket}/${obj.path}`,
          createdAt: obj.createdAt,
          size: obj.data.byteLength,
        });
      }

      return entries;
    },

    async deleteByUrl(url: string): Promise<boolean> {
      const prefix = `${baseUrl}/`;
      if (!url.startsWith(prefix)) return false;
      const rest = url.slice(prefix.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx === -1) return false;
      const bucket = rest.slice(0, slashIdx);
      const filePath = rest.slice(slashIdx + 1);
      const key = toKey(bucket, filePath);
      return store.delete(key);
    },

    getObject(bucket: string, path: string): StoredMemoryObject | undefined {
      return store.get(toKey(bucket, path));
    },

    clear(): void {
      store.clear();
    },

    get size(): number {
      return store.size;
    },
  };
}
