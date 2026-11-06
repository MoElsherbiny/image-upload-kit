import type { StorageAdapter } from '../../storage/types';
import type {
  CropStrategy,
  ExplicitOutputFormat,
  ImageAspectRatio,
  ImageDimensions,
  ImageUploadOptions,
  UploadedImageData,
  UploadPresetConfig,
} from '../../types';
import { validateImageFileStrict } from '../../utils/validators';
import { UploadValidationError } from '../handler/responses';
import { assertMagicBytesAllowed, sanitizeSvg } from '../security';
import { computeDedupeKey, computeSha256Hex, type DedupeStore } from './dedupe';
import { resolveEffectiveAllowedFormats } from './variantGenerator';

export interface UploaderDefaults {
  defaultBucket: string;
  defaultFolder: string;
  defaultMaxSizeMB: number;
  defaultAllowedFormats: string[];
  defaultMaxDimensions: ImageDimensions;
  defaultAllowSvg: boolean;
  defaultIncludeBlurHash: boolean;
  defaultLimitInputPixels?: number;
  defaultDedupeEnabled: boolean;
}

export interface ResolvedUploadSettings {
  presetConfig?: UploadPresetConfig;
  bucket: string;
  folder: string;
  maxSizeMB: number;
  allowSvg: boolean;
  allowedFormats: string[];
  maxDimensions: ImageDimensions;
  aspectRatio?: Exclude<ImageAspectRatio, 'auto'>;
  crop?: CropStrategy;
  outputFormat?: ExplicitOutputFormat;
  quality?: number;
  includeBlurHash: boolean;
  limitInputPixels?: number;
  variantWidths?: number[];
  shouldDedupe: boolean;
  dedupeSettings: Record<string, unknown>;
}

export function resolveUploadSettings<TPreset extends string>(
  uploadOptions: ImageUploadOptions<TPreset>,
  resolvePreset: (name?: string) => UploadPresetConfig | undefined,
  defaults: UploaderDefaults,
): ResolvedUploadSettings {
  const presetConfig = resolvePreset(uploadOptions.preset);
  if (uploadOptions.preset && !presetConfig) {
    throw new UploadValidationError(`Invalid preset "${uploadOptions.preset}".`);
  }

  const bucket = uploadOptions.bucket || presetConfig?.bucket || defaults.defaultBucket;
  const folder = uploadOptions.folder ?? presetConfig?.folder ?? defaults.defaultFolder;
  const maxSizeMB =
    uploadOptions.maxSizeMB ?? presetConfig?.maxSizeMB ?? defaults.defaultMaxSizeMB;
  const allowSvg =
    uploadOptions.allowSvg ?? presetConfig?.allowSvg ?? defaults.defaultAllowSvg;
  const explicitAllowSvg = Boolean(
    uploadOptions.allowSvg ??
      presetConfig?.allowSvg ??
      (defaults.defaultAllowSvg &&
        !uploadOptions.allowedFormats &&
        !presetConfig?.allowedFormats),
  );
  const allowedFormats = resolveEffectiveAllowedFormats(
    uploadOptions.allowedFormats ??
      presetConfig?.allowedFormats ??
      defaults.defaultAllowedFormats,
    allowSvg,
    explicitAllowSvg,
  );
  const maxDimensions =
    uploadOptions.maxDimensions ??
    presetConfig?.maxDimensions ??
    defaults.defaultMaxDimensions;
  const aspectRatio = uploadOptions.aspectRatio ?? presetConfig?.aspectRatio;
  const crop = uploadOptions.crop ?? presetConfig?.crop;
  const outputFormat = uploadOptions.outputFormat ?? presetConfig?.outputFormat;
  const quality = uploadOptions.quality ?? presetConfig?.quality;
  const includeBlurHash =
    uploadOptions.includeBlurHash ??
    presetConfig?.includeBlurHash ??
    defaults.defaultIncludeBlurHash;
  const limitInputPixels =
    uploadOptions.limitInputPixels ??
    presetConfig?.limitInputPixels ??
    defaults.defaultLimitInputPixels;
  const variantWidths = uploadOptions.variantWidths ?? presetConfig?.variantWidths;
  const shouldDedupe =
    uploadOptions.deduplicate ??
    presetConfig?.deduplicate ??
    defaults.defaultDedupeEnabled;

  const dedupeSettings: Record<string, unknown> = {
    bucket,
    folder,
    preset: uploadOptions.preset,
    maxDimensions,
    aspectRatio,
    crop,
    outputFormat,
    quality,
    variantWidths,
    includeBlurHash,
    customFilename: uploadOptions.customFilename,
  };

  return {
    presetConfig,
    bucket,
    folder,
    maxSizeMB,
    allowSvg,
    allowedFormats,
    maxDimensions,
    aspectRatio,
    crop,
    outputFormat,
    quality,
    includeBlurHash,
    limitInputPixels,
    variantWidths,
    shouldDedupe,
    dedupeSettings,
  };
}

export async function readAndValidateUploadInput(
  input: File | { buffer: Buffer; name?: string; type: string; size?: number },
  maxSizeMB: number,
  allowedFormats: string[],
  allowSvg: boolean,
): Promise<Buffer> {
  const isWebFile = typeof (input as File).arrayBuffer === 'function';
  if (isWebFile) {
    const pre = validateImageFileStrict(
      { size: (input as File).size, type: input.type },
      maxSizeMB,
      allowedFormats,
    );
    if (!pre.valid) throw new UploadValidationError(pre.error!);
  }

  let originalBuffer = isWebFile
    ? Buffer.from(await (input as File).arrayBuffer())
    : (input as { buffer: Buffer }).buffer;
  if (!originalBuffer || originalBuffer.length === 0) {
    throw new UploadValidationError('File is empty');
  }

  const validation = validateImageFileStrict(
    { size: originalBuffer.length, type: input.type },
    maxSizeMB,
    allowedFormats,
  );
  if (!validation.valid) throw new UploadValidationError(validation.error!);

  const sniffed = assertMagicBytesAllowed(originalBuffer, allowedFormats, allowSvg);
  if (sniffed.format === 'svg') {
    originalBuffer = sanitizeSvg(originalBuffer);
  }
  return originalBuffer;
}

export async function lookupDedupeCache(params: {
  originalBuffer: Buffer;
  dedupeSettings: Record<string, unknown>;
  dedupeStore: DedupeStore;
  verifyExists: boolean;
  storage: StorageAdapter;
  bucket: string;
  altText?: string;
}): Promise<{
  dedupeKey: string;
  sourceHash: string;
  cachedResult?: UploadedImageData;
}> {
  const {
    originalBuffer,
    dedupeSettings,
    dedupeStore,
    verifyExists,
    storage,
    bucket,
    altText,
  } = params;
  const [sourceHash, dedupeKey] = await Promise.all([
    computeSha256Hex(originalBuffer),
    computeDedupeKey(originalBuffer, dedupeSettings),
  ]);
  const cached = await dedupeStore.get(dedupeKey);
  if (cached) {
    const existsOk =
      !verifyExists ||
      !storage.exists ||
      !cached.storagePath ||
      (await storage.exists(cached.bucket ?? bucket, cached.storagePath));
    if (existsOk) {
      return {
        dedupeKey,
        sourceHash,
        cachedResult: {
          ...cached,
          altText: altText ?? cached.altText,
          deduplicated: true,
        },
      };
    }
    await dedupeStore.delete?.(dedupeKey);
  }
  return { dedupeKey, sourceHash };
}

export async function evictDedupeForPath(
  dedupeStore: DedupeStore,
  storage: StorageAdapter,
  bucket: string,
  targetPath: string,
): Promise<void> {
  const cleanPath = targetPath.replace(/^\/+/, '');
  await dedupeStore.delete?.(cleanPath);
  await dedupeStore.delete?.(`${bucket}:${cleanPath}`);
  if (storage.getPublicUrl) {
    const pubUrl = await storage.getPublicUrl(bucket, cleanPath);
    await dedupeStore.deleteByUrl?.(pubUrl);
  }
}

export function collectAllowedBuckets(
  defaultBucket: string,
  presets: Record<string, UploadPresetConfig>,
): string[] {
  const buckets = new Set<string>([defaultBucket]);
  for (const preset of Object.values(presets)) {
    if (preset?.bucket) buckets.add(preset.bucket);
  }
  return [...buckets];
}

export function collectMirrorDirs(
  presets: Record<string, UploadPresetConfig>,
): string[] {
  return [
    ...new Set(
      Object.values(presets)
        .map((p) => p?.mirrorDir)
        .filter(Boolean) as string[],
    ),
  ];
}

export function computeMaxSizeMB(
  defaultMaxSizeMB: number,
  presets: Record<string, UploadPresetConfig>,
  allowedPresets?: string[],
): number {
  let maxMB = defaultMaxSizeMB;
  const keys = allowedPresets?.length ? allowedPresets : Object.keys(presets);
  for (const key of keys) {
    const p = presets[key];
    if (p?.maxSizeMB && p.maxSizeMB > maxMB) maxMB = p.maxSizeMB;
  }
  return maxMB;
}
