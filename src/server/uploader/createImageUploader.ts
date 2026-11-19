import type {
  ImageUploadOptions, ImageUploadRecord, UploadedImageData, UploadPresetConfig,
} from '../../types';
import {
  DEFAULT_ALLOWED_FORMATS, DEFAULT_IMAGE_DIMENSIONS, STANDARD_PRESETS, SVG_MIME_TYPE,
} from '../../types';
import { AsyncSemaphore } from '../semaphore';
import { processImageBuffer } from './bufferProcessor';
import { createMemoryDedupeStore, type DedupeStore } from './dedupe';
import {
  createInFlightCoalescer, mapUploaderError, rollbackIfUploadAborted, throwIfAborted,
} from './inFlightCoalescer';
import { createDefaultPathGenerator, formatToExtension } from './pathGenerator';
import {
  collectAllowedBuckets, collectMirrorDirs, computeMaxSizeMB, createVariantTracker,
  evictDedupeForPath, lookupDedupeCache, readAndValidateUploadInput, resolveUploadSettings,
} from './resolveUploadSettings';
import type {
  ImageUploader, ImageUploaderOptions, InferredPresetKey,
  ProcessedImageBufferResult, ProcessImageBufferOptions,
} from './types';
import { deleteMirroredFiles, mirrorBufferLocally, uploadWithCollisionRetry } from './uploadRetry';
import {
  collectCandidateVariantWidths, deleteStoredVariants,
  generateImageVariants, invokeRecordHookWithRollback,
} from './variantGenerator';

const MAX_IN_FLIGHT_DEDUPE = 1000;

export function createImageUploader<
  TPresets extends Record<string, UploadPresetConfig> = Record<string, UploadPresetConfig>,
>(
  options: ImageUploaderOptions<TPresets>,
): ImageUploader<InferredPresetKey<TPresets>> {
  const {
    storage, defaultBucket = 'images', defaultFolder = '', defaultMaxSizeMB = 10,
    defaultAllowedFormats = DEFAULT_ALLOWED_FORMATS,
    defaultMaxDimensions = DEFAULT_IMAGE_DIMENSIONS,
    allowSvg: defaultAllowSvg = false, limitInputPixels: defaultLimitInputPixels,
    maxWidth: defaultMaxWidth, maxHeight: defaultMaxHeight, maxFrames: defaultMaxFrames,
    focalPoint: defaultFocalPoint, colorSpace: defaultColorSpace,
    preserveMetadata: defaultPreserveMetadata, svgSanitizer: defaultSvgSanitizer,
    transformCache: defaultTransformCache, effort: defaultEffort,
    presets: customPresets, includeStandardPresets = true, pathGenerator,
    onUploadRecord, awaitRecordHook = false, onError, concurrency = 2, maxQueue,
    optimizationTimeoutMs = 60000, blurTimeoutMs = 30000,
    includeBlurHash: defaultIncludeBlurHash = false, deduplicate, deduplicateByHash = false,
  } = options;

  const dedupeObj =
    typeof deduplicate === 'object' && deduplicate !== null ? deduplicate : undefined;
  const defaultDedupeEnabled =
    typeof deduplicate === 'boolean'
      ? deduplicate
      : Boolean(dedupeObj ? dedupeObj.enabled !== false : deduplicateByHash);
  const verifyDedupeExists = dedupeObj?.verifyExists !== false;
  const dedupeStore: DedupeStore = dedupeObj?.store ?? createMemoryDedupeStore();
  const inFlightCoalescer = createInFlightCoalescer(MAX_IN_FLIGHT_DEDUPE);

  const mergedPresets: Record<string, UploadPresetConfig> = {
    ...(includeStandardPresets ? STANDARD_PRESETS : {}),
    ...(customPresets || {}),
  };
  const uploaderDefaults = {
    defaultBucket, defaultFolder, defaultMaxSizeMB, defaultAllowedFormats,
    defaultMaxDimensions, defaultAllowSvg, defaultIncludeBlurHash, defaultLimitInputPixels,
    defaultMaxWidth, defaultMaxHeight, defaultMaxFrames, defaultFocalPoint,
    defaultColorSpace, defaultPreserveMetadata, defaultSvgSanitizer, defaultDedupeEnabled,
  };

  const semaphore = new AsyncSemaphore(concurrency, { maxQueue });
  const buildPath = pathGenerator || createDefaultPathGenerator();
  const variantTracker = createVariantTracker();

  const resolvePreset = (name?: string): UploadPresetConfig | undefined =>
    name ? mergedPresets[name] : undefined;
  const getMirrorDirs = (): string[] => collectMirrorDirs(mergedPresets);

  const cleanupVariantsFor = async (bucket: string, basePath: string): Promise<void> => {
    const knownVariantPaths = variantTracker.pop(`${bucket}:${basePath}`);
    await deleteStoredVariants({
      storage, bucket, basePath, mirrorDirs: getMirrorDirs(), knownVariantPaths,
      candidateWidths: collectCandidateVariantWidths(mergedPresets, variantTracker.widths),
      onError,
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
            maxWidth: defaultMaxWidth, maxHeight: defaultMaxHeight, maxFrames: defaultMaxFrames,
            focalPoint: defaultFocalPoint, colorSpace: defaultColorSpace,
            preserveMetadata: defaultPreserveMetadata, svgSanitizer: defaultSvgSanitizer,
            transformCache: defaultTransformCache, effort: defaultEffort, ...procOptions,
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
        maxDimensions, aspectRatio, crop, focalPoint, outputFormat, quality,
        includeBlurHash, limitInputPixels, maxWidth, maxHeight, maxFrames,
        colorSpace, preserveMetadata, svgSanitizer, variantWidths, shouldDedupe, dedupeSettings,
      } = resolveUploadSettings(uploadOptions, resolvePreset, uploaderDefaults);

      try {
        throwIfAborted(uploadOptions.signal);
        const originalBuffer = await readAndValidateUploadInput(
          input, maxSizeMB, allowedFormats, allowSvg, svgSanitizer,
        );
        throwIfAborted(uploadOptions.signal);

        let dedupeKey: string | undefined;
        let sourceHash: string | undefined;
        if (shouldDedupe) {
          const hit = await lookupDedupeCache({
            originalBuffer, dedupeSettings, dedupeStore,
            verifyExists: verifyDedupeExists, storage, bucket, altText: uploadOptions.altText,
          });
          throwIfAborted(uploadOptions.signal);
          if (hit.cachedResult) return hit.cachedResult;
          dedupeKey = hit.dedupeKey;
          sourceHash = hit.sourceHash;
        }

        const executeUpload = async (execSignal?: AbortSignal): Promise<UploadedImageData> => {
          const { optimized, blurData, contentHash, originalSize } = await semaphore.run(
            () =>
              processImageBuffer(originalBuffer, {
                maxDimensions, aspectRatio, crop, focalPoint, outputFormat, quality,
                includeBlurHash, optimizationTimeoutMs, blurTimeoutMs, limitInputPixels,
                maxWidth, maxHeight, maxFrames, colorSpace, preserveMetadata,
                transformCache: defaultTransformCache, effort: defaultEffort, allowSvg,
                precomputedHash: sourceHash, signal: execSignal,
              }),
            { signal: execSignal },
          );

          throwIfAborted(execSignal);
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
            signal: execSignal,
          });

          let variantPaths: string[] = [];
          const checkAborted = () =>
            rollbackIfUploadAborted({
              signal: execSignal, storage, bucket: storageTarget.bucket,
              mainPath: uploadResult.path, variantPaths, mirrorDirs: getMirrorDirs(), onError,
            });

          await checkAborted();
          const resolvedUrl = await mirrorBufferLocally({
            buffer: optimized.buffer, filename: storageTarget.filename,
            storagePath: uploadResult.path, fallbackUrl: uploadResult.url,
            mirrorDir: presetConfig?.mirrorDir, publicUrlBase: presetConfig?.publicUrlBase,
          });
          await checkAborted();

          const { variants, srcSet } =
            variantWidths?.length && mainFormat !== 'svg'
              ? await semaphore.run(() =>
                  generateImageVariants({
                    sourceBuffer: originalBuffer, format: mainFormat,
                    quality: optimized.quality ?? quality, effort: defaultEffort,
                    limitInputPixels, aspectRatio, crop,
                    mainWidth: optimized.width, mainHeight: optimized.height,
                    mainUrl: resolvedUrl, baseStoragePath: uploadResult.path,
                    baseFilename: storageTarget.filename, bucket: storageTarget.bucket,
                    storage, variantWidths,
                    upsert: Boolean(uploadOptions.customFilename) && !uploadOptions.isClientFilename,
                    contentHash, metadata: uploadOptions.metadata,
                    mirrorDir: presetConfig?.mirrorDir, publicUrlBase: presetConfig?.publicUrlBase,
                    signal: execSignal, onError,
                  }),
                )
              : { variants: [], srcSet: undefined };

          variantPaths = variants.map((v) => v.storagePath).filter(Boolean) as string[];
          await checkAborted();

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
          await checkAborted();
          variantTracker.track(`${storageTarget.bucket}:${uploadResult.path}`, variantPaths, variants);
          if (shouldDedupe && dedupeKey) await dedupeStore.set(dedupeKey, result);
          return result;
        };

        if (shouldDedupe && dedupeKey) {
          return await inFlightCoalescer.runOrJoin(
            dedupeKey,
            uploadOptions.signal,
            uploadOptions.altText,
            (sharedSignal) => executeUpload(sharedSignal),
          );
        }
        return await executeUpload(uploadOptions.signal);
      } catch (error) {
        mapUploaderError(error, 'upload');
      }
    },

    async deleteImage(targetPath: string, bucket?: string): Promise<void> {
      const targetBucket = bucket || defaultBucket;
      try {
        await storage.delete(targetBucket, targetPath);
        await deleteMirroredFiles(getMirrorDirs(), targetPath, onError);
        await cleanupVariantsFor(targetBucket, targetPath);
        await evictDedupeForPath(dedupeStore, storage, targetBucket, targetPath);
      } catch (error) {
        mapUploaderError(error, 'deletion');
      }
    },

    async deleteByUrl(url: string): Promise<boolean> {
      try {
        const parsed = storage.parseUrl?.(url);
        const deleted = storage.deleteByUrl ? await storage.deleteByUrl(url) : false;
        await dedupeStore.deleteByUrl?.(url);
        if (parsed?.path) {
          await evictDedupeForPath(dedupeStore, storage, parsed.bucket || defaultBucket, parsed.path);
        }
        if (deleted && parsed?.path) {
          await deleteMirroredFiles(getMirrorDirs(), parsed.path, onError);
          await cleanupVariantsFor(parsed.bucket || defaultBucket, parsed.path);
        }
        return deleted;
      } catch (error) {
        mapUploaderError(error, 'deletion');
      }
    },
  };
}
