export type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type ConfidenceLevel = 'confirmed' | 'likely' | 'possible' | 'unknown';

export type EvidenceLayer = 'frontend' | 'backend' | 'storage' | 'infra';

export interface EvidenceItem {
  signal: string;
  source: string;
  layer: EvidenceLayer;
  detail?: string;
}

export type FrontendFramework =
  | 'nextjs'
  | 'react'
  | 'nuxt'
  | 'vue'
  | 'angular'
  | 'expo'
  | 'react-native'
  | 'vite'
  | 'vanilla'
  | 'none';

export type BackendRuntime =
  | 'nextjs-node'
  | 'node'
  | 'express'
  | 'fastify'
  | 'hono'
  | 'nestjs'
  | 'nuxt-server'
  | 'aws-lambda'
  | 'cloudflare-workers'
  | 'vercel-edge'
  | 'firebase-functions'
  | 'frontend-only'
  | 'none';

export type StorageProviderId =
  | 's3'
  | 'r2'
  | 'supabase'
  | 'minio'
  | 'spaces'
  | 'b2'
  | 'gcs'
  | 'azure-blob'
  | 'firebase'
  | 'local'
  | 'custom-s3'
  | 'memory'
  | 'unknown';

export type CdnProvider = 'cloudfront' | 'cloudflare' | 'supabase' | 'vercel' | 'none';

export type AuthProvider =
  | 'nextauth'
  | 'clerk'
  | 'supabase-auth'
  | 'lucia'
  | 'firebase-auth'
  | 'none';

export type MonorepoTool = 'pnpm' | 'npm' | 'yarn' | 'turbo' | 'nx' | 'none';

export interface LayerDetection<T extends string> {
  detected: T;
  alternatives: T[];
  confidence: ConfidenceLevel;
  evidence: EvidenceItem[];
}

export interface MonorepoInfo {
  isMonorepo: boolean;
  tool: MonorepoTool;
  workspaceRoot?: string;
}

export interface EnvTemplateFileInfo {
  path: string;
  fileName: string;
  keys: string[];
}

export interface ProjectDetectionReport {
  cwd: string;
  packageManager: PackageManagerName;
  hasPackageJson: boolean;
  installedPackages: string[];
  frontend: LayerDetection<FrontendFramework>;
  backend: LayerDetection<BackendRuntime>;
  storage: LayerDetection<StorageProviderId>;
  cdn: LayerDetection<CdnProvider>;
  auth: LayerDetection<AuthProvider>;
  hasDocker: boolean;
  monorepo: MonorepoInfo;
  envFiles: EnvTemplateFileInfo[];
  hasAgentsMd: boolean;
  hasBlurManifest: boolean;
  typescript: boolean;
  ambiguousStorage: StorageProviderId[];
}
