import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef, forwardRef, type ImgHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadedImageData } from '../../src';
import {
  AnimatedImage,
  type ImageUploadHandle,
  MultiImageUpload,
  SingleImageUpload,
} from '../../src/react';
import { installMockXhr, type MockXhrController } from '../helpers/mockXhr';

const makeUploaded = (overrides: Partial<UploadedImageData> = {}): UploadedImageData => ({
  url: 'https://cdn.example.com/uploaded.avif',
  blurDataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
  blurColor: '#336699',
  altText: 'Sample',
  width: 1200,
  height: 800,
  format: 'avif',
  size: 12_000,
  originalSize: 24_000,
  contentHash: 'hash123',
  uploadedAt: '2026-11-06T00:00:00.000Z',
  ...overrides,
});

const makePngFile = (name = 'paste.png') =>
  new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

const MockCustomImg = forwardRef<
  HTMLImageElement,
  ImgHTMLAttributes<HTMLImageElement> & Record<string, unknown>
>(function MockCustomImg(props, ref) {
  const { fill: _fill, priority: _priority, quality: _quality, ...rest } = props;
  return <img ref={ref} {...rest} />;
});

describe('Phase 7: Paste, Capture, Per-Tile Cancel/Retry, Form Integration & Responsive AnimatedImage', () => {
  let xhr: MockXhrController;

  beforeEach(() => {
    xhr = installMockXhr();
  });

  afterEach(() => {
    xhr.restore();
    vi.restoreAllMocks();
  });

  it('7a: AnimatedImage renders srcSet from image.variants, defaults sizes="100vw" when fill is set, and omits auto srcSet for custom `as`', () => {
    const image = makeUploaded({
      url: 'https://cdn.example.com/hero.avif',
      width: 1600,
      height: 900,
      variants: [
        { width: 1024, height: 576, url: 'https://cdn.example.com/hero-1024w.avif', size: 8000 },
        { width: 640, height: 360, url: 'https://cdn.example.com/hero-640w.avif', size: 4000 },
      ],
    });

    const { container, rerender } = render(<AnimatedImage image={image} fill />);
    const nativeImg = container.querySelector<HTMLImageElement>('.iuk-animated-image__img')!;
    expect(nativeImg.getAttribute('srcset')).toBe(
      'https://cdn.example.com/hero-640w.avif 640w, https://cdn.example.com/hero-1024w.avif 1024w, https://cdn.example.com/hero.avif 1600w',
    );
    expect(nativeImg.getAttribute('sizes')).toBe('100vw');

    rerender(<AnimatedImage image={image} fill as={MockCustomImg} />);
    const customImg = container.querySelector<HTMLImageElement>('.iuk-animated-image__img')!;
    expect(customImg.getAttribute('srcset')).toBeNull();
  });

  it('7b: forwards camera capture attribute and handles clipboard paste on dropzone and document', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <SingleImageUpload
        onChange={onChange}
        capture="environment"
        pasteTarget="document"
      />,
    );

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(fileInput.getAttribute('capture')).toBe('environment');

    const file = makePngFile('clipboard-shot.png');
    act(() => {
      const pasteEvt = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvt, 'clipboardData', {
        value: { files: [file], items: [] },
      });
      document.dispatchEvent(pasteEvt);
    });

    await waitFor(() => expect(xhr.instances.length).toBe(1));
    act(() => {
      xhr.latest().respond(200, makeUploaded({ url: 'https://cdn.example.com/pasted.avif' }));
    });

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://cdn.example.com/pasted.avif' }),
      ),
    );
  });

  it('7c: supports per-tile cancel while uploading and per-tile retry after failure with lifecycle callbacks', async () => {
    const onChange = vi.fn();
    const onUploadStart = vi.fn();
    const onUploadComplete = vi.fn();
    const onUploadCancel = vi.fn();

    const { container } = render(
      <MultiImageUpload
        mode="multiple"
        onChange={onChange}
        onUploadStart={onUploadStart}
        onUploadComplete={onUploadComplete}
        onUploadCancel={onUploadCancel}
      />,
    );

    const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    const fileA = makePngFile('a.png');
    const fileB = makePngFile('b.png');

    await act(async () => {
      fireEvent.change(input, { target: { files: [fileA, fileB] } });
    });

    await waitFor(() => expect(xhr.instances.length).toBe(2));
    expect(onUploadStart).toHaveBeenCalledWith([fileA, fileB]);

    // Cancel first tile while uploading
    const cancelBtns = container.querySelectorAll<HTMLButtonElement>('[data-slot="tile-cancel"]');
    expect(cancelBtns.length).toBe(2);

    act(() => {
      fireEvent.click(cancelBtns[0]);
    });

    expect(xhr.instances[0].aborted).toBe(true);
    expect(onUploadCancel).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[data-slot="tile"]').length).toBe(1);

    // Fail second tile, then retry it via tile-retry button
    await act(async () => {
      xhr.instances[1].respond(500, { error: 'Server busy' });
    });

    const retryBtn = await waitFor(() => {
      const btn = container.querySelector<HTMLButtonElement>('[data-slot="tile-retry"]');
      expect(btn).toBeInTheDocument();
      return btn!;
    });

    await act(async () => {
      fireEvent.click(retryBtn!);
    });

    await waitFor(() => expect(xhr.instances.length).toBe(3));
    act(() => {
      xhr.latest().respond(200, makeUploaded({ url: 'https://cdn.example.com/b-retried.avif' }));
    });

    await waitFor(() =>
      expect(onUploadComplete).toHaveBeenCalledWith([
        expect.objectContaining({ url: 'https://cdn.example.com/b-retried.avif' }),
      ]),
    );
  });

  it('7d: renders synchronized hidden input (url & json), supports required + minImages, and exposes ref handle { focus, open, clear }', async () => {
    const singleRef = createRef<ImageUploadHandle>();
    const onSingleChange = vi.fn();
    const onBlur = vi.fn();
    const initialImg = makeUploaded({ url: 'https://cdn.example.com/avatar.avif' });

    const { container, rerender } = render(
      <SingleImageUpload
        ref={singleRef}
        name="avatarUrl"
        formValue="url"
        required
        value={initialImg}
        onChange={onSingleChange}
        onBlur={onBlur}
      />,
    );

    const hiddenSingle = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="avatarUrl"]',
    )!;
    expect(hiddenSingle).toBeInTheDocument();
    expect(hiddenSingle).toHaveAttribute('required');
    expect(hiddenSingle.value).toBe('https://cdn.example.com/avatar.avif');

    rerender(
      <SingleImageUpload
        ref={singleRef}
        name="avatarUrl"
        formValue="json"
        required
        value={initialImg}
        onChange={onSingleChange}
        onBlur={onBlur}
      />,
    );
    expect(JSON.parse(hiddenSingle.value)).toMatchObject({
      url: 'https://cdn.example.com/avatar.avif',
    });

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const clickSpy = vi.spyOn(fileInput, 'click');
    act(() => {
      singleRef.current?.open();
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    act(() => {
      singleRef.current?.clear();
    });
    expect(onSingleChange).toHaveBeenCalledWith(null);
    expect(hiddenSingle.value).toBe('');

    act(() => {
      singleRef.current?.focus();
    });
    const dropzone = container.querySelector<HTMLElement>('[data-slot="dropzone"]')!;
    expect(document.activeElement).toBe(dropzone);
    expect(dropzone.getAttribute('aria-required')).toBe('true');

    fireEvent.blur(dropzone, { relatedTarget: document.body });
    expect(onBlur).toHaveBeenCalledTimes(1);

    // Multi form integration + minImages warning
    const multiRef = createRef<ImageUploadHandle>();
    const onMultiChange = vi.fn();
    const { container: multiContainer } = render(
      <MultiImageUpload
        ref={multiRef}
        mode="multiple"
        name="gallery"
        minImages={2}
        required
        value={[initialImg]}
        onChange={onMultiChange}
      />,
    );

    const hiddenMulti = multiContainer.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="gallery"]',
    )!;
    expect(JSON.parse(hiddenMulti.value)).toHaveLength(1);
    expect(multiContainer.querySelector('[data-slot="error-text"]')?.textContent).toContain(
      'at least 2 images',
    );

    act(() => {
      multiRef.current?.clear();
    });
    expect(hiddenMulti.value).toBe('');
  });
});
