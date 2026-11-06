import { describe, expect, it } from 'vitest';
import {
  calculateReduction,
  createSuccessMessage,
  DEFAULT_BLUR_COLOR,
  defineUploadPresets,
  estimateOutputSize,
  formatFileSize,
  generateColorSvgDataURL,
  getFriendlyErrorMessage,
  getStatusMessage,
  hexToRgb,
  normalizeColorInput,
  rgbToHex,
  STANDARD_PRESETS,
  validateImageFile,
  validateImageFileStrict,
  validateImageFileWithName,
  validateMultipleFiles,
} from '../src';

describe('color utilities', () => {
  it('normalizes 3-digit and 6-digit hex inputs and rejects invalid values', () => {
    expect(normalizeColorInput(null)).toBeNull();
    expect(normalizeColorInput('   ')).toBeNull();
    expect(normalizeColorInput('abc')).toBe('#AABBCC');
    expect(normalizeColorInput('#3b82f6')).toBe('#3B82F6');
    expect(normalizeColorInput('#12345')).toBeNull();
    expect(normalizeColorInput('zzzzzz')).toBeNull();
  });

  it('converts between hex and RGB with clamping and safe fallbacks', () => {
    expect(hexToRgb('#3B82F6')).toEqual({ r: 59, g: 130, b: 246 });
    expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb('#ZZZZZZ')).toEqual({ r: 245, g: 245, b: 245 });

    expect(rgbToHex(59, 130, 246)).toBe('#3B82F6');
    expect(rgbToHex(-20, 300, 127.6)).toBe('#00FF80');
  });

  it('generates base64 SVG data URLs with normalized or fallback colors', () => {
    const dataUrl = generateColorSvgDataURL('3b82f6');
    expect(dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const svg = Buffer.from(dataUrl.split(',')[1], 'base64').toString('utf8');
    expect(svg).toContain('fill="#3B82F6"');

    const fallbackUrl = generateColorSvgDataURL('invalid-color');
    const fallbackSvg = Buffer.from(fallbackUrl.split(',')[1], 'base64').toString('utf8');
    expect(fallbackSvg).toContain(`fill="${DEFAULT_BLUR_COLOR}"`);
  });
});

describe('formatters and localized status messages', () => {
  it('formats file sizes, reduction percentages, and estimated output sizes', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
    expect(formatFileSize(-10)).toBe('0 Bytes');
    expect(formatFileSize(512)).toBe('512 Bytes');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2 MB');

    expect(calculateReduction(1000, 250)).toBe(75);
    expect(calculateReduction(0, 250)).toBe(0);

    expect(estimateOutputSize(1000, 'low')).toBe(120);
    expect(estimateOutputSize(1000, 'high')).toBe(300);
  });

  it('produces progress status and completion messages in EN and AR', () => {
    expect(getStatusMessage(25, 'en').length).toBeGreaterThan(0);
    expect(getStatusMessage(90, 'en')).toBe('✨ Polishing the final details...');
    expect(getStatusMessage(96, 'ar')).toBe('🎉 اقتربنا جداً...');

    expect(createSuccessMessage(1000, 200, true, 'en')).toContain('80% smaller!');
    expect(createSuccessMessage(500, 500, true, 'en')).toBe('✓ 500 Bytes');
    expect(createSuccessMessage(1000, 200, false, 'ar')).toContain('رائع!');
    expect(createSuccessMessage(1000, 700, false, 'en')).toContain('Reduced by 30%');
  });

  it('maps technical error strings to friendly EN and AR messages', () => {
    expect(getFriendlyErrorMessage('File size exceeds limit', 'en')).toContain('File is too large');
    expect(getFriendlyErrorMessage('File size exceeds limit', 'ar')).toContain('الملف كبير جداً');
    expect(getFriendlyErrorMessage('Invalid format', 'en')).toContain('Invalid file type');
    expect(getFriendlyErrorMessage('Network fetch failed', 'en')).toContain('Network error');
    expect(getFriendlyErrorMessage('TypeError: Failed to fetch', 'en')).toBe(
      'Network error. Please check your connection and try again.',
    );
    expect(getFriendlyErrorMessage('Operation timed out', 'ar')).toContain('انتهت مهلة الرفع');
    expect(getFriendlyErrorMessage('Custom backend message', 'en')).toBe('Custom backend message');
    expect(getFriendlyErrorMessage('', 'en')).toBe('Upload failed. Please try again.');
  });
});

describe('file validators', () => {
  const mb = 1024 * 1024;

  it('validates strictly by size and MIME allowlist', () => {
    expect(
      validateImageFileStrict({ size: 1 * mb, type: 'image/png' }, 2, ['image/png']),
    ).toEqual({ valid: true });

    const tooBig = validateImageFileStrict({ size: 3 * mb, type: 'image/png' }, 2, ['image/png']);
    expect(tooBig.valid).toBe(false);
    expect(tooBig.error).toContain('exceeds maximum of 2MB');

    const badType = validateImageFileStrict({ size: 512, type: 'image/gif' }, 2, ['image/png']);
    expect(badType.valid).toBe(false);
    expect(badType.error).toContain('is not allowed');
  });

  it('validates single files in EN and AR', () => {
    expect(validateImageFile({ size: 512, type: 'application/pdf' }, 2, 'en')).toBe(
      'Please select a valid image file',
    );
    expect(validateImageFile({ size: 512, type: 'application/pdf' }, 2, 'ar')).toBe(
      'يرجى اختيار ملف صورة صالح',
    );
    expect(
      validateImageFile({ size: 512, type: 'image/gif' }, 2, 'en', ['image/webp']),
    ).toBe('Unsupported image format (image/gif)');
    expect(
      validateImageFile({ size: 512, type: 'image/gif' }, 2, 'ar', ['image/webp']),
    ).toBe('صيغة الملف غير مدعومة (image/gif)');
    expect(validateImageFile({ size: 3 * mb, type: 'image/png' }, 2, 'en')).toBe(
      'File size must be less than 2MB',
    );
    expect(validateImageFile({ size: 3 * mb, type: 'image/png' }, 2, 'ar')).toBe(
      'يجب ألا يتجاوز حجم الملف 2MB',
    );
    expect(validateImageFile({ size: 1 * mb, type: 'image/webp' }, 2, 'en')).toBeNull();
  });

  it('validates named single files and multi-file batches', () => {
    expect(
      validateImageFileWithName({ name: 'doc.pdf', size: 100, type: 'application/pdf' }, 2, 'en'),
    ).toBe('doc.pdf: Not a valid image file');
    expect(
      validateImageFileWithName({ name: 'big.png', size: 3 * mb, type: 'image/png' }, 2, 'ar'),
    ).toBe('big.png: يجب ألا يتجاوز حجم الملف 2MB');
    expect(
      validateImageFileWithName({ name: 'ok.png', size: 100, type: 'image/png' }, 2, 'en'),
    ).toBeNull();

    const batch = [
      { name: 'a.png', size: 3 * mb, type: 'image/png' },
      { name: 'b.png', size: 4 * mb, type: 'image/png' },
    ];
    expect(validateMultipleFiles(batch, 5, 2, 3, 'en')).toBe(
      'Can only upload 3 images. 1 remaining.',
    );
    expect(validateMultipleFiles(batch, 5, 2, 3, 'ar')).toBe(
      'يمكن رفع 3 صورة فقط. المتبقي: 1.',
    );
    expect(validateMultipleFiles(batch, 2, 0, 5, 'en')).toContain('files are too large');
    expect(validateMultipleFiles([batch[0]], 2, 0, 5, 'ar')).toContain('الملفات التالية أكبر');
    expect(validateMultipleFiles(batch, 5, 0, 5, 'en')).toBeNull();
  });
});

describe('STANDARD_PRESETS and defineUploadPresets', () => {
  it('exposes universal role presets and preserves custom preset definitions', () => {
    expect(Object.keys(STANDARD_PRESETS)).toEqual([
      'thumbnail',
      'avatar',
      'card',
      'cover',
      'hero',
      'logo',
      'original',
    ]);
    expect(STANDARD_PRESETS.avatar.maxDimensions).toEqual({ width: 512, height: 512 });

    const custom = defineUploadPresets({
      productZoom: {
        folder: 'catalog/zoom',
        maxDimensions: { width: 2000, height: 2000 },
        quality: 90,
      },
    });
    expect(custom.productZoom.folder).toBe('catalog/zoom');
    expect(custom.productZoom.quality).toBe(90);
  });
});
