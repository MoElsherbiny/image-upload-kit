# img-upload-kit

Production-grade, **zero-runtime-dependency** image upload and processing framework for **React, Next.js, Vue 3 / Nuxt 4, Angular 17–21+, and React Native / Expo** with **Sharp AVIF/WebP optimization**, **client-side pre-upload resize**, **presigned direct-to-storage uploads**, **content-hash deduplication**, **smart size-guarding**, **responsive `srcSet` variants**, **social & e-commerce aspect cropping (`1:1`, `4:5`, `9:16`)**, **WebP LQIP & BlurHash placeholders**, **4-edge dominant color extraction**, **pluggable storage adapters**, and the **`<AnimatedImage />` blur-up display component**.

[![Live Interactive Demo](https://img.shields.io/badge/Live%20Demo-upload--kit.buildwithsherbo.com-0284c7?style=for-the-badge)](https://upload-kit.buildwithsherbo.com)
[![npm version](https://img.shields.io/npm/v/img-upload-kit?color=38bdf8&style=for-the-badge)](https://www.npmjs.com/package/img-upload-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](./LICENSE)
[![Studio Repo](https://img.shields.io/badge/Studio%20Code-image--upload--kit--studio-1e293b?style=for-the-badge&logo=github)](https://github.com/MoElsherbiny/image-upload-kit-studio)

---

## Interactive Studio & Live Demo

Experience the full multi-platform pipeline live in your browser: 👉 **[upload-kit.buildwithsherbo.com](https://upload-kit.buildwithsherbo.com)**

- **Live Framework Switcher (`React` | `Vue` | `Angular` | `React Native`)**: Watch synchronized Shiki IDE code stream live across React, Vue 3.5+, Angular 17–21+, and React Native / Expo while the 60 FPS preview updates in real time.
- **Social Aspect Framing & Pointer-Drag Reordering**: Test `16:10`, `1:1` Square, `4:5` Portrait, and `9:16` Story aspect ratios alongside pointer drag-and-drop and keyboard product gallery reordering (`Cover` badge + `move` / `setCover`).
- **4-Layer Placeholder Lab & Sharp Size-Guard Sandbox**: Compare **4-Edge Ambient Color** (0 B runtime), **Client BlurHash** (~28 chars), **WebP LQIP Data URL** (<1 KB), and final **Sharp AVIF/WebP** assets.
- **Upgrading from v1.x?** Read the [**v2.0 Migration Guide (`MIGRATION.md`)**](./MIGRATION.md).

---

## Multi-Platform Matrix & Subpath Reference

| Subpath | Target Platform | Key Exports | Guide |
| --- | --- | --- | --- |
| `img-upload-kit` | Universal | `STANDARD_PRESETS`, `defineUploadPresets`, `resolveAspectRatio`, validators, color utils, `decodeBlurHashToDataURL` | [Architecture](./docs/ARCHITECTURE.md) |
| `img-upload-kit/client` | Web / Vue / Angular / RN | `uploadAsset`, `uploadViaPresignedUrl`, `deleteUploadedImage`, `createClientResizeTransform`, `composeTransforms`, `xhrUpload`, `createUploadTracker`, `runUploadQueue`, `moveItem`, `promoteToCover` | [**Presigned & Dedupe**](./docs/presigned-and-dedupe.md) |
| `img-upload-kit/react` | React & Next.js | `<ImageUploadProvider>`, `<SingleImageUpload>`, `<MultiImageUpload>`, `<AnimatedImage>`, `<BlurImage>` | [Styling](./docs/CUSTOM_STYLING.md) |
| `img-upload-kit/headless` | React Headless | `<HeadlessSingleUpload>`, `<HeadlessMultiUpload>`, `useSingleUpload`, `useMultiUpload`, `useDropzone` | [Styling](./docs/CUSTOM_STYLING.md) |
| `img-upload-kit/vue` | Vue 3.5+ & Nuxt 4 | `createImageUpload`, `provideImageUploadConfig` (`provideImageUpload`), `<SingleImageUpload>`, `<MultiImageUpload>`, `<AnimatedImage>`, `useSingleUpload`, `useMultiUpload`, `<HeadlessSingleUpload>`, `<HeadlessMultiUpload>` | [**Vue & Nuxt Guide**](./docs/vue.md) |
| `img-upload-kit/angular` | Angular 17–21+ | `provideImageUploadConfig`, `resolveImageUploadConfig`, `withAngularSignals`, `createSingleUpload`, `createMultiUpload`, `createImageReveal`, `mountAnimatedImage`, `mountSingleImageUpload`, `mountMultiImageUpload` | [**Angular Guide**](./docs/angular.md) |
| `img-upload-kit/react-native` | Expo & Bare RN | `<NativeImageUploadProvider>`, `useNativeSingleUpload`, `useNativeMultiUpload`, `<AnimatedImage>`, `createExpoImagePickerAdapter`, `createRnImagePickerAdapter`, `createExpoManipulatorResizeTransform` | [**React Native Guide**](./docs/react-native.md) |
| `img-upload-kit/server` | Node.js (`>=20`) | `createImageUploader`, `createUploadHttpHandler`, `createMemoryDedupeStore`, `sweepStagedUploads`, `optimizeImage`, `generateBlurPlaceholder`, `sniffImageFormat`, `sanitizeSvg` | [Server Recipes](./docs/FRAMEWORK_RECIPES.md) |
| `img-upload-kit/server/handler` | Node / Edge | Edge-safe `createUploadHttpHandler` (zero Sharp or `node:fs` imports at module load) | [Server Recipes](./docs/FRAMEWORK_RECIPES.md) |
| `img-upload-kit/storage` | Node / Edge | `createStorageAdapter`, `createS3StorageAdapter`, `createSupabaseStorageAdapter`, `createLocalFsStorageAdapter` | [Server Recipes](./docs/FRAMEWORK_RECIPES.md) |
| `img-upload-kit/blur` | Universal | `BlurService`, `createBlurService`, `decodeBlurHashToDataURL`, `LRUCache` | [AnimatedImage](./docs/ANIMATED_IMAGE.md) |
| `img-upload-kit/cli` | Node CLI | CLI binaries (`img-upload-kit` / `blur-cli`) for build-time manifest generation | [Architecture](./docs/ARCHITECTURE.md) |
| `img-upload-kit/styles.css` | CSS (React/Vue/Angular) | Complete stylesheet (`--iuk-*` tokens, dark mode, RTL) + per-layer `img-upload-kit/styles/*.css` | [Styling](./docs/CUSTOM_STYLING.md) |

---

## Installation

`img-upload-kit` ships with **zero runtime `"dependencies"`** in `package.json` for a minimal, supply-chain-hardened footprint:

```bash
# Client UI (React, Vue 3, Angular, or React Native — zero native dependencies):
npm install img-upload-kit

# Server / Full-Stack (Next.js, Nuxt, Remix, Hono, SvelteKit, Express, Node) or CLI:
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

---

## Server Uploader, Content-Hash Deduplication & Presigned Uploads

`createUploadHttpHandler` enforces binary magic-byte sniffing, streaming `maxBodyBytes` limits (HTTP `413`), `allowedOrigins` CSRF checks (HTTP `403`), bucket allowlists on `DELETE`, content-hash deduplication (`deduplicate`), and two-phase presigned direct-to-storage uploads (`presigned`):

```ts
// app/api/upload/route.ts (Next.js App Router, Nuxt, Remix, Hono, SvelteKit)
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  createImageUploader,
  createMemoryDedupeStore,
  createUploadHttpHandler,
} from 'img-upload-kit/server';
import { createS3StorageAdapter } from 'img-upload-kit/storage';

const storage = createS3StorageAdapter({
  publicBaseUrl: 'https://cdn.example.com',
  defaultBucket: 'media',
  putObject: (input) => s3.send(new PutObjectCommand(input)),
  deleteObject: (input) => s3.send(new DeleteObjectCommand(input)),
  getObject: (input) => s3.send(new GetObjectCommand(input)),
  presignUpload: async ({ bucket, path, contentType, expiresInSeconds }) => {
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: bucket, Key: path, ContentType: contentType }),
      { expiresIn: expiresInSeconds ?? 300 },
    );
    return { method: 'PUT', url, headers: { 'content-type': contentType } };
  },
});

export const uploader = createImageUploader({
  storage,
  defaultBucket: 'media',
  deduplicate: { store: createMemoryDedupeStore() },
});

export const { POST, DELETE } = createUploadHttpHandler({
  uploader,
  maxBodyBytes: 16 * 1024 * 1024,
  allowedOrigins: ['https://app.example.com'],
  presigned: process.env.UPLOAD_SECRET
    ? { secret: process.env.UPLOAD_SECRET, expiresInSeconds: 300 }
    : undefined,
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

## React Upload UI: Client Resize, Pointer-Drag Reordering & Forms

`<SingleImageUpload>` and `<MultiImageUpload>` support **client-side pre-upload resize** (`createClientResizeTransform`), **pointer drag-and-drop + keyboard gallery reordering** (`reorderable`, `showCoverBadge`, `onReorder`), **opt-in server deletion** (`deleteEndpoint` / `customDeleter`), **presigned uploads** (`uploadMode="presigned"`), **clipboard paste** (`Ctrl+V`), and **mobile camera capture**:

```tsx
import { useState } from 'react';
import { createClientResizeTransform } from 'img-upload-kit/client';
import { ImageUploadProvider, SingleImageUpload, MultiImageUpload } from 'img-upload-kit/react';
import type { UploadedImageData } from 'img-upload-kit';
import 'img-upload-kit/styles.css';

const resizeTransform = createClientResizeTransform({ maxWidth: 2048, maxHeight: 2048, quality: 0.9 });

export function ProductMediaForm() {
  const [cover, setCover] = useState<UploadedImageData | null>(null);
  const [gallery, setGallery] = useState<UploadedImageData[]>([]);

  return (
    <ImageUploadProvider endpoint="/api/upload" deleteEndpoint="/api/upload" locale="en">
      <SingleImageUpload
        preset="portrait"
        aspectRatio="4:5"
        label="Social Feed Cover (4:5)"
        name="coverUrl"
        value={cover}
        onChange={setCover}
        transformAsset={resizeTransform}
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
        transformAsset={resizeTransform}
        onReorder={(ordered) => console.log('New Cover photo:', ordered[0]?.url)}
      />
    </ImageUploadProvider>
  );
}
```

---

## Documentation & Guides

- [**Vue 3.5+ & Nuxt 4 Guide (`docs/vue.md`)**](./docs/vue.md) — `createImageUpload`, `provideImageUploadConfig` (`provideImageUpload`), `<SingleImageUpload v-model>`, `<MultiImageUpload reorderable>`, `<AnimatedImage>`, composables & Nuxt server routes.
- [**Client Resize, Presigned Uploads & Deduplication (`docs/presigned-and-dedupe.md`)**](./docs/presigned-and-dedupe.md) — `createClientResizeTransform`, `createExpoManipulatorResizeTransform`, `createMemoryDedupeStore`, `uploadMode: 'presigned'`.
- [**Angular 17–21+ Guide (`docs/angular.md`)**](./docs/angular.md) — `provideImageUploadConfig`, `withAngularSignals`, `createSingleUpload`, `createMultiUpload`, `mountAnimatedImage`, Reactive Forms `toControlValueAccessor()`.
- [**React Native & Expo Guide (`docs/react-native.md`)**](./docs/react-native.md) — `NativeImageUploadProvider`, Expo & RN image picker adapters, HEIC normalization, `<AnimatedImage>` with `expo-image`.
- [**E-Commerce & Social Media Guide (`docs/ecommerce-social.md`)**](./docs/ecommerce-social.md) — `square` / `portrait` / `story` presets, `reorderable` + `Cover` badge, smart attention cropping, `transformAsset`.
- [Custom Styling & 4 Headless Tiers (`docs/CUSTOM_STYLING.md`)](./docs/CUSTOM_STYLING.md) · [AnimatedImage Guide (`docs/ANIMATED_IMAGE.md`)](./docs/ANIMATED_IMAGE.md)
- [Architecture & Internals (`docs/ARCHITECTURE.md`)](./docs/ARCHITECTURE.md) · [Framework & Storage Recipes (`docs/FRAMEWORK_RECIPES.md`)](./docs/FRAMEWORK_RECIPES.md)
- [v2.0 Migration Guide (`MIGRATION.md`)](./MIGRATION.md) · [Roadmap (`ROADMAP.md`)](./ROADMAP.md) · [Changelog (`CHANGELOG.md`)](./CHANGELOG.md) · [AI Agent Guide (`AGENTS.md`)](./AGENTS.md)

## License & Author

**Author & Identity**: [buildwithsherbo](https://www.buildwithsherbo.com/) — Mohamed Elsherbiny ([@MoElsherbiny](https://github.com/MoElsherbiny) · [mo@buildwithsherbo.com](mailto:mo@buildwithsherbo.com))
Distributed under the [MIT License](./LICENSE).
