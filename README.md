# img-upload-kit

Production-grade, zero-lock-in image upload and processing framework for **React, Next.js, Angular, and React Native / Expo** with **Sharp AVIF/WebP optimization**, **smart size-guarding**, **responsive `srcSet` variants**, **social & e-commerce aspect cropping (`1:1`, `4:5`, `9:16`)**, **WebP LQIP & BlurHash placeholders**, **4-edge dominant color extraction**, **pluggable storage adapters**, and the **`<AnimatedImage />` blur-up display component**.

[![Live Interactive Demo](https://img.shields.io/badge/Live%20Demo-upload--kit.buildwithsherbo.com-0284c7?style=for-the-badge)](https://upload-kit.buildwithsherbo.com)
[![npm version](https://img.shields.io/npm/v/img-upload-kit?color=38bdf8&style=for-the-badge)](https://www.npmjs.com/package/img-upload-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](./LICENSE)
[![Studio Repo](https://img.shields.io/badge/Studio%20Code-image--upload--kit--studio-1e293b?style=for-the-badge&logo=github)](https://github.com/MoElsherbiny/image-upload-kit-studio)

---

## Interactive Studio & Live Demo

Experience the full multi-platform pipeline live in your browser: 👉 **[upload-kit.buildwithsherbo.com](https://upload-kit.buildwithsherbo.com)**

- **Live Framework Switcher (`React` | `Angular` | `React Native`)**: Watch synchronized Shiki IDE code stream live across React, Angular 17–19+, and React Native / Expo while the 60 FPS preview updates in real time.
- **Social Aspect Framing & E-Commerce Reordering**: Test `16:10`, `1:1` Square, `4:5` Portrait, and `9:16` Story aspect ratios alongside interactive product gallery reordering (`Cover` badge + `move` / `setCover`).
- **4-Layer Placeholder Lab & Sharp Size-Guard Sandbox**: Compare **4-Edge Ambient Color** (0 B runtime), **Client BlurHash** (~28 chars), **WebP LQIP Data URL** (<1 KB), and final **Sharp AVIF/WebP** assets.
- **Upgrading from v1.x?** Read the [**v2.0 Migration Guide (`MIGRATION.md`)**](./MIGRATION.md).

---

## Multi-Platform Matrix & Subpath Reference

| Subpath | Target Platform | Key Exports | Guide |
| --- | --- | --- | --- |
| `img-upload-kit` | Universal | `STANDARD_PRESETS`, `defineUploadPresets`, `resolveAspectRatio`, validators, color utils, `decodeBlurHashToDataURL` | [Architecture](./docs/ARCHITECTURE.md) |
| `img-upload-kit/client` | Web / Angular / RN | `xhrUpload`, `createUploadTracker`, `runUploadQueue`, `moveItem`, `promoteToCover`, `runTransformAsset` | [Architecture](./docs/ARCHITECTURE.md) |
| `img-upload-kit/react` | React & Next.js | `<ImageUploadProvider>`, `<SingleImageUpload>`, `<MultiImageUpload>`, `<AnimatedImage>`, `<BlurImage>` | [Styling](./docs/CUSTOM_STYLING.md) |
| `img-upload-kit/headless` | React Headless | `<HeadlessSingleUpload>`, `<HeadlessMultiUpload>`, `useSingleUpload`, `useMultiUpload`, `useDropzone` | [Styling](./docs/CUSTOM_STYLING.md) |
| `img-upload-kit/angular` | Angular 17–19+ | `provideImageUploadConfig`, `createSingleUpload`, `createMultiUpload`, `createImageReveal`, `mountAnimatedImage` | [**Angular Guide**](./docs/angular.md) |
| `img-upload-kit/react-native` | Expo & Bare RN | `<NativeImageUploadProvider>`, `useNativeSingleUpload`, `useNativeMultiUpload`, `<AnimatedImage>`, picker adapters | [**React Native Guide**](./docs/react-native.md) |
| `img-upload-kit/server` | Node.js (`>=20`) | `createImageUploader`, `createUploadHttpHandler`, `optimizeImage`, `generateBlurPlaceholder`, `sniffImageFormat`, `sanitizeSvg` | [Server Recipes](./docs/FRAMEWORK_RECIPES.md) |
| `img-upload-kit/server/handler` | Node / Edge | Edge-safe `createUploadHttpHandler` (zero Sharp or `node:fs` imports at module load) | [Server Recipes](./docs/FRAMEWORK_RECIPES.md) |
| `img-upload-kit/storage` | Node / Edge | `createStorageAdapter`, `createS3StorageAdapter`, `createSupabaseStorageAdapter`, `createLocalFsStorageAdapter` | [Server Recipes](./docs/FRAMEWORK_RECIPES.md) |
| `img-upload-kit/blur` | Universal | `BlurService`, `createBlurService`, `decodeBlurHashToDataURL`, `LRUCache` | [AnimatedImage](./docs/ANIMATED_IMAGE.md) |
| `img-upload-kit/cli` | Node CLI | CLI binaries (`img-upload-kit` / `blur-cli`) for build-time manifest generation | [Architecture](./docs/ARCHITECTURE.md) |
| `img-upload-kit/styles.css` | CSS (React/Angular) | Complete stylesheet (`--iuk-*` tokens, dark mode, RTL) + per-layer `img-upload-kit/styles/*.css` | [Styling](./docs/CUSTOM_STYLING.md) |

---

## Installation

```bash
# Client UI (React, Angular, or React Native — zero native dependencies):
npm install img-upload-kit

# Server / Full-Stack (Next.js, Remix, Hono, SvelteKit, Express, Node) or CLI:
npm install img-upload-kit sharp lqip-modern
```

---

## Universal Presets, Social Aspect Cropping & Variants (`variantWidths`)

Built-in visual role presets balance dimension constraints, smart aspect cropping (`crop: 'attention'`), compression quality, and responsive `variantWidths`. Only raster formats (`JPEG, PNG, WebP, AVIF`) are accepted by default via binary magic-byte sniffing; opt into sanitized SVG support with `allowSvg: true`.

| Preset | Max Dimensions | Aspect / Crop | Variants | Max Size | Quality | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `thumbnail` | `600x600` | Fit inside | — | 5 MB | Q78 | Compact grid thumbnails |
| `avatar` | `512x512` | Fit inside | — | 5 MB | Q80 | User profile pictures |
| `card` | `1200x900` | Fit inside | — | 8 MB | Q85 | Content & article cards |
| `cover` | `1920x1080` | Fit inside | — | 10 MB | Q88 | Wide section banners |
| `hero` | `2560x1440` | Fit inside | — | 15 MB | Q92 | Full-bleed hero headers |
| `logo` | `800x800` | Fit inside | — | 5 MB | Q90 | Set `allowSvg: true` for sanitized vector SVGs |
| `original` | `4096x4096` | Fit inside | — | 25 MB | Q95 | Master archival fidelity |
| `square` | `1600x1600` | `1:1` (`attention`) | `[400, 800, 1200]` | 12 MB | Q88 | E-commerce product galleries & square posts |
| `portrait` | `1080x1350` | `4:5` (`attention`) | `[480, 720]` | 12 MB | Q86 | Instagram vertical feed posts & lookbooks |
| `story` | `1080x1920` | `9:16` (`attention`) | `[540, 720]` | 15 MB | Q86 | Stories, Reels & full-screen mobile covers |

```ts
import { defineUploadPresets, STANDARD_PRESETS } from 'img-upload-kit';

export const presets = defineUploadPresets({
  ...STANDARD_PRESETS,
  hero: {
    ...STANDARD_PRESETS.hero,
    folder: 'banners/hero',
    variantWidths: [640, 1024, 1920], // Encodes <base>-640w.avif, etc. + populates data.srcSet
    includeBlurHash: true,
  },
});
```

---

## Server Uploader & Secure-by-Default HTTP Handler

`createUploadHttpHandler` enforces binary magic-byte sniffing, streaming `maxBodyBytes` limits (HTTP `413`), `allowedOrigins` CSRF checks (HTTP `403`), bucket allowlists on `DELETE`, and generic `500` responses with `onError`. Client `FormData` overrides are ignored unless explicitly enabled in `allowClientOverrides`:

```ts
// app/api/upload/route.ts (Next.js App Router, Remix, Hono, SvelteKit)
import { createImageUploader, createUploadHttpHandler } from 'img-upload-kit/server';
import { createS3StorageAdapter } from 'img-upload-kit/storage';
import { presets } from '@/lib/upload-presets';

const storage = createS3StorageAdapter({
  publicBaseUrl: 'https://cdn.example.com',
  defaultBucket: 'media',
  putObject: (input) => s3.send(new PutObjectCommand(input)),
  deleteObject: (input) => s3.send(new DeleteObjectCommand(input)),
});

export const uploader = createImageUploader({ storage, defaultBucket: 'media', presets });

export const { POST, DELETE } = createUploadHttpHandler({
  uploader,
  maxBodyBytes: 16 * 1024 * 1024,
  allowedOrigins: ['https://app.example.com'],
  authorize: async ({ action, request, bucket }) => {
    const user = await verifySession(request);
    if (!user) return false;
    return action === 'delete' ? user.role === 'admin' && bucket === 'media' : true;
  },
  allowClientOverrides: {
    filename: true,
    folder: (folder) => (folder.startsWith('users/') ? folder : null),
    dimensions: true,
    aspectRatio: true,
    crop: true,
    format: true,
    quality: true,
  },
});
```

---

## React Upload UI: Paste, Camera, Reordering, `transformAsset` & Forms

`<SingleImageUpload>` and `<MultiImageUpload>` support **clipboard paste** (`Ctrl+V`), **mobile camera capture** (`capture="environment"`), **e-commerce gallery reordering** (`reorderable`, `showCoverBadge`, `onReorder`, `move`, `setCover`), **pre-upload client transformations** (`transformAsset`), **per-tile cancel & retry**, and **native HTML / React Hook Form integration**:

```tsx
import { useState } from 'react';
import { ImageUploadProvider, SingleImageUpload, MultiImageUpload } from 'img-upload-kit/react';
import type { UploadedImageData } from 'img-upload-kit';
import 'img-upload-kit/styles.css';

export function ProductMediaForm() {
  const [cover, setCover] = useState<UploadedImageData | null>(null);
  const [gallery, setGallery] = useState<UploadedImageData[]>([]);

  return (
    <ImageUploadProvider endpoint="/api/upload" locale="en">
      <SingleImageUpload
        preset="portrait"
        aspectRatio="4:5"
        label="Social Feed Cover (4:5)"
        name="coverUrl"
        enablePaste
        capture="environment"
        value={cover}
        onChange={setCover}
        transformAsset={async (file) => file /* optional client cropper / watermark */}
      />
      <MultiImageUpload
        mode="multiple"
        preset="square"
        label="Product Gallery (Drag or click to reorder Cover)"
        name="galleryJson"
        reorderable
        showCoverBadge
        maxImages={8}
        value={gallery}
        onChange={setGallery}
        onReorder={(ordered) => console.log('New Cover photo:', ordered[0]?.url)}
      />
    </ImageUploadProvider>
  );
}
```

---

## AnimatedImage (Progressive Blur-Up, `aspectRatio` & Settle Reveal)

`<AnimatedImage />` delivers a 60 FPS settle reveal (`opacity: 0 -> 1` + `scale(1.02 -> 1)` over `600ms`), pre-decodes via `img.decode()`, auto-wires responsive `srcSet` from `image.variants`, supports social `aspectRatio` (`'1:1' | '4:5' | '9:16' | '16:10'`), and preserves the blurred backdrop on load error:

```tsx
import { AnimatedImage } from 'img-upload-kit/react';
import Image from 'next/image';
import 'img-upload-kit/styles.css';

// 1. Direct shorthand with social aspect ratio (auto-wires variants srcSet, LQIP, blurColor):
<AnimatedImage image={img} aspectRatio="4:5" showShimmer />

// 2. Next.js App Router (as={Image} + first-class priority & quality props):
<AnimatedImage
  image={img}
  as={Image}
  aspectRatio="16:9"
  priority
  quality={85}
  sizes="(max-width: 768px) 100vw, 1200px"
  fallbackSrc="/images/fallback-hero.webp"
/>
```

---

## Documentation & Guides

- [**Angular 17–19+ Guide (`docs/angular.md`)**](./docs/angular.md) — `provideImageUploadConfig`, `createSingleUpload`, `createMultiUpload`, `mountAnimatedImage`, Reactive Forms `toControlValueAccessor()`.
- [**React Native & Expo Guide (`docs/react-native.md`)**](./docs/react-native.md) — `NativeImageUploadProvider`, Expo & RN image picker adapters, HEIC normalization, `<AnimatedImage>` with `expo-image`.
- [**E-Commerce & Social Media Guide (`docs/ecommerce-social.md`)**](./docs/ecommerce-social.md) — `square` / `portrait` / `story` presets, `reorderable` + `Cover` badge, smart attention cropping, `transformAsset`.
- [Custom Styling & 4 Headless Tiers (`docs/CUSTOM_STYLING.md`)](./docs/CUSTOM_STYLING.md) · [AnimatedImage Guide (`docs/ANIMATED_IMAGE.md`)](./docs/ANIMATED_IMAGE.md)
- [Architecture & Internals (`docs/ARCHITECTURE.md`)](./docs/ARCHITECTURE.md) · [Framework & Storage Recipes (`docs/FRAMEWORK_RECIPES.md`)](./docs/FRAMEWORK_RECIPES.md)
- [v2.0 Migration Guide (`MIGRATION.md`)](./MIGRATION.md) · [Roadmap (`ROADMAP.md`)](./ROADMAP.md) · [Changelog (`CHANGELOG.md`)](./CHANGELOG.md) · [AI Agent Guide (`AGENTS.md`)](./AGENTS.md)

## License & Author

**Author & Identity**: [buildwithsherbo](https://www.buildwithsherbo.com/) — Mohamed Elsherbiny ([@MoElsherbiny](https://github.com/MoElsherbiny) · [mo@buildwithsherbo.com](mailto:mo@buildwithsherbo.com))
Distributed under the [MIT License](./LICENSE).
