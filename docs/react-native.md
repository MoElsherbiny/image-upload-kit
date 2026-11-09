# React Native & Expo Guide (`img-upload-kit/react-native`)

`img-upload-kit/react-native` provides native mobile upload hooks, camera/photo-library picker adapters, e-commerce gallery reordering, and a 60 FPS `<AnimatedImage />` component built for **Expo** and **Bare React Native** without any DOM (`window`, `document`, `File`, `HTMLImageElement`) dependencies.

---

## 1. Installation

```bash
# Interactive CLI (detects React Native / Expo & your package manager):
npx img-upload-kit@latest init

# Or non-interactive for React Native / Expo:
npx img-upload-kit@latest init --framework react-native --yes
```

---

## 2. Provider & Image Picker Adapters

Wrap your app or screen with `<NativeImageUploadProvider>` and connect either `expo-image-picker` (`createExpoImagePickerAdapter`) or `react-native-image-picker` (`createRnImagePickerAdapter`).

Both adapters automatically normalize iOS `ph://` / `file://` URIs, infer dimensions and file sizes, and normalize iOS `.heic` / `.heif` camera captures to `.jpg` (`image/jpeg`) when transcoded by the native picker:

```tsx
import * as ImagePicker from 'expo-image-picker';
import {
  NativeImageUploadProvider,
  createExpoImagePickerAdapter,
  defaultNativeTheme,
} from 'img-upload-kit/react-native';

const picker = createExpoImagePickerAdapter(ImagePicker, {
  quality: 0.9,
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <NativeImageUploadProvider
      endpoint="https://api.example.com/api/upload"
      picker={picker}
      locale="en"
      theme={defaultNativeTheme}
      headers={{ Authorization: 'Bearer <token>' }}
    >
      {children}
    </NativeImageUploadProvider>
  );
}
```

### Bare React Native (`react-native-image-picker`)

```ts
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { createRnImagePickerAdapter } from 'img-upload-kit/react-native';

export const rnPicker = createRnImagePickerAdapter({
  launchImageLibrary,
  launchCamera,
});
```

---

## 3. Drop-In Native Upload Components (`<SingleImageUpload>` & `<MultiImageUpload>`)

```tsx
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { UploadedImageData } from 'img-upload-kit';
import {
  SingleImageUpload,
  MultiImageUpload,
} from 'img-upload-kit/react-native';

export function ProductEditorScreen() {
  const [cover, setCover] = useState<UploadedImageData | null>(null);
  const [gallery, setGallery] = useState<UploadedImageData[]>([]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
      <SingleImageUpload
        preset="portrait"
        aspectRatio="4:5"
        label="Feed Post (4:5)"
        value={cover}
        onChange={setCover}
        enableCamera
      />

      <MultiImageUpload
        preset="square"
        label="Product Gallery (1:1)"
        value={gallery}
        onChange={setGallery}
        maxImages={8}
        reorderable
        showCoverBadge
        onReorder={(ordered) => console.log('Primary cover is now:', ordered[0]?.url)}
      />
    </ScrollView>
  );
}
```

---

## 4. Headless Native Hooks (`useNativeSingleUpload` & `useNativeMultiUpload`)

Build custom bottom sheets, camera overlays, or social story composers with `useNativeSingleUpload` and `useNativeMultiUpload`:

```tsx
import { Pressable, Text, View } from 'react-native';
import { useNativeMultiUpload } from 'img-upload-kit/react-native';

export function CustomCarouselPicker() {
  const ctrl = useNativeMultiUpload({
    preset: 'story',
    aspectRatio: '9:16',
    maxImages: 5,
    onChange: (items) => console.log('Uploaded stories:', items.length),
  });

  return (
    <View>
      <Pressable onPress={() => void ctrl.pickFromLibrary()}>
        <Text>Choose from Photos ({ctrl.remainingCount} left)</Text>
      </Pressable>
      <Pressable onPress={() => void ctrl.takePhoto()}>
        <Text>Take Camera Shot</Text>
      </Pressable>

      {ctrl.items.map((item, index) => (
        <View key={item.id}>
          <Text>
            #{index + 1} {index === 0 ? '(Cover)' : ''} — {item.progress ?? 100}%
          </Text>
          {index > 0 && (
            <Pressable onPress={() => ctrl.setCover(index)}>
              <Text>Make Cover</Text>
            </Pressable>
          )}
          {item.isUploading && (
            <Pressable onPress={() => ctrl.cancel(item.id)}>
              <Text>Cancel</Text>
            </Pressable>
          )}
          {item.error && (
            <Pressable onPress={() => void ctrl.retry(item.id)}>
              <Text>Retry</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}
```

---

## 5. Progressive `<AnimatedImage>` & `expo-image` Integration

`<AnimatedImage>` from `img-upload-kit/react-native` renders an instant `blurColor` surface, crossfades from `blurDataUrl` LQIP to the sharp asset, and supports `objectFit="contain"` letterbox blur backdrops, social `aspectRatio` (`'1:1' | '4:5' | '9:16' | '16:9'`), and `as={Image}` from `expo-image`:

```tsx
import { Image as ExpoImage } from 'expo-image';
import type { UploadedImageData } from 'img-upload-kit';
import { AnimatedImage } from 'img-upload-kit/react-native';

export function SocialPostCard({ photo }: { photo: UploadedImageData }) {
  return (
    <AnimatedImage
      image={photo}
      as={ExpoImage}
      aspectRatio="4:5"
      objectFit="contain"
      animationDuration={500}
      fallbackSrc="https://cdn.example.com/fallback.webp"
    />
  );
}
```

---

## 6. Native Theme Tokens (`defaultNativeTheme`)

Customize colors and radii via `defaultNativeTheme`, `lightNativeTheme`, or `darkNativeTheme` on `<NativeImageUploadProvider theme={...}>`:

```ts
import { darkNativeTheme, type NativeTheme } from 'img-upload-kit/react-native';

export const brandTheme: NativeTheme = {
  ...darkNativeTheme,
  colors: {
    ...darkNativeTheme.colors,
    primary: '#38bdf8',
    surface: '#0f172a',
  },
};
```
