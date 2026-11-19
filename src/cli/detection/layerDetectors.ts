import type {
  AuthProvider,
  BackendRuntime,
  CdnProvider,
  ConfidenceLevel,
  EvidenceItem,
  FrontendFramework,
  LayerDetection,
  StorageProviderId,
} from '../types/detection';

export interface DetectionSignals {
  packages: ReadonlySet<string>;
  files: ReadonlySet<string>;
  envKeys: ReadonlySet<string>;
}

function hasAnyKey(keys: ReadonlySet<string>, prefixes: readonly string[]): string | null {
  for (const key of keys) {
    for (const prefix of prefixes) {
      if (key === prefix || key.startsWith(prefix)) return key;
    }
  }
  return null;
}

export function detectFrontendLayer(s: DetectionSignals): LayerDetection<FrontendFramework> {
  const evidence: EvidenceItem[] = [];
  const matches: FrontendFramework[] = [];
  const add = (fw: FrontendFramework, signal: string, source: string) => {
    if (!matches.includes(fw)) matches.push(fw);
    evidence.push({ signal, source, layer: 'frontend' });
  };

  if (s.packages.has('expo') || s.files.has('app.json') && s.packages.has('react-native')) {
    add('expo', 'expo', 'package.json');
  }
  if (s.packages.has('react-native')) add('react-native', 'react-native', 'package.json');
  if (s.packages.has('next') || s.files.has('next.config.ts') || s.files.has('next.config.mjs') || s.files.has('next.config.js')) {
    add('nextjs', 'next', s.packages.has('next') ? 'package.json' : 'next.config');
  }
  if (s.packages.has('nuxt') || s.files.has('nuxt.config.ts') || s.files.has('nuxt.config.js')) {
    add('nuxt', 'nuxt', s.packages.has('nuxt') ? 'package.json' : 'nuxt.config');
  }
  if (s.packages.has('@angular/core') || s.files.has('angular.json')) {
    add('angular', '@angular/core', s.packages.has('@angular/core') ? 'package.json' : 'angular.json');
  }
  if (s.packages.has('vue')) add('vue', 'vue', 'package.json');
  if (s.packages.has('react')) add('react', 'react', 'package.json');
  if (s.packages.has('vite') || s.files.has('vite.config.ts') || s.files.has('vite.config.js')) {
    add('vite', 'vite', s.packages.has('vite') ? 'package.json' : 'vite.config');
  }

  if (matches.length === 0) {
    return { detected: 'none', alternatives: [], confidence: 'unknown', evidence };
  }
  const detected = matches[0];
  const confidence: ConfidenceLevel = evidence.length > 0 ? 'confirmed' : 'possible';
  return { detected, alternatives: matches.slice(1), confidence, evidence };
}

export function detectBackendLayer(
  s: DetectionSignals,
  frontend: FrontendFramework,
): LayerDetection<BackendRuntime> {
  const evidence: EvidenceItem[] = [];
  const matches: BackendRuntime[] = [];
  const add = (rt: BackendRuntime, signal: string, source: string) => {
    if (!matches.includes(rt)) matches.push(rt);
    evidence.push({ signal, source, layer: 'backend' });
  };

  if (
    s.files.has('wrangler.toml') ||
    s.files.has('wrangler.json') ||
    s.files.has('wrangler.jsonc') ||
    s.packages.has('wrangler') ||
    s.packages.has('@cloudflare/workers-types')
  ) {
    add('cloudflare-workers', 'wrangler/workers', 'config/package.json');
  }
  if (s.packages.has('@nestjs/core')) add('nestjs', '@nestjs/core', 'package.json');
  if (s.packages.has('express')) add('express', 'express', 'package.json');
  if (s.packages.has('fastify')) add('fastify', 'fastify', 'package.json');
  if (s.packages.has('hono')) add('hono', 'hono', 'package.json');
  if (s.packages.has('@vercel/edge') || s.packages.has('edge-runtime')) {
    add('vercel-edge', 'vercel-edge', 'package.json');
  }
  if (s.packages.has('aws-lambda') || s.packages.has('@types/aws-lambda') || s.files.has('serverless.yml') || s.files.has('template.yaml')) {
    add('aws-lambda', 'aws-lambda', 'package.json/config');
  }
  if (s.packages.has('firebase-functions') || (s.files.has('firebase.json') && s.packages.has('firebase-admin'))) {
    add('firebase-functions', 'firebase-functions', 'package.json/firebase.json');
  }
  if (frontend === 'nextjs') add('nextjs-node', 'next', 'package.json');
  if (frontend === 'nuxt') add('nuxt-server', 'nuxt', 'package.json');

  if (matches.length > 0) {
    return {
      detected: matches[0],
      alternatives: matches.slice(1),
      confidence: 'confirmed',
      evidence,
    };
  }

  if (
    frontend === 'vite' ||
    frontend === 'react' ||
    frontend === 'vue' ||
    frontend === 'angular' ||
    frontend === 'expo' ||
    frontend === 'react-native'
  ) {
    evidence.push({ signal: frontend, source: 'frontend-without-server', layer: 'backend' });
    return { detected: 'frontend-only', alternatives: ['node'], confidence: 'likely', evidence };
  }

  if (s.packages.has('img-upload-kit') || s.packages.has('sharp')) {
    evidence.push({ signal: 'node-packages', source: 'package.json', layer: 'backend' });
    return { detected: 'node', alternatives: [], confidence: 'possible', evidence };
  }

  return { detected: 'none', alternatives: [], confidence: 'unknown', evidence };
}

export function detectStorageLayer(
  s: DetectionSignals,
): { layer: LayerDetection<StorageProviderId>; ambiguous: StorageProviderId[] } {
  const evidence: EvidenceItem[] = [];
  const matches: StorageProviderId[] = [];
  const add = (id: StorageProviderId, signal: string, source: string) => {
    if (!matches.includes(id)) matches.push(id);
    evidence.push({ signal, source, layer: 'storage' });
  };

  const r2Key = hasAnyKey(s.envKeys, ['R2_', 'CLOUDFLARE_R2_']);
  if (r2Key) add('r2', r2Key, 'env-template');

  const minioKey = hasAnyKey(s.envKeys, ['MINIO_']);
  if (s.packages.has('minio') || minioKey) {
    add('minio', minioKey ?? 'minio', minioKey ? 'env-template' : 'package.json');
  }

  const spacesKey = hasAnyKey(s.envKeys, ['DO_SPACES_', 'SPACES_']);
  if (spacesKey) add('spaces', spacesKey, 'env-template');

  const b2Key = hasAnyKey(s.envKeys, ['B2_', 'BACKBLAZE_']);
  if (b2Key) add('b2', b2Key, 'env-template');

  const customS3Key = hasAnyKey(s.envKeys, ['S3_ENDPOINT']);
  if (customS3Key && !matches.includes('r2') && !matches.includes('minio') && !matches.includes('spaces') && !matches.includes('b2')) {
    add('custom-s3', customS3Key, 'env-template');
  }

  const supabaseKey = hasAnyKey(s.envKeys, ['SUPABASE_']);
  if (s.packages.has('@supabase/supabase-js') || supabaseKey) {
    add('supabase', supabaseKey ?? '@supabase/supabase-js', supabaseKey ? 'env-template' : 'package.json');
  }

  const gcsKey = hasAnyKey(s.envKeys, ['GCS_', 'GOOGLE_CLOUD_STORAGE']);
  if (s.packages.has('@google-cloud/storage') || gcsKey) {
    add('gcs', gcsKey ?? '@google-cloud/storage', gcsKey ? 'env-template' : 'package.json');
  }

  const azureKey = hasAnyKey(s.envKeys, ['AZURE_STORAGE_']);
  if (s.packages.has('@azure/storage-blob') || azureKey) {
    add('azure-blob', azureKey ?? '@azure/storage-blob', azureKey ? 'env-template' : 'package.json');
  }

  const firebaseKey = hasAnyKey(s.envKeys, ['FIREBASE_STORAGE_']);
  if (s.packages.has('firebase-admin') || s.packages.has('firebase') || s.files.has('firebase.json') || firebaseKey) {
    add('firebase', firebaseKey ?? 'firebase', firebaseKey ? 'env-template' : 'package.json/config');
  }

  const awsKey = hasAnyKey(s.envKeys, ['AWS_S3_', 'AWS_BUCKET', 'AWS_ACCESS_KEY_ID']);
  if ((s.packages.has('@aws-sdk/client-s3') || awsKey) && !matches.some((m) => ['r2', 'minio', 'spaces', 'b2', 'custom-s3'].includes(m))) {
    add('s3', awsKey ?? '@aws-sdk/client-s3', awsKey ? 'env-template' : 'package.json');
  }

  const localKey = hasAnyKey(s.envKeys, ['UPLOAD_DIR']);
  if (localKey) add('local', localKey, 'env-template');

  if (matches.length === 0) {
    return {
      layer: { detected: 'unknown', alternatives: ['local', 's3', 'r2', 'supabase'], confidence: 'unknown', evidence },
      ambiguous: [],
    };
  }

  const ambiguous = matches.length > 1 ? [...matches] : [];
  const confidence: ConfidenceLevel = matches.length === 1 ? 'confirmed' : 'likely';
  return {
    layer: { detected: matches[0], alternatives: matches.slice(1), confidence, evidence },
    ambiguous,
  };
}

export function detectCdnAndAuth(s: DetectionSignals): {
  cdn: LayerDetection<CdnProvider>;
  auth: LayerDetection<AuthProvider>;
} {
  const cdnEvidence: EvidenceItem[] = [];
  const cdnMatches: CdnProvider[] = [];
  if (hasAnyKey(s.envKeys, ['CLOUDFRONT_']) || s.packages.has('@aws-sdk/cloudfront-signer')) {
    cdnMatches.push('cloudfront');
    cdnEvidence.push({ signal: 'cloudfront', source: 'env/package.json', layer: 'infra' });
  }
  if (hasAnyKey(s.envKeys, ['CLOUDFLARE_', 'R2_PUBLIC_URL']) || s.files.has('wrangler.toml')) {
    cdnMatches.push('cloudflare');
    cdnEvidence.push({ signal: 'cloudflare', source: 'env/config', layer: 'infra' });
  }
  if (s.packages.has('@supabase/supabase-js') || hasAnyKey(s.envKeys, ['SUPABASE_URL'])) {
    cdnMatches.push('supabase');
    cdnEvidence.push({ signal: 'supabase', source: 'env/package.json', layer: 'infra' });
  }

  const authEvidence: EvidenceItem[] = [];
  const authMatches: AuthProvider[] = [];
  if (s.packages.has('next-auth') || s.packages.has('@auth/core')) {
    authMatches.push('nextauth');
    authEvidence.push({ signal: 'next-auth', source: 'package.json', layer: 'infra' });
  }
  if (s.packages.has('@clerk/nextjs') || s.packages.has('@clerk/clerk-react') || s.packages.has('@clerk/backend')) {
    authMatches.push('clerk');
    authEvidence.push({ signal: 'clerk', source: 'package.json', layer: 'infra' });
  }
  if (s.packages.has('@supabase/ssr') || s.packages.has('@supabase/auth-helpers-nextjs')) {
    authMatches.push('supabase-auth');
    authEvidence.push({ signal: 'supabase-auth', source: 'package.json', layer: 'infra' });
  }
  if (s.packages.has('lucia')) {
    authMatches.push('lucia');
    authEvidence.push({ signal: 'lucia', source: 'package.json', layer: 'infra' });
  }
  if (s.packages.has('firebase-admin') || s.packages.has('firebase')) {
    authMatches.push('firebase-auth');
    authEvidence.push({ signal: 'firebase-auth', source: 'package.json', layer: 'infra' });
  }

  return {
    cdn: {
      detected: cdnMatches[0] ?? 'none',
      alternatives: cdnMatches.slice(1),
      confidence: cdnMatches.length > 0 ? 'likely' : 'unknown',
      evidence: cdnEvidence,
    },
    auth: {
      detected: authMatches[0] ?? 'none',
      alternatives: authMatches.slice(1),
      confidence: authMatches.length > 0 ? 'confirmed' : 'unknown',
      evidence: authEvidence,
    },
  };
}
