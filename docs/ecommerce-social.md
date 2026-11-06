# E-Commerce Galleries & Social Media Guide

`img-upload-kit` v2.1 includes built-in presets, smart server-side attention cropping, gallery reordering (`Cover` badge + `move` / `setCover`), social aspect ratio framing (`1:1`, `4:5`, `9:16`), and pre-upload `transformAsset` hooks tailored for online stores and social apps.

---

## 1. E-Commerce & Social Presets (`square`, `portrait`, `story`)

In addition to `thumbnail`, `avatar`, `card`, `cover`, `hero`, `logo`, and `original`, `STANDARD_PRESETS` provides three aspect-locked presets with automatic Sharp `crop: 'attention'` focus detection and responsive `variantWidths`:

| Preset | Aspect Ratio | Max Dimensions | Crop Strategy | Responsive `variantWidths` | Primary Use Case |
| --- | --- | --- | --- | --- | --- |
| `square` | `1:1` | `1600x1600` | `'attention'` | `[400, 800, 1200]` | Product galleries, catalog grids, square feed posts |
| `portrait` | `4:5` | `1080x1350` | `'attention'` | `[480, 720]` | Instagram vertical feed posts, fashion lookbooks |
| `story` | `9:16` | `1080x1920` | `'attention'` | `[540, 720]` | Stories, Reels, TikTok vertical full-screen covers |

---

## 2. E-Commerce Product Galleries (`reorderable` & `showCoverBadge`)

Online storefronts treat `index 0` of a product's media array as the primary **Cover** photo shown on collection pages and social cards. Enable `reorderable` and `showCoverBadge` on `<MultiImageUpload>` to let merchants reorder tiles or promote any image to Cover:

```tsx
import { useState } from 'react';
import type { UploadedImageData } from 'img-upload-kit';
import { MultiImageUpload } from 'img-upload-kit/react';

export function ProductGalleryField() {
  const [images, setImages] = useState<UploadedImageData[]>([]);

  return (
    <MultiImageUpload
      mode="multiple"
      preset="square"
      label="Product Photos"
      value={images}
      onChange={setImages}
      maxImages={8}
      minImages={1}
      reorderable
      showCoverBadge
      onReorder={(ordered) => {
        console.log('Primary product cover is now:', ordered[0]?.url);
      }}
    />
  );
}
```

### Headless & Programmatic Gallery Reordering

`useMultiUpload` (React), `createMultiUpload` (Angular), `useNativeMultiUpload` (React Native), and `img-upload-kit/client` expose deterministic reorder helpers:

```ts
import { moveItem, promoteToCover } from 'img-upload-kit/client';

// On any MultiUploadController (React / Angular / React Native):
ctrl.move(fromIndex, toIndex); // Move tile from `fromIndex` to `toIndex`
ctrl.setCover(index);          // Promote tile at `index` to position 0 (Cover)
ctrl.setPrimary(index);        // Alias for setCover(index)

// Or pure immutable array helpers:
const next = promoteToCover(images, 3);
const shifted = moveItem(images, 2, 1);
```

---

## 3. Social Aspect Ratios & Letterbox Blur Backdrops

Social feeds often mix `1:1` square, `4:5` vertical portrait, and `9:16` story assets. `<AnimatedImage>` supports first-class `aspectRatio` framing (`'1:1' | '4:5' | '3:4' | '4:3' | '3:2' | '16:10' | '16:9' | '9:16' | 'auto' | number`) across React, Angular, and React Native:

```tsx
import { AnimatedImage } from 'img-upload-kit/react';

// 1. Instagram 4:5 vertical feed card:
<AnimatedImage
  image={post.image}
  aspectRatio="4:5"
  objectFit="cover"
  showShimmer
/>

// 2. Uncropped photo inside a 9:16 Story frame with ambient 4-edge color + blur backdrop:
<AnimatedImage
  image={post.image}
  aspectRatio="9:16"
  objectFit="contain"
  priority
/>
```

---

## 4. Server-Side Smart Attention Cropping

When a preset or upload option specifies `aspectRatio` (e.g. `'1:1'`, `'4:5'`, `'9:16'`), `optimizeImage` automatically computes the target bounding box and runs Sharp with `fit: 'cover'` and luminance/saturation/skin-tone attention detection (`crop: 'attention' | 'entropy' | 'center'`):

```ts
import { defineUploadPresets, STANDARD_PRESETS } from 'img-upload-kit';

export const presets = defineUploadPresets({
  ...STANDARD_PRESETS,
  lookbook: {
    folder: 'catalog/lookbook',
    maxDimensions: { width: 1440, height: 1800 },
    aspectRatio: '4:5',
    crop: 'attention', // Focuses on faces, high-contrast details, and focal subjects
    variantWidths: [480, 960, 1440],
    quality: 88,
  },
});
```

---

## 5. Pre-Upload `transformAsset` Hook (Client Cropper / Watermark)

Run custom client-side transformations (interactive cropper modal, canvas watermark, or EXIF scrubbing) before bytes are sent over the network using `transformAsset`:

```tsx
import { SingleImageUpload } from 'img-upload-kit/react';

<SingleImageUpload
  preset="portrait"
  aspectRatio="4:5"
  value={photo}
  onChange={setPhoto}
  transformAsset={async (file, { signal, preset }) => {
    // Open an interactive 4:5 cropper modal or process on an OffscreenCanvas:
    const croppedFile = await openInteractiveCropper(file, {
      aspectRatio: 4 / 5,
      signal,
    });
    return croppedFile;
  }}
/>
```

If `signal` is aborted while `transformAsset` is running (for example, when the user clicks Cancel), `img-upload-kit` halts the pipeline immediately without starting the network request.
