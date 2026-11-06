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
import { validateImageFileStrict } from '../../utils/validators';
import { UploadValidationError } from '../handler/responses';
import { assertMagicBytesAllowed, sanitizeSvg } from '../security';
import { AsyncSemaphore, SemaphoreQueueFullError } from '../semaphore';
import { processImageBuffer } from './bufferProcessor';
import { createDefaultPathGenerator, formatToExtension } from './pathGenerator';
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

function resolveEffectiveAllowedFormats(
  baseFormats: string[],
  allowSvg: boolean,
  explicitAllowSvg: boolean,
): string[] {
  if (!allowSvg) return baseFormats.filter((fmt) => fmt !== SVG_MIME_TYPE);
  if (explicitAllowSvg && !baseFormats.includes(SVG_MIME_TYPE)) {
    return [...baseFormats, SVG_MIME_TYPE];
  }
  return baseFormats;
}

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
  } = options;

  const mergedPresets: Record<string, UploadPresetConfig> = {
    ...(includeStandardPresets ? STANDARD_PRESETS : {}),
    ...(customPresets || {}),
  };

  const semaphore = new AsyncSemaphore(concurrency, { maxQueue });
  const buildPath = pathGenerator || createDefaultPathGenerator();
  const resolvePreset = (name?: string): UploadPresetConfig | undefined =>
    name ? mergedPresets[name] : undefined;

  const getAllowedBuckets = (): string[] => {
    const buckets = new Set<string>([defaultBucket]);
    for (const preset of Object.values(mergedPresets)) {
      if (preset?.bucket) buckets.add(preset.bucket);
    }
    return [...buckets];
  };

  const getMirrorDirs = (): string[] =>
    [...new Set(Object.values(mergedPresets).map((p) => p?.mirrorDir).filter(Boolean) as string[])];

  const getMaxSizeMB = (allowedPresets?: string[]): number => {
    let maxMB = defaultMaxSizeMB;
    const keys = allowedPresets?.length ? allowedPresets : Object.keys(mergedPresets);
    for (const key of keys) {
      const p = mergedPresets[key];
      if (p?.maxSizeMB && p.maxSizeMB > maxMB) maxMB = p.maxSizeMB;
    }
    return maxMB;
  };

  return {
    defaultBucket,
    resolvePreset,
    getAllowedBuckets,
    getMaxSizeMB,
    parseUrl: (url: string) => (storage.parseUrl ? storage.parseUrl(url) : null),

    async processBuffer(
      buffer: Buffer,
      procOptions: ProcessImageBufferOptions = {},
    ): Promise<ProcessedImageBufferResult> {
      return semaphore.run(
        () =>
          processImageBuffer(buffer, {
            maxDimensions: defaultMaxDimensions,
            optimizationTimeoutMs,
            blurTimeoutMs,
            includeBlurHash: defaultIncludeBlurHash,
            limitInputPixels: defaultLimitInputPixels,
            effort: defaultEffort,
            ...procOptions,
          }),
        { signal: procOptions.signal },
      );
    },

    async uploadImage(
      input,
      uploadOptions: ImageUploadOptions<InferredPresetKey<TPresets>> = {},
    ): Promise<UploadedImageData> {
      const presetConfig = resolvePreset(uploadOptions.preset);
      if (uploadOptions.preset && !presetConfig) {
        throw new UploadValidationError(`Invalid preset "${uploadOptions.preset}".`);
      }

      const bucket = uploadOptions.bucket || presetConfig?.bucket || defaultBucket;
      const folder = uploadOptions.folder ?? presetConfig?.folder ?? defaultFolder;
      const maxSizeMB = uploadOptions.maxSizeMB ?? presetConfig?.maxSizeMB ?? defaultMaxSizeMB;
      const allowSvg = uploadOptions.allowSvg ?? presetConfig?.allowSvg ?? defaultAllowSvg;
      const explicitAllowSvg = Boolean(
        uploadOptions.allowSvg ??
          presetConfig?.allowSvg ??
          (defaultAllowSvg && !uploadOptions.allowedFormats && !presetConfig?.allowedFormats),
      );
      const allowedFormats = resolveEffectiveAllowedFormats(
        uploadOptions.allowedFormats ?? presetConfig?.allowedFormats ?? defaultAllowedFormats,
        allowSvg,
        explicitAllowSvg,
      );
      const maxDimensions =
        uploadOptions.maxDimensions ?? presetConfig?.maxDimensions ?? defaultMaxDimensions;
      const outputFormat = uploadOptions.outputFormat ?? presetConfig?.outputFormat;
      const quality = uploadOptions.quality ?? presetConfig?.quality;
      const includeBlurHash =
        uploadOptions.includeBlurHash ?? presetConfig?.includeBlurHash ?? defaultIncludeBlurHash;
      const limitInputPixels =
        uploadOptions.limitInputPixels ?? presetConfig?.limitInputPixels ?? defaultLimitInputPixels;

      const isWebFile = typeof (input as File).arrayBuffer === 'function';
      if (isWebFile) {
        const pre = validateImageFileStrict({ size: (input as File).size, type: input.type }, maxSizeMB, allowedFormats);
        if (!pre.valid) throw new UploadValidationError(pre.error!);
      }

      try {
        let originalBuffer = isWebFile
          ? Buffer.from(await (input as File).arrayBuffer())
          : (input as { buffer: Buffer }).buffer;
        if (!originalBuffer || originalBuffer.length === 0) throw new UploadValidationError('File is empty');

        const validation = validateImageFileStrict({ size: originalBuffer.length, type: input.type }, maxSizeMB, allowedFormats);
        if (!validation.valid) throw new UploadValidationError(validation.error!);

        const sniffed = assertMagicBytesAllowed(originalBuffer, allowedFormats, allowSvg);
        if (sniffed.format === 'svg') originalBuffer = sanitizeSvg(originalBuffer);

        const { optimized, blurData, contentHash, originalSize } = await semaphore.run(
          () =>
            processImageBuffer(originalBuffer, {
              maxDimensions, outputFormat, quality, includeBlurHash,
              optimizationTimeoutMs, blurTimeoutMs, limitInputPixels,
              effort: defaultEffort, allowSvg, signal: uploadOptions.signal,
            }),
          { signal: uploadOptions.signal },
        );

        const mainFormat = optimized.format;
        const { uploadResult, storageTarget } = await uploadWithCollisionRetry({
          storage,
          buildPath,
          pathContext: {
            bucket,
            folder,
            preset: uploadOptions.preset,
            format: mainFormat,
            extension: formatToExtension(mainFormat),
            customFilename: uploadOptions.customFilename,
            isClientFilename: uploadOptions.isClientFilename,
            contentHash,
            originalName: input.name,
            metadata: uploadOptions.metadata,
          },
          data: optimized.buffer,
          contentType: mainFormat === 'svg' ? SVG_MIME_TYPE : `image/${mainFormat}`,
        });

        const resolvedUrl = await mirrorBufferLocally({
          buffer: optimized.buffer,
          filename: storageTarget.filename,
          storagePath: uploadResult.path,
          fallbackUrl: uploadResult.url,
          mirrorDir: presetConfig?.mirrorDir,
          publicUrlBase: presetConfig?.publicUrlBase,
        });

        const result: UploadedImageData = {
          url: resolvedUrl,
          blurDataUrl: blurData.dataURL,
          blurColor: blurData.color,
          ...(blurData.blurHash && { blurHash: blurData.blurHash }),
          altText: uploadOptions.altText || '',
          width: optimized.width,
          height: optimized.height,
          format: optimized.format,
          size: optimized.size,
          originalSize,
          contentHash,
          storagePath: uploadResult.path,
          bucket: storageTarget.bucket,
          ...(uploadOptions.preset && { preset: uploadOptions.preset }),
          ...(folder && { folder }),
          ...(uploadOptions.metadata && { metadata: uploadOptions.metadata }),
          uploadedAt: new Date().toISOString(),
        };

        if (onUploadRecord) {
          const record: ImageUploadRecord = {
            ...result,
            quality: optimized.quality ?? quality ?? 85,
          };
          if (awaitRecordHook) {
            try {
              await onUploadRecord(record);
            } catch (hookError) {
              await storage.delete(storageTarget.bucket, uploadResult.path).catch(() => {});
              throw hookError;
            }
          } else {
            Promise.resolve(onUploadRecord(record)).catch((err: unknown) => {
              onError?.(err, { action: 'recordHook' });
            });
          }
        }

        return result;
      } catch (error) {
        if (error instanceof UploadValidationError || error instanceof SemaphoreQueueFullError) {
          throw error;
        }
        throw new Error(
          `Image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    },

    async deleteImage(targetPath: string, bucket?: string): Promise<void> {
      try {
        await storage.delete(bucket || defaultBucket, targetPath);
        await deleteMirroredFiles(getMirrorDirs(), targetPath);
      } catch (error) {
        throw new Error(
          `Image deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    },

    async deleteByUrl(url: string): Promise<boolean> {
      const parsed = storage.parseUrl?.(url);
      const deleted = storage.deleteByUrl ? await storage.deleteByUrl(url) : false;
      if (deleted && parsed?.path) {
        await deleteMirroredFiles(getMirrorDirs(), parsed.path);
      }
      return deleted;
    },
  };
}
