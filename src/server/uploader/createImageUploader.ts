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
} from '../../types';
import { validateImageFileStrict } from '../../utils/validators';
import { UploadValidationError } from '../handler';
import { AsyncSemaphore } from '../semaphore';
import { processImageBuffer } from './bufferProcessor';
import {
  createDefaultPathGenerator,
  formatToExtension,
} from './pathGenerator';
import type {
  ImageUploader,
  ImageUploaderOptions,
  InferredPresetKey,
  ProcessedImageBufferResult,
  ProcessImageBufferOptions,
} from './types';
import { mirrorBufferLocally, uploadWithCollisionRetry } from './uploadRetry';

export function createImageUploader<
  TPresets extends Record<string, UploadPresetConfig> = Record<
    string,
    UploadPresetConfig
  >,
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
    presets: customPresets,
    includeStandardPresets = true,
    pathGenerator,
    onUploadRecord,
    awaitRecordHook = false,
    concurrency = 2,
    optimizationTimeoutMs = 60000,
    blurTimeoutMs = 30000,
    includeBlurHash: defaultIncludeBlurHash = false,
  } = options;

  const mergedPresets: Record<string, UploadPresetConfig> = {
    ...(includeStandardPresets ? STANDARD_PRESETS : {}),
    ...(customPresets || {}),
  };

  const semaphore = new AsyncSemaphore(concurrency);
  const buildPath = pathGenerator || createDefaultPathGenerator();

  const resolvePreset = (
    presetName?: string,
  ): UploadPresetConfig | undefined =>
    presetName ? mergedPresets[presetName] : undefined;

  return {
    resolvePreset,

    async processBuffer(
      buffer: Buffer,
      procOptions: ProcessImageBufferOptions = {},
    ): Promise<ProcessedImageBufferResult> {
      return semaphore.run(() =>
        processImageBuffer(buffer, {
          maxDimensions: defaultMaxDimensions,
          optimizationTimeoutMs,
          blurTimeoutMs,
          includeBlurHash: defaultIncludeBlurHash,
          ...procOptions,
        }),
      );
    },

    async uploadImage(
      input,
      uploadOptions: ImageUploadOptions<InferredPresetKey<TPresets>> = {},
    ): Promise<UploadedImageData> {
      const presetConfig = resolvePreset(uploadOptions.preset);

      const bucket =
        uploadOptions.bucket || presetConfig?.bucket || defaultBucket;
      const folder =
        uploadOptions.folder ?? presetConfig?.folder ?? defaultFolder;
      const maxSizeMB =
        uploadOptions.maxSizeMB ??
        presetConfig?.maxSizeMB ??
        defaultMaxSizeMB;
      const allowedFormats =
        uploadOptions.allowedFormats ??
        presetConfig?.allowedFormats ??
        defaultAllowedFormats;
      const maxDimensions =
        uploadOptions.maxDimensions ??
        presetConfig?.maxDimensions ??
        defaultMaxDimensions;
      const outputFormat =
        uploadOptions.outputFormat ?? presetConfig?.outputFormat;
      const quality = uploadOptions.quality ?? presetConfig?.quality;
      const includeBlurHash =
        uploadOptions.includeBlurHash ??
        presetConfig?.includeBlurHash ??
        defaultIncludeBlurHash;

      const isWebFile = typeof (input as File).arrayBuffer === 'function';
      const fileType = input.type;
      const originalName = input.name;
      const fileSize = isWebFile
        ? (input as File).size
        : ((input as { size?: number; buffer: Buffer }).size ??
          (input as { buffer: Buffer }).buffer.length);

      const validation = validateImageFileStrict(
        { size: fileSize, type: fileType },
        maxSizeMB,
        allowedFormats,
      );
      if (!validation.valid) {
        throw new UploadValidationError(validation.error!);
      }

      try {
        const originalBuffer = isWebFile
          ? Buffer.from(await (input as File).arrayBuffer())
          : (input as { buffer: Buffer }).buffer;

        const { optimized, blurData, contentHash, originalSize } =
          await semaphore.run(() =>
            processImageBuffer(originalBuffer, {
              maxDimensions,
              outputFormat,
              quality,
              includeBlurHash,
              optimizationTimeoutMs,
              blurTimeoutMs,
            }),
          );

        const mainFormat = optimized.format;
        const extension = formatToExtension(mainFormat);
        const mainContentType =
          mainFormat === 'svg' ? 'image/svg+xml' : `image/${mainFormat}`;

        const { uploadResult, storageTarget } = await uploadWithCollisionRetry({
          storage,
          buildPath,
          pathContext: {
            bucket,
            folder,
            preset: uploadOptions.preset,
            format: mainFormat,
            extension,
            customFilename: uploadOptions.customFilename,
            contentHash,
            originalName,
            metadata: uploadOptions.metadata,
          },
          data: optimized.buffer,
          contentType: mainContentType,
        });

        const resolvedUrl = mirrorBufferLocally({
          buffer: optimized.buffer,
          filename: storageTarget.filename,
          fallbackUrl: uploadResult.url,
          mirrorDir: presetConfig?.mirrorDir,
          publicUrlBase: presetConfig?.publicUrlBase,
        });

        const resolvedQuality = quality ?? 85;
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
            quality: resolvedQuality,
          };

          if (awaitRecordHook) {
            await onUploadRecord(record);
          } else {
            Promise.resolve(onUploadRecord(record)).catch(() => {
              // Non-blocking best-effort persistence
            });
          }
        }

        return result;
      } catch (error) {
        if (error instanceof UploadValidationError) {
          throw error;
        }
        throw new Error(
          `Image upload failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    },

    async deleteImage(targetPath: string, bucket?: string): Promise<void> {
      try {
        await storage.delete(bucket || defaultBucket, targetPath);
      } catch (error) {
        throw new Error(
          `Image deletion failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    },

    async deleteByUrl(url: string): Promise<boolean> {
      if (storage.deleteByUrl) {
        return storage.deleteByUrl(url);
      }
      return false;
    },
  };
}
