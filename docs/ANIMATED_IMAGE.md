# AnimatedImage & Blur-Up Reveal Guide

`<AnimatedImage />` is a high-performance, blur-up progressive image component for React (>= 18) and Next.js. It delivers instant visual feedback, eliminates Cumulative Layout Shift (CLS), and provides a GPU-accelerated crossfade from low-quality placeholders to sharp hero assets.

---

## 1. Features

- **Progressive Reveal**: Zero-layout-shift reveal with placeholder crossfade.
- **Hierarchical Placeholders**: Resolves `blurDataUrl` > `blurHash` > `blurColor` with an automatic gradient SVG fallback.
- **Framework-Agnostic**: Works with native `<img>`, Next.js `next/image` (`as={Image}`), Remix, Astro, or Gatsby.
- **Headless Reveal State Machine**: Powered by `useImageReveal` hook with pre-decode verification via `HTMLImageElement.decode()`.
- **CSS-Powered Transition**: 700ms staggered fade-in, customizable shimmer effect, and dark mode tokens.
- **Accessibility & Reduced Motion**: Sets `aria-busy` during loading and respects `prefers-reduced-motion: reduce`.

---

## 2. Basic React Usage

```tsx
import { AnimatedImage } from 'img-upload-kit/react';
import 'img-upload-kit/styles.css';

export function ProductHero({ image }: { image: UploadedImageData }) {
  return (
    <div style={{ width: 800, height: 500, borderRadius: 16, overflow: 'hidden' }}>
      {/* Shorthand: pass UploadedImageData directly via `image`, or pass explicit src/alt/blur* props */}
      <AnimatedImage image={image} width={800} height={500} showShimmer />
    </div>
  );
}
```

---

## 3. Next.js App Router Integration (`as={Image}`)

Pass `next/image` via the `as` prop. `AnimatedImage` forwards image props (`fill`, `sizes`, `priority`) directly while preserving blur-up crossfade orchestration:

```tsx
import Image from 'next/image';
import { AnimatedImage } from 'img-upload-kit/react';
import 'img-upload-kit/styles.css';

export function Banner({ image }: { image: UploadedImageData }) {
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9' }}>
      <AnimatedImage
        as={Image}
        src={image.url}
        alt={image.altText || 'Banner'}
        blurDataUrl={image.blurDataUrl}
        blurHash={image.blurHash}
        blurColor={image.blurColor}
        fill
        sizes="(max-width: 768px) 100vw, 1200px"
        imageComponentProps={{ priority: true, quality: 85 }}
      />
    </div>
  );
}
```

---

## 4. Props Reference (`AnimatedImageProps`)

All standard HTML `<img>` attributes (`loading`, `decoding`, `sizes`, `crossOrigin`, etc.) pass through directly.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `string` | *(Required)* | Image source URL. |
| `alt` | `string` | *(Required)* | Accessible description (`""` for decorative). |
| `blurDataUrl` | `string \| null` | `undefined` | WebP LQIP base64 data URL (highest priority). |
| `blurHash` | `string \| null` | `undefined` | Compact BlurHash decoded client-side on canvas. |
| `blurColor` | `string \| null` | `undefined` | Dominant hex/rgb color; powers background and gradient SVG fallback. |
| `fill` | `boolean` | `false` | Absolutely fill parent container (`inset: 0`). |
| `objectFit` | `AnimatedImageObjectFit` | `'cover'` | `'cover' \| 'contain' \| 'fill' \| 'none' \| 'scale-down'`. |
| `objectPosition`| `CSSProperties['objectPosition']` | `'center'` | CSS object-position coordinate. |
| `showShimmer` | `boolean` | `false` | Displays an animated highlight pass during loading. |
| `animationDuration` | `number` | `700` | Crossfade duration in milliseconds. |
| `as` | `ElementType` | `undefined` | Custom renderer component (e.g. `next/image`). |
| `imageComponentProps` | `Record<string, unknown>` | `undefined` | Props passed exclusively to the `as` component. |
| `unstyled` | `boolean` | `false` | Removes all `iuk-animated-image*` classes. |
| `wrapperClassName` | `string` | `undefined` | Custom class name for the outer container. |
| `wrapperStyle` | `CSSProperties` | `undefined` | Inline styles for the outer container. |
| `wrapperProps` | `HTMLAttributes<HTMLDivElement>` | `undefined` | Extra attributes spread onto container `<div>`. |
| `placeholderClassName` | `string` | `undefined` | Class name applied to placeholder element. |
| `onLoad` | `(img: HTMLImageElement \| null) => void` | `undefined` | Fires after `HTMLImageElement.decode()` resolves. |
| `onError` | `(event: SyntheticEvent) => void` | `undefined` | Error handler on load failure. |

---

## 5. Placeholder Priority & Fallback Logic

`resolvePlaceholderUrl({ blurDataUrl, blurHash, blurColor })` selects placeholders deterministically:

1. **`blurDataUrl`**: If present, returned directly.
2. **`blurHash`**: If `blurDataUrl` is absent and `document` is available, decodes to a 32x32 WebP/PNG data URL via `decodeBlurHashToDataURL`.
3. **`blurColor`**: If valid and non-neutral, builds an SVG gradient using the color.
4. **Neutral SVG Gradient**: If color is absent, invalid, or neutral (`#000000`, `#ffffff`, `#1a1a1a`), returns an inline SVG gradient from `#2c3340` to `#1e242d`.

```ts
import {
  createFallbackBlurSvg,
  resolveMeaningfulColor,
  resolvePlaceholderUrl,
} from 'img-upload-kit/react';

// Returns undefined for empty or generic black/white DB placeholders:
resolveMeaningfulColor('#ffffff'); // -> undefined
resolveMeaningfulColor('#3a7bd5'); // -> '#3a7bd5'

// Generate inline SVG gradient string:
const svg = createFallbackBlurSvg('#3a7bd5');
```

---

## 6. Semantic Slots & CSS Custom Properties

### Data Attributes

- `data-slot="animated-image"`: Outer wrapper element.
- `data-slot="animated-image-placeholder"`: Blurry placeholder image element.
- `data-slot="animated-image-shimmer"`: Shimmer highlight bar.
- `data-state="loading | loaded | error"`: Dynamic reveal state.
- `aria-busy="true"`: Present while the image is loading; removed upon decode.

### CSS Design Tokens

```css
:root {
  --iuk-animated-image-bg: rgba(38, 45, 56, 0.4);
  --iuk-animated-image-blur: 20px;
  --iuk-animated-image-shimmer: rgba(255, 255, 255, 0.12);
  --iuk-animated-image-duration: 700ms;
}
```

### Staggered Crossfade Timing

`AnimatedImage` staggers the crossfade to avoid visual "dipping":
- The placeholder layer stays 100% opaque for the first 25% of `animationDuration`.
- The placeholder fades out over the remaining 75% (`transition-delay: 25%`).
- Once the transition finishes, the placeholder DOM element is completely unmounted.

---

## 7. Headless Hook: `useImageReveal`

For completely custom DOM structures, use `useImageReveal` directly:

```tsx
import { useImageReveal } from 'img-upload-kit/react';

export function CustomBlurUpImage({ src, alt, placeholderUrl }: Props) {
  const { isLoaded, showPlaceholder, hasError, imgRef, handleLoad, handleError } =
    useImageReveal({
      srcKey: src,
      animationDuration: 500,
      onLoad: (img) => console.log('Image decoded', img?.naturalWidth),
    });

  return (
    <div className="relative overflow-hidden">
      {showPlaceholder && (
        <img
          src={placeholderUrl}
          alt=""
          aria-hidden="true"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
            isLoaded ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={(e) => handleLoad(e.currentTarget)}
        onError={handleError}
        className={`h-full w-full object-cover transition-opacity duration-500 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {hasError && <div className="text-red-500">Failed to load image</div>}
    </div>
  );
}
```

### `useImageReveal` Key Guarantees

1. **Synchronous Reset**: Clears state immediately on `srcKey` change to eliminate stale-frame flashes.
2. **Pre-Decode Verification**: Awaits `img.decode()` before triggering reveal, avoiding stutter.
3. **Cached Image Detection**: Automatically detects pre-cached images on initial mount via `requestAnimationFrame`.
4. **Memory Safety**: Cleans up all pending timers and decode callbacks on unmount.
