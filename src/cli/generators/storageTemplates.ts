import type { StorageProviderId } from '../types/detection';

export function buildStorageAdapterFile(storage: StorageProviderId): {
  relativePath: string;
  content: string;
  description: string;
} {
  if (storage === 's3') {
    return {
      relativePath: 'src/lib/upload-storage.ts',
      description: 'AWS S3 StorageAdapter configuration',
      content: [
        "import { createS3StorageAdapter } from 'img-upload-kit/storage';",
        '',
        'export const uploadStorage = createS3StorageAdapter({',
        "  region: process.env.AWS_REGION ?? 'us-east-1',",
        "  bucket: process.env.AWS_S3_BUCKET ?? '',",
        '  credentials: {',
        "    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',",
        "    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',",
        '  },',
        '});',
        '',
      ].join('\n'),
    };
  }

  if (storage === 'r2') {
    return {
      relativePath: 'src/lib/upload-storage.ts',
      description: 'Cloudflare R2 (S3-compatible) StorageAdapter configuration',
      content: [
        "import { createS3StorageAdapter } from 'img-upload-kit/storage';",
        '',
        "const accountId = process.env.R2_ACCOUNT_ID ?? '';",
        '',
        'export const uploadStorage = createS3StorageAdapter({',
        "  region: 'auto',",
        '  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,',
        "  bucket: process.env.R2_BUCKET ?? '',",
        '  publicBaseUrl: process.env.R2_PUBLIC_URL,',
        '  credentials: {',
        "    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',",
        "    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',",
        '  },',
        '});',
        '',
      ].join('\n'),
    };
  }

  if (storage === 'minio' || storage === 'spaces' || storage === 'b2' || storage === 'custom-s3') {
    const endpointEnv =
      storage === 'minio'
        ? 'MINIO_ENDPOINT'
        : storage === 'spaces'
          ? 'DO_SPACES_ENDPOINT'
          : storage === 'b2'
            ? 'B2_ENDPOINT'
            : 'S3_ENDPOINT';
    const bucketEnv =
      storage === 'minio'
        ? 'MINIO_BUCKET'
        : storage === 'spaces'
          ? 'DO_SPACES_BUCKET'
          : storage === 'b2'
            ? 'B2_BUCKET'
            : 'S3_BUCKET';
    const keyEnv =
      storage === 'minio'
        ? 'MINIO_ACCESS_KEY'
        : storage === 'spaces'
          ? 'DO_SPACES_KEY'
          : storage === 'b2'
            ? 'B2_KEY_ID'
            : 'S3_ACCESS_KEY_ID';
    const secretEnv =
      storage === 'minio'
        ? 'MINIO_SECRET_KEY'
        : storage === 'spaces'
          ? 'DO_SPACES_SECRET'
          : storage === 'b2'
            ? 'B2_APPLICATION_KEY'
            : 'S3_SECRET_ACCESS_KEY';
    return {
      relativePath: 'src/lib/upload-storage.ts',
      description: `${storage} S3-compatible StorageAdapter configuration`,
      content: [
        "import { createS3StorageAdapter } from 'img-upload-kit/storage';",
        '',
        'export const uploadStorage = createS3StorageAdapter({',
        "  region: process.env.S3_REGION ?? 'us-east-1',",
        `  endpoint: process.env.${endpointEnv},`,
        `  bucket: process.env.${bucketEnv} ?? '',`,
        `  forcePathStyle: ${storage === 'minio' ? 'true' : 'false'},`,
        '  credentials: {',
        `    accessKeyId: process.env.${keyEnv} ?? '',`,
        `    secretAccessKey: process.env.${secretEnv} ?? '',`,
        '  },',
        '});',
        '',
      ].join('\n'),
    };
  }

  if (storage === 'supabase') {
    return {
      relativePath: 'src/lib/upload-storage.ts',
      description: 'Supabase StorageAdapter configuration',
      content: [
        "import { createSupabaseStorageAdapter } from 'img-upload-kit/storage';",
        '',
        'export const uploadStorage = createSupabaseStorageAdapter({',
        "  supabaseUrl: process.env.SUPABASE_URL ?? '',",
        "  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',",
        "  bucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'uploads',",
        '});',
        '',
      ].join('\n'),
    };
  }

  if (storage === 'memory') {
    return {
      relativePath: 'src/lib/upload-storage.ts',
      description: 'In-memory StorageAdapter configuration',
      content: [
        "import { createMemoryStorageAdapter } from 'img-upload-kit/storage';",
        '',
        'export const uploadStorage = createMemoryStorageAdapter();',
        '',
      ].join('\n'),
    };
  }

  if (storage === 'gcs' || storage === 'azure-blob' || storage === 'firebase') {
    const sdkName =
      storage === 'gcs'
        ? '@google-cloud/storage'
        : storage === 'azure-blob'
          ? '@azure/storage-blob'
          : 'firebase-admin/storage';
    return {
      relativePath: 'src/lib/upload-storage.ts',
      description: `Custom StorageAdapter scaffold for ${storage}`,
      content: [
        "import type { StorageAdapter, StorageUploadParams, StorageUploadResult } from 'img-upload-kit/storage';",
        '',
        `// Custom StorageAdapter scaffold for ${storage} (${sdkName}).`,
        '// img-upload-kit does not ship a built-in adapter for this provider;',
        '// implement upload() and delete() using your provider SDK.',
        'export const uploadStorage: StorageAdapter = {',
        '  async upload(_params: StorageUploadParams): Promise<StorageUploadResult> {',
        `    throw new Error('Implement ${storage} upload() using ${sdkName}');`,
        '  },',
        '  async delete(_bucket: string, _objectPath: string): Promise<void> {',
        `    throw new Error('Implement ${storage} delete() using ${sdkName}');`,
        '  },',
        '};',
        '',
      ].join('\n'),
    };
  }

  return {
    relativePath: 'src/lib/upload-storage.ts',
    description: 'Local filesystem StorageAdapter configuration',
    content: [
      "import { createLocalFsStorageAdapter } from 'img-upload-kit/storage';",
      '',
      'export const uploadStorage = createLocalFsStorageAdapter({',
      "  rootDir: process.env.UPLOAD_DIR ?? './public/uploads',",
      "  publicBaseUrl: process.env.UPLOAD_PUBLIC_BASE_URL ?? '/uploads',",
      '});',
      '',
    ].join('\n'),
  };
}
