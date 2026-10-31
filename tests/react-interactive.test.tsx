import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MultiImageUpload, SingleImageUpload } from '../src/react';
import { QualitySelector } from '../src/react/components/QualitySelector';
import { UploadProgressPanel } from '../src/react/components/UploadProgressPanel';
import type { UploadItem } from '../src/react/components/UploadProgressPanel';
import type { UploadedImageData } from '../src/types';

const noop = () => {};

const makeImage = (id: string, url: string): UploadedImageData => ({
  url,
  blurDataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
  blurColor: '#4F46E5', altText: `Image ${id}`, width: 800, height: 600, format: 'webp',
  size: 24000, originalSize: 80000, contentHash: `hash-${id}`, uploadedAt: '2026-01-01T00:00:00.000Z',
});

const sample1 = makeImage('1', 'https://cdn.example.com/photo-1.webp');
const sample2 = makeImage('2', 'https://cdn.example.com/photo-2.webp');

describe('Controlled MultiImageUpload - External Value Updates (Feature 8)', () => {
  it('renders all tiles when value contains multiple images', () => {
    const html = renderToStaticMarkup(<MultiImageUpload mode="multiple" value={[sample1, sample2]} onChange={noop} />);
    expect(html).toContain(sample1.url);
    expect(html).toContain(sample2.url);
    expect(html).toContain('data-slot="tile"');
    expect((html.match(/data-slot="tile"/g) || []).length).toBe(2);
  });

  it('removes tile when image is externally removed from value', () => {
    const initialHtml = renderToStaticMarkup(<MultiImageUpload mode="multiple" value={[sample1, sample2]} onChange={noop} />);
    expect(initialHtml).toContain(sample1.url);
    expect(initialHtml).toContain(sample2.url);

    const updatedHtml = renderToStaticMarkup(<MultiImageUpload mode="multiple" value={[sample1]} onChange={noop} />);
    expect(updatedHtml).toContain(sample1.url);
    expect(updatedHtml).not.toContain(sample2.url);
    expect((updatedHtml.match(/data-slot="tile"/g) || []).length).toBe(1);
  });

  it('renders empty dropzone when value transitions to empty array', () => {
    const emptyHtml = renderToStaticMarkup(<MultiImageUpload mode="multiple" value={[]} onChange={noop} />);
    expect(emptyHtml).toContain('data-slot="empty-dropzone"');
    expect(emptyHtml).toContain('iuk-multi__empty');
    expect(emptyHtml).not.toContain(sample1.url);
    expect(emptyHtml).not.toContain(sample2.url);
  });

  it('renders previews corresponding to external active value and reflects removals', () => {
    const singleHtml = renderToStaticMarkup(<MultiImageUpload mode="multiple" value={[sample1]} onChange={noop} />);
    expect(singleHtml).toContain(sample1.url);
    expect(singleHtml).not.toContain(sample2.url);
    expect((singleHtml.match(/data-slot="tile"/g) || []).length).toBe(1);

    const dualHtml = renderToStaticMarkup(<MultiImageUpload mode="multiple" value={[sample1, sample2]} onChange={noop} />);
    expect(dualHtml).toContain(sample1.url);
    expect(dualHtml).toContain(sample2.url);
    expect((dualHtml.match(/data-slot="tile"/g) || []).length).toBe(2);

    const removedHtml = renderToStaticMarkup(<MultiImageUpload mode="multiple" value={[sample2]} onChange={noop} />);
    expect(removedHtml).not.toContain(sample1.url);
    expect(removedHtml).toContain(sample2.url);
    expect((removedHtml.match(/data-slot="tile"/g) || []).length).toBe(1);
  });
});

describe('Controlled SingleImageUpload - External Reset to null (Feature 9)', () => {
  it('renders preview tile and ready state when value is an image object', () => {
    const html = renderToStaticMarkup(<SingleImageUpload value={sample1} onChange={noop} />);
    expect(html).toContain('data-state="ready"');
    expect(html).toContain(sample1.url);
    expect(html).toContain('data-slot="preview-wrap"');
    expect(html).toContain('data-slot="tile"');
  });

  it('clears preview and resets to idle dropzone when value transitions to null', () => {
    const readyHtml = renderToStaticMarkup(<SingleImageUpload value={sample1} onChange={noop} />);
    expect(readyHtml).toContain('data-state="ready"');

    const resetHtml = renderToStaticMarkup(<SingleImageUpload value={null} onChange={noop} />);
    expect(resetHtml).toContain('data-state="idle"');
    expect(resetHtml).not.toContain(sample1.url);
    expect(resetHtml).not.toContain('data-slot="preview-wrap"');
    expect(resetHtml).toContain('data-slot="dropzone"');
  });

  it('clears preview when value transitions to empty string', () => {
    const emptyHtml = renderToStaticMarkup(<SingleImageUpload value="" onChange={noop} />);
    expect(emptyHtml).toContain('data-state="idle"');
    expect(emptyHtml).not.toContain('data-slot="preview-wrap"');
    expect(emptyHtml).toContain('data-slot="dropzone"');
  });

  it('resets uploadedData and renders empty dropzone prompt when value transitions to null', () => {
    const readyHtml = renderToStaticMarkup(<SingleImageUpload value={sample1} onChange={noop} />);
    expect(readyHtml).toContain('data-state="ready"');
    expect(readyHtml).not.toContain('data-slot="dropzone-prompt"');

    const emptyHtml = renderToStaticMarkup(<SingleImageUpload value={null} onChange={noop} />);
    expect(emptyHtml).toContain('data-state="idle"');
    expect(emptyHtml).not.toContain(sample1.url);
    expect(emptyHtml).not.toContain('data-slot="preview-wrap"');
    expect(emptyHtml).toContain('data-slot="dropzone"');
    expect(emptyHtml).toContain('data-slot="dropzone-prompt"');
    expect(emptyHtml).toContain('data-slot="dropzone-text"');
  });
});

describe('QualitySelector - Radio Selection & WAI-ARIA Conformance (Feature 13)', () => {
  it('renders role="radiogroup" containing 4 role="radio" buttons with proper aria-checked states', () => {
    const html = renderToStaticMarkup(<QualitySelector value="medium" onChange={noop} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Quality level"');
    expect(html.match(/role="radio"/g)).toHaveLength(4);
    expect((html.match(/aria-checked="true"/g) || []).length).toBe(1);
  });

  it('triggers onChange with selected quality level when radio button is clicked', () => {
    const onChange = vi.fn();
    const element = QualitySelector({ value: 'medium', onChange });
    const buttons = element.props.children[1].props.children;
    expect(buttons).toHaveLength(4);

    const highBtn = buttons.find((b: { key: string }) => b.key === 'high');
    highBtn?.props.onClick();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('high');

    const maxBtn = buttons.find((b: { key: string }) => b.key === 'maximum');
    maxBtn?.props.onClick();
    expect(onChange).toHaveBeenCalledWith('maximum');
  });

  it('does not trigger onChange when disabled is true', () => {
    const onChange = vi.fn();
    const element = QualitySelector({ value: 'medium', onChange, disabled: true });
    const buttons = element.props.children[1].props.children;
    for (const btn of buttons) {
      expect(btn.props.disabled).toBe(true);
      btn.props.onClick();
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders star indicator for recommended preset and supports RTL Arabic locale', () => {
    const html = renderToStaticMarkup(
      <QualitySelector value="low" recommendedLevel="high" locale="ar" onChange={noop} />,
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('★');
    expect(html).toContain('iuk-quality__tab--recommended');
    expect(html).toContain('منخفض');
    expect(html).toContain('عالي');
  });
});

describe('Progress Dock Visibility & Lifecycle (Feature 10)', () => {
  it('renders nothing (null) when upload items list is empty', () => {
    const html = renderToStaticMarkup(<UploadProgressPanel items={[]} completedCount={0} totalCount={0} />);
    expect(html).toBe('');
  });

  it('renders floating progress dock with progress and file details when items are present', () => {
    const items = [{ id: 'upload-1', url: 'blob:file-1', fileName: 'sample-photo.png', progress: 65, message: 'Optimizing...' }];
    const html = renderToStaticMarkup(<UploadProgressPanel items={items} completedCount={1} totalCount={2} />);
    expect(html).toContain('data-upload-progress-dock');
    expect(html).toContain('iuk-progress-dock');
    expect(html).toContain('sample-photo.png');
    expect(html).toContain('65%');
    expect(html).toContain('Optimizing...');
  });

  it('renders progress dock structure and header count when mounted with items', () => {
    const items = [{ id: 'u1', url: 'blob:test', fileName: 'test.jpg', progress: 50 }];
    const html = renderToStaticMarkup(<UploadProgressPanel items={items} completedCount={0} totalCount={1} />);
    expect(html).toContain('data-upload-progress-dock');
    expect(html).toContain('iuk-progress-dock');
    expect(html).toContain('iuk-progress-panel__header');
    expect(html).toContain('test.jpg');
    expect(html).toContain('50%');
    expect(html).toContain('(0/1)');
  });

  it('renders multi-item progress with individual completion bars and error status messages', () => {
    const items: UploadItem[] = [
      { id: 'it-1', url: 'blob:1', fileName: 'finished.png', progress: 100, message: 'Upload complete' },
      { id: 'it-2', url: 'blob:2', fileName: 'processing.png', progress: 45, message: 'Uploading 45%' },
      { id: 'it-3', url: 'blob:3', fileName: 'failed.png', progress: 0, message: 'Upload failed: timeout' },
    ];
    const html = renderToStaticMarkup(<UploadProgressPanel items={items} completedCount={1} totalCount={3} />);
    expect(html).toContain('(1/3)');
    expect(html).toContain('finished.png');
    expect(html).toContain('processing.png');
    expect(html).toContain('failed.png');
    expect(html).toContain('Upload complete');
    expect(html).toContain('Uploading 45%');
    expect(html).toContain('Upload failed: timeout');
    expect(html).toMatch(/width:\s*100%/);
    expect(html).toMatch(/width:\s*45%/);
    expect((html.match(/iuk-progress-bar__fill/g) || []).length).toBe(2);
    expect((html.match(/class="iuk-progress-item"/g) || []).length).toBe(3);
  });

  it('supports custom image renderer for progress item thumbnails', () => {
    const customRenderer = vi.fn((props: { src: string; alt?: string }) => (
      <span data-custom-thumb="true" data-src={props.src} className="custom-preview-img" />
    ));
    const items: UploadItem[] = [
      { id: 'custom-1', url: 'blob:preview-custom.jpg', fileName: 'custom.jpg', progress: 70 },
    ];
    const html = renderToStaticMarkup(
      <UploadProgressPanel items={items} completedCount={0} totalCount={1} renderImage={customRenderer} />,
    );
    expect(html).toContain('data-custom-thumb="true"');
    expect(html).toContain('blob:preview-custom.jpg');
    expect(customRenderer).toHaveBeenCalled();
    expect(customRenderer.mock.calls[0][0].src).toBe('blob:preview-custom.jpg');
  });

  it('supports RTL direction, Arabic localization, and fallback labels for omitted item fields', () => {
    const items: UploadItem[] = [{ id: 'u-fallback', url: 'blob:fallback.png', progress: 80 }];
    const html = renderToStaticMarkup(
      <UploadProgressPanel
        items={items}
        completedCount={1}
        totalCount={1}
        locale="ar"
        translations={{ uploading: 'جارٍ الرفع', uploadImage: 'صورة', image: 'ملف صورة', processing: 'قيد المعالجة' }}
      />,
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('جارٍ الرفع 1 صورة');
    expect(html).toContain('(1/1)');
    expect(html).toContain('ملف صورة');
    expect(html).toContain('قيد المعالجة');
    expect(html).toMatch(/width:\s*80%/);
  });
});
