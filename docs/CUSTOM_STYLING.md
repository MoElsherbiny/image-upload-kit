# Custom Styling & Headless UI Guide

`image-upload-kit` provides **4 progressive customization tiers** for both single and multi-image uploads — ranging from 5 lines of CSS variables to 100% headless hooks and render-prop controllers.

| Tier | Best For | Keep Built-In Modals & Dock? | Requires `styles.css`? |
| --- | --- | --- | --- |
| **1. `--iuk-*` CSS Tokens** | Brand colors, radii, fonts, dark mode | Yes | Yes |
| **2. `classNames`, `styles` & `unstyled`** | Full Tailwind CSS or CSS Modules restyling | Yes | Optional (`unstyled`) |
| **3. Partial Slot Renderers (`render*`)** | Custom dropzone or card JSX + built-in modals | Yes | Yes (for modals/dock) |
| **4. Headless (`image-upload-kit/headless`)** | Bespoke avatars, masonry grids, design systems | Bring your own | No |

---

## Approach 1: CSS Design Tokens (`--iuk-*`)

Import `image-upload-kit/styles.css` once and override `--iuk-*` custom properties globally (`:root`) or inside any scoped wrapper. Dark mode activates automatically via `prefers-color-scheme: dark`, `.dark`, or `[data-theme="dark"]`.

```css
/* Theme colors, radii, and shadows in 5 lines of CSS */
:root {
  --iuk-primary: #4f46e5;
  --iuk-primary-hover: #4338ca;
  --iuk-surface: #f8fafc;
  --iuk-radius-md: 16px;
  --iuk-shadow-sm: 0 2px 8px rgba(79, 70, 229, 0.08);
}

.dark {
  --iuk-primary: #818cf8;
  --iuk-surface: #0f172a;
  --iuk-border: #1e293b;
}
```

Available token groups in `tokens.css`: `--iuk-bg`, `--iuk-surface`, `--iuk-surface-hover`, `--iuk-border`, `--iuk-border-strong`, `--iuk-text`, `--iuk-text-muted`, `--iuk-primary`, `--iuk-primary-hover`, `--iuk-primary-soft`, `--iuk-danger`, `--iuk-success`, `--iuk-warning`, `--iuk-info`, `--iuk-radius-{sm,md,lg}`, `--iuk-shadow-{sm,lg}`, and `--iuk-font`.

---

## Approach 2: Slot `classNames`, `styles`, `unstyled` Mode & `data-[state=*]`

Every semantic element exposes a named slot (`classNames` & inline `styles`), `data-slot="..."`, and deterministic `data-state` attributes:

- **`data-state` priority**: `'disabled'` > `'dragging'` > `'uploading'` > `'error'` > `'ready'` > `'idle'`.
- **`unstyled={true}`**: Strips all built-in `iuk-*` classes (eliminating specificity overrides), sets `data-unstyled="true"`, and keeps `<input type="file">` accessibly hidden via inline clip styles even without `image-upload-kit/styles.css`.

### Single Upload with Tailwind CSS (`unstyled`)

```tsx
import { SingleImageUpload } from 'image-upload-kit/react';

<SingleImageUpload
  unstyled preset="cover" label="Cover Artwork" showQualitySelector={false}
  value={cover} onChange={setCover}
  classNames={{
    root: 'flex flex-col gap-2',
    label: 'text-sm font-semibold text-slate-800 dark:text-slate-100',
    dropzone:
      'group flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl ' +
      'border-2 border-dashed border-slate-300 bg-slate-50/70 p-6 text-center transition ' +
      'hover:border-indigo-400 data-[state=dragging]:border-indigo-600 data-[state=dragging]:bg-indigo-50 ' +
      'data-[state=error]:border-rose-500 data-[state=disabled]:cursor-not-allowed data-[state=disabled]:opacity-50',
    dropzonePrompt: 'flex flex-col items-center gap-2',
    dropzoneText: 'text-sm font-medium text-slate-700',
    dropzoneHint: 'text-xs text-slate-500',
    browseButton: 'mt-1 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500',
    previewWrap: 'overflow-hidden rounded-2xl border border-slate-200',
    errorText: 'text-xs font-medium text-rose-600',
  }}
/>
```

### Multi Upload with Tailwind CSS (`unstyled`)

```tsx
import { MultiImageUpload } from 'image-upload-kit/react';

<MultiImageUpload
  mode="multiple" unstyled preset="card" label="Gallery" showQualitySelector={false}
  value={gallery} onChange={setGallery}
  classNames={{
    root: 'space-y-4',
    header: 'flex items-center justify-between',
    label: 'text-sm font-semibold text-slate-900',
    count: 'ml-2 text-xs text-slate-500',
    bulkActions: 'flex items-center gap-2',
    bulkButton: 'rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium hover:bg-slate-50',
    bulkDangerButton: 'rounded-md bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100',
    emptyDropzone:
      'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-10 ' +
      'data-[state=dragging]:border-indigo-500 data-[state=dragging]:bg-indigo-50/60',
    emptyActions: 'mt-2 flex gap-2',
    primaryButton: 'rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white',
    secondaryButton: 'rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700',
    grid: 'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4',
    tile: 'relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100',
    addMoreTile: 'flex aspect-square flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 p-4',
    errorText: 'text-xs text-rose-600',
  }}
/>
```

### Global App Theming via `<ImageUploadProvider>`

Apply your design system once across every uploader in your application (per-component `classNames` and `styles` merge cleanly on top):

```tsx
import { ImageUploadProvider } from 'image-upload-kit/react';

<ImageUploadProvider
  endpoint="/api/upload"
  unstyled
  singleClassNames={{ root: 'space-y-2', dropzone: 'rounded-2xl border-2 border-dashed p-6' }}
  multiClassNames={{ root: 'space-y-4', grid: 'grid grid-cols-3 gap-4' }}
>
  {children}
</ImageUploadProvider>
```

---

## Approach 3: Partial Slot Renderers (`render*`)

Want bespoke dropzone or card JSX **without** rebuilding `<AltTextModal />`, `<BlurVisualizationModal />`, or the minimizable `<UploadProgressPanel />` dock? Pass partial slot renderers:

- **Single**: `renderDropzone(ctx)`, `renderPreview(ctx)`
- **Multi**: `renderHeader(ctx)`, `renderEmptyDropzone(ctx)`, `renderTile(ctx)`, `renderAddMore(ctx)` (return `null` to hide)

```tsx
import { MultiImageUpload, SingleImageUpload } from 'image-upload-kit/react';
import 'image-upload-kit/styles.css';

<SingleImageUpload
  value={cover} onChange={setCover}
  renderDropzone={(ctx) => (
    <div {...ctx.dropzoneProps} className="rounded-xl border border-dashed p-6 text-center">
      <p>{ctx.isUploading ? `Optimizing (${ctx.progress}%)...` : 'Drop high-res cover'}</p>
      <button type="button" onClick={ctx.openFileDialog}>Choose File</button>
    </div>
  )}
  renderPreview={(ctx) => (
    <div className="relative overflow-hidden rounded-xl">
      <img src={ctx.previewUrl} alt={ctx.altText} className="h-56 w-full object-cover" />
      <div className="flex gap-2 bg-slate-900/80 p-2 text-xs text-white">
        <button type="button" onClick={ctx.openAltTextModal}>Edit Alt</button>
        <button type="button" onClick={ctx.openBlurInspector}>Inspect LQIP</button>
        <button type="button" onClick={ctx.remove}>Remove</button>
      </div>
    </div>
  )}
/>

<MultiImageUpload
  mode="multiple" value={gallery} onChange={setGallery}
  renderEmptyDropzone={(ctx) => (
    <div {...ctx.dropzoneProps} className="rounded-xl border-2 border-dashed p-8 text-center">
      <button type="button" onClick={ctx.openFileDialog}>Select up to {ctx.maxImages} images</button>
    </div>
  )}
  renderTile={(ctx) => (
    <article className="relative overflow-hidden rounded-xl border">
      <img src={ctx.item.url} alt={ctx.item.altText || ''} className="aspect-square w-full object-cover" />
      <button type="button" onClick={ctx.openAltTextModal}>Alt</button>
      <button type="button" onClick={ctx.remove}>Delete</button>
    </article>
  )}
  renderAddMore={(ctx) =>
    ctx.remainingCount > 0 ? (
      <button type="button" onClick={ctx.openFileDialog}>+ Add ({ctx.remainingCount} left)</button>
    ) : null
  }
/>
```

---

## Approach 4: 100% Headless Controllers (`image-upload-kit/headless`)

For complete DOM freedom with zero shipped markup or CSS, use `<HeadlessSingleUpload>`, `<HeadlessMultiUpload>`, or the `useSingleUpload` / `useMultiUpload` hooks from `image-upload-kit/headless`.

### Custom Circular Avatar (`<HeadlessSingleUpload>`)

```tsx
import { HeadlessSingleUpload } from 'image-upload-kit/headless';

export function CircularAvatarUploader({ value, onChange }: AvatarProps) {
  return (
    <HeadlessSingleUpload preset="avatar" value={value} onChange={onChange}>
      {(ctrl) => (
        <div className="inline-flex flex-col items-center gap-2">
          <div
            {...ctrl.getDropzoneProps({
              className:
                'relative flex h-28 w-28 cursor-pointer items-center justify-center overflow-hidden ' +
                'rounded-full border-2 border-slate-300 bg-slate-100 data-[state=dragging]:border-indigo-600',
            })}
          >
            <input {...ctrl.getInputProps()} />
            {ctrl.preview ? (
              <img src={ctrl.preview} alt={ctrl.altText} className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs font-medium text-slate-500">Upload</span>
            )}
            {ctrl.isUploading && (
              <div className="absolute inset-0 grid place-items-center bg-black/50 text-xs font-bold text-white">
                {ctrl.progress}%
              </div>
            )}
          </div>
          {ctrl.preview && <button type="button" onClick={ctrl.remove} className="text-xs text-rose-600">Remove photo</button>}
          {ctrl.error && <p className="text-xs text-rose-600">{ctrl.error}</p>}
        </div>
      )}
    </HeadlessSingleUpload>
  );
}
```

### Custom Masonry / Grid (`<HeadlessMultiUpload>` & Hooks)

```tsx
import { HeadlessMultiUpload, useSingleUpload, useMultiUpload } from 'image-upload-kit/headless';

export function MasonryGalleryUploader({ value, onChange }: GalleryProps) {
  return (
    <HeadlessMultiUpload preset="card" value={value} onChange={onChange} maxImages={20}>
      {(ctrl) => (
        <section {...ctrl.getDropzoneProps({ className: 'space-y-3' })}>
          <input {...ctrl.getInputProps()} />
          <input {...ctrl.getFolderInputProps()} />
          <header className="flex items-center justify-between">
            <span className="text-sm font-medium">{ctrl.stats.completed} uploaded</span>
            <div className="flex gap-2">
              <button type="button" onClick={ctrl.openFileDialog}>Add Files</button>
              <button type="button" onClick={ctrl.openFolderDialog}>Add Folder</button>
              {ctrl.selectedIds.size > 0 && <button type="button" onClick={ctrl.removeSelected}>Delete ({ctrl.selectedIds.size})</button>}
              {ctrl.hasFailedUploads && <button type="button" onClick={() => void ctrl.retryFailed()}>Retry Failed</button>}
            </div>
          </header>
          <div className="columns-2 gap-3 sm:columns-3">
            {ctrl.items.map((item) => (
              <figure key={item.id} className="mb-3 break-inside-avoid overflow-hidden rounded-xl border">
                <img src={item.url} alt={item.altText || ''} className="w-full object-cover" />
                <button type="button" onClick={() => ctrl.remove(item.id)}>Remove</button>
              </figure>
            ))}
          </div>
        </section>
      )}
    </HeadlessMultiUpload>
  );
}
```

> **Hook API**: Prefer hooks over render-props? Call `const ctrl = useSingleUpload(options)` or `const ctrl = useMultiUpload(options)` directly inside any React component — they return the exact same `SingleUploadController` and `MultiUploadController` objects.
