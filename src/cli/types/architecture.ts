import type {
  BackendRuntime,
  FrontendFramework,
  PackageManagerName,
  StorageProviderId,
} from './detection';

export type StorageSupportLevel =
  | 'native'
  | 'verified-s3-compatible'
  | 'custom-adapter-required';

export interface StorageProviderCapability {
  id: StorageProviderId;
  displayName: string;
  supportLevel: StorageSupportLevel;
  nativeAdapterAvailable: boolean;
  requiresCustomAdapter: boolean;
  supportsPrivateObjects: boolean;
  supportsSignedUploads: boolean;
  supportsSignedDownloads: boolean;
  supportsDeletion: boolean;
  supportsMultipartUploads: boolean;
  requiredDependencies: readonly string[];
  requiredEnvironmentVariables: readonly string[];
  compatibilityNotes: string;
}

export interface RuntimeCapability {
  id: BackendRuntime;
  displayName: string;
  supportsSharp: boolean;
  supportsNodeFs: boolean;
  supportsWebFetch: boolean;
  recommendedHandlerEntry: 'img-upload-kit/server' | 'img-upload-kit/server/handler' | 'none';
  notes: string;
}

export interface ArchitectureRecommendation {
  frontend: FrontendFramework;
  backend: BackendRuntime;
  storage: StorageProviderId;
  storageCapability: StorageProviderCapability;
  runtimeCapability: RuntimeCapability;
  selectedReason: string;
  reusedInfrastructure: string[];
  requiresCustomAdapter: boolean;
  requiresSeparateProcessingBackend: boolean;
  processingBackendAdvice?: string;
  requiredEnvVars: string[];
  securityConsiderations: string[];
  knownLimitations: string[];
  alternatives: string[];
}

export interface DependencyPlan {
  pm: PackageManagerName;
  toInstall: string[];
  alreadyInstalled: string[];
  skippedServerDeps: string[];
  installCommand: string;
  reasons: Record<string, string>;
}

export interface PlannedFile {
  relativePath: string;
  content: string;
  description: string;
  mode?: 'create' | 'merge' | 'overwrite';
}

export interface FileConflict {
  relativePath: string;
  reason: 'exists-different';
}

export interface FileWritePreview {
  toCreate: string[];
  toUpdate: string[];
  unchanged: string[];
  conflicts: FileConflict[];
}

export interface FileWriteResult {
  dryRun: boolean;
  written: string[];
  skipped: string[];
  conflicts: FileConflict[];
  rolledBack: boolean;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface DiagnosticIssue {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  fixable?: boolean;
  suggestion?: string;
}

export interface DoctorReport {
  cwd: string;
  ok: boolean;
  issues: DiagnosticIssue[];
  appliedFixes: string[];
}

export interface ProjectValidationReport {
  cwd: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  checksRun: string[];
}
