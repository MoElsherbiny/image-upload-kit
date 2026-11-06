# Angular Integration Guide (`img-upload-kit/angular`)

`img-upload-kit/angular` brings the full `img-upload-kit` upload lifecycle, progressive blur-up reveal, e-commerce gallery reordering, Zoneless Angular Signals (`withAngularSignals`), and Reactive Forms integration to Angular **17, 18, 19, 20, and 21+** with zero runtime lock-in.

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

## 2. Global Configuration (`provideImageUploadConfig` & `resolveImageUploadConfig`)

Provide default upload configuration (`endpoint`, `deleteEndpoint`, `uploadMode`, `locale`, `headers`, `withCredentials`, or `customUploader`) at the application or route level:

```ts
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideImageUploadConfig } from 'img-upload-kit/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideImageUploadConfig({
      endpoint: '/api/upload',
      deleteEndpoint: '/api/upload',
      uploadMode: 'direct', // 'direct' | 'presigned'
      locale: 'en',         // 'en' | 'ar' (automatic RTL support)
      withCredentials: true,
    }),
  ],
};
```

Inside components or services, call `resolveImageUploadConfig(overrides)` (or `injectImageUploadConfig(overrides)`) to merge global settings with per-instance options.

---

## 3. Reactive Single Upload & Zoneless Signals (`createSingleUpload` & `withAngularSignals`)

`createSingleUpload` returns a controller with fine-grained callable signals (`ctrl.previewUrl()`, `ctrl.value()`, `ctrl.isUploading()`, `ctrl.progress()`, `ctrl.uploadStatus()`, `ctrl.error()`, `ctrl.state()`, `ctrl.phase()`, `ctrl.canSave()`, `ctrl.altText()`, `ctrl.blurColor()`, `ctrl.quality()`, `ctrl.disabled()`), top-level `.subscribe(listener)`, and `.toControlValueAccessor()`.

For **Zoneless Angular 18–21+ `OnPush`** components, wrap the controller with `withAngularSignals(controller, { signal, destroyRef: inject(DestroyRef) })` so every signal property is bridged into a native `@angular/core` `Signal<T>` that triggers `OnPush` template updates automatically:

```ts
// cover-upload.component.ts
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { UploadedImageData } from 'img-upload-kit';
import {
  createSingleUpload,
  resolveImageUploadConfig,
  withAngularSignals,
} from 'img-upload-kit/angular';

@Component({
  selector: 'app-cover-upload',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="iuk-single" [attr.data-state]="upload.state()">
      <label class="iuk-label">Cover Image ({{ upload.phase() }})</label>
      <div
        class="iuk-dropzone"
        (click)="fileInput.click()"
        (dragover)="onDragOver($event)"
        (drop)="onDrop($event)"
      >
        <input #fileInput type="file" accept="image/*" style="display: none" (change)="onFileSelected($event)" />
        @if (upload.previewUrl()) {
          <img [src]="upload.previewUrl()!" [alt]="upload.altText()" class="iuk-preview-img" />
        } @else {
          <span>Drop cover photo or click to browse</span>
        }
      </div>
      @if (upload.isUploading()) {
        <div class="iuk-progress" role="progressbar" [attr.aria-valuenow]="upload.progress()">
          {{ upload.uploadStatus() }} ({{ upload.progress() }}%)
          <button type="button" (click)="upload.cancel()">Cancel</button>
        </div>
      }
      @if (upload.error()) {
        <p class="iuk-error" role="alert">
          {{ upload.error() }} <button type="button" (click)="upload.retry()">Retry</button>
        </p>
      }
      <button type="button" [disabled]="!upload.canSave()" (click)="save()">Save Cover</button>
    </div>
  `,
})
export class CoverUploadComponent {
  readonly coverControl = new FormControl<UploadedImageData | null>(null);

  readonly upload = withAngularSignals(
    createSingleUpload({
      ...resolveImageUploadConfig(),
      preset: 'cover',
      aspectRatio: '16:9',
      onChange: (data) => this.coverControl.setValue(data),
    }),
    { signal, destroyRef: inject(DestroyRef) },
  );

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) void this.upload.selectFile(input.files[0]);
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

  save() {
    if (this.upload.canSave()) {
      console.log('Saved cover payload:', this.upload.value());
    }
  }
}
```

### Binding Directly as a `ControlValueAccessor`

Use `upload.toControlValueAccessor()` to implement Angular's `ControlValueAccessor` (`writeValue`, `registerOnChange`, `registerOnTouched`, `setDisabledState`) in a single line.

---

## 4. Multi-Image Gallery & Reordering (`createMultiUpload`)

`createMultiUpload` manages parallel upload queues, per-tile cancel/retry, and e-commerce gallery reordering (`move(fromIndex, toIndex)`, `setCover(index)`, `setPrimary(index)`):

```ts
import { createMultiUpload, withAngularSignals } from 'img-upload-kit/angular';

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
await gallery.selectFiles(fileList); // or gallery.addFiles(fileList)

// Reorder tiles or promote any image to index 0 (Primary Cover):
gallery.move(2, 0);
gallery.setCover(3);
```

---

## 5. Mounted DOM Elements & Progressive Blur-Up (`mountSingleImageUpload`, `mountMultiImageUpload`, `mountAnimatedImage`)

Want turnkey DOM rendering with keyboard + pointer-drag reordering and localized labels? Mount the built-in elements directly onto an Angular `ElementRef`:

```ts
import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild } from '@angular/core';
import type { UploadedImageData } from 'img-upload-kit';
import {
  mountAnimatedImage,
  mountMultiImageUpload,
} from 'img-upload-kit/angular';

@Component({
  selector: 'app-product-media',
  standalone: true,
  template: `
    <div #heroHost></div>
    <div #galleryHost></div>
  `,
})
export class ProductMediaComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) hero!: UploadedImageData;
  @ViewChild('heroHost', { static: true }) heroHost!: ElementRef<HTMLElement>;
  @ViewChild('galleryHost', { static: true }) galleryHost!: ElementRef<HTMLElement>;

  private heroInstance?: ReturnType<typeof mountAnimatedImage>;
  private galleryInstance?: ReturnType<typeof mountMultiImageUpload>;

  ngAfterViewInit() {
    this.heroInstance = mountAnimatedImage(this.heroHost.nativeElement, {
      image: this.hero,
      aspectRatio: '16:10',
      showShimmer: true,
      animationDuration: 600,
      revealScale: 1.02,
      priority: true,
    });

    this.galleryInstance = mountMultiImageUpload(this.galleryHost.nativeElement, {
      preset: 'square',
      reorderable: true,
      showCoverBadge: true,
      locale: 'en',
    });
  }

  ngOnDestroy() {
    this.heroInstance?.destroy();
    this.galleryInstance?.destroy();
  }
}
```

You can also use the standalone wrapper classes `AnimatedImageComponent`, `SingleImageUploadComponent`, and `MultiImageUploadComponent` or drive custom templates with `createImageReveal({ src, blurDataUrl, animationDuration: 600 })`.
