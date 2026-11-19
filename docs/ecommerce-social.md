# E-Commerce Galleries & Social Media Guide

`img-upload-kit` includes built-in social and catalog presets, smart server-side attention and focal-point cropping, pointer-drag gallery reordering (`Cover` badge + `move` / `setCover`), social aspect ratio framing (`1:1`, `4:5`, `9:16`), and pre-upload `transformAsset` hooks across **React**, **Vue 3 / Nuxt 4**, **Angular 17–21+**, and **React Native / Expo**.

---

## 1. E-Commerce & Social Presets (`square`, `portrait`, `story`)

Alongside `thumbnail`, `avatar`, `card`, `cover`, `hero`, `logo`, and `original`, `STANDARD_PRESETS` provides three aspect-locked presets with automatic Sharp `crop: 'attention'` focus detection and responsive `variantWidths`:

| Preset | Aspect Ratio | Max Dimensions | Crop Strategy | Responsive `variantWidths` | Primary Use Case |
| --- | --- | --- | --- | --- | --- |
| `square` | `1:1` | `1600x1600` | `'attention'` | `[400, 800, 1200]` | Product galleries, catalog grids, square feed posts |
| `portrait` | `4:5` | `1080x1350` | `'attention'` | `[480, 720]` | Instagram vertical feed posts, fashion lookbooks |
| `story` | `9:16` | `1080x1920` | `'attention'` | `[540, 720]` | Stories, Reels, TikTok vertical full-screen covers |

---

## 2. E-Commerce Product Galleries (`reorderable` & `showCoverBadge`)

Online storefronts treat `index 0` of a product's media array as the primary **Cover** photo shown on collection pages and social cards. Enable `reorderable` and `showCoverBadge` on `<MultiImageUpload>` to let merchants drag tiles, use keyboard shortcuts (`Alt+ArrowLeft/Right`), or promote any image to Cover.

### React (`img-upload-kit/react`)

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

### Vue 3 / Nuxt 4 (`img-upload-kit/vue`)

`<MultiImageUpload v-model reorderable show-cover-badge />` and the `useMultiUpload` composable share the same pointer-drag reordering and Cover controls:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import type { UploadedImageData } from 'img-upload-kit';
import { MultiImageUpload } from 'img-upload-kit/vue';

const images = ref<UploadedImageData[]>([]);
</script>

<template>
  <MultiImageUpload
    v-model="images"
    preset="square"
    :max-images="8"
    reorderable
    show-cover-badge
  />
</template>
```

### Headless & Programmatic Gallery Reordering (React, Vue, Angular, React Native)

`useMultiUpload` (`img-upload-kit/headless` & `img-upload-kit/vue`), `createMultiUpload` (`img-upload-kit/angular`), `useNativeMultiUpload` (`img-upload-kit/react-native`), and `img-upload-kit/client` expose deterministic reorder helpers:

```ts
import type { UploadedImageData } from 'img-upload-kit';
import { moveItem, promoteToCover } from 'img-upload-kit/client';
import { useMultiUpload as useVueMultiUpload } from 'img-upload-kit/vue';

// Inside a Vue setup() or React/Angular/React Native multi-upload controller:
function reorderGallery(ctrl: ReturnType<typeof useVueMultiUpload>, images: UploadedImageData[]) {
  ctrl.move(2, 0);      // Move tile from index 2 to index 0
  ctrl.setCover(1);     // Promote tile at index 1 to position 0 (Cover)
  ctrl.setPrimary(1);   // Alias for setCover(1)

  // Or pure immutable array helpers for custom state stores:
  const promoted = promoteToCover(images, 3);
  return moveItem(promoted, 2, 1);
}
export { reorderGallery };
```

---

## 3. Social Aspect Ratios & Letterbox Blur Backdrops

Social feeds often mix `1:1` square, `4:5` vertical portrait, and `9:16` story assets. `<AnimatedImage>` supports first-class `aspectRatio` framing (`'1:1' | '4:5' | '3:4' | '4:3' | '3:2' | '16:10' | '16:9' | '9:16' | 'auto' | number`) across React, Vue, Angular, and React Native:

```tsx
import type { UploadedImageData } from 'img-upload-kit';
import { AnimatedImage } from 'img-upload-kit/react';

export function SocialCards({ image }: { image: UploadedImageData }) {
  return (
    <>
      {/* 1. Instagram 4:5 vertical feed card */}
      <AnimatedImage image={image} aspectRatio="4:5" objectFit="cover" showShimmer />

      {/* 2. Uncropped photo inside a 9:16 Story frame with ambient 4-edge blur backdrop */}
      <AnimatedImage image={image} aspectRatio="9:16" objectFit="contain" priority />
    </>
  );
}
```

---

## 4. Server-Side Smart Attention & `focalPoint` Cropping

When a preset or upload option specifies `aspectRatio`, `optimizeImage` computes the target bounding box and runs Sharp with `fit: 'cover'` using luminance/saturation/skin-tone detection (`crop: 'attention' | 'entropy' | 'center'`). When exact subject coordinates are known (e.g. from a face detector or UI focal picker), pass normalized `focalPoint: { x, y }` (`[0, 1]`) to center the crop around that point:

```ts
import { defineUploadPresets, STANDARD_PRESETS } from 'img-upload-kit';
import { optimizeImage } from 'img-upload-kit/server';

export const presets = defineUploadPresets({
  ...STANDARD_PRESETS,
  lookbook: {
    folder: 'catalog/lookbook',
    maxDimensions: { width: 1440, height: 1800 },
    aspectRatio: '4:5',
    crop: 'attention',
    focalPoint: { x: 0.5, y: 0.32 }, // Keep upper-third subject/face centered in 4:5 crop
    variantWidths: [480, 960, 1440],
    quality: 88,
  },
});

export async function cropAroundPoint(buffer: Buffer, x: number, y: number) {
  return optimizeImage(buffer, {
    maxDimensions: { width: 1080, height: 1350 },
    aspectRatio: '4:5',
    focalPoint: { x, y },
  });
}
```

---

## 5. Pre-Upload `transformAsset` Hook (Client Cropper / Watermark)

Run custom client-side transformations (interactive cropper modal, canvas watermark, or pre-upload resize) before bytes cross the network using `transformAsset`:

```tsx
import type { UploadedImageData } from 'img-upload-kit';
import { SingleImageUpload } from 'img-upload-kit/react';

declare function openInteractiveCropper(
  file: File,
  opts: { aspectRatio: number; signal: AbortSignal },
): Promise<File>;

export function PortraitCropField({
  photo,
  setPhoto,
}: {
  photo: UploadedImageData | null;
  setPhoto: (next: UploadedImageData | null) => void;
}) {
  return (
    <SingleImageUpload
      preset="portrait"
      aspectRatio="4:5"
      value={photo}
      onChange={setPhoto}
      transformAsset={async (asset, { signal }) => {
        if (!(asset instanceof File)) return asset;
        return openInteractiveCropper(asset, { aspectRatio: 4 / 5, signal });
      }}
    />
  );
}
```

If `signal` is aborted while `transformAsset` is running (for example, when the user clicks Cancel), `img-upload-kit` halts the pipeline immediately without starting the network request.
