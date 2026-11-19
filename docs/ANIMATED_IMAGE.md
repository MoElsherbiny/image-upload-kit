# AnimatedImage & Blur-Up Reveal Guide

`<AnimatedImage />` is a zero-layout-shift progressive blur-up image primitive available across **React** (`img-upload-kit/react`), **Vue 3 / Nuxt 4** (`img-upload-kit/vue`), **Angular 17–21+** (`img-upload-kit/angular`), and **React Native / Expo** (`img-upload-kit/react-native`).

---

## 1. Key Capabilities & Multi-Platform Availability

- **Multi-Platform Parity**:
  - **React / Next.js**: `<AnimatedImage>` & `useImageReveal` from `img-upload-kit/react` (supports `as={Image}` for `next/image`).
  - **Vue 3 / Nuxt 4**: `<AnimatedImage>` (`<IukAnimatedImage>`) & `useImageReveal` from `img-upload-kit/vue`.
  - **Angular 17–21+**: `createImageReveal`, `mountAnimatedImage`, & `AnimatedImageComponent` from `img-upload-kit/angular`.
  - **React Native / Expo**: `<AnimatedImage>` (`<NativeAnimatedImage>`) from `img-upload-kit/react-native` (supports `as={Image}` for `expo-image`).
- **Hierarchical Placeholders**: Resolves `blurDataUrl` > `blurHash` > `blurColor` (`colorPlaceholder="flat"` wrapper background by default, or `"gradient"` SVG fallback).
- **Smooth Scale-Settle Reveal**: Transitions over `600ms` (`animationDuration = 600`) from `opacity: 0; scale(1.02)` to `opacity: 1; scale(1)` (`revealScale = 1.02`) after `HTMLImageElement.decode()` resolves.
- **Resilient Error & Motion Accessibility**: Preserves the placeholder on load failure, retries `fallbackSrc` once if provided, exposes `renderError={({ src, retry }) => ...}`, sets `aria-busy`, and honors `prefers-reduced-motion: reduce`.

---

## 2. Basic React Usage

```tsx
import type { UploadedImageData } from 'img-upload-kit';
import { AnimatedImage } from 'img-upload-kit/react';
import 'img-upload-kit/styles.css';

export function ProductHero({ image }: { image: UploadedImageData }) {
  return (
    <div style={{ width: 800, height: 500, borderRadius: 16, overflow: 'hidden' }}>
      {/* Pass UploadedImageData directly via `image`, or pass explicit src/alt/blur* props */}
      <AnimatedImage image={image} width={800} height={500} showShimmer />
    </div>
  );
}
```

---

## 3. Next.js App Router Integration (`as={Image}`)

Pass `next/image` via `as`. First-class `priority` and `quality` props forward cleanly without conflicting with `loading="lazy"`:

```tsx
import Image from 'next/image';
import type { UploadedImageData } from 'img-upload-kit';
import { AnimatedImage } from 'img-upload-kit/react';
import 'img-upload-kit/styles.css';

export function Banner({ image }: { image: UploadedImageData }) {
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9' }}>
      <AnimatedImage
        as={Image}
        image={image}
        alt={image.altText || 'Banner'}
        fill
        priority
        quality={85}
        sizes="(max-width: 768px) 100vw, 1200px"
        fallbackSrc="/images/fallback.webp"
      />
    </div>
  );
}
```

### Vue 3, Angular & React Native Imports

```ts
import { AnimatedImage as VueAnimatedImage, useImageReveal as useVueReveal } from 'img-upload-kit/vue';
import { createImageReveal, mountAnimatedImage } from 'img-upload-kit/angular';
import { AnimatedImage as NativeAnimatedImage } from 'img-upload-kit/react-native';

export { VueAnimatedImage, useVueReveal, createImageReveal, mountAnimatedImage, NativeAnimatedImage };
```

---

## 4. Props Reference (`AnimatedImageProps`)

All standard HTML `<img>` attributes (`loading`, `decoding`, `sizes`, `crossOrigin`, etc.) pass through on web. Either `image` (`AnimatedImageSource`) or `src` + `alt` is required.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `image` | `AnimatedImageSource` | `undefined` | Shorthand `UploadedImageData` object (`url`, `blurDataUrl`, `blurHash`, `blurColor`, `srcSet`). |
| `src` / `alt` | `string` | *(Required if no `image`)* | Image URL and accessible description (`""` for decorative). |
| `blurDataUrl` | `string \| null` | `undefined` | WebP LQIP base64 data URL (highest priority). |
| `blurHash` | `string \| null` | `undefined` | Compact BlurHash decoded client-side when `blurDataUrl` is absent. |
| `blurColor` | `string \| null` | `undefined` | Dominant hex/rgb color or CSS token (`var(--card-bg)`). |
| `colorPlaceholder` | `'flat' \| 'gradient'` | `'flat'` | When only `blurColor` is present: flat background (`'flat'`) or inline SVG gradient (`'gradient'`). |
| `aspectRatio` | `ImageAspectRatio` | `undefined` | CSS aspect ratio (`'1:1'`, `'4:5'`, `'9:16'`, `'16:9'`, `number`). |
| `fill` | `boolean` | `false` | Absolutely fill positioned parent (`inset: 0`). |
| `priority` | `boolean` | `false` | Sets `loading="eager"` + `fetchPriority="high"` (or forwards `priority` to `as`). |
| `quality` | `number` | `undefined` | Quality hint (`1–100`) forwarded only when `as` is provided. |
| `objectFit` | `AnimatedImageObjectFit` | `'cover'` | `'cover' \| 'contain' \| 'fill' \| 'none' \| 'scale-down'`. |
| `animationDuration` | `number` | `600` | Reveal transition duration in milliseconds. |
| `revealScale` | `number` | `1.02` | Initial pre-reveal scale (`scale(1.02) -> scale(1)`; pass `1` for pure opacity fade). |
| `showShimmer` | `boolean` | `false` | Displays an animated highlight pass while loading. |
| `fallbackSrc` | `string` | `undefined` | Backup URL tried once if primary `src` fails to load. |
| `renderError` | `(ctx) => ReactNode` | `undefined` | Custom recovery UI receiving `{ src, retry }`. |
| `as` | `ElementType` | `undefined` | Custom image component (e.g. `next/image`). |
| `imageComponentProps` | `Record<string, unknown>` | `undefined` | Extra props forwarded exclusively to `as`. |
| `unstyled` | `boolean` | `false` | Strips all `iuk-animated-image*` classes. |

---

## 5. Placeholder Priority, Slots & CSS Custom Properties

```ts
import {
  createFallbackBlurSvg,
  resolveMeaningfulColor,
  resolvePlaceholderUrl,
} from 'img-upload-kit/react';

resolveMeaningfulColor('#ffffff'); // -> undefined (neutral white skipped by default)
resolveMeaningfulColor('#3a7bd5'); // -> '#3a7bd5'
const placeholder = resolvePlaceholderUrl({ blurColor: '#3a7bd5' });
const svg = createFallbackBlurSvg('#3a7bd5');
console.log(placeholder, svg.length);
```

- **Slots & State**: `data-slot="animated-image"`, `data-slot="animated-image-placeholder"`, `data-slot="animated-image-shimmer"`, `data-state="loading | loaded | error"`, and `aria-busy="true"` while decoding.
- **Crossfade Timing**: Main image transitions opacity and `scale(1.02 -> 1)` over `animationDuration` (`600ms`); placeholder (`scale(1.1)`, `blur(20px)`) fades over `duration * 5 / 6` (`500ms`) and unmounts at `duration + 50ms`.

```css
:root {
  --iuk-animated-image-blur: 20px;
  --iuk-animated-image-placeholder-scale: 1.1;
  --iuk-animated-image-reveal-scale: 1.02;
  --iuk-animated-image-duration: 600ms;
  --iuk-animated-image-shimmer: rgba(255, 255, 255, 0.1);
}
```

---

## 6. Headless Hook: `useImageReveal`

```tsx
import { useImageReveal } from 'img-upload-kit/react';

export function CustomBlurUpImage({ src, alt, placeholderUrl }: { src: string; alt: string; placeholderUrl: string }) {
  const { isLoaded, showPlaceholder, hasError, imgRef, handleLoad, handleError } =
    useImageReveal({
      srcKey: src,
      animationDuration: 600,
      onLoad: (img) => console.log('Image decoded', img?.naturalWidth),
    });

  return (
    <div className="relative overflow-hidden">
      {showPlaceholder && (
        <img
          src={placeholderUrl}
          alt=""
          aria-hidden="true"
          className={isLoaded ? 'opacity-0' : 'opacity-100'}
        />
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={(e) => handleLoad(e.currentTarget)}
        onError={handleError}
        className={isLoaded ? 'opacity-100' : 'opacity-0'}
      />
      {hasError && <div>Failed to load image</div>}
    </div>
  );
}
```
