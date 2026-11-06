# img-upload-kit

Production-grade, zero-lock-in image upload and processing framework with **Sharp AVIF/WebP optimization**, **smart size-guarding**, **responsive `srcSet` variants**, **WebP LQIP & BlurHash placeholders**, **4-edge dominant color extraction**, **pluggable storage adapters**, **4 styling tiers**, and the **`<AnimatedImage />` blur-up display component** for React & Next.js.

[![Live Interactive Demo](https://img.shields.io/badge/Live%20Demo-upload--kit.buildwithsherbo.com-0284c7?style=for-the-badge)](https://upload-kit.buildwithsherbo.com)
[![npm version](https://img.shields.io/npm/v/img-upload-kit?color=38bdf8&style=for-the-badge)](https://www.npmjs.com/package/img-upload-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](./LICENSE)
[![Studio Repo](https://img.shields.io/badge/Studio%20Code-image--upload--kit--studio-1e293b?style=for-the-badge&logo=github)](https://github.com/MoElsherbiny/image-upload-kit-studio)

---

## Interactive Studio & Live Demo

Experience the full pipeline live in your browser: 👉 **[upload-kit.buildwithsherbo.com](https://upload-kit.buildwithsherbo.com)**

- **Watch Code Stream Live**: Synchronized Shiki IDE writing `<AnimatedImage />`, upload route, and UI code while the live preview mutates at 60 FPS.
- **4-Layer Placeholder Lab**: Side-by-side comparison of **4-Edge Ambient Color** (0 B runtime), **Client BlurHash** (~28 chars), **WebP LQIP Data URL** (<1 KB), and the final **Sharp AVIF/WebP** asset.
- **Sharp Size-Guard Sandbox**: Drop or paste any image to inspect real-time byte savings, responsive `srcSet` variants, dimensions, and color extraction.
- **Upgrading from v1.x?** Read the [**v2.0 Migration Guide (`MIGRATION.md`)**](./MIGRATION.md).

---

## Installation

```bash
# Client / React UI only (zero native dependencies):
npm install img-upload-kit react react-dom

# Server / Full-Stack (Next.js, Remix, Hono, SvelteKit, Node) or CLI:
npm install img-upload-kit sharp lqip-modern

# pnpm / yarn / bun:
pnpm add img-upload-kit sharp lqip-modern
```

> **Requirements**: Node.js `>= 20.0.0` on the server for `sharp` and Web Fetch `Request`/`FormData` APIs. React `>= 18.0.0` for UI components (`lucide-react` is no longer required — all icons are inlined).

---

## Subpath Exports Reference

| Subpath | Environment | Key Exports |
| --- | --- | --- |
| `img-upload-kit` | Universal | `STANDARD_PRESETS`, `defineUploadPresets`, types, color utils, validators, `createMemoryStorageAdapter`, `decodeBlurHashToDataURL`, `getBlurData` |
| `img-upload-kit/server` | Node.js | `createImageUploader`, `createUploadHttpHandler`, `optimizeImage`, `generateBlurPlaceholder`, `sniffImageFormat`, `sanitizeSvg` |
| `img-upload-kit/server/handler` | Node / Edge | Edge-safe `createUploadHttpHandler` (zero Sharp or `node:fs` imports at module load) |
| `img-upload-kit/storage` | Node / Edge | `createStorageAdapter`, `createS3StorageAdapter`, `createSupabaseStorageAdapter`, `createLocalFsStorageAdapter` |
| `img-upload-kit/blur` | Universal | `BlurService`, `createBlurService`, `decodeBlurHashToDataURL`, `LRUCache` |
| `img-upload-kit/react` | React Client | `<ImageUploadProvider>`, `<SingleImageUpload>`, `<MultiImageUpload>`, `<AnimatedImage>`, `<BlurImage>` |
| `img-upload-kit/headless` | React Client | `<HeadlessSingleUpload>`, `<HeadlessMultiUpload>`, `useSingleUpload`, `useMultiUpload`, `useDropzone` |
| `img-upload-kit/cli` | Node CLI | CLI binaries (`img-upload-kit` / `blur-cli`) for build-time manifest generation |
| `img-upload-kit/styles.css` | CSS | Complete stylesheet (`--iuk-*` tokens, dark mode, RTL) + per-layer `img-upload-kit/styles/*.css` |

---

## Universal Presets & Responsive Variants (`variantWidths`)

Built-in visual role presets balance dimension constraints, compression quality, and blur generation. By default, only raster formats (`JPEG, PNG, WebP, AVIF`) are accepted and verified via binary magic-byte sniffing; opt into sanitized SVG support per preset or uploader with `allowSvg: true`.

| Preset | Max Dimensions | Max Size | Quality | Default Formats | Notes |
| --- | --- | --- | --- | --- | --- |
| `thumbnail` | `600x600` | 5 MB | Q78 | JPEG, PNG, WebP, AVIF | Compact grid thumbnails |
| `avatar` | `512x512` | 5 MB | Q80 | JPEG, PNG, WebP, AVIF | Square user profiles |
| `card` | `1200x900` | 8 MB | Q85 | JPEG, PNG, WebP, AVIF | Content & product cards |
| `cover` | `1920x1080` | 10 MB | Q88 | JPEG, PNG, WebP, AVIF | Wide section banners |
| `hero` | `2560x1440` | 15 MB | Q92 | JPEG, PNG, WebP, AVIF | Full-bleed hero headers |
| `logo` | `800x800` | 5 MB | Q90 | JPEG, PNG, WebP, AVIF | Set `allowSvg: true` for sanitized vector SVGs |
| `original` | `4096x4096` | 25 MB | Q95 | JPEG, PNG, WebP, AVIF | Master archival fidelity |

```ts
import { defineUploadPresets } from 'img-upload-kit';

export const presets = defineUploadPresets({
  hero: {
    folder: 'banners/hero',
    maxDimensions: { width: 2560, height: 1440 },
    variantWidths: [640, 1024, 1920], // Encodes <base>-640w.avif, etc. + populates data.srcSet
    maxSizeMB: 15,
    quality: 90,
    includeBlurHash: true,
  },
  logo: {
    folder: 'brand/logos',
    maxDimensions: { width: 800, height: 800 },
    allowSvg: true, // Runs built-in allowlist SVG sanitizer before storage
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
  authorize: async ({ action, request, preset, bucket, path }) => {
    const user = await verifySession(request);
    if (!user) return false;
    if (action === 'delete') return user.role === 'admin' && bucket === 'media';
    return true;
  },
  allowClientOverrides: {
    filename: true, // Sanitized, forced to output extension, never overwrites existing files
    folder: (folder) => (folder.startsWith('users/') ? folder : null),
    dimensions: true, // Clamped to preset maxDimensions
    format: true,
    quality: true,
  },
  onError: (error, ctx) => console.error(`[upload:${ctx.action}]`, error),
});
```

---

## React Upload UI: Paste, Camera Capture, Cancel/Retry & Forms

`<SingleImageUpload>` and `<MultiImageUpload>` support **clipboard image paste** (`Ctrl+V` / `Cmd+V`), **mobile camera capture** (`capture="environment"`), **per-tile cancel & retry** (backed by per-upload `AbortController`), and **native HTML form / React Hook Form integration** (`name`, `formValue`, `ref`, `required`, `minImages`, `onBlur`):

```tsx
import { useRef, useState } from 'react';
import {
  ImageUploadProvider,
  SingleImageUpload,
  MultiImageUpload,
  type ImageUploadHandle,
} from 'img-upload-kit/react';
import type { UploadedImageData } from 'img-upload-kit';
import 'img-upload-kit/styles.css';

export function ProductMediaForm() {
  const uploadRef = useRef<ImageUploadHandle>(null);
  const [cover, setCover] = useState<UploadedImageData | null>(null);
  const [gallery, setGallery] = useState<UploadedImageData[]>([]);

  return (
    <ImageUploadProvider endpoint="/api/upload" locale="en">
      <form onSubmit={(e) => { e.preventDefault(); /* FormData includes coverUrl & galleryJson */ }}>
        <SingleImageUpload
          ref={uploadRef}
          preset="cover"
          label="Cover Photo"
          name="coverUrl"
          formValue="url"
          required
          enablePaste
          pasteTarget="document"
          capture="environment"
          value={cover}
          onChange={setCover}
        />
        <MultiImageUpload
          mode="multiple"
          preset="card"
          label="Product Gallery"
          name="galleryJson"
          formValue="json"
          required
          minImages={2}
          maxImages={10}
          value={gallery}
          onChange={setGallery}
          onUploadCancel={(id) => console.log('Cancelled tile:', id)}
        />
        <button type="submit">Save Product</button>
      </form>
    </ImageUploadProvider>
  );
}
```

---

## AnimatedImage (Progressive Blur-Up & Settle Reveal)

`<AnimatedImage />` delivers a 60 FPS settle reveal (`opacity: 0 -> 1` + `scale(1.02 -> 1)` over `600ms ease-in-out`), pre-decodes via `img.decode()` before crossfading, auto-wires responsive `srcSet` from `image.variants`, and preserves the blurred backdrop on load error with automatic `fallbackSrc` retry:

```tsx
import { AnimatedImage } from 'img-upload-kit/react';
import Image from 'next/image';
import 'img-upload-kit/styles.css';

// 1. Direct shorthand with UploadedImageData (auto-wires variants srcSet, LQIP, blurColor):
<AnimatedImage image={img} showShimmer />

// 2. Next.js App Router (as={Image} + first-class priority & quality props):
<div style={{ position: 'relative', aspectRatio: '16/9' }}>
  <AnimatedImage
    image={img}
    as={Image}
    fill
    priority
    quality={85}
    sizes="(max-width: 768px) 100vw, 1200px"
    fallbackSrc="/images/fallback-hero.webp"
    renderError={({ retry }) => <button type="button" onClick={retry}>Reload</button>}
  />
</div>
```

---

## The 4 Styling Tiers

1. **Tier 1 — CSS Variables (`--iuk-*`)**: Automatic dark mode and RTL (`dir="rtl"`) with customizable `--iuk-primary`, `--iuk-surface`, and `--iuk-radius-*` tokens.
2. **Tier 2 — Unstyled + Slots (`unstyled` + `classNames`)**: Strip built-in styles and target slots (`dropzone`, `tile`, `browseButton`) with Tailwind `data-[state=dragging|uploading|error]:*` selectors.
3. **Tier 3 — Partial Slot Renderers**: Override specific regions via `renderDropzone`, `renderPreview`, `renderTile`, `renderHeader`, or `renderEmptyDropzone`.
4. **Tier 4 — Headless Primitives (`img-upload-kit/headless`)**: Full control via `<HeadlessSingleUpload>`, `<HeadlessMultiUpload>`, `useSingleUpload`, and `useMultiUpload` (including `cancel(id)`, `retry(id)`, `retryAll()`, and clipboard paste).

---

## Documentation & Links

- [v2.0 Migration Guide (`MIGRATION.md`)](./MIGRATION.md) & [Post-v2.0 Roadmap (`ROADMAP.md`)](./ROADMAP.md)
- [AI Agent Contributor Guide (`AGENTS.md`)](./AGENTS.md)
- [Custom Styling & Headless Guide (`docs/CUSTOM_STYLING.md`)](./docs/CUSTOM_STYLING.md)
- [AnimatedImage & Blur-Up Guide (`docs/ANIMATED_IMAGE.md`)](./docs/ANIMATED_IMAGE.md)
- [Architecture & Internals (`docs/ARCHITECTURE.md`)](./docs/ARCHITECTURE.md)
- [Framework & Storage Recipes (`docs/FRAMEWORK_RECIPES.md`)](./docs/FRAMEWORK_RECIPES.md)
- [Contributing Guide (`CONTRIBUTING.md`)](./CONTRIBUTING.md) & [Changelog (`CHANGELOG.md`)](./CHANGELOG.md)

## License & Author

**Author & Identity**: [buildwithsherbo](https://www.buildwithsherbo.com/) — Mohamed Elsherbiny ([@MoElsherbiny](https://github.com/MoElsherbiny) · [mo@buildwithsherbo.com](mailto:mo@buildwithsherbo.com))
Distributed under the [MIT License](./LICENSE).
