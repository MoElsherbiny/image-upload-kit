import type { UploadLocale } from '../types';

export interface FileLike {
  name?: string;
  size: number;
  type: string;
}

export function validateImageFileStrict(
  file: FileLike,
  maxSizeMB: number,
  allowedFormats: string[],
): { valid: boolean; error?: string } {
  const maxBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum of ${maxSizeMB}MB`,
    };
  }

  if (allowedFormats.length > 0 && !allowedFormats.includes(file.type)) {
    return {
      valid: false,
      error: `File type ${file.type || 'unknown'} is not allowed. Allowed: ${allowedFormats.join(', ')}`,
    };
  }

  return { valid: true };
}

export function validateImageFile(
  file: FileLike,
  maxSizeMB: number,
  locale: UploadLocale = 'en',
  allowedFormats?: string[],
  options?: { skipSizeCheck?: boolean },
): string | null {
  if (!file.type || !file.type.startsWith('image/')) {
    return locale === 'ar'
      ? 'يرجى اختيار ملف صورة صالح'
      : 'Please select a valid image file';
  }

  if (allowedFormats && allowedFormats.length > 0 && !allowedFormats.includes(file.type)) {
    return locale === 'ar'
      ? `صيغة الملف غير مدعومة (${file.type})`
      : `Unsupported image format (${file.type})`;
  }

  if (!options?.skipSizeCheck) {
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > maxSizeMB) {
      return locale === 'ar'
        ? `يجب ألا يتجاوز حجم الملف ${maxSizeMB}MB`
        : `File size must be less than ${maxSizeMB}MB`;
    }
  }

  return null;
}

export function validateImageFileWithName(
  file: FileLike & { name: string },
  maxSizeMB: number,
  locale: UploadLocale = 'en',
): string | null {
  if (!file.type || !file.type.startsWith('image/')) {
    return locale === 'ar'
      ? `${file.name}: ليس ملف صورة صالحاً`
      : `${file.name}: Not a valid image file`;
  }

  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > maxSizeMB) {
    return locale === 'ar'
      ? `${file.name}: يجب ألا يتجاوز حجم الملف ${maxSizeMB}MB`
      : `${file.name}: File size must be less than ${maxSizeMB}MB`;
  }

  return null;
}

export function validateMultipleFiles(
  files: Array<FileLike & { name: string }>,
  maxSizeMB: number,
  currentCount: number,
  maxImages: number,
  locale: UploadLocale = 'en',
  options?: { skipSizeCheck?: boolean },
): string | null {
  if (currentCount + files.length > maxImages) {
    return locale === 'ar'
      ? `يمكن رفع ${maxImages} صورة فقط. المتبقي: ${maxImages - currentCount}.`
      : `Can only upload ${maxImages} images. ${maxImages - currentCount} remaining.`;
  }

  if (options?.skipSizeCheck) {
    return null;
  }

  const oversizedFiles: string[] = [];
  for (const file of files) {
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > maxSizeMB) {
      oversizedFiles.push(file.name);
    }
  }

  if (oversizedFiles.length > 0) {
    if (locale === 'ar') {
      return `الملفات التالية أكبر من الحد المسموح (${maxSizeMB}MB): ${oversizedFiles.join(', ')}`;
    }
    return `The following file${
      oversizedFiles.length > 1 ? 's are' : ' is'
    } too large (max ${maxSizeMB}MB): ${oversizedFiles.join(', ')}`;
  }

  return null;
}
