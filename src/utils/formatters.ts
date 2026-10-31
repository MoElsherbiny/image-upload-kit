import type { QualityLevel, UploadLocale } from '../types';
import { QUALITY_PRESETS } from '../types';

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.min(
    sizes.length - 1,
    Math.floor(Math.log(bytes) / Math.log(k)),
  );
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

export function calculateReduction(
  original: number,
  optimized: number,
): number {
  if (original <= 0) return 0;
  return Math.round(((original - optimized) / original) * 100);
}

export function estimateOutputSize(
  originalBytes: number,
  level: QualityLevel,
): number {
  return Math.round(originalBytes * QUALITY_PRESETS[level].compressionRatio);
}

const creativeMessages = [
  'Sprinkling digital magic ✨',
  'Painting pixels with perfection 🎨',
  'Launching to the cloud 🚀',
  'Creating something beautiful ⭐',
  'Transforming your vision ⚡',
  'Weaving visual excellence 💫',
  'Crafting your masterpiece 🎭',
  'Working our magic 🔮',
  'Making it pixel-perfect ✨',
  'Keep calm, creating magic 🎪',
  'Hitting the sweet spot 🎯',
  'Artist mode activated 🎨',
  'Shooting for the stars 🌠',
  'Compressing with love 💝',
  'Enhancing quality 💎',
  'Polishing to perfection ✨',
];

const creativeMessagesAr = [
  'نضيف لمسة رقمية ساحرة ✨',
  'ننسق البكسلات بإتقان 🎨',
  'الرفع جارٍ إلى السحابة 🚀',
  'نصنع شيئاً جميلاً ⭐',
  'نحوّل رؤيتك إلى واقع ⚡',
  'نبني تجربة بصرية مميزة 💫',
  'نصقل عملك باحتراف 🎭',
  'السحر جارٍ الآن 🔮',
  'نضبط كل بكسل بعناية ✨',
  'اهدأ، نحن نهتم بالتفاصيل 🎪',
  'نقترب من النتيجة المثالية 🎯',
  'وضع الإبداع مفعل 🎨',
  'نستهدف أفضل نتيجة 🌠',
  'ضغط ذكي مع الحفاظ على الجودة 💝',
  'تحسين الجودة مستمر 💎',
  'اللمسات الأخيرة قيد التنفيذ ✨',
];

let lastMessageIndex = -1;

export function getStatusMessage(
  progress: number,
  locale: UploadLocale = 'en',
): string {
  const list = locale === 'ar' ? creativeMessagesAr : creativeMessages;
  const clampedProgress = Math.max(0, Math.min(99, progress));
  const messageIndex = Math.floor((clampedProgress / 100) * list.length);

  const useRandom = Math.random() > 0.7;
  let selectedIndex = useRandom
    ? Math.floor(Math.random() * list.length)
    : messageIndex;

  if (selectedIndex === lastMessageIndex && list.length > 1) {
    selectedIndex = (selectedIndex + 1) % list.length;
  }

  lastMessageIndex = selectedIndex;

  if (progress >= 95) {
    return locale === 'ar' ? '🎉 اقتربنا جداً...' : '🎉 Almost there...';
  }
  if (progress >= 85) {
    return locale === 'ar'
      ? '✨ نضع اللمسات الأخيرة...'
      : '✨ Polishing the final details...';
  }

  return list[selectedIndex];
}

export function createSuccessMessage(
  originalSize: number,
  optimizedSize: number,
  compact: boolean = false,
  locale: UploadLocale = 'en',
): string {
  const reduction = calculateReduction(originalSize, optimizedSize);
  const original = formatFileSize(originalSize);
  const optimized = formatFileSize(optimizedSize);

  if (compact) {
    if (reduction > 50) {
      return locale === 'ar'
        ? `🎉 أصغر بنسبة ${reduction}%! (${original} → ${optimized})`
        : `🎉 ${reduction}% smaller! (${original} → ${optimized})`;
    }
    if (reduction > 0) {
      return locale === 'ar'
        ? `✓ أصغر بنسبة ${reduction}% (${original} → ${optimized})`
        : `✓ ${reduction}% smaller (${original} → ${optimized})`;
    }
    return `✓ ${optimized}`;
  }

  if (reduction > 70) {
    return locale === 'ar'
      ? `🎉 رائع! تم تقليل الحجم بنسبة ${reduction}% (${original} → ${optimized})`
      : `🎉 Amazing! Reduced by ${reduction}% (${original} → ${optimized})`;
  }
  if (reduction > 50) {
    return locale === 'ar'
      ? `✨ ممتاز! تم تقليل الحجم بنسبة ${reduction}% (${original} → ${optimized})`
      : `✨ Great! Reduced by ${reduction}% (${original} → ${optimized})`;
  }
  if (reduction > 20) {
    return locale === 'ar'
      ? `✓ اكتمل الرفع! تم تقليل الحجم بنسبة ${reduction}% (${original} → ${optimized})`
      : `✓ Upload complete! Reduced by ${reduction}% (${original} → ${optimized})`;
  }
  return locale === 'ar'
    ? `✓ اكتمل الرفع! (${original} → ${optimized})`
    : `✓ Upload complete! (${original} → ${optimized})`;
}

export function getFriendlyErrorMessage(
  error: string,
  locale: UploadLocale = 'en',
): string {
  const lower = error.toLowerCase();
  if (lower.includes('size') || lower.includes('large') || lower.includes('exceeds')) {
    return locale === 'ar'
      ? 'الملف كبير جداً. يرجى اختيار صورة أصغر.'
      : 'File is too large. Please choose a smaller image.';
  }
  if (lower.includes('type') || lower.includes('format')) {
    return locale === 'ar'
      ? 'نوع الملف غير صالح. يرجى رفع صورة صالحة (JPEG, PNG, WebP, AVIF, SVG).'
      : 'Invalid file type. Please upload a valid image (JPEG, PNG, WebP, AVIF, SVG).';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return locale === 'ar'
      ? 'حدث خطأ في الشبكة. يرجى التحقق من الاتصال والمحاولة مرة أخرى.'
      : 'Network error. Please check your connection and try again.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return locale === 'ar'
      ? 'انتهت مهلة الرفع. يرجى المحاولة مرة أخرى.'
      : 'Upload timed out. Please try again.';
  }
  if (error) return error;
  return locale === 'ar'
    ? 'فشل الرفع. يرجى المحاولة مرة أخرى.'
    : 'Upload failed. Please try again.';
}
