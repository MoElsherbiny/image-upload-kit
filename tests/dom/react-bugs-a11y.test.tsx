import { act, fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARABIC_UPLOAD_TRANSLATIONS,
  DEFAULT_UPLOAD_TRANSLATIONS,
  MultiImageUpload,
  QualitySelector,
  SingleImageUpload,
} from '../../src/react';
import type { UploadedImageData } from '../../src/types';
import { installMockXhr, type MockXhrController } from '../helpers/mockXhr';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeUploaded(id: string, altText = ''): UploadedImageData {
  return {
    url: `https://cdn.example.com/uploads/${id}.avif`,
    blurDataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
    blurColor: '#4F46E5',
    altText,
    width: 800,
    height: 600,
    format: 'avif',
    size: 12_000,
    originalSize: 48_000,
    contentHash: `hash-${id}`,
    uploadedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('Phase 5: React Bugs & Accessibility (jsdom)', () => {
  let xhr: MockXhrController;

  beforeEach(() => {
    xhr = installMockXhr();
  });

  afterEach(() => {
    xhr.restore();
    document.documentElement.lang = '';
    document.documentElement.dir = '';
    document.body.style.overflow = '';
    vi.restoreAllMocks();
  });

  it('tracks parallel uploads independently without cross-contaminating progress', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MultiImageUpload
        mode="multiple"
        onChange={vi.fn()}
        endpoint="/api/upload"
        showQualitySelector={false}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    const fileA = new File([PNG_BYTES], 'alpha.png', { type: 'image/png' });
    const fileB = new File([PNG_BYTES], 'beta.png', { type: 'image/png' });

    await user.upload(input, [fileA, fileB]);
    await waitFor(() => expect(xhr.pending()).toHaveLength(2));

    const [reqA, reqB] = xhr.pending();
    act(() => {
      reqA.progress(80, 100);
      reqB.progress(20, 100);
    });

    const bars = container.querySelectorAll<HTMLElement>('[data-slot="tile"] [role="progressbar"]');
    expect(bars).toHaveLength(2);
    const values = Array.from(bars).map((el) => Number(el.getAttribute('aria-valuenow')));
    expect(values[0]).toBe(68);
    expect(values[1]).toBe(17);
  });

  it('aborts in-flight XHR when component unmounts', async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(
      <SingleImageUpload onChange={vi.fn()} endpoint="/api/upload" showQualitySelector={false} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([PNG_BYTES], 'unmount.png', { type: 'image/png' });

    await user.upload(input, file);
    await waitFor(() => expect(xhr.pending()).toHaveLength(1));
    const req = xhr.latest();
    expect(req.aborted).toBe(false);

    unmount();
    expect(req.aborted).toBe(true);
  });

  it('clears stale alt text when replacing an existing image with a new file', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const initial = makeUploaded('first', 'Old mountain caption');
    const { container } = render(
      <SingleImageUpload
        value={initial}
        onChange={onChange}
        endpoint="/api/upload"
        showQualitySelector={false}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const newFile = new File([PNG_BYTES], 'second.png', { type: 'image/png' });

    await user.upload(input, newFile);
    await waitFor(() => expect(xhr.pending()).toHaveLength(1));

    const req = xhr.latest();
    const formData = req.body as FormData;
    expect(formData.get('altText') ?? '').toBe('');

    act(() => req.respond(200, makeUploaded('second', '')));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).toMatchObject({
      url: 'https://cdn.example.com/uploads/second.avif',
      altText: '',
    });
  });

  it('resets file input value so re-selecting the same file after an error triggers a retry', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <SingleImageUpload onChange={onChange} endpoint="/api/upload" showQualitySelector={false} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([PNG_BYTES], 'retry-same.png', { type: 'image/png' });

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(xhr.instances).toHaveLength(1));
    expect(input.value).toBe('');

    act(() => xhr.latest().respond(500, { error: 'Server busy' }));
    await waitFor(() =>
      expect(container.querySelector('[role="alert"]')).toHaveTextContent('Server busy'),
    );

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(xhr.instances).toHaveLength(2));
  });

  it('maintains dragging state when dragenter/dragleave fire over child elements', () => {
    const { container } = render(
      <SingleImageUpload onChange={vi.fn()} showQualitySelector={false} />,
    );
    const dropzone = container.querySelector<HTMLElement>('[data-slot="dropzone"]')!;
    const childIcon = container.querySelector<HTMLElement>('[data-slot="dropzone-icon"]')!;

    fireEvent.dragEnter(dropzone);
    expect(dropzone).toHaveAttribute('data-state', 'dragging');

    fireEvent.dragEnter(childIcon);
    fireEvent.dragLeave(dropzone);
    expect(dropzone).toHaveAttribute('data-state', 'dragging');

    fireEvent.dragLeave(childIcon);
    expect(dropzone).toHaveAttribute('data-state', 'idle');
  });

  it('traps focus, closes on Escape, restores focus and preserves body overflow in AltTextModal', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'scroll';
    const initial = makeUploaded('modal-test', 'Initial alt');
    const { container } = render(
      <SingleImageUpload value={initial} onChange={vi.fn()} showQualitySelector={false} />,
    );

    const altTrigger = container.querySelector<HTMLButtonElement>('[data-slot="tile-alt-btn"]')!;
    altTrigger.focus();
    await user.click(altTrigger);

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(document.body.querySelector('[role="dialog"]')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('scroll');
    expect(document.activeElement).toBe(altTrigger);
  });

  it('announces upload lifecycle via polite live region and removes role="button" when preview is shown', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SingleImageUpload
        onChange={vi.fn()}
        endpoint="/api/upload"
        showProgress
        showQualitySelector={false}
      />,
    );
    const dropzone = container.querySelector<HTMLElement>('[data-slot="dropzone"]')!;
    expect(dropzone).toHaveAttribute('role', 'button');

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File([PNG_BYTES], 'live.png', { type: 'image/png' }));
    await waitFor(() => expect(xhr.pending()).toHaveLength(1));

    const liveRegion = container.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')!;
    expect(liveRegion).toBeInTheDocument();

    act(() => xhr.latest().progress(60, 100));
    expect(liveRegion.textContent).toMatch(/%/);

    act(() => xhr.latest().respond(200, makeUploaded('live')));
    await waitFor(() => expect(dropzone).not.toHaveAttribute('role', 'button'));
  });

  it('implements roving tabIndex and arrow/Home/End keyboard navigation in QualitySelector', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole, rerender } = render(<QualitySelector value="medium" onChange={onChange} />);

    const radios = getByRole('radiogroup').querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect(radios).toHaveLength(4);
    expect(radios[0]).toHaveAttribute('tabIndex', '-1');
    expect(radios[1]).toHaveAttribute('tabIndex', '0');

    radios[1].focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('high');
    expect(document.activeElement).toBe(radios[2]);

    rerender(<QualitySelector value="high" onChange={onChange} />);
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('maximum');

    rerender(<QualitySelector value="maximum" onChange={onChange} />);
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('low');
  });

  it('maintains 100% key parity between en and ar translations and auto-detects <html lang="ar-EG">', () => {
    expect(Object.keys(ARABIC_UPLOAD_TRANSLATIONS).sort()).toEqual(
      Object.keys(DEFAULT_UPLOAD_TRANSLATIONS).sort(),
    );
    expect(Object.keys(ARABIC_UPLOAD_TRANSLATIONS.blurModal).sort()).toEqual(
      Object.keys(DEFAULT_UPLOAD_TRANSLATIONS.blurModal).sort(),
    );

    document.documentElement.lang = 'ar-EG';
    const { container } = render(
      <SingleImageUpload onChange={vi.fn()} showQualitySelector={false} />,
    );
    const root = container.querySelector('[data-slot="single-root"]')!;
    expect(root).toHaveAttribute('dir', 'rtl');
  });
});
