import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  cx,
  HIDDEN_INPUT_STYLE,
  HeadlessMultiUpload as ReactHeadlessMulti,
  HeadlessSingleUpload as ReactHeadlessSingle,
  ImageUploadProvider,
  MultiImageUpload,
  resolveSlotClass,
  resolveSlotStyle,
  resolveUploadDataState,
  SingleImageUpload,
} from '../src/react';
import {
  HeadlessMultiUpload,
  HeadlessSingleUpload,
  useMultiUpload,
  useSingleUpload,
} from '../src/react/headless';
import type { UploadedImageData } from '../src/types';

const noop = () => {};

const sampleUploadedImage: UploadedImageData = {
  url: 'https://cdn.example.com/media/photo-1.avif',
  blurDataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
  blurColor: '#334155',
  altText: 'Mountain ridge at sunrise',
  width: 1200,
  height: 800,
  format: 'avif',
  size: 42000,
  originalSize: 128000,
  contentHash: 'sha256-sample-hash-01',
  uploadedAt: '2026-01-15T10:00:00.000Z',
};

describe('slotStyles utilities', () => {
  it('cx joins truthy class names and drops falsy values', () => {
    expect(cx('a', false, null, undefined, '', 'b', 'c')).toBe('a b c');
    expect(cx(false, null, undefined)).toBe('');
  });

  it('resolveSlotClass merges or strips iuk-* default classes based on unstyled', () => {
    expect(resolveSlotClass('iuk-dropzone', false, 'provider-dz', 'my-dz')).toBe(
      'iuk-dropzone provider-dz my-dz',
    );
    expect(resolveSlotClass('iuk-dropzone', true, 'provider-dz', 'my-dz')).toBe('provider-dz my-dz');
    expect(resolveSlotClass('iuk-dropzone', true, undefined, false)).toBeUndefined();
    expect(resolveSlotClass(undefined, false)).toBeUndefined();
  });

  it('resolveSlotStyle merges CSSProperties objects immutably', () => {
    expect(resolveSlotStyle(undefined, undefined)).toBeUndefined();
    const base = { borderRadius: 8, padding: 12 };
    const merged = resolveSlotStyle(base, undefined, { padding: 24, borderColor: '#4f46e5' });
    expect(merged).toEqual({ borderRadius: 8, padding: 24, borderColor: '#4f46e5' });
    expect(base.padding).toBe(12);
    expect(HIDDEN_INPUT_STYLE.clip).toBe('rect(0, 0, 0, 0)');
  });

  it('resolveUploadDataState follows strict priority: disabled > dragging > uploading > error > ready > idle', () => {
    expect(resolveUploadDataState({})).toBe('idle');
    expect(resolveUploadDataState({ hasContent: true })).toBe('ready');
    expect(resolveUploadDataState({ hasContent: true, hasError: true })).toBe('error');
    expect(resolveUploadDataState({ hasContent: true, hasError: true, isUploading: true })).toBe('uploading');
    expect(resolveUploadDataState({ isUploading: true, hasError: true, isDragging: true })).toBe('dragging');
    expect(
      resolveUploadDataState({
        disabled: true, isDragging: true, isUploading: true, hasError: true, hasContent: true,
      }),
    ).toBe('disabled');
  });
});

describe('<SingleImageUpload /> custom styling & slots (SSR)', () => {
  it('preserves default iuk-* classes and merges custom slot classNames & styles', () => {
    const html = renderToStaticMarkup(
      <SingleImageUpload
        value={null} onChange={noop}
        classNames={{ root: 'my-root', dropzone: 'my-dz' }}
        styles={{ dropzone: { borderWidth: 3 } }}
      />,
    );
    expect(html).toContain('iuk-single');
    expect(html).toContain('my-root');
    expect(html).toContain('iuk-dropzone');
    expect(html).toContain('my-dz');
    expect(html).toContain('border-width:3px');
    expect(html).toContain('data-state="idle"');
    expect(html).not.toContain('data-unstyled');
  });

  it('strips iuk-single / iuk-dropzone in unstyled mode while keeping hidden file input clipped', () => {
    const idleHtml = renderToStaticMarkup(
      <SingleImageUpload
        unstyled showQualitySelector={false} value={null} onChange={noop}
        classNames={{ root: 'my-root', dropzone: 'my-dz' }}
      />,
    );
    expect(idleHtml).not.toContain('iuk-single');
    expect(idleHtml).not.toContain('iuk-dropzone');
    expect(idleHtml).not.toContain('iuk-hidden-input');
    expect(idleHtml).toContain('my-root');
    expect(idleHtml).toContain('my-dz');
    expect(idleHtml).toContain('data-unstyled="true"');
    expect(idleHtml).toContain('data-state="idle"');
    expect(idleHtml).toContain('type="file"');
    expect(idleHtml).toContain('clip:rect(0, 0, 0, 0)');

    const errorHtml = renderToStaticMarkup(
      <SingleImageUpload
        unstyled value={null} onChange={noop} error="Bad file"
        classNames={{ errorText: 'tw-err' }}
      />,
    );
    expect(errorHtml).toContain('data-state="error"');
    expect(errorHtml).toContain('Bad file');
    expect(errorHtml).toContain('tw-err');
  });

  it('propagates global unstyled & singleClassNames from <ImageUploadProvider />', () => {
    const html = renderToStaticMarkup(
      <ImageUploadProvider unstyled singleClassNames={{ root: 'provider-root', dropzone: 'provider-dz' }}>
        <SingleImageUpload
          showQualitySelector={false} value={null} onChange={noop}
          classNames={{ dropzone: 'local-dz' }}
        />
      </ImageUploadProvider>,
    );
    expect(html).not.toContain('iuk-single');
    expect(html).not.toContain('iuk-dropzone');
    expect(html).toContain('data-unstyled="true"');
    expect(html).toContain('provider-root');
    expect(html).toContain('provider-dz local-dz');
  });

  it('renders custom renderDropzone and renderPreview JSX cleanly', () => {
    const emptyHtml = renderToStaticMarkup(
      <SingleImageUpload
        value={null} onChange={noop}
        renderDropzone={(ctx) => (
          <div {...ctx.dropzoneProps} className="bespoke-dropzone">Max {ctx.maxSizeMB}MB ({ctx.state})</div>
        )}
      />,
    );
    expect(emptyHtml).toContain('bespoke-dropzone');
    expect(emptyHtml).toContain('Max 10MB (idle)');

    const previewHtml = renderToStaticMarkup(
      <SingleImageUpload
        value={sampleUploadedImage} onChange={noop}
        renderPreview={(ctx) => (
          <figure className="bespoke-preview" data-color={ctx.blurColor}>
            <img src={ctx.previewUrl} alt={ctx.altText} />
          </figure>
        )}
      />,
    );
    expect(previewHtml).toContain('bespoke-preview');
    expect(previewHtml).toContain('data-color="#334155"');
    expect(previewHtml).toContain('Mountain ridge at sunrise');
    expect(previewHtml).toContain('data-state="ready"');
  });
});

describe('<MultiImageUpload /> custom styling & slots (SSR)', () => {
  it('strips iuk-multi in unstyled mode and applies Tailwind slot classNames', () => {
    const html = renderToStaticMarkup(
      <MultiImageUpload
        mode="multiple" unstyled showQualitySelector={false} value={[]} onChange={noop}
        classNames={{ root: 'tw-multi', emptyDropzone: 'tw-empty' }}
      />,
    );
    expect(html).not.toContain('iuk-multi');
    expect(html).toContain('tw-multi');
    expect(html).toContain('tw-empty');
    expect(html).toContain('data-unstyled="true"');
    expect(html).toContain('clip:rect(0, 0, 0, 0)');
  });

  it('renders custom renderHeader, renderEmptyDropzone, renderTile, and renderAddMore', () => {
    const emptyHtml = renderToStaticMarkup(
      <MultiImageUpload
        mode="multiple" value={[]} onChange={noop}
        renderEmptyDropzone={(ctx) => (
          <div {...ctx.dropzoneProps} className="custom-multi-empty">Up to {ctx.maxImages} files</div>
        )}
      />,
    );
    expect(emptyHtml).toContain('custom-multi-empty');

    const gridHtml = renderToStaticMarkup(
      <MultiImageUpload
        mode="multiple" label="Gallery" maxImages={5} value={[sampleUploadedImage]} onChange={noop}
        renderHeader={(ctx) => <header className="custom-multi-header">{ctx.label}: {ctx.totalCount}</header>}
        renderTile={(ctx) => <article className="custom-multi-tile" data-idx={ctx.index}>{ctx.item.altText}</article>}
        renderAddMore={(ctx) => <button type="button" className="custom-add-more">+{ctx.remainingCount} left</button>}
      />,
    );
    expect(gridHtml).toContain('custom-multi-header');
    expect(gridHtml).toContain('Gallery: 1');
    expect(gridHtml).toContain('custom-multi-tile');
    expect(gridHtml).toContain('data-idx="0"');
    expect(gridHtml).toContain('custom-add-more');
    expect(gridHtml).toContain('+4 left');
  });
});

describe('Headless upload controllers (SSR)', () => {
  it('exports hooks & components from both headless and react entrypoints and renders zero iuk-* classes', () => {
    expect(HeadlessSingleUpload).toBe(ReactHeadlessSingle);
    expect(HeadlessMultiUpload).toBe(ReactHeadlessMulti);
    expect(typeof useSingleUpload).toBe('function');
    expect(typeof useMultiUpload).toBe('function');

    const singleHtml = renderToStaticMarkup(
      <HeadlessSingleUpload preset="avatar" value={null} onChange={noop}>
        {(ctrl) => (
          <section {...ctrl.getDropzoneProps({ className: 'headless-avatar' })}>
            <input {...ctrl.getInputProps()} />
            <span>State: {ctrl.state}</span>
          </section>
        )}
      </HeadlessSingleUpload>,
    );
    expect(singleHtml).not.toContain('iuk-');
    expect(singleHtml).toContain('headless-avatar');
    expect(singleHtml).toContain('data-state="idle"');
    expect(singleHtml).toContain('State: idle');

    const multiHtml = renderToStaticMarkup(
      <HeadlessMultiUpload value={[sampleUploadedImage]} maxImages={4} onChange={noop}>
        {(ctrl) => (
          <section {...ctrl.getDropzoneProps({ className: 'headless-grid' })}>
            <input {...ctrl.getInputProps()} />
            <input {...ctrl.getFolderInputProps()} />
            {ctrl.items.map((item) => <img key={item.id} src={item.url} alt={item.altText || ''} />)}
            <span>Remaining: {ctrl.remainingCount}</span>
          </section>
        )}
      </HeadlessMultiUpload>,
    );
    expect(multiHtml).not.toContain('iuk-');
    expect(multiHtml).toContain('headless-grid');
    expect(multiHtml).toContain('data-state="ready"');
    expect(multiHtml).toContain('Remaining: 3');
    expect(multiHtml).toContain(sampleUploadedImage.url);
  });
});
