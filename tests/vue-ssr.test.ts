import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { describe, expect, it } from 'vitest';
import {
  AnimatedImage,
  createImageUpload,
  MultiImageUpload,
  provideImageUpload,
  SingleImageUpload,
  useImageUploadConfig,
} from '../src/vue';

describe('img-upload-kit/vue — Nuxt 4 / Vue 3.5 SSR Safety', () => {
  it('renders AnimatedImage, SingleImageUpload, and MultiImageUpload via renderToString without DOM globals', async () => {
    expect(typeof window).toBe('undefined');

    const app = createSSRApp({
      render: () =>
        h('div', [
          h(AnimatedImage, {
            src: 'https://cdn.example.com/hero.avif',
            alt: 'Hero banner',
            blurColor: '#3B82F6',
            colorPlaceholder: 'gradient',
            aspectRatio: '16:9',
            showShimmer: true,
          }),
          h(SingleImageUpload, {
            preset: 'square',
            locale: 'ar',
          }),
          h(MultiImageUpload, {
            preset: 'card',
            modelValue: [
              {
                url: 'https://cdn.example.com/1.webp',
                blurDataUrl:
                  'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
                blurColor: '#344040',
                altText: 'Cover item',
                width: 800,
                height: 800,
                format: 'webp',
                size: 20480,
                originalSize: 64000,
                contentHash: 'ssr-hash-1',
                uploadedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          }),
        ]),
    });

    app.use(
      createImageUpload({
        endpoint: '/api/upload',
        locale: 'en',
      }),
    );

    const html = await renderToString(app);
    expect(html).toContain('data-slot="animated-image"');
    expect(html).toContain('data-slot="animated-image-placeholder"');
    expect(html).toContain('data-slot="animated-image-shimmer"');
    expect(html).toContain('data-slot="single-root"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('data-slot="multi-root"');
    expect(html).toContain('data-slot="cover-badge"');
  });

  it('isolates createImageUpload and provideImageUpload across concurrent SSR app instances without cross-request leakage', async () => {
    const ConfigProbe = defineComponent({
      setup() {
        const cfg = useImageUploadConfig();
        return () =>
          h('span', {
            'data-endpoint': cfg.endpoint,
            'data-locale': cfg.locale,
          });
      },
    });

    const appA = createSSRApp({ render: () => h(ConfigProbe) });
    appA.use(createImageUpload({ endpoint: '/api/tenant-a', locale: 'en' }));

    const appB = createSSRApp({ render: () => h(ConfigProbe) });
    appB.use(createImageUpload({ endpoint: '/api/tenant-b', locale: 'ar' }));

    const NestedProviderApp = createSSRApp(
      defineComponent({
        setup() {
          provideImageUpload({ endpoint: '/api/scoped-provide', locale: 'ar' });
          return () => h(ConfigProbe);
        },
      }),
    );

    // Render appA AFTER appB was configured to prove appB.use() did not overwrite appA or module state
    const [htmlA, htmlB, htmlScoped] = await Promise.all([
      renderToString(appA),
      renderToString(appB),
      renderToString(NestedProviderApp),
    ]);

    expect(htmlA).toContain('data-endpoint="/api/tenant-a"');
    expect(htmlA).toContain('data-locale="en"');
    expect(htmlB).toContain('data-endpoint="/api/tenant-b"');
    expect(htmlB).toContain('data-locale="ar"');
    expect(htmlScoped).toContain('data-endpoint="/api/scoped-provide"');

    // Module-level default config remains untouched by SSR app instances
    expect(useImageUploadConfig().endpoint).toBe('/api/upload');
  });
});
