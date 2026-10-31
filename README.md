# image-upload-kit

Production-grade, zero-lock-in image upload and processing framework with **Sharp AVIF/WebP optimization**, **smart size-guarding**, **WebP LQIP & BlurHash placeholders**, **4-edge dominant color extraction**, **pluggable storage adapters**, **4 styling tiers**, and the **`<AnimatedImage />` blur-up display component** for React & Next.js.

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
npm install image-upload-kit
# pnpm
pnpm add image-upload-kit
# yarn
yarn add image-upload-kit
# bun
bun add image-upload-kit

# Optional peer dependencies (only if using image-upload-kit/react or /headless):
npm install react react-dom
```

> **Requirements**: Node.js `>= 18.17.0` on the server for `sharp` and Web Fetch `Request`/`FormData` APIs. React `>= 18.0.0` for UI components.

---

## Subpath Exports Reference

| Subpath | Environment | Key Exports |
| --- | --- | --- |
| `image-upload-kit` | Universal | `STANDARD_PRESETS`, `defineUploadPresets`, types, color utils, validators, `createMemoryStorageAdapter`, `decodeBlurHashToDataURL`, `getBlurData` |
| `image-upload-kit/server` | Node.js | `createImageUploader`, `createUploadHttpHandler`, `optimizeImage`, `generateBlurPlaceholder` |
| `image-upload-kit/storage` | Node / Edge | `createStorageAdapter`, `createS3StorageAdapter`, `createSupabaseStorageAdapter`, `createLocalFsStorageAdapter` |
| `image-upload-kit/blur` | Universal | `BlurService`, `createBlurService`, `decodeBlurHashToDataURL`, `LRUCache` |
| `image-upload-kit/react` | React Client | `<ImageUploadProvider>`, `<SingleImageUpload>`, `<MultiImageUpload>`, `<AnimatedImage>`, `<BlurImage>` |
| `image-upload-kit/headless` | React Client | `<HeadlessSingleUpload>`, `<HeadlessMultiUpload>`, `useSingleUpload`, `useMultiUpload`, `useDropzone` |
| `image-upload-kit/cli` | Node CLI | CLI binaries (`image-upload-kit` / `blur-cli`) for build-time manifest generation |
| `image-upload-kit/styles.css` | CSS | Complete stylesheet powered by `--iuk-*` design tokens (supports dark mode & RTL) |

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
import { defineUploadPresets } from 'image-upload-kit';

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

### 1. Server Uploader & Route Handler (`image-upload-kit/server` & `/storage`)

```ts
// app/api/upload/route.ts (Next.js App Router, Remix, Hono, SvelteKit)
import { createImageUploader, createUploadHttpHandler } from 'image-upload-kit/server';
import { createS3StorageAdapter } from 'image-upload-kit/storage';

const storage = createS3StorageAdapter({
  publicBaseUrl: 'https://cdn.example.com',
  defaultBucket: 'media',
  putObject: (input) => s3.send(new PutObjectCommand(input)),
  deleteObject: (input) => s3.send(new DeleteObjectCommand(input)),
});

export const uploader = createImageUploader({ storage, defaultBucket: 'media' });
export const { POST, DELETE } = createUploadHttpHandler({ uploader });
```

### 2. Client Provider & Upload UI (`image-upload-kit/react` & `/styles.css`)

```tsx
import { useState } from 'react';
import { ImageUploadProvider, SingleImageUpload, MultiImageUpload } from 'image-upload-kit/react';
import type { UploadedImageData } from 'image-upload-kit';
import 'image-upload-kit/styles.css';

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

### 3. Build-Time Blur Manifests & Runtime Lookup (`image-upload-kit/cli` & `/blur`)

```bash
npx image-upload-kit generate --dir ./public/images --out ./src/blur-manifest.json
```
```ts
import { createBlurService } from 'image-upload-kit/blur';
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

### Tier 4: Headless Hooks & Primitives (`image-upload-kit/headless`)
```tsx
import { HeadlessSingleUpload, useDropzone } from 'image-upload-kit/headless';

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
import { AnimatedImage } from 'image-upload-kit/react';
import 'image-upload-kit/styles.css';

// 1. Direct shorthand with UploadedImageData returned from SingleImageUpload / MultiImageUpload:
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

### Props Summary
- **Source & Alt**: Pass `image={uploadedImageData}` directly, or explicit `src` and `alt` (native `<img>` attributes pass through).
- **Placeholder Hierarchy**: `blurDataUrl` (LQIP) > `blurHash` (canvas decode) > `blurColor` (gradient SVG fallback; neutral/invalid colors ignored).
- **Layout & Sizing**: `fill` (absolute fill), `objectFit` (`'cover'` default \| `contain` \| `fill` \| `none` \| `scale-down`), `objectPosition`.
- **Transitions**: `showShimmer` (`false`), `animationDuration` (`700ms` staggered crossfade), respects `prefers-reduced-motion`.
- **Custom Renderers**: `as` (`ElementType`, e.g. `next/image`), `imageComponentProps` (forwarded only to `as`), `unstyled`.
- **Styling**: `wrapperClassName`, `wrapperStyle`, `wrapperProps`, `placeholderClassName`.
- **Events**: `onLoad(img)` (fires after decode), `onError(event)`.

### Data Attributes & CSS Tokens
- **Slots**: `data-slot="animated-image"`, `"animated-image-placeholder"`, `"animated-image-shimmer"`.
- **State**: `data-state="loading|loaded|error"`, `aria-busy="true"` while loading.
- **Design Tokens**: `--iuk-animated-image-bg`, `--iuk-animated-image-blur`, `--iuk-animated-image-shimmer`, `--iuk-animated-image-duration`.

### Related Exports
- `useImageReveal`: Headless state machine hook (`isLoaded`, `showPlaceholder`, `hasError`, `imgRef`, `handleLoad`, `handleError`).
- Utilities: `createFallbackBlurSvg`, `resolveMeaningfulColor`, `resolvePlaceholderUrl`.

See [Extended AnimatedImage Guide (`docs/ANIMATED_IMAGE.md`)](./docs/ANIMATED_IMAGE.md) for complete details.

---

## Documentation

- [AI Agent Contributor Guide (`AGENTS.md`)](./AGENTS.md) — Architecture, guardrails, and styling tiers for AI agents.
- [Custom Styling & Headless Guide (`docs/CUSTOM_STYLING.md`)](./docs/CUSTOM_STYLING.md) — Theming, slots, and headless recipes.
- [AnimatedImage & Blur-Up Guide (`docs/ANIMATED_IMAGE.md`)](./docs/ANIMATED_IMAGE.md) — Progressive reveal component architecture.
- [Architecture & Internals (`docs/ARCHITECTURE.md`)](./docs/ARCHITECTURE.md) — Sharp size-guarding and 4-edge color math.
- [Framework & Storage Recipes (`docs/FRAMEWORK_RECIPES.md`)](./docs/FRAMEWORK_RECIPES.md) — Next.js, Hono, Remix, S3, Supabase recipes.
- [Contributing Guide (`CONTRIBUTING.md`)](./CONTRIBUTING.md) & [Changelog (`CHANGELOG.md`)](./CHANGELOG.md).

## License & Author

**Author**: Mo Elsherbiny
- **Website**: [buildwithsherbo.com](https://www.buildwithsherbo.com/)
- **GitHub**: [@MoElsherbiny](https://github.com/MoElsherbiny)
- **Email**: [mo@buildwithsherbo.com](mailto:mo@buildwithsherbo.com)

Distributed under the [MIT License](./LICENSE).
