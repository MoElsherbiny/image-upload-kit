import type { StorageProviderId } from '../types/detection';

interface S3TemplateSpec {
  regionExpr: string;
  endpointExpr?: string;
  forcePathStyle?: boolean;
  bucketExpr: string;
  publicBaseUrlExpr: string;
  accessKeyExpr: string;
  secretKeyExpr: string;
  preamble?: string[];
}

function renderS3AdapterContent(spec: S3TemplateSpec): string {
  const clientLines = [
    'const s3 = new S3Client({',
    `  region: ${spec.regionExpr},`,
    ...(spec.endpointExpr ? [`  endpoint: ${spec.endpointExpr},`] : []),
    ...(spec.forcePathStyle !== undefined ? [`  forcePathStyle: ${String(spec.forcePathStyle)},`] : []),
    '  credentials: {',
    `    accessKeyId: ${spec.accessKeyExpr},`,
    `    secretAccessKey: ${spec.secretKeyExpr},`,
    '  },',
    '});',
  ];

  return [
    'import {',
    '  DeleteObjectCommand,',
    '  GetObjectCommand,',
    '  HeadObjectCommand,',
    '  PutObjectCommand,',
    '  S3Client,',
    "} from '@aws-sdk/client-s3';",
    "import { createS3StorageAdapter } from 'img-upload-kit/storage';",
    '',
    ...(spec.preamble ?? []),
    `const defaultBucket = ${spec.bucketExpr};`,
    ...clientLines,
    '',
    'export const uploadStorage = createS3StorageAdapter({',
    `  publicBaseUrl: ${spec.publicBaseUrlExpr},`,
    '  defaultBucket,',
    '  putObject: (input) => s3.send(new PutObjectCommand(input)),',
    '  deleteObject: (input) => s3.send(new DeleteObjectCommand(input)),',
    '  getObject: (input) => s3.send(new GetObjectCommand(input)),',
    '  headObject: (input) => s3.send(new HeadObjectCommand(input)),',
    '});',
    '',
  ].join('\n');
}

export function buildStorageAdapterFile(storage: StorageProviderId): {
  relativePath: string;
  content: string;
  description: string;
} {
  if (storage === 's3') {
    return {
      relativePath: 'src/lib/upload-storage.ts',
      description: 'AWS S3 StorageAdapter configuration',
      content: renderS3AdapterContent({
        preamble: ["const region = process.env.AWS_REGION ?? 'us-east-1';"],
        regionExpr: 'region',
        bucketExpr: "process.env.AWS_S3_BUCKET ?? ''",
        publicBaseUrlExpr:
          'process.env.AWS_S3_PUBLIC_URL ?? `https://${defaultBucket}.s3.${region}.amazonaws.com`',
        accessKeyExpr: "process.env.AWS_ACCESS_KEY_ID ?? ''",
        secretKeyExpr: "process.env.AWS_SECRET_ACCESS_KEY ?? ''",
      }),
    };
  }

  if (storage === 'r2') {
    return {
      relativePath: 'src/lib/upload-storage.ts',
      description: 'Cloudflare R2 (S3-compatible) StorageAdapter configuration',
      content: renderS3AdapterContent({
        preamble: ["const accountId = process.env.R2_ACCOUNT_ID ?? '';"],
        regionExpr: "'auto'",
        endpointExpr: '`https://${accountId}.r2.cloudflarestorage.com`',
        bucketExpr: "process.env.R2_BUCKET ?? ''",
        publicBaseUrlExpr: 'process.env.R2_PUBLIC_URL ?? `https://${accountId}.r2.dev`',
        accessKeyExpr: "process.env.R2_ACCESS_KEY_ID ?? ''",
        secretKeyExpr: "process.env.R2_SECRET_ACCESS_KEY ?? ''",
      }),
    };
  }

  if (storage === 'minio' || storage === 'spaces' || storage === 'b2' || storage === 'custom-s3') {
    const configByProvider = {
      minio: {
        regionExpr: "process.env.S3_REGION ?? 'us-east-1'",
        endpointExpr: "process.env.MINIO_ENDPOINT ?? 'http://localhost:9000'",
        bucketExpr: "process.env.MINIO_BUCKET ?? ''",
        publicBaseUrlExpr:
          "process.env.MINIO_PUBLIC_URL ?? process.env.MINIO_ENDPOINT ?? 'http://localhost:9000'",
        accessKeyExpr: "process.env.MINIO_ACCESS_KEY ?? ''",
        secretKeyExpr: "process.env.MINIO_SECRET_KEY ?? ''",
        forcePathStyle: true,
      },
      spaces: {
        regionExpr: "process.env.DO_SPACES_REGION ?? 'nyc3'",
        endpointExpr: "process.env.DO_SPACES_ENDPOINT ?? ''",
        bucketExpr: "process.env.DO_SPACES_BUCKET ?? ''",
        publicBaseUrlExpr:
          "process.env.DO_SPACES_PUBLIC_URL ?? process.env.DO_SPACES_ENDPOINT ?? ''",
        accessKeyExpr: "process.env.DO_SPACES_KEY ?? ''",
        secretKeyExpr: "process.env.DO_SPACES_SECRET ?? ''",
        forcePathStyle: false,
      },
      b2: {
        regionExpr: "process.env.B2_REGION ?? 'us-west-004'",
        endpointExpr: "process.env.B2_ENDPOINT ?? ''",
        bucketExpr: "process.env.B2_BUCKET ?? ''",
        publicBaseUrlExpr: "process.env.B2_PUBLIC_URL ?? process.env.B2_ENDPOINT ?? ''",
        accessKeyExpr: "process.env.B2_KEY_ID ?? ''",
        secretKeyExpr: "process.env.B2_APPLICATION_KEY ?? ''",
        forcePathStyle: false,
      },
      'custom-s3': {
        regionExpr: "process.env.S3_REGION ?? 'us-east-1'",
        endpointExpr: "process.env.S3_ENDPOINT ?? ''",
        bucketExpr: "process.env.S3_BUCKET ?? ''",
        publicBaseUrlExpr: "process.env.S3_PUBLIC_URL ?? process.env.S3_ENDPOINT ?? ''",
        accessKeyExpr: "process.env.S3_ACCESS_KEY_ID ?? ''",
        secretKeyExpr: "process.env.S3_SECRET_ACCESS_KEY ?? ''",
        forcePathStyle: false,
      },
    }[storage];

    return {
      relativePath: 'src/lib/upload-storage.ts',
      description: `${storage} S3-compatible StorageAdapter configuration`,
      content: renderS3AdapterContent(configByProvider),
    };
  }

  if (storage === 'supabase') {
    return {
      relativePath: 'src/lib/upload-storage.ts',
      description: 'Supabase StorageAdapter configuration',
      content: [
        "import { createClient } from '@supabase/supabase-js';",
        "import { createSupabaseStorageAdapter } from 'img-upload-kit/storage';",
        '',
        'const supabase = createClient(',
        "  process.env.SUPABASE_URL ?? '',",
        "  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',",
        ');',
        '',
        'export const uploadStorage = createSupabaseStorageAdapter(supabase);',
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
      "  baseUrl: process.env.UPLOAD_PUBLIC_BASE_URL ?? '/uploads',",
      '});',
      '',
    ].join('\n'),
  };
}
