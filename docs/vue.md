# Vue 3.5+ & Nuxt 4 Integration Guide (`img-upload-kit/vue`)

`img-upload-kit/vue` brings the full `img-upload-kit` upload lifecycle, two-way `v-model` binding, progressive `<AnimatedImage>` blur-up reveal, pointer-drag e-commerce gallery reordering, and scoped-slot headless primitives to **Vue 3.5+** and **Nuxt 4** with zero runtime lock-in.

---

## 1. Installation & Styling

```bash
# Interactive CLI (detects Vue 3 / Nuxt 4, your package manager & storage adapter):
npx img-upload-kit@latest init

# Or non-interactive for Vue 3 / Nuxt 4:
npx img-upload-kit@latest init --framework vue --yes
```

Import the shared design-token stylesheet in your root `main.ts`, `app.vue`, or `nuxt.config.ts`:

```css
@import 'img-upload-kit/styles.css';
```

---

## 2. Global Plugin & Provider (`createImageUpload` / `provideImageUploadConfig`)

Register global defaults (`endpoint`, `deleteEndpoint`, `uploadMode`, `locale`, `headers`, `withCredentials`, or a custom `uploader`) via the Vue plugin or Composition API provider (`provideImageUploadConfig`, also exported as alias `provideImageUpload`):

```ts
// main.ts (Vue 3 SPA) or plugins/image-upload.ts (Nuxt 4)
import { createApp } from 'vue';
import { createImageUpload } from 'img-upload-kit/vue';
import App from './App.vue';
import 'img-upload-kit/styles.css';

const app = createApp(App);

app.use(
  createImageUpload({
    endpoint: '/api/upload',
    deleteEndpoint: '/api/upload', // Opt-in DELETE when an uploaded image is removed
    uploadMode: 'direct',         // 'direct' | 'presigned'
    locale: 'en',                 // 'en' | 'ar' (automatic RTL layout)
    withCredentials: true,
  }),
);

app.mount('#app');
```

You can also scope configuration to a component subtree using `provideImageUploadConfig({ endpoint: '/api/upload', locale: 'ar' })` (or its alias `provideImageUpload({ endpoint: '/api/upload', locale: 'ar' })`).

---

## 3. Drop-In Components (`<SingleImageUpload>` & `<MultiImageUpload>`)

Both components support Vue `v-model`, clipboard paste (`Ctrl+V`), mobile camera capture (`capture="environment"`), pre-upload client resize (`transformAsset`), and all 4 styling tiers (`--iuk-*` tokens, `unstyled` + `classNames`, and custom slots):

```vue
<script setup lang="ts">
import { ref } from 'vue';
import type { UploadedImageData } from 'img-upload-kit';
import { createClientResizeTransform } from 'img-upload-kit/client';
import { SingleImageUpload, MultiImageUpload } from 'img-upload-kit/vue';

const avatar = ref<UploadedImageData | null>(null);
const gallery = ref<UploadedImageData[]>([]);
const resizeBeforeUpload = createClientResizeTransform({ maxWidth: 2048, maxHeight: 2048, quality: 0.9 });
</script>

<template>
  <!-- 1. Single Image Upload with v-model -->
  <SingleImageUpload
    v-model="avatar"
    preset="avatar"
    aspectRatio="1:1"
    label="Profile Avatar"
    name="avatarUrl"
    enablePaste
    :transformAsset="resizeBeforeUpload"
  />

  <!-- 2. Reorderable Product Gallery with Cover badge & pointer drag-and-drop -->
  <MultiImageUpload
    v-model="gallery"
    preset="square"
    label="Product Gallery"
    name="galleryJson"
    reorderable
    showCoverBadge
    :maxImages="8"
    :transformAsset="resizeBeforeUpload"
    @reorder="(ordered) => console.log('New Cover:', ordered[0]?.url)"
  />
</template>
```

---

## 4. Progressive Blur-Up Display (`<AnimatedImage />`)

`<AnimatedImage />` renders a 60 FPS settle reveal (`opacity: 0 -> 1` + `scale(1.02 -> 1)` over `600ms`), decodes off-thread via `img.decode()`, auto-wires responsive `srcSet` from `image.variants`, and supports social aspect ratios (`'1:1' | '4:5' | '9:16' | '16:10'`):

```vue
<script setup lang="ts">
import type { UploadedImageData } from 'img-upload-kit';
import { AnimatedImage } from 'img-upload-kit/vue';

defineProps<{ image: UploadedImageData }>();
</script>

<template>
  <AnimatedImage
    :image="image"
    aspectRatio="4:5"
    showShimmer
    priority
    sizes="(max-width: 768px) 100vw, 600px"
    fallbackSrc="/images/fallback-portrait.webp"
  />
</template>
```

---

## 5. Composables (`useSingleUpload`, `useMultiUpload`, `useImageReveal`)

Build custom upload workflows with reactive Vue `Ref` / `ComputedRef` state:

```vue
<script setup lang="ts">
import { useSingleUpload, useMultiUpload } from 'img-upload-kit/vue';

const single = useSingleUpload({
  preset: 'cover',
  aspectRatio: '16:9',
  onChange: (data) => console.log('Uploaded cover:', data?.url),
});

const multi = useMultiUpload({
  preset: 'square',
  maxImages: 6,
  reorderable: true,
});
</script>

<template>
  <div v-bind="single.getDropzoneProps()">
    <input v-bind="single.getInputProps()" />
    <img v-if="single.previewUrl.value" :src="single.previewUrl.value" :alt="single.altText.value" />
    <span v-else>Drop cover image or click to browse</span>
  </div>
  <progress v-if="single.isUploading.value" :value="single.progress.value" max="100" />
</template>
```

---

## 6. Headless Scoped-Slot Primitives (`<HeadlessSingleUpload>` & `<HeadlessMultiUpload>`)

Prefer renderless components in templates? Use `<HeadlessSingleUpload>` and `<HeadlessMultiUpload>` with scoped slots:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import type { UploadedImageData } from 'img-upload-kit';
import { HeadlessMultiUpload } from 'img-upload-kit/vue';

const images = ref<UploadedImageData[]>([]);
</script>

<template>
  <HeadlessMultiUpload v-model="images" preset="square" reorderable v-slot="ctrl">
    <div v-bind="ctrl.getDropzoneProps()" class="custom-dropzone">
      <input v-bind="ctrl.getInputProps()" />
      <button type="button" @click="ctrl.openFileDialog()">Add Photos ({{ ctrl.remainingCount }})</button>
    </div>

    <div class="custom-grid">
      <div v-for="(item, idx) in ctrl.items" :key="item.id" :data-index="idx">
        <img :src="item.url" :alt="item.altText || ''" />
        <span v-if="idx === 0">Cover</span>
        <button v-if="idx > 0" type="button" @click="ctrl.setCover(idx)">Set as Cover</button>
        <button type="button" @click="ctrl.removeItem(item.id)">Remove</button>
      </div>
    </div>
  </HeadlessMultiUpload>
</template>
```

---

## 7. Nuxt 4 Server Route (`server/api/upload.ts`)

Pair `img-upload-kit/vue` with `createUploadHttpHandler` inside a Nuxt 4 / Nitro server handler using `toWebRequest(event)`:

```ts
// server/api/upload.ts (handles POST & DELETE /api/upload)
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { defineEventHandler, toWebRequest } from 'h3';
import { createImageUploader, createUploadHttpHandler } from 'img-upload-kit/server';
import { createS3StorageAdapter } from 'img-upload-kit/storage';

const storage = createS3StorageAdapter({
  publicBaseUrl: process.env.CDN_BASE_URL!,
  defaultBucket: 'media',
  putObject: (input) => s3.send(new PutObjectCommand(input)),
  deleteObject: (input) => s3.send(new DeleteObjectCommand(input)),
});

const uploader = createImageUploader({ storage, defaultBucket: 'media' });
const handler = createUploadHttpHandler({
  uploader,
  maxBodyBytes: 15 * 1024 * 1024,
  allowClientOverrides: { aspectRatio: true, crop: true, quality: true },
});

export default defineEventHandler(async (event) => {
  const request = toWebRequest(event);
  return request.method === 'DELETE' ? handler.DELETE(request) : handler.POST(request);
});
```
