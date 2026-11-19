import { getRuntimeCapability } from '../capabilities/runtimeRegistry';
import { getStorageCapability } from '../capabilities/storageRegistry';
import type { ArchitectureRecommendation } from '../types/architecture';
import type {
  BackendRuntime,
  FrontendFramework,
  ProjectDetectionReport,
  StorageProviderId,
} from '../types/detection';

export interface ArchitectureOverrides {
  frontend?: FrontendFramework;
  backend?: BackendRuntime;
  storage?: StorageProviderId;
}

function resolveStorageChoice(
  report: ProjectDetectionReport,
  backend: BackendRuntime,
  explicitStorage?: StorageProviderId,
): { storage: StorageProviderId; reason: string; reused: string[] } {
  if (explicitStorage && explicitStorage !== 'unknown') {
    return {
      storage: explicitStorage,
      reason: `Explicitly selected ${getStorageCapability(explicitStorage).displayName}.`,
      reused: report.storage.detected === explicitStorage ? [explicitStorage] : [],
    };
  }

  const detected = report.storage.detected;
  if (detected !== 'unknown') {
    const cap = getStorageCapability(detected);
    if (cap.supportLevel === 'native') {
      return {
        storage: detected,
        reason: `Reusing detected ${cap.displayName} with native img-upload-kit adapter.`,
        reused: [cap.displayName],
      };
    }
    if (cap.supportLevel === 'verified-s3-compatible') {
      return {
        storage: detected,
        reason: `Reusing detected ${cap.displayName} via verified S3-compatible createS3StorageAdapter.`,
        reused: [cap.displayName],
      };
    }
    return {
      storage: detected,
      reason: `Reusing detected ${cap.displayName} with a generated custom StorageAdapter scaffold (no native adapter ships in img-upload-kit).`,
      reused: [cap.displayName],
    };
  }

  if (backend === 'aws-lambda') {
    return {
      storage: 's3',
      reason: 'AWS Lambda uses ephemeral local disks; recommending native AWS S3 adapter.',
      reused: [],
    };
  }

  if (backend === 'cloudflare-workers') {
    return {
      storage: 'r2',
      reason: 'Cloudflare Workers pairs best with Cloudflare R2 (verified S3-compatible).',
      reused: [],
    };
  }

  return {
    storage: 'local',
    reason: 'No cloud storage detected; defaulting to Local Filesystem for zero-config development.',
    reused: [],
  };
}

export function resolveArchitecture(
  report: ProjectDetectionReport,
  overrides: ArchitectureOverrides = {},
): ArchitectureRecommendation {
  const frontend = overrides.frontend ?? report.frontend.detected;
  const backend = overrides.backend ?? report.backend.detected;
  const { storage, reason, reused } = resolveStorageChoice(
    report,
    backend,
    overrides.storage,
  );

  const storageCapability = getStorageCapability(storage);
  const runtimeCapability = getRuntimeCapability(backend);
  const requiresSeparateProcessingBackend = !runtimeCapability.supportsSharp;

  const reusedInfrastructure = [...reused];
  if (report.auth.detected !== 'none') {
    reusedInfrastructure.push(`Auth (${report.auth.detected})`);
  }
  if (report.cdn.detected !== 'none') {
    reusedInfrastructure.push(`CDN (${report.cdn.detected})`);
  }

  let processingBackendAdvice: string | undefined;
  if (backend === 'cloudflare-workers' || backend === 'vercel-edge') {
    processingBackendAdvice =
      `${runtimeCapability.displayName} cannot run Sharp native binaries. Use img-upload-kit/server/handler for presigned flows or route image processing to a dedicated Node.js backend.`;
  } else if (backend === 'frontend-only' || backend === 'none') {
    processingBackendAdvice =
      'No Node.js backend was detected in this workspace. Point uploadEndpoint to an external Node.js API running img-upload-kit/server + Sharp.';
  }

  const securityConsiderations: string[] = [
    'Never place storage secrets or service-role keys in NEXT_PUBLIC_, VITE_, EXPO_PUBLIC_, or NUXT_PUBLIC_ variables.',
    'Authenticate and authorize every upload/delete route using the `authorize` hook in createUploadHttpHandler.',
    'SVG uploads remain disabled by default; only enable `allowSvg: true` when required (sanitized via sanitizeSvg).',
  ];
  if (report.auth.detected !== 'none') {
    securityConsiderations.push(
      `Wire your existing ${report.auth.detected} session check inside the upload handler authorize callback.`,
    );
  }

  const knownLimitations: string[] = [];
  if (storageCapability.requiresCustomAdapter) {
    knownLimitations.push(storageCapability.compatibilityNotes);
  }
  if (requiresSeparateProcessingBackend && processingBackendAdvice) {
    knownLimitations.push(processingBackendAdvice);
  }
  if (storage === 'local' && (backend === 'aws-lambda' || backend === 'vercel-edge')) {
    knownLimitations.push('Local filesystem storage is ephemeral on serverless/edge platforms.');
  }
  if (report.ambiguousStorage.length > 1) {
    knownLimitations.push(
      `Multiple storage providers detected (${report.ambiguousStorage.join(', ')}); confirm the active target with --storage.`,
    );
  }

  const alternatives: string[] = [];
  if (storageCapability.requiresCustomAdapter) {
    alternatives.push('AWS S3 (native adapter)', 'Cloudflare R2 (verified S3-compatible)');
  } else if (storage === 'local') {
    alternatives.push('AWS S3 (native)', 'Cloudflare R2 (S3-compatible)', 'Supabase Storage (native)');
  }

  return {
    frontend,
    backend,
    storage,
    storageCapability,
    runtimeCapability,
    selectedReason: reason,
    reusedInfrastructure,
    requiresCustomAdapter: storageCapability.requiresCustomAdapter,
    requiresSeparateProcessingBackend,
    processingBackendAdvice,
    requiredEnvVars: [...storageCapability.requiredEnvironmentVariables],
    securityConsiderations,
    knownLimitations,
    alternatives,
  };
}
