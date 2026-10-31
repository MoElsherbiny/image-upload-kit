# @mo-elsherbiny/image-upload-kit

Production-grade, zero-lock-in image upload and processing framework with **Sharp AVIF/WebP optimization**, **smart size-guarding**, **WebP LQIP & BlurHash placeholders**, **4-edge dominant color extraction**, **pluggable storage adapters**, **4 styling tiers**, and the **`<AnimatedImage />` blur-up display component** for React & Next.js.

[![Live Interactive Demo](https://img.shields.io/badge/Live%20Demo-upload--kit.buildwithsherbo.com-0284c7?style=for-the-badge)](https://upload-kit.buildwithsherbo.com)
[![npm version](https://img.shields.io/npm/v/@mo-elsherbiny/image-upload-kit?color=38bdf8&style=for-the-badge)](https://www.npmjs.com/package/@mo-elsherbiny/image-upload-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](./LICENSE)
[![Studio Repo](https://img.shields.io/badge/Studio%20Code-image--upload--kit--studio-1e293b?style=for-the-badge&logo=github)](https://github.com/MoElsherbiny/image-upload-kit-studio)

---

## Interactive Studio & Live Demo

Experience the full pipeline live in your browser:

👉 **[upload-kit.buildwithsherbo.com](https://upload-kit.buildwithsherbo.com)**

- **Watch Code Stream Live**: Synchronized Shiki IDE writing `<AnimatedImage />`, upload route, and UI code while the live preview mutates at 60 FPS.
- **4-Layer Placeholder Lab**: Side-by-side comparison of **4-Edge Ambient Color** (0 B runtime), **Client BlurHash** (~28 chars), **WebP LQIP Data URL** (<1 KB), and the final **Sharp AVIF/WebP** asset.
- **Sharp Size-Guard Sandbox**: Drop any image to inspect real-time byte savings, dimensions, and color extraction.
- **Studio Source Code**: Open source at [`MoElsherbiny/image-upload-kit-studio`](https://github.com/MoElsherbiny/image-upload-kit-studio).

---

## The Problems Solved

1. **Pipeline Fragmentation**: Eliminates stitching separate libraries for file validation, resizing, AVIF/WebP conversion, placeholder generation, storage uploading, and UI forms. Provides one unified pipeline from browser dropzone to CDN.
2. **AVIF Bloat on Pre-compressed JPEGs**: Naive AVIF converters expand pre-compressed inputs by 30–80%. Our **Sharp Size-Guard** evaluates output bytes against source size, scales quality proportionally, and falls back to WebP or passthrough.
3. **Cumulative Layout Shift (CLS)**: Eliminates layout shifts by generating instant **WebP LQIP data URLs** (<8KB), client-decoded **BlurHash** strings, and **4-edge ambient colors** before full-resolution assets load.
4. **Storage Vendor Lock-in**: Decouples application logic from cloud vendors via a uniform `StorageAdapter` contract across AWS S3, Cloudflare R2, Supabase, Local Filesystem, or In-Memory (testing).
5. **UI Styling Lock-in**: Provides 4 styling tiers: default `--iuk-*` CSS tokens, `unstyled` mode with Tailwind/CSS Modules, partial slot renderers, or 100% headless hooks and primitives.

---

## Installation

```bash
# npm
npm install @mo-elsherbiny/image-upload-kit
# pnpm
pnpm add @mo-elsherbiny/image-upload-kit
# yarn
yarn add @mo-elsherbiny/image-upload-kit
# bun
bun add @mo-elsherbiny/image-upload-kit

# Optional peer dependencies (only if using React or Headless UI):
npm install react react-dom
```

> **Requirements**: Node.js `>= 18.17.0` on the server for `sharp` and Web Fetch `Request`/`FormData` APIs. React `>= 18.0.0` for UI components.

---

## Subpath Exports Reference

| Subpath | Environment | Key Exports |
| --- | --- | --- |
| `@mo-elsherbiny/image-upload-kit` | Universal | `STANDARD_PRESETS`, `defineUploadPresets`, types, color utils, validators, `createMemoryStorageAdapter`, `decodeBlurHashToDataURL`, `getBlurData` |
| `@mo-elsherbiny/image-upload-kit/server` | Node.js | `createImageUploader`, `createUploadHttpHandler`, `optimizeImage`, `generateBlurPlaceholder` |
| `@mo-elsherbiny/image-upload-kit/storage` | Node / Edge | `createStorageAdapter`, `createS3StorageAdapter`, `createSupabaseStorageAdapter`, `createLocalFsStorageAdapter` |
| `@mo-elsherbiny/image-upload-kit/blur` | Universal | `BlurService`, `createBlurService`, `decodeBlurHashToDataURL`, `LRUCache` |
| `@mo-elsherbiny/image-upload-kit/react` | React Client | `<ImageUploadProvider>`, `<SingleImageUpload>`, `<MultiImageUpload>`, `<AnimatedImage>`, `<BlurImage>` |
| `@mo-elsherbiny/image-upload-kit/headless` | React Client | `<HeadlessSingleUpload>`, `<HeadlessMultiUpload>`, `useSingleUpload`, `useMultiUpload`, `useDropzone` |
| `@mo-elsherbiny/image-upload-kit/cli` | Node CLI | CLI binaries (`image-upload-kit` / `blur-cli`) for build-time manifest generation |
| `@mo-elsherbiny/image-upload-kit/styles.css` | CSS | Complete stylesheet powered by `--iuk-*` design tokens (supports dark mode & RTL) |

---

## Universal Presets Reference

Built-in visual role presets balance dimension constraints, compression quality, and blur generation:

| Preset | Max Dimensions | Max Size | Quality | Allowed Formats | Blur / Notes |
| --- | --- | --- | --- | --- | --- |
| `thumbnail` | `600x600` | 5 MB | Q78 | JPEG, PNG, WebP, AVIF | Medium quality, compact size |
| `avatar` | `512x512` | 5 MB | Q80 | JPEG, PNG, WebP, AVIF | Medium quality, square profile |
| `card` | `1200x900` | 8 MB | Q85 | JPEG, PNG, WebP, AVIF, SVG | High quality content cards |
| `cover` | `1920x1080` | 10 MB | Q88 | JPEG, PNG, WebP, AVIF, SVG | High quality wide banners |
| `hero` | `2560x1440` | 15 MB | Q92 | JPEG, PNG, WebP, AVIF, SVG | Maximum detail for hero headers |
| `logo` | `800x800` | 5 MB | Q90 | JPEG, PNG, WebP, AVIF, SVG | Vector SVG passthrough & sharp edges |
| `original` | `4096x4096` | 25 MB | Q95 | JPEG, PNG, WebP, AVIF, SVG | Preserves maximum master fidelity |

```ts
import { defineUploadPresets } from '@mo-elsherbiny/image-upload-kit';

export const presets = defineUploadPresets({
  'product-gallery': {
    folder: 'catalog/products',
    maxDimensions: { width: 1600, height: 1600 },
    maxSizeMB: 10,
    quality: 85,
    includeBlurHash: true,
  },
});
```

---

## Subpath Usage Guides

### 1. Server Uploader & Route Handler (`/server` & `/storage`)

```ts
// app/api/upload/route.ts (Next.js App Router, Remix, Hono, SvelteKit)
import { createImageUploader, createUploadHttpHandler } from '@mo-elsherbiny/image-upload-kit/server';
import { createS3StorageAdapter } from '@mo-elsherbiny/image-upload-kit/storage';

const storage = createS3StorageAdapter({
  publicBaseUrl: 'https://cdn.example.com',
  defaultBucket: 'media',
  putObject: (input) => s3.send(new PutObjectCommand(input)),
  deleteObject: (input) => s3.send(new DeleteObjectCommand(input)),
});

export const uploader = createImageUploader({ storage, defaultBucket: 'media' });
export const { POST, DELETE } = createUploadHttpHandler({ uploader });
```

### 2. Client Provider & Upload UI (`/react` & `/styles.css`)

```tsx
import { useState } from 'react';
import { ImageUploadProvider, SingleImageUpload, MultiImageUpload } from '@mo-elsherbiny/image-upload-kit/react';
import type { UploadedImageData } from '@mo-elsherbiny/image-upload-kit';
import '@mo-elsherbiny/image-upload-kit/styles.css';

export function MediaForm() {
  const [avatar, setAvatar] = useState<UploadedImageData | null>(null);
  const [gallery, setGallery] = useState<UploadedImageData[]>([]);

  return (
    <ImageUploadProvider endpoint="/api/upload" locale="en">
      <SingleImageUpload preset="avatar" label="Avatar" value={avatar} onChange={setAvatar} />
      <MultiImageUpload preset="card" label="Gallery" value={gallery} onChange={setGallery} maxImages={10} />
    </ImageUploadProvider>
  );
}
```

### 3. Build-Time Blur Manifests & Runtime Lookup (`/cli` & `/blur`)

```bash
npx image-upload-kit generate --dir ./public/images --out ./src/blur-manifest.json
```
```ts
import { createBlurService } from '@mo-elsherbiny/image-upload-kit/blur';
import manifest from './blur-manifest.json';

const blurService = createBlurService({ manifest });
const { color, blur: blurDataUrl } = blurService.getProgressiveData('/images/hero.avif');
```

---

## The 4 Styling Tiers

Customize UI components cleanly at any level of abstraction:

### Tier 1: CSS Variables (`--iuk-*`) & Automatic Dark Mode
```css
:root {
  --iuk-primary: #4f46e5;
  --iuk-primary-hover: #4338ca;
  --iuk-radius-md: 14px;
}
.dark { --iuk-primary: #818cf8; --iuk-surface: #0f172a; }
```

### Tier 2: Unstyled Mode with `classNames` & `data-[state=*]` (Tailwind CSS)
```tsx
<SingleImageUpload
  unstyled value={avatar} onChange={setAvatar}
  classNames={{
    dropzone: 'rounded-2xl border-2 border-dashed p-6 text-center data-[state=dragging]:border-indigo-500',
    browseButton: 'rounded-lg bg-indigo-600 px-4 py-2 text-white',
  }}
/>
```

### Tier 3: Partial Slot Renderers
```tsx
<SingleImageUpload
  value={avatar} onChange={setAvatar}
  renderDropzone={(ctx) => (
    <div {...ctx.dropzoneProps} className="p-8 border border-dashed rounded-xl">
      <button type="button" onClick={ctx.openFileDialog}>Select Photo</button>
    </div>
  )}
/>
```

### Tier 4: Headless Hooks & Primitives (`/headless`)
```tsx
import { HeadlessSingleUpload, useDropzone } from '@mo-elsherbiny/image-upload-kit/headless';

<HeadlessSingleUpload preset="avatar" value={avatar} onChange={setAvatar}>
  {(ctrl) => (
    <div {...ctrl.getDropzoneProps()}>
      <input {...ctrl.getInputProps()} />
      {ctrl.preview ? <img src={ctrl.preview} alt="" /> : <button type="button" onClick={ctrl.openFileDialog}>Upload</button>}
    </div>
  )}
</HeadlessSingleUpload>
```

---

## AnimatedImage (Blur-Up Display Component)

`<AnimatedImage />` provides an instant blur-up placeholder crossfade to full resolution without layout shift:

```tsx
import { AnimatedImage } from '@mo-elsherbiny/image-upload-kit/react';
import '@mo-elsherbiny/image-upload-kit/styles.css';

// 1. Direct shorthand with UploadedImageData:
<AnimatedImage image={img} showShimmer />

// 2. Explicit props in standard React:
<AnimatedImage
  src={img.url}
  alt={img.altText || 'Product'}
  blurDataUrl={img.blurDataUrl}
  blurHash={img.blurHash}
  blurColor={img.blurColor}
  width={800}
  height={600}
  showShimmer
/>

// 3. Next.js App Router (as={Image}):
import Image from 'next/image';
<div style={{ position: 'relative', aspectRatio: '16/9' }}>
  <AnimatedImage image={img} as={Image} fill sizes="100vw" imageComponentProps={{ priority: true, quality: 80 }} />
</div>
```

---

## Documentation

- [AI Agent Contributor Guide (`AGENTS.md`)](./AGENTS.md) — Architecture, guardrails, and styling tiers for AI agents.
- [Custom Styling & Headless Guide (`docs/CUSTOM_STYLING.md`)](./docs/CUSTOM_STYLING.md) — Theming, slots, and headless recipes.
- [AnimatedImage & Blur-Up Guide (`docs/ANIMATED_IMAGE.md`)](./docs/ANIMATED_IMAGE.md) — Progressive reveal component architecture.
- [Architecture & Internals (`docs/ARCHITECTURE.md`)](./docs/ARCHITECTURE.md) — Sharp size-guarding and 4-edge color math.
- [Framework & Storage Recipes (`docs/FRAMEWORK_RECIPES.md`)](./docs/FRAMEWORK_RECIPES.md) — Next.js, Hono, Remix, S3, Supabase recipes.
- [Interactive Studio Code](https://github.com/MoElsherbiny/image-upload-kit-studio) — Source for the live demo playground.
- [Contributing Guide (`CONTRIBUTING.md`)](./CONTRIBUTING.md) & [Changelog (`CHANGELOG.md`)](./CHANGELOG.md).

## License & Author

**Author & Identity**: [buildwithsherbo](https://www.buildwithsherbo.com/) — Mohamed Elsherbiny
- **Website**: [buildwithsherbo.com](https://www.buildwithsherbo.com/)
- **Live Demo**: [upload-kit.buildwithsherbo.com](https://upload-kit.buildwithsherbo.com)
- **GitHub**: [@MoElsherbiny](https://github.com/MoElsherbiny)
- **Email**: [mo@buildwithsherbo.com](mailto:mo@buildwithsherbo.com)

Distributed under the [MIT License](./LICENSE).
