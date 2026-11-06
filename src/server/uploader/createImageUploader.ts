import type {
  ImageUploadOptions,
  ImageUploadRecord,
  UploadedImageData,
  UploadPresetConfig,
} from '../../types';
import {
  DEFAULT_ALLOWED_FORMATS,
  DEFAULT_IMAGE_DIMENSIONS,
  STANDARD_PRESETS,
  SVG_MIME_TYPE,
} from '../../types';
import { UploadValidationError } from '../handler/responses';
import { AsyncSemaphore, SemaphoreQueueFullError } from '../semaphore';
import { processImageBuffer } from './bufferProcessor';
import { createMemoryDedupeStore, type DedupeStore } from './dedupe';
import { createDefaultPathGenerator, formatToExtension } from './pathGenerator';
import {
  collectAllowedBuckets,
  collectMirrorDirs,
  computeMaxSizeMB,
  evictDedupeForPath,
  lookupDedupeCache,
  readAndValidateUploadInput,
  resolveUploadSettings,
} from './resolveUploadSettings';
import type {
  ImageUploader,
  ImageUploaderOptions,
  InferredPresetKey,
  ProcessedImageBufferResult,
  ProcessImageBufferOptions,
} from './types';
import {
  deleteMirroredFiles,
  mirrorBufferLocally,
  uploadWithCollisionRetry,
} from './uploadRetry';
import {
  collectCandidateVariantWidths,
  deleteStoredVariants,
  generateImageVariants,
  invokeRecordHookWithRollback,
} from './variantGenerator';

export function createImageUploader<
  TPresets extends Record<string, UploadPresetConfig> = Record<string, UploadPresetConfig>,
>(
  options: ImageUploaderOptions<TPresets>,
): ImageUploader<InferredPresetKey<TPresets>> {
  const {
    storage,
    defaultBucket = 'images',
    defaultFolder = '',
    defaultMaxSizeMB = 10,
    defaultAllowedFormats = DEFAULT_ALLOWED_FORMATS,
    defaultMaxDimensions = DEFAULT_IMAGE_DIMENSIONS,
    allowSvg: defaultAllowSvg = false,
    limitInputPixels: defaultLimitInputPixels,
    effort: defaultEffort,
    presets: customPresets,
    includeStandardPresets = true,
    pathGenerator,
    onUploadRecord,
    awaitRecordHook = false,
    onError,
    concurrency = 2,
    maxQueue,
    optimizationTimeoutMs = 60000,
    blurTimeoutMs = 30000,
    includeBlurHash: defaultIncludeBlurHash = false,
    deduplicate,
    deduplicateByHash = false,
  } = options;

  const dedupeObj =
    typeof deduplicate === 'object' && deduplicate !== null ? deduplicate : undefined;
  const defaultDedupeEnabled =
    typeof deduplicate === 'boolean'
      ? deduplicate
      : Boolean(dedupeObj ? dedupeObj.enabled !== false : deduplicateByHash);
  const verifyDedupeExists = dedupeObj?.verifyExists !== false;
  const dedupeStore: DedupeStore = dedupeObj?.store ?? createMemoryDedupeStore();

  const mergedPresets: Record<string, UploadPresetConfig> = {
    ...(includeStandardPresets ? STANDARD_PRESETS : {}),
    ...(customPresets || {}),
  };
  const uploaderDefaults = {
    defaultBucket, defaultFolder, defaultMaxSizeMB, defaultAllowedFormats,
    defaultMaxDimensions, defaultAllowSvg, defaultIncludeBlurHash,
    defaultLimitInputPixels, defaultDedupeEnabled,
  };

  const semaphore = new AsyncSemaphore(concurrency, { maxQueue });
  const buildPath = pathGenerator || createDefaultPathGenerator();
  const trackedVariants = new Map<string, string[]>();
  const observedWidths = new Set<number>();

  const resolvePreset = (name?: string): UploadPresetConfig | undefined =>
    name ? mergedPresets[name] : undefined;
  const getMirrorDirs = (): string[] => collectMirrorDirs(mergedPresets);

  const cleanupVariantsFor = async (bucket: string, basePath: string): Promise<void> => {
    const key = `${bucket}:${basePath}`;
    const knownVariantPaths = trackedVariants.get(key);
    trackedVariants.delete(key);
    await deleteStoredVariants({
      storage, bucket, basePath, mirrorDirs: getMirrorDirs(), knownVariantPaths,
      candidateWidths: collectCandidateVariantWidths(mergedPresets, observedWidths),
    });
  };

  return {
    defaultBucket,
    storage,
    getStorage: () => storage,
    resolvePreset,
    resolveUploadLimits: (presetName?: string) => {
      const r = resolveUploadSettings(
        { preset: presetName as InferredPresetKey<TPresets> | undefined },
        resolvePreset,
        uploaderDefaults,
      );
      return {
        maxSizeMB: r.maxSizeMB, allowedFormats: r.allowedFormats,
        allowSvg: r.allowSvg, defaultFolder: r.folder,
      };
    },
    getAllowedBuckets: () => collectAllowedBuckets(defaultBucket, mergedPresets),
    getMaxSizeMB: (allowedPresets?: string[]) =>
      computeMaxSizeMB(defaultMaxSizeMB, mergedPresets, allowedPresets),
    parseUrl: (url: string) => (storage.parseUrl ? storage.parseUrl(url) : null),

    async processBuffer(
      buffer: Buffer,
      procOptions: ProcessImageBufferOptions = {},
    ): Promise<ProcessedImageBufferResult> {
      return semaphore.run(
        () =>
          processImageBuffer(buffer, {
            maxDimensions: defaultMaxDimensions, optimizationTimeoutMs, blurTimeoutMs,
            includeBlurHash: defaultIncludeBlurHash, limitInputPixels: defaultLimitInputPixels,
            effort: defaultEffort, ...procOptions,
          }),
        { signal: procOptions.signal },
      );
    },

    async uploadImage(
      input,
      uploadOptions: ImageUploadOptions<InferredPresetKey<TPresets>> = {},
    ): Promise<UploadedImageData> {
      const {
        presetConfig, bucket, folder, maxSizeMB, allowSvg, allowedFormats,
        maxDimensions, aspectRatio, crop, outputFormat, quality,
        includeBlurHash, limitInputPixels, variantWidths, shouldDedupe, dedupeSettings,
      } = resolveUploadSettings(uploadOptions, resolvePreset, uploaderDefaults);

      try {
        const originalBuffer = await readAndValidateUploadInput(
          input, maxSizeMB, allowedFormats, allowSvg,
        );

        let dedupeKey: string | undefined;
        let sourceHash: string | undefined;
        if (shouldDedupe) {
          const hit = await lookupDedupeCache({
            originalBuffer, dedupeSettings, dedupeStore,
            verifyExists: verifyDedupeExists, storage, bucket,
            altText: uploadOptions.altText,
          });
          if (hit.cachedResult) return hit.cachedResult;
          dedupeKey = hit.dedupeKey;
          sourceHash = hit.sourceHash;
        }

        const { optimized, blurData, contentHash, originalSize } = await semaphore.run(
          () =>
            processImageBuffer(originalBuffer, {
              maxDimensions, aspectRatio, crop, outputFormat, quality, includeBlurHash,
              optimizationTimeoutMs, blurTimeoutMs, limitInputPixels,
              effort: defaultEffort, allowSvg, signal: uploadOptions.signal,
            }),
          { signal: uploadOptions.signal },
        );

        const mainFormat = optimized.format;
        const { uploadResult, storageTarget } = await uploadWithCollisionRetry({
          storage, buildPath,
          pathContext: {
            bucket, folder, preset: uploadOptions.preset, format: mainFormat,
            extension: formatToExtension(mainFormat),
            customFilename: uploadOptions.customFilename,
            isClientFilename: uploadOptions.isClientFilename,
            contentHash, originalName: input.name, metadata: uploadOptions.metadata,
          },
          data: optimized.buffer,
          contentType: mainFormat === 'svg' ? SVG_MIME_TYPE : `image/${mainFormat}`,
        });

        const resolvedUrl = await mirrorBufferLocally({
          buffer: optimized.buffer, filename: storageTarget.filename,
          storagePath: uploadResult.path, fallbackUrl: uploadResult.url,
          mirrorDir: presetConfig?.mirrorDir, publicUrlBase: presetConfig?.publicUrlBase,
        });

        const { variants, srcSet } =
          variantWidths?.length && mainFormat !== 'svg'
            ? await semaphore.run(
                () =>
                  generateImageVariants({
                    sourceBuffer: originalBuffer, format: mainFormat,
                    quality: optimized.quality ?? quality, effort: defaultEffort, limitInputPixels,
                    aspectRatio, crop,
                    mainWidth: optimized.width, mainHeight: optimized.height, mainUrl: resolvedUrl,
                    baseStoragePath: uploadResult.path, baseFilename: storageTarget.filename,
                    bucket: storageTarget.bucket, storage, variantWidths,
                    upsert: Boolean(uploadOptions.customFilename) && !uploadOptions.isClientFilename,
                    contentHash, metadata: uploadOptions.metadata,
                    mirrorDir: presetConfig?.mirrorDir, publicUrlBase: presetConfig?.publicUrlBase,
                  }),
                { signal: uploadOptions.signal },
              )
            : { variants: [], srcSet: undefined };

        const variantPaths = variants.map((v) => v.storagePath).filter(Boolean) as string[];
        if (variantPaths.length > 0) {
          trackedVariants.set(`${storageTarget.bucket}:${uploadResult.path}`, variantPaths);
          variants.forEach((v) => observedWidths.add(v.width));
        }

        const result: UploadedImageData = {
          url: resolvedUrl, blurDataUrl: blurData.dataURL, blurColor: blurData.color,
          ...(blurData.blurHash && { blurHash: blurData.blurHash }),
          altText: uploadOptions.altText || '',
          width: optimized.width, height: optimized.height, format: optimized.format,
          size: optimized.size, originalSize, contentHash,
          storagePath: uploadResult.path, bucket: storageTarget.bucket,
          ...(uploadOptions.preset && { preset: uploadOptions.preset }),
          ...(folder && { folder }),
          ...(uploadOptions.metadata && { metadata: uploadOptions.metadata }),
          ...(variants.length > 0 && { variants }),
          ...(srcSet && { srcSet }),
          uploadedAt: new Date().toISOString(),
        };

        const record: ImageUploadRecord = {
          ...result,
          quality: optimized.quality ?? quality ?? 85,
          ...(sourceHash && { sourceHash }),
        };
        await invokeRecordHookWithRollback({
          onUploadRecord, awaitRecordHook, record, storage, bucket: storageTarget.bucket,
          mainPath: uploadResult.path, variantPaths, mirrorDirs: getMirrorDirs(), onError,
        });
        if (shouldDedupe && dedupeKey) await dedupeStore.set(dedupeKey, result);
        return result;
      } catch (error) {
        if (error instanceof UploadValidationError || error instanceof SemaphoreQueueFullError) {
          throw error;
        }
        throw new Error(`Image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },

    async deleteImage(targetPath: string, bucket?: string): Promise<void> {
      const targetBucket = bucket || defaultBucket;
      try {
        await storage.delete(targetBucket, targetPath);
        await deleteMirroredFiles(getMirrorDirs(), targetPath);
        await cleanupVariantsFor(targetBucket, targetPath);
        await evictDedupeForPath(dedupeStore, storage, targetBucket, targetPath);
      } catch (error) {
        throw new Error(`Image deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },

    async deleteByUrl(url: string): Promise<boolean> {
      const parsed = storage.parseUrl?.(url);
      const deleted = storage.deleteByUrl ? await storage.deleteByUrl(url) : false;
      await dedupeStore.deleteByUrl?.(url);
      if (parsed?.path) {
        await evictDedupeForPath(dedupeStore, storage, parsed.bucket || defaultBucket, parsed.path);
      }
      if (deleted && parsed?.path) {
        await deleteMirroredFiles(getMirrorDirs(), parsed.path);
        await cleanupVariantsFor(parsed.bucket || defaultBucket, parsed.path);
      }
      return deleted;
    },
  };
}
