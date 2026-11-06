import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SingleImageUpload } from '../../src/react';
import { useImageUploadContext } from '../../src/react/headless';
import { ImageUploadProvider } from '../../src/react';
import type { UploadedImageData } from '../../src/types';
import { installMockXhr, type MockXhrController } from '../helpers/mockXhr';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const uploaded: UploadedImageData = {
  url: 'https://cdn.example.com/uploads/photo.avif',
  blurDataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
  blurColor: '#4F46E5',
  altText: '',
  width: 800,
  height: 600,
  format: 'avif',
  size: 12_000,
  originalSize: 48_000,
  contentHash: 'hash-photo',
  uploadedAt: '2026-01-01T00:00:00.000Z',
};

function getDropzone(container: HTMLElement): HTMLElement {
  const dropzone = container.querySelector<HTMLElement>('[data-slot="dropzone"]');
  if (!dropzone) throw new Error('dropzone not rendered');
  return dropzone;
}

describe('jsdom + Testing Library smoke', () => {
  let xhr: MockXhrController;

  beforeEach(() => {
    xhr = installMockXhr();
  });

  afterEach(() => {
    xhr.restore();
    vi.restoreAllMocks();
  });

  it('runs in a DOM environment', () => {
    expect(typeof window).toBe('object');
    expect(document.body).toBeInTheDocument();
  });

  it('opens the file dialog from the dropzone via click, Enter and Space', async () => {
    const user = userEvent.setup();
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => {});
    const { container } = render(
      <SingleImageUpload onChange={vi.fn()} showQualitySelector={false} />,
    );
    const dropzone = getDropzone(container);
    expect(dropzone).toHaveAttribute('role', 'button');
    expect(dropzone).toHaveAttribute('data-state', 'idle');

    await user.click(dropzone);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    dropzone.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(clickSpy).toHaveBeenCalledTimes(3);
  });

  it('uploads a selected file through the (mock) XHR and reports onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <SingleImageUpload
        onChange={onChange}
        endpoint="/api/test-upload"
        showQualitySelector={false}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' });

    await user.upload(input, file);
    await waitFor(() => expect(xhr.pending()).toHaveLength(1));

    const request = xhr.latest();
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/test-upload');
    expect(request.body).toBeInstanceOf(FormData);
    expect((request.body as FormData).get('file')).toBeInstanceOf(File);
    expect(getDropzone(container)).toHaveAttribute('data-state', 'uploading');

    act(() => request.progress(50, 100));
    act(() => request.respond(200, uploaded));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).toMatchObject({
      url: uploaded.url,
      blurColor: uploaded.blurColor,
      contentHash: uploaded.contentHash,
    });
  });

  it('shares one context between the /react provider and /headless hooks', () => {
    let seenEndpoint: string | undefined;
    function Probe() {
      seenEndpoint = useImageUploadContext().endpoint;
      return null;
    }
    render(
      <ImageUploadProvider endpoint="/api/shared">
        <Probe />
      </ImageUploadProvider>,
    );
    expect(seenEndpoint).toBe('/api/shared');
  });
});
