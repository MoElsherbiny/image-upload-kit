# Migrating from v1.x to v2.0.0

`img-upload-kit` v2.0.0 hardens security by default, aligns `<AnimatedImage>` with production motion standards, fixes RSC `'use client'` bundling and shared React contexts, and introduces responsive variants, clipboard paste, camera capture, per-tile cancel/retry, and native form integration.

---

## 1. Dependencies & Peer Dependencies (`sharp`, `lqip-modern`, `lucide-react`)

- **`sharp` & `lqip-modern` are now optional peer dependencies.** Client-only or Edge consumers no longer download native Sharp binaries when installing `img-upload-kit`. Server (`img-upload-kit/server`) and CLI (`img-upload-kit/cli`) consumers must install `sharp` (and optionally `lqip-modern`).
- **`lucide-react` has been removed.** All UI icons are now inlined inside `img-upload-kit/react` (`src/react/icons.tsx`) with zero external icon dependencies.
- **Node.js `>= 20.0.0`** is recommended for development and server runtimes.

### Before (v1.x)
```bash
npm install img-upload-kit
```

### After (v2.0.0)
```bash
# Client-only / React UI:
npm install img-upload-kit react react-dom

# Server / Full-Stack (Next.js, Remix, Hono, Node.js) or CLI:
npm install img-upload-kit sharp lqip-modern
```

---

## 2. SVG Uploads Disabled by Default (`allowSvg`) & Magic-Byte Sniffing

- **SVG (`image/svg+xml`) is disabled by default** across `DEFAULT_ALLOWED_FORMATS` and all `STANDARD_PRESETS` (including `logo`) to prevent stored XSS and XXE out of the box.
- **Opt-in with `allowSvg: true`** on `createImageUploader`, a preset, or a per-upload call. When enabled, SVGs pass through a built-in dependency-free allowlist sanitizer (`sanitizeSvg`) that strips `<script>`, `<foreignObject>`, `on*` handlers, unsafe `href`/`xlink:href` URIs, and `<!ENTITY` declarations.
- **Mandatory magic-byte sniffing (`sniffImageFormat`)**: Every upload inspects binary magic bytes rather than trusting `file.type`. Spoofed files (e.g. SVG or HTML disguised as `image/png`) are rejected with `UploadValidationError` (HTTP `400`).

### Before (v1.x)
```ts
const uploader = createImageUploader({ storage });
// SVG was accepted on card, cover, hero, logo, original without sanitization
await uploader.uploadImage(svgFile, { preset: 'logo' });
```

### After (v2.0.0)
```ts
const uploader = createImageUploader({
  storage,
  allowSvg: false, // Default — opt in globally or per preset:
  presets: defineUploadPresets({
    logo: {
      folder: 'logos',
      maxDimensions: { width: 800, height: 800 },
      allowSvg: true, // Sanitizes SVG before storage
    },
  }),
});
```

---

## 3. Secure-by-Default HTTP Handler (`allowClientOverrides`, `maxBodyBytes`, `allowedOrigins`, `onError`)

`createUploadHttpHandler` now ignores client-supplied `FormData` overrides (`customFilename`, `folder`, `maxWidth`, `maxHeight`, `outputFormat`, `quality`) unless explicitly enabled via `allowClientOverrides`:

- **Client overrides**: Clamped to preset `maxDimensions`. Client `customFilename` never forces `upsert: true` (preventing arbitrary object overwrites) and always uses the optimized output extension. Invalid `quality` values return HTTP `400`.
- **Body size & CSRF protection**: Enforces `maxBodyBytes` (streaming byte limit, HTTP `413`) and `allowedOrigins` (HTTP `403`).
- **`DELETE` bucket allowlist**: Rejects attempts to delete URLs/buckets outside the uploader's configured buckets (HTTP `403`).
- **Generic `500` responses**: Internal error messages and paths are never leaked to clients (`{ "error": "Internal server error" }`); inspect raw errors with `onError(error, ctx)`.
- **Edge-safe handler subpath**: Import `createUploadHttpHandler` from `img-upload-kit/server/handler` when running in Edge runtimes without Sharp or `node:fs`.

### Before (v1.x)
```ts
// Client FormData could freely override folder, customFilename, maxWidth, quality
export const { POST, DELETE } = createUploadHttpHandler({ uploader });
```

### After (v2.0.0)
```ts
export const { POST, DELETE } = createUploadHttpHandler({
  uploader,
  maxBodyBytes: 15 * 1024 * 1024,
  allowedOrigins: ['https://app.example.com'],
  allowClientOverrides: {
    filename: true,
    folder: (folder) => (folder.startsWith('users/') ? folder : null),
    dimensions: true, // Clamped to preset maxDimensions
    format: true,
    quality: true,
  },
  onError: (error, ctx) => {
    console.error(`[upload:${ctx.action}]`, error);
  },
});
```

---

## 4. Context-Aware `authorize(ctx)` Signature

`UploadHttpHandlerOptions.authorize` now receives an `AuthorizeContext` object (`{ action, request, path?, bucket?, preset? }`) instead of a bare `Request`. Throwing inside `authorize` now returns HTTP `401 Unauthorized` instead of `500`.

### Before (v1.x)
```ts
const handler = createUploadHttpHandler({
  uploader,
  authorize: async (request: Request) => {
    return request.headers.get('authorization') === 'Bearer secret';
  },
});
```

### After (v2.0.0)
```ts
const handler = createUploadHttpHandler({
  uploader,
  authorize: async ({ action, request, preset, bucket, path }) => {
    if (action === 'delete' && bucket !== 'media') return false;
    return request.headers.get('authorization') === 'Bearer secret';
  },
});
```

---

## 5. `<AnimatedImage>` Visual Defaults, `priority`, & Error Handling

1. **Reveal animation & timing**: Default `animationDuration` changed from `700` ms to `600` ms. The image now transitions from `opacity: 0; transform: scale(1.02)` to `opacity: 1; transform: scale(1)` (`revealScale` prop, default `1.02`). The placeholder uses `inset: 0; scale(1.1); blur(20px)`, fades immediately (`0ms` delay) over `duration * 5 / 6` (`500ms`), and unmounts at `duration + 50ms`.
2. **Color-only placeholder (`colorPlaceholder`)**: When only `blurColor` is provided (no `blurDataUrl` or `blurHash`), `<AnimatedImage>` defaults to `colorPlaceholder="flat"` (paints wrapper `backgroundColor` without mounting an extra SVG `<img>`). Pass `colorPlaceholder="gradient"` for the v1 SVG layer. Wrapper backgrounds also accept `var(--css-token)`.
3. **First-class `priority` & `quality`**: Passing `priority` sets `loading="eager"` + `fetchPriority="high"` on native `<img>` and forwards `priority` to custom `as={Image}` components without conflicting with `loading="lazy"`.
4. **Placeholder-preserving error state**: On load error, the placeholder remains visible, the broken `<img>` is hidden (`visibility: hidden`, `data-state="error"`), `fallbackSrc` is retried once if provided, and `renderError={({ src, retry }) => ...}` renders custom recovery UI.

### Before (v1.x)
```tsx
// Next.js threw when passing priority via imageComponentProps due to forced loading="lazy"
<AnimatedImage
  image={img}
  as={Image}
  imageComponentProps={{ priority: true, quality: 85 }}
/>
```

### After (v2.0.0)
```tsx
// First-class priority & quality props, fallbackSrc, and optional v1 fade restore:
<AnimatedImage
  image={img}
  as={Image}
  priority
  quality={85}
  fallbackSrc="/images/fallback.webp"
  renderError={({ retry }) => <button onClick={retry}>Retry</button>}
  // Optional: restore v1 pure opacity fade & SVG color gradient
  animationDuration={700}
  revealScale={1}
  colorPlaceholder="gradient"
/>
```

---

## 6. Storage, Preview Cache-Busting, Blur & CLI Updates

- **Supabase `deleteByUrl`**: No longer issues speculative deletes for non-existent `-blur.avif` / `-thumb.avif` sibling paths.
- **Opt-in `?t=` preview cache-buster**: `<SingleImageUpload>` and `<PreviewTile>` no longer append `?t=...` by default (which previously invalidated pre-signed S3/R2/GCS URLs). Opt in with `<PreviewTile appendCacheBuster />` or `appendCacheBuster(url, { enabled: true })` (signed URLs are always skipped).
- **`createSrcSetWithBlur` & `preloadImageWithBlur`**: `createSrcSetWithBlur` no longer injects the 40px LQIP data URL into `srcset`, and `preloadImageWithBlur` deduplicates `<link rel="preload">` tags without overriding `imagesrcset`.
- **`normalizeImagePath`**: Preserves `/<bucket>/<path>` for Supabase public URLs consistently with S3 path-style URLs.
- **`mirrorBufferLocally` & CLI entry**: `mirrorBufferLocally` is now async (`Promise<string>`). Importing `img-upload-kit/cli` has zero side effects (the CLI binary entry moved to `dist/bin.js`).

### Before (v1.x)
```tsx
// Mutated preview URLs with ?t=..., breaking X-Amz-Signature on presigned URLs
<PreviewTile preview={item} onRemove={onRemove} />
```

### After (v2.0.0)
```tsx
// Preserves URLs verbatim by default; opt in when overwriting static paths:
<PreviewTile preview={item} onRemove={onRemove} appendCacheBuster />
```

---

## 7. Package `exports` & Per-Layer CSS Subpaths

`package.json` `exports` now use nested `import` / `require` conditions with dedicated `.d.ts` and `.d.cts` declarations, and expose individual CSS layers under `img-upload-kit/styles/*.css`:

```ts
// Full stylesheet (unchanged):
import 'img-upload-kit/styles.css';

// Or import individual CSS layers in v2.0:
import 'img-upload-kit/styles/tokens.css';
import 'img-upload-kit/styles/animated-image.css';
```
