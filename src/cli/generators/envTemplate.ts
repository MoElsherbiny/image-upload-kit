import type { EnvEntrySpec } from '../filesystem/envManager';
import type { ArchitectureRecommendation } from '../types/architecture';
import type { StorageProviderId } from '../types/detection';

const STORAGE_ENV_SPECS: Readonly<Record<StorageProviderId, readonly EnvEntrySpec[]>> = {
  local: [
    { key: 'UPLOAD_DIR', placeholder: './public/uploads', comment: 'Local upload directory' },
    { key: 'UPLOAD_PUBLIC_BASE_URL', placeholder: '/uploads', comment: 'Public URL prefix for local uploads' },
  ],
  s3: [
    { key: 'AWS_REGION', placeholder: 'us-east-1', serverOnly: true },
    { key: 'AWS_S3_BUCKET', placeholder: 'my-app-uploads', serverOnly: true },
    { key: 'AWS_ACCESS_KEY_ID', placeholder: 'your-aws-access-key-id', serverOnly: true },
    { key: 'AWS_SECRET_ACCESS_KEY', placeholder: 'your-aws-secret-access-key', serverOnly: true },
  ],
  r2: [
    { key: 'R2_ACCOUNT_ID', placeholder: 'your-cloudflare-account-id', serverOnly: true },
    { key: 'R2_BUCKET', placeholder: 'my-r2-bucket', serverOnly: true },
    { key: 'R2_ACCESS_KEY_ID', placeholder: 'your-r2-access-key-id', serverOnly: true },
    { key: 'R2_SECRET_ACCESS_KEY', placeholder: 'your-r2-secret-access-key', serverOnly: true },
    { key: 'R2_PUBLIC_URL', placeholder: 'https://cdn.example.com' },
  ],
  supabase: [
    { key: 'SUPABASE_URL', placeholder: 'https://your-project.supabase.co' },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', placeholder: 'your-supabase-service-role-key', serverOnly: true },
    { key: 'SUPABASE_STORAGE_BUCKET', placeholder: 'uploads', serverOnly: true },
  ],
  minio: [
    { key: 'MINIO_ENDPOINT', placeholder: 'http://localhost:9000', serverOnly: true },
    { key: 'MINIO_BUCKET', placeholder: 'uploads', serverOnly: true },
    { key: 'MINIO_ACCESS_KEY', placeholder: 'minioadmin', serverOnly: true },
    { key: 'MINIO_SECRET_KEY', placeholder: 'change-me-in-production', serverOnly: true },
  ],
  spaces: [
    { key: 'DO_SPACES_REGION', placeholder: 'nyc3', serverOnly: true },
    { key: 'DO_SPACES_ENDPOINT', placeholder: 'https://nyc3.digitaloceanspaces.com', serverOnly: true },
    { key: 'DO_SPACES_BUCKET', placeholder: 'my-space', serverOnly: true },
    { key: 'DO_SPACES_KEY', placeholder: 'your-spaces-key', serverOnly: true },
    { key: 'DO_SPACES_SECRET', placeholder: 'your-spaces-secret', serverOnly: true },
  ],
  b2: [
    { key: 'B2_REGION', placeholder: 'us-west-004', serverOnly: true },
    { key: 'B2_ENDPOINT', placeholder: 'https://s3.us-west-004.backblazeb2.com', serverOnly: true },
    { key: 'B2_BUCKET', placeholder: 'my-b2-bucket', serverOnly: true },
    { key: 'B2_KEY_ID', placeholder: 'your-b2-key-id', serverOnly: true },
    { key: 'B2_APPLICATION_KEY', placeholder: 'your-b2-application-key', serverOnly: true },
  ],
  'custom-s3': [
    { key: 'S3_ENDPOINT', placeholder: 'https://s3.example.com', serverOnly: true },
    { key: 'S3_REGION', placeholder: 'us-east-1', serverOnly: true },
    { key: 'S3_BUCKET', placeholder: 'uploads', serverOnly: true },
    { key: 'S3_ACCESS_KEY_ID', placeholder: 'your-s3-access-key-id', serverOnly: true },
    { key: 'S3_SECRET_ACCESS_KEY', placeholder: 'your-s3-secret-access-key', serverOnly: true },
  ],
  gcs: [
    { key: 'GCS_PROJECT_ID', placeholder: 'my-gcp-project', serverOnly: true },
    { key: 'GCS_BUCKET', placeholder: 'my-gcs-bucket', serverOnly: true },
    { key: 'GOOGLE_APPLICATION_CREDENTIALS', placeholder: './service-account.json', serverOnly: true },
  ],
  'azure-blob': [
    { key: 'AZURE_STORAGE_CONNECTION_STRING', placeholder: 'DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;', serverOnly: true },
    { key: 'AZURE_STORAGE_CONTAINER', placeholder: 'uploads', serverOnly: true },
  ],
  firebase: [
    { key: 'FIREBASE_PROJECT_ID', placeholder: 'my-firebase-project', serverOnly: true },
    { key: 'FIREBASE_STORAGE_BUCKET', placeholder: 'my-firebase-project.appspot.com', serverOnly: true },
    { key: 'GOOGLE_APPLICATION_CREDENTIALS', placeholder: './firebase-admin.json', serverOnly: true },
  ],
  memory: [],
  unknown: [],
};

export function buildEnvEntriesForRecommendation(
  recommendation: ArchitectureRecommendation,
): EnvEntrySpec[] {
  const entries: EnvEntrySpec[] = [];

  if (recommendation.backend === 'frontend-only') {
    const publicPrefix =
      recommendation.frontend === 'expo' || recommendation.frontend === 'react-native'
        ? 'EXPO_PUBLIC_'
        : recommendation.frontend === 'nextjs'
          ? 'NEXT_PUBLIC_'
          : 'VITE_';
    entries.push({
      key: `${publicPrefix}UPLOAD_ENDPOINT`,
      placeholder: 'https://api.example.com/api/upload',
      comment: 'Public URL of your Node.js image upload backend (never put secrets here)',
    });
    return entries;
  }

  for (const spec of STORAGE_ENV_SPECS[recommendation.storage] ?? []) {
    entries.push({ ...spec });
  }
  return entries;
}
