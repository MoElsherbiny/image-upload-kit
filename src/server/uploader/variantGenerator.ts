import type { StorageAdapter, UploadRecordHook } from '../../storage/types';
import type {
  CropStrategy,
  ImageAspectRatio,
  ImageOutputFormat,
  ImageUploadRecord,
  ImageVariant,
  UploadPresetConfig,
} from '../../types';
import { resolveAspectRatio, SVG_MIME_TYPE } from '../../types';
import {
  DEFAULT_LIMIT_INPUT_PIXELS,
  PRIMARY_AVIF_EFFORT,
} from '../optimization';
import { loadSharp } from '../optimization/loadSharp';
import { deleteMirroredFiles, mirrorBufferLocally } from './uploadRetry';

export interface GenerateImageVariantsParams {
  sourceBuffer: Buffer;
  format: ImageOutputFormat;
  quality?: number;
  effort?: number;
  limitInputPixels?: number;
  aspectRatio?: Exclude<ImageAspectRatio, 'auto'>;
  crop?: CropStrategy;
  mainWidth: number;
  mainHeight: number;
  mainUrl: string;
  baseStoragePath: string;
  baseFilename: string;
  bucket: string;
  storage: StorageAdapter;
  variantWidths?: number[];
  upsert?: boolean;
  contentHash?: string;
  metadata?: Record<string, string>;
  mirrorDir?: string;
  publicUrlBase?: string;
}

export interface GeneratedVariantsResult {
  variants: ImageVariant[];
  srcSet?: string;
}

export function buildVariantStoragePath(basePath: string, width: number): string {
  const dotIdx = basePath.lastIndexOf('.');
  const slashIdx = basePath.lastIndexOf('/');
  if (dotIdx > slashIdx && dotIdx > 0) {
    return `${basePath.slice(0, dotIdx)}-${width}w${basePath.slice(dotIdx)}`;
  }
  return `${basePath}-${width}w`;
}

export function resolveEffectiveAllowedFormats(
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

export async function generateImageVariants(
  params: GenerateImageVariantsParams,
): Promise<GeneratedVariantsResult> {
  const {
    sourceBuffer, format, quality, effort, limitInputPixels, aspectRatio, crop,
    mainWidth, mainHeight, mainUrl, baseStoragePath, baseFilename, bucket,
    storage, variantWidths, upsert = false, contentHash, metadata, mirrorDir, publicUrlBase,
  } = params;

  if (format === 'svg' || !variantWidths?.length) {
    return { variants: [] };
  }

  const targetWidths = [
    ...new Set(
      variantWidths
        .map((w) => Math.floor(w))
        .filter((w) => Number.isFinite(w) && w > 0 && w < mainWidth),
    ),
  ].sort((a, b) => a - b);

  if (targetWidths.length === 0) {
    return { variants: [] };
  }

  const sharp = await loadSharp();
  const baseQuality = Math.max(1, Math.min(100, quality ?? 85));
  const avifEffort = effort ?? PRIMARY_AVIF_EFFORT;
  const targetRatio = resolveAspectRatio(aspectRatio);
  const basePipeline = sharp(sourceBuffer, {
    failOn: 'error',
    limitInputPixels: limitInputPixels ?? DEFAULT_LIMIT_INPUT_PIXELS,
  }).rotate();

  const uploadedVariantPaths: string[] = [];
  let variants: ImageVariant[];
  try {
    variants = await Promise.all(
      targetWidths.map(async (w): Promise<ImageVariant> => {
        let branch = basePipeline
          .clone()
          .resize(
            targetRatio !== undefined
              ? {
                  width: w,
                  height: Math.max(1, Math.round(w / targetRatio)),
                  fit: 'cover',
                  position: crop || 'attention',
                  withoutEnlargement: true,
                  kernel: 'lanczos3',
                }
              : {
                  width: w,
                  withoutEnlargement: true,
                  kernel: 'lanczos3',
                },
          );

        if (format === 'jpeg') {
          branch = branch.jpeg({ quality: baseQuality, mozjpeg: true });
        } else if (format === 'png') {
          branch = branch.png({ compressionLevel: 9 });
        } else if (format === 'webp') {
          branch = branch.webp({ quality: baseQuality, effort: 4 });
        } else {
          branch = branch.avif({
            quality: baseQuality,
            effort: avifEffort,
            chromaSubsampling: '4:2:0',
            bitdepth: 8,
          });
        }

        const out = await branch.toBuffer({ resolveWithObject: true });
        const variantPath = buildVariantStoragePath(baseStoragePath, w);
        const variantFilename = buildVariantStoragePath(baseFilename, w);

        const uploaded = await storage.upload({
          bucket,
          path: variantPath,
          data: out.data,
          contentType: `image/${format}`,
          upsert,
          contentHash,
          metadata,
        });
        uploadedVariantPaths.push(uploaded.path);

        const resolvedUrl = await mirrorBufferLocally({
          buffer: out.data,
          filename: variantFilename,
          storagePath: uploaded.path,
          fallbackUrl: uploaded.url,
          mirrorDir,
          publicUrlBase,
        });

        return {
          width: out.info.width || w,
          height:
            out.info.height ||
            (targetRatio !== undefined
              ? Math.max(1, Math.round(w / targetRatio))
              : Math.max(1, Math.round((mainHeight / Math.max(1, mainWidth)) * w))),
          url: resolvedUrl,
          size: out.info.size,
          storagePath: uploaded.path,
        };
      }),
    );
  } catch (err) {
    const mirrorDirs = mirrorDir ? [mirrorDir] : [];
    await storage.delete(bucket, baseStoragePath).catch(() => {});
    await deleteMirroredFiles(mirrorDirs, baseStoragePath);
    await deleteStoredVariants({
      storage,
      bucket,
      basePath: baseStoragePath,
      mirrorDirs,
      knownVariantPaths: uploadedVariantPaths,
    });
    throw err;
  }

  const srcSet = [
    ...variants.map((v) => `${v.url} ${v.width}w`),
    `${mainUrl} ${mainWidth}w`,
  ].join(', ');

  return { variants, srcSet };
}

export function collectCandidateVariantWidths(
  presets: Record<string, UploadPresetConfig>,
  extraWidths?: Iterable<number>,
): number[] {
  const widths = new Set<number>(extraWidths);
  for (const preset of Object.values(presets)) {
    if (preset?.variantWidths) {
      for (const w of preset.variantWidths) {
        if (Number.isFinite(w) && w > 0) widths.add(Math.floor(w));
      }
    }
  }
  return [...widths];
}

export async function deleteStoredVariants(params: {
  storage: StorageAdapter;
  bucket: string;
  basePath: string;
  mirrorDirs: string[];
  knownVariantPaths?: string[];
  candidateWidths?: number[];
}): Promise<void> {
  const {
    storage,
    bucket,
    basePath,
    mirrorDirs,
    knownVariantPaths = [],
    candidateWidths = [],
  } = params;

  const paths = new Set<string>(knownVariantPaths);
  for (const w of candidateWidths) {
    paths.add(buildVariantStoragePath(basePath, w));
  }

  if (paths.size === 0) return;

  await Promise.all(
    [...paths].map(async (vPath) => {
      await storage.delete(bucket, vPath).catch(() => {});
      await deleteMirroredFiles(mirrorDirs, vPath);
    }),
  );
}

export async function invokeRecordHookWithRollback(params: {
  onUploadRecord?: UploadRecordHook;
  awaitRecordHook: boolean;
  record: ImageUploadRecord;
  storage: StorageAdapter;
  bucket: string;
  mainPath: string;
  variantPaths: string[];
  mirrorDirs: string[];
  onError?: (error: unknown, ctx: { action: 'recordHook' | 'mirrorCleanup' }) => void;
}): Promise<void> {
  const {
    onUploadRecord,
    awaitRecordHook,
    record,
    storage,
    bucket,
    mainPath,
    variantPaths,
    mirrorDirs,
    onError,
  } = params;
  if (!onUploadRecord) return;

  if (awaitRecordHook) {
    try {
      await onUploadRecord(record);
    } catch (hookError) {
      await storage.delete(bucket, mainPath).catch(() => {});
      await deleteMirroredFiles(mirrorDirs, mainPath);
      await deleteStoredVariants({
        storage,
        bucket,
        basePath: mainPath,
        mirrorDirs,
        knownVariantPaths: variantPaths,
      });
      throw hookError;
    }
  } else {
    Promise.resolve(onUploadRecord(record)).catch((err: unknown) => {
      onError?.(err, { action: 'recordHook' });
    });
  }
}
