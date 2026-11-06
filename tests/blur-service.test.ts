import { describe, expect, it } from 'vitest';
import {
  BlurService,
  createSrcSetWithBlur,
  DEFAULT_PLACEHOLDERS,
  getBlurData,
  getBlurPlaceholderStyle,
  getImagePropsWithBlur,
  LRUCache,
  normalizeImagePath,
  preloadImageWithBlur,
} from '../src/blur';

describe('LRUCache', () => {
  it('promotes accessed keys, evicts least-recently-used entries, and clears', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);

    // Promote 'a' so 'b' becomes least-recently-used
    expect(cache.get('a')).toBe(1);

    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);

    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('normalizeImagePath', () => {
  it('normalizes local paths, strips /public/ and query/hash fragments', () => {
    const info = normalizeImagePath('./public/gallery/photo.webp?v=42#section');
    expect(info.normalizedPath).toBe('/gallery/photo.webp');
    expect(info.folder).toBe('gallery');
    expect(info.filename).toBe('photo.webp');
    expect(info.extension).toBe('webp');
    expect(info.isExternal).toBe(false);
  });

  it('normalizes Supabase, Cloudflare R2, and AWS S3 CDN URLs', () => {
    const supabase = normalizeImagePath(
      'https://demo.supabase.co/storage/v1/object/public/media/items/banner.avif?width=800',
    );
    expect(supabase.normalizedPath).toBe('/media/items/banner.avif');
    expect(supabase.isExternal).toBe(true);
    expect(supabase.extension).toBe('avif');

    const r2 = normalizeImagePath('https://pub-abc123.r2.dev/catalog/shoe.png?token=xyz');
    expect(r2.normalizedPath).toBe('/catalog/shoe.png');
    expect(r2.isExternal).toBe(true);

    const s3 = normalizeImagePath('https://assets-bucket.s3.amazonaws.com/icons/logo.svg');
    expect(s3.normalizedPath).toBe('/icons/logo.svg');
    expect(s3.isExternal).toBe(true);
  });
});

describe('BlurService', () => {
  it('hydrates manifests, resolves small/medium/fallback URLs, tracks hit rate, and registers entries', () => {
    const service = new BlurService({ cacheSize: 10 });

    service.loadManifest({
      version: '2.1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      totalImages: 1,
      hashes: {
        '/items/banner.avif': {
          hash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
          color: '#1E40AF',
          variants: {
            small: 'data:image/webp;base64,SMALL_BANNER',
            medium: 'data:image/webp;base64,MEDIUM_BANNER',
          },
        },
      },
    });

    const cdnUrl = 'https://demo.supabase.co/storage/v1/object/public/media/items/banner.avif?v=2';
    expect(service.hasBlurHash(cdnUrl)).toBe(true);
    expect(service.hasBlurHash('/unknown/missing.png')).toBe(false);
    expect(service.getDominantColor(cdnUrl)).toBe('#1E40AF');
    expect(service.getDominantColor('/unknown/missing.png')).toBe('#E5E7EB');

    // Request 1 (miss) + Request 2 (hit)
    expect(service.getBlurDataURL('/items/banner.avif')).toBe('data:image/webp;base64,SMALL_BANNER');
    expect(service.getBlurDataURL('/items/banner.avif')).toBe('data:image/webp;base64,SMALL_BANNER');

    // Request 3 (medium miss)
    expect(service.getBlurDataURL('/items/banner.avif', { size: 'medium' })).toBe(
      'data:image/webp;base64,MEDIUM_BANNER',
    );

    // Request 4 (missing fallback with type sensitivity)
    expect(service.getBlurDataURL('/missing.avif', { type: 'hero' })).toBe(
      DEFAULT_PLACEHOLDERS.hero,
    );
    expect(service.getBlurDataURL('/missing.avif', { type: 'card' })).toBe(
      DEFAULT_PLACEHOLDERS.card,
    );

    const meta = service.getMetadata();
    expect(meta.version).toBe('2.1');
    expect(meta.totalImages).toBe(1);
    expect(meta.metrics.totalRequests).toBe(5);
    expect(meta.metrics.cacheHits).toBe(1);
    expect(meta.metrics.cacheMisses).toBe(4);
    expect(meta.metrics.cacheHitRate).toBe('20.00%');

    // Runtime entry registration & medium->small fallback
    service.registerEntry('/catalog/new-shoe.webp', {
      hash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
      color: '#10B981',
      variants: { small: 'data:image/webp;base64,SMALL_SHOE' },
    });

    expect(service.getMetadata().totalImages).toBe(2);
    expect(service.getBlurDataURL('/catalog/new-shoe.webp', { size: 'medium' })).toBe(
      'data:image/webp;base64,SMALL_SHOE',
    );
    expect(service.findMatchingKeys('CATALOG')).toEqual(['/catalog/new-shoe.webp']);
  });
});

describe('blurDataUtils', () => {
  it('computes BlurData, image props, CSS placeholder styles, and srcSet strings', () => {
    expect(getBlurData(null)).toEqual({
      blurDataUrl: '',
      blurColor: '#E5E7EB',
      hasBlur: false,
    });

    const source = {
      url: '/gallery/item.avif',
      blurDataUrl: 'data:image/webp;base64,LQIP',
      blurColor: '#0F172A',
      blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      altText: 'Gallery item',
      width: 1200,
      height: 800,
    };

    expect(getBlurData(source)).toEqual({
      blurDataUrl: 'data:image/webp;base64,LQIP',
      blurColor: '#0F172A',
      blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      hasBlur: true,
    });

    expect(getImagePropsWithBlur(null)).toBeNull();
    expect(getImagePropsWithBlur(source)).toEqual({
      src: '/gallery/item.avif',
      alt: 'Gallery item',
      width: 1200,
      height: 800,
      placeholder: 'blur',
      blurDataURL: 'data:image/webp;base64,LQIP',
    });

    expect(getBlurPlaceholderStyle({ blurColor: '#0F172A' })).toEqual({
      backgroundColor: '#0F172A',
    });
    expect(getBlurPlaceholderStyle(source)).toMatchObject({
      backgroundColor: '#0F172A',
      backgroundImage: 'url("data:image/webp;base64,LQIP")',
      filter: 'blur(20px)',
      transform: 'scale(1.1)',
    });

    expect(createSrcSetWithBlur(null)).toBe('');
    expect(createSrcSetWithBlur({ url: '/plain.avif', width: 1000 })).toBe('/plain.avif 1000w');
    expect(createSrcSetWithBlur(source)).toBe('/gallery/item.avif 1200w');
    expect(createSrcSetWithBlur(source)).not.toContain('data:image/');

    // preloadImageWithBlur drops imagesrcset and deduplicates <link> elements
    const appended: Array<{ rel: string; as: string; href: string; attrs: Record<string, string> }> = [];
    const origDoc = globalThis.document;
    try {
      (globalThis as unknown as { document: unknown }).document = {
        createElement: () => {
          const el = {
            rel: '',
            as: '',
            href: '',
            attrs: {} as Record<string, string>,
            setAttribute(k: string, v: string) {
              this.attrs[k] = v;
            },
            getAttribute(k: string) {
              return k === 'href' ? this.href : this.attrs[k];
            },
          };
          return el;
        },
        head: {
          querySelectorAll: () => appended,
          appendChild: (el: (typeof appended)[number]) => {
            appended.push(el);
          },
        },
      };

      preloadImageWithBlur(source);
      preloadImageWithBlur(source);
      expect(appended).toHaveLength(1);
      expect(appended[0].href).toBe('/gallery/item.avif');
      expect(appended[0].attrs.imagesrcset).toBeUndefined();
    } finally {
      (globalThis as unknown as { document: unknown }).document = origDoc;
    }
  });
});
