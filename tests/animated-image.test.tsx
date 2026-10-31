import { forwardRef, type ImgHTMLAttributes } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AnimatedImage,
  createFallbackBlurSvg,
  resolveMeaningfulColor,
  resolvePlaceholderUrl,
} from '../src/react';

describe('AnimatedImage placeholder utils', () => {
  it('treats empty, neutral and invalid colors as non-meaningful', () => {
    expect(resolveMeaningfulColor(undefined)).toBeUndefined();
    expect(resolveMeaningfulColor('  ')).toBeUndefined();
    expect(resolveMeaningfulColor('#000000')).toBeUndefined();
    expect(resolveMeaningfulColor('#FFFFFF')).toBeUndefined();
    expect(resolveMeaningfulColor('red;}</style>')).toBeUndefined();
    expect(resolveMeaningfulColor('#3a7bd5')).toBe('#3a7bd5');
    expect(resolveMeaningfulColor('rgb(10, 20, 30)')).toBe('rgb(10, 20, 30)');
  });

  it('builds an SVG gradient data URL using the dominant color or neutral fallback', () => {
    const colored = decodeURIComponent(createFallbackBlurSvg('#3a7bd5'));
    expect(colored).toMatch(/^data:image\/svg\+xml/);
    expect(colored).toContain('stop-color="#3a7bd5"');
    const neutral = decodeURIComponent(createFallbackBlurSvg(null));
    expect(neutral).toContain('stop-color="#2c3340"');
  });

  it('prefers blurDataUrl over blurHash and color', () => {
    expect(resolvePlaceholderUrl({ blurDataUrl: ' data:image/webp;base64,AAA ', blurColor: '#123456' })).toBe(
      'data:image/webp;base64,AAA',
    );
    expect(resolvePlaceholderUrl({ blurColor: '#123456' })).toContain('svg');
  });
});

describe('<AnimatedImage> (SSR)', () => {
  it('renders placeholder + main image with loading state and default classes', () => {
    const html = renderToStaticMarkup(
      <AnimatedImage src="/photo.jpg" alt="A photo" blurDataUrl="data:image/webp;base64,AAA" blurColor="#3a7bd5" />,
    );
    expect(html).toContain('class="iuk-animated-image"');
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('src="data:image/webp;base64,AAA"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('src="/photo.jpg"');
    expect(html).toContain('alt="A photo"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('background-color:#3a7bd5');
  });

  it('applies fill / contain modifiers and shimmer', () => {
    const html = renderToStaticMarkup(
      <AnimatedImage src="/a.jpg" alt="" fill objectFit="contain" showShimmer wrapperClassName="card" />,
    );
    expect(html).toContain('iuk-animated-image--fill');
    expect(html).toContain('iuk-animated-image--contain');
    expect(html).toContain('iuk-animated-image__shimmer');
    expect(html).toContain('card');
  });

  it('strips all iuk-* classes in unstyled mode', () => {
    const html = renderToStaticMarkup(
      <AnimatedImage src="/a.jpg" alt="x" unstyled showShimmer className="my-img" wrapperClassName="my-wrap" />,
    );
    expect(html).not.toContain('iuk-animated-image');
    expect(html).toContain('my-img');
    expect(html).toContain('my-wrap');
    expect(html).toContain('data-slot="animated-image"');
  });

  it('renders a custom image component via `as` and forwards fill + extra props', () => {
    const received: Array<Record<string, unknown>> = [];
    const FrameworkImage = forwardRef<HTMLImageElement, ImgHTMLAttributes<HTMLImageElement> & Record<string, unknown>>(
      function FrameworkImage(props, ref) {
        received.push(props);
        const { fill: _fill, quality: _quality, ...rest } = props;
        return <img ref={ref} data-framework="yes" {...rest} />;
      },
    );
    const html = renderToStaticMarkup(
      <AnimatedImage as={FrameworkImage} src="/b.jpg" alt="b" fill imageComponentProps={{ quality: 80 }} />,
    );
    expect(html).toContain('data-framework="yes"');
    expect(received[0]?.fill).toBe(true);
    expect(received[0]?.quality).toBe(80);
    expect(received[0]?.src).toBe('/b.jpg');
  });

  it('accepts an UploadedImageData object directly via `image` prop', () => {
    const uploadedImage = {
      url: 'https://cdn.example.com/hero.avif',
      blurDataUrl: 'data:image/webp;base64,BBB',
      blurColor: '#4f46e5',
      altText: 'Uploaded Hero',
      width: 1200,
      height: 800,
    };
    const html = renderToStaticMarkup(<AnimatedImage image={uploadedImage} />);
    expect(html).toContain('src="https://cdn.example.com/hero.avif"');
    expect(html).toContain('alt="Uploaded Hero"');
    expect(html).toContain('src="data:image/webp;base64,BBB"');
    expect(html).toContain('background-color:#4f46e5');
    expect(html).toContain('width="1200"');
    expect(html).toContain('height="800"');
  });
});
