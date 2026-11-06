# Angular Integration Guide (`img-upload-kit/angular`)

`img-upload-kit/angular` brings the full `img-upload-kit` upload lifecycle, progressive blur-up reveal, e-commerce gallery reordering, and Reactive Forms integration to Angular **17, 18, and 19+** with zero runtime lock-in.

---

## 1. Installation & Styling

```bash
npm install img-upload-kit
# Optional on your Node.js server:
npm install sharp lqip-modern
```

Import the shared design-token stylesheet in `angular.json` or `styles.css`:

```css
@import 'img-upload-kit/styles.css';
```

---

## 2. Global Configuration (`provideImageUploadConfig`)

Provide default upload configuration (`endpoint`, `locale`, `headers`, `withCredentials`, or a custom `uploader`) at the application or route level:

```ts
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideImageUploadConfig } from 'img-upload-kit/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideImageUploadConfig({
      endpoint: '/api/upload',
      locale: 'en', // 'en' | 'ar' (automatic RTL support)
      withCredentials: true,
    }),
  ],
};
```

---

## 3. Reactive Single Upload & Angular Forms (`createSingleUpload`)

`createSingleUpload` returns a reactive controller with `.state()` (callable signal-style getter), `.subscribe(listener)`, actions (`selectFile`, `cancel`, `retry`, `clear`, `setAltText`, `setBlurColor`), and a first-class `.toControlValueAccessor()` bridge for `@angular/forms`:

```ts
// cover-upload.component.ts
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { UploadedImageData } from 'img-upload-kit';
import { createSingleUpload, resolveImageUploadConfig } from 'img-upload-kit/angular';

@Component({
  selector: 'app-cover-upload',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="iuk-root" [attr.data-state]="state().state">
      <label class="iuk-label">Cover Image</label>
      <div
        class="iuk-dropzone"
        (click)="fileInput.click()"
        (dragover)="onDragOver($event)"
        (drop)="onDrop($event)"
      >
        <input #fileInput type="file" accept="image/*" style="display: none" (change)="onFileSelected($event)" />
        @if (state().preview) {
          <img [src]="state().preview!" [alt]="state().altText" class="iuk-preview-img" />
        } @else {
          <span>Drop cover photo or click to browse</span>
        }
      </div>
      @if (state().isUploading) {
        <div class="iuk-progress" role="progressbar" [attr.aria-valuenow]="state().progress">
          Uploading {{ state().progress }}%
          <button type="button" (click)="upload.cancel()">Cancel</button>
        </div>
      }
      @if (state().error) {
        <p class="iuk-error" role="alert">
          {{ state().error }} <button type="button" (click)="upload.retry()">Retry</button>
        </p>
      }
    </div>
  `,
})
export class CoverUploadComponent {
  private destroyRef = inject(DestroyRef);
  readonly coverControl = new FormControl<UploadedImageData | null>(null);

  readonly upload = createSingleUpload({
    ...resolveImageUploadConfig(),
    preset: 'cover',
    aspectRatio: '16:9',
    onChange: (data) => this.coverControl.setValue(data),
  });

  readonly state = signal(this.upload.state());

  constructor() {
    const unsub = this.upload.subscribe((next) => this.state.set(next));
    this.destroyRef.onDestroy(() => {
      unsub();
      this.upload.destroy();
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) void this.upload.selectFiles(input.files);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.upload.setDragging(true);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.upload.setDragging(false);
    if (event.dataTransfer?.files?.length) {
      void this.upload.selectFiles(event.dataTransfer.files);
    }
  }
}
```

### Binding Directly as a `ControlValueAccessor`

Use `upload.toControlValueAccessor()` to implement Angular's `ControlValueAccessor` in a single line (`writeValue`, `registerOnChange`, `registerOnTouched`, `setDisabledState`).

---

## 4. Multi-Image Gallery & Reordering (`createMultiUpload`)

`createMultiUpload` manages parallel upload queues, per-tile cancel/retry, and e-commerce gallery reordering (`move(fromIndex, toIndex)` and `setCover(index)`):

```ts
import { createMultiUpload } from 'img-upload-kit/angular';

const gallery = createMultiUpload({
  endpoint: '/api/upload',
  preset: 'square',
  maxImages: 8,
  maxParallelUploads: 3,
  reorderable: true,
  onChange: (images) => console.log('Gallery updated:', images),
  onReorder: (images) => console.log('New gallery order (index 0 = Cover):', images),
});

// Add files from an <input type="file" multiple> or drop event:
await gallery.selectFiles(fileList);

// Reorder tiles or promote any image to index 0 (Primary Cover):
gallery.move(2, 0);
gallery.setCover(3);
```

---

## 5. Progressive Blur-Up Reveal (`createImageReveal` & `mountAnimatedImage`)

Render 60 FPS progressive blur-up images (`blurDataUrl` -> `blurHash` -> `blurColor`) with off-thread `img.decode()` verification and `aspectRatio` support:

```ts
import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild } from '@angular/core';
import type { UploadedImageData } from 'img-upload-kit';
import { mountAnimatedImage } from 'img-upload-kit/angular';

@Component({
  selector: 'app-hero-image',
  standalone: true,
  template: `<div #container></div>`,
})
export class HeroImageComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) image!: UploadedImageData;
  @ViewChild('container', { static: true }) container!: ElementRef<HTMLElement>;

  private instance?: ReturnType<typeof mountAnimatedImage>;

  ngAfterViewInit() {
    this.instance = mountAnimatedImage(this.container.nativeElement, {
      image: this.image,
      aspectRatio: '16:10',
      showShimmer: true,
      animationDuration: 600,
      revealScale: 1.02,
      priority: true,
    });
  }

  ngOnDestroy() {
    this.instance?.destroy();
  }
}
```

You can also use the standalone helpers `AnimatedImageComponent`, `SingleImageUploadComponent`, and `MultiImageUploadComponent` exported from `img-upload-kit/angular` or drive custom templates with `createImageReveal({ srcKey, animationDuration: 600 })`.

---

## 6. Styling with `--iuk-*` CSS Tokens

All Angular uploaders and mounted `<AnimatedImage>` elements share the exact same `--iuk-*` CSS variables and `data-slot` / `data-state` attributes as the React package:

```css
:root {
  --iuk-primary: #0284c7;
  --iuk-radius-md: 14px;
  --iuk-animated-image-duration: 600ms;
}
```
