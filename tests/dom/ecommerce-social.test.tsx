import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadedImageData } from '../../src';
import { HeadlessMultiUpload } from '../../src/react/headless';
import {
  AnimatedImage,
  MultiImageUpload,
  SingleImageUpload,
} from '../../src/react';

function makeUploadedItem(index: number): UploadedImageData {
  return {
    url: `https://cdn.example.com/product-${index}.avif`,
    blurDataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
    blurColor: '#3b82f6',
    altText: `Product view ${index}`,
    width: 800,
    height: 800,
    format: 'avif',
    size: 12000,
    originalSize: 48000,
    contentHash: `hash-${index}`,
    uploadedAt: '2026-01-01T00:00:00.000Z',
  };
}

afterEach(() => {
  cleanup();
});

describe('React & Headless E-Commerce and Social Features (WP-R)', () => {
  it('renders Cover badge on index 0, reorders via buttons & Set as cover, updates hidden form input & polite live region', () => {
    const initial = [
      makeUploadedItem(1),
      makeUploadedItem(2),
      makeUploadedItem(3),
    ];
    const onChange = vi.fn();
    const onReorder = vi.fn();

    function ControlledGallery() {
      const [items, setItems] = useState<UploadedImageData[]>(initial);
      return (
        <MultiImageUpload
          mode="multiple"
          name="gallery"
          formValue="url"
          reorderable
          value={items}
          onChange={(next) => {
            setItems(next);
            onChange(next);
          }}
          onReorder={onReorder}
        />
      );
    }

    const { container } = render(<ControlledGallery />);

    // Cover badge on index 0 only
    const coverBadges = container.querySelectorAll('[data-slot="cover-badge"]');
    expect(coverBadges.length).toBe(1);
    expect(coverBadges[0]?.textContent).toContain('Cover');

    const hiddenInput = container.querySelector(
      'input[type="hidden"][name="gallery"]',
    ) as HTMLInputElement;
    expect(hiddenInput.value).toBe(
      'https://cdn.example.com/product-1.avif,https://cdn.example.com/product-2.avif,https://cdn.example.com/product-3.avif',
    );

    // Click "Move image later" on tile 0 -> moves item 1 to index 1
    const moveLaterButtons = screen.getAllByLabelText('Move image later');
    expect(moveLaterButtons.length).toBe(3);
    expect((moveLaterButtons[2] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(moveLaterButtons[0]);

    expect(onChange).toHaveBeenLastCalledWith([
      initial[1],
      initial[0],
      initial[2],
    ]);
    expect(onReorder).toHaveBeenLastCalledWith([
      initial[1],
      initial[0],
      initial[2],
    ]);
    expect(hiddenInput.value).toBe(
      'https://cdn.example.com/product-2.avif,https://cdn.example.com/product-1.avif,https://cdn.example.com/product-3.avif',
    );

    const liveRegion = container.querySelector('[data-slot="live-region"]');
    expect(liveRegion?.textContent).toBe('Moved image to position 2 of 3');

    // Click "Move image earlier" on tile 1 -> moves item 1 back to index 0
    const moveEarlierButtons = screen.getAllByLabelText('Move image earlier');
    expect((moveEarlierButtons[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(moveEarlierButtons[1]);

    expect(onChange).toHaveBeenLastCalledWith([
      initial[0],
      initial[1],
      initial[2],
    ]);
    expect(liveRegion?.textContent).toBe('Moved image to position 1 of 3');

    // Click "Set as cover" on tile 2 (index 2, which is second "Set as cover" button since index 0 has none)
    const setCoverButtons = screen.getAllByLabelText('Set as cover');
    expect(setCoverButtons.length).toBe(2);
    fireEvent.click(setCoverButtons[1]);

    expect(onChange).toHaveBeenLastCalledWith([
      initial[2],
      initial[0],
      initial[1],
    ]);
    expect(onReorder).toHaveBeenLastCalledWith([
      initial[2],
      initial[0],
      initial[1],
    ]);
    expect(hiddenInput.value).toBe(
      'https://cdn.example.com/product-3.avif,https://cdn.example.com/product-1.avif,https://cdn.example.com/product-2.avif',
    );
    expect(liveRegion?.textContent).toBe(
      'Image set as cover (position 1 of 3)',
    );
  });

  it('supports Alt+ArrowLeft and Alt+ArrowRight keyboard reordering on tiles and HeadlessMultiUpload controller', () => {
    const initial = [makeUploadedItem(1), makeUploadedItem(2)];
    const onReorder = vi.fn();

    function ControlledGallery() {
      const [items, setItems] = useState<UploadedImageData[]>(initial);
      return (
        <MultiImageUpload
          mode="multiple"
          reorderable
          value={items}
          onChange={setItems}
          onReorder={onReorder}
        />
      );
    }

    const { container } = render(<ControlledGallery />);
    const tiles = container.querySelectorAll('[data-slot="tile"]');
    expect(tiles.length).toBe(2);

    fireEvent.keyDown(tiles[0], { key: 'ArrowRight', altKey: true });
    expect(onReorder).toHaveBeenLastCalledWith([initial[1], initial[0]]);

    const updatedTiles = container.querySelectorAll('[data-slot="tile"]');
    fireEvent.keyDown(updatedTiles[1], { key: 'ArrowLeft', altKey: true });
    expect(onReorder).toHaveBeenLastCalledWith([initial[0], initial[1]]);
  });

  it('exposes move, setCover, and setPrimary on HeadlessMultiUpload', () => {
    const initial = [makeUploadedItem(1), makeUploadedItem(2)];
    const onReorder = vi.fn();

    render(
      <HeadlessMultiUpload
        value={initial}
        onChange={() => {}}
        onReorder={onReorder}
      >
        {(ctrl) => (
          <div>
            <button type="button" onClick={() => ctrl.setPrimary(1)}>
              Promote 2nd
            </button>
          </div>
        )}
      </HeadlessMultiUpload>,
    );

    fireEvent.click(screen.getByText('Promote 2nd'));
    expect(onReorder).toHaveBeenCalledWith([initial[1], initial[0]]);
  });

  it('sets style.aspectRatio on <AnimatedImage aspectRatio="4:5" />', () => {
    const { container } = render(
      <AnimatedImage
        src="https://cdn.example.com/lookbook.avif"
        alt="Lookbook"
        aspectRatio="4:5"
      />,
    );
    const wrapper = container.querySelector(
      '[data-slot="animated-image"]',
    ) as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.style.aspectRatio).toBe('4 / 5');
  });

  it('runs transformAsset before uploading and handles thrown transformAsset errors gracefully', async () => {
    const uploader = vi.fn(async (file: File) => ({
      ...makeUploadedItem(1),
      altText: file.name,
    }));

    const transformAsset = vi.fn(
      async (file: File) =>
        new File([file], `cropped-${file.name}`, { type: file.type }),
    );

    const onChange = vi.fn();
    const { container } = render(
      <SingleImageUpload
        onChange={onChange}
        uploader={uploader}
        transformAsset={transformAsset}
      />,
    );

    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const rawFile = new File(['pixel-bytes'], 'shirt.png', {
      type: 'image/png',
    });

    fireEvent.change(input, { target: { files: [rawFile] } });

    await waitFor(() => {
      expect(transformAsset).toHaveBeenCalledTimes(1);
      expect(uploader).toHaveBeenCalledTimes(1);
    });
    expect(uploader.mock.calls[0][0].name).toBe('cropped-shirt.png');

    // Now test transformAsset throwing an error
    cleanup();
    const failingTransform = vi.fn(async () => {
      throw new Error('Crop cancelled by user');
    });
    const failingUploader = vi.fn();

    const { container: errContainer } = render(
      <SingleImageUpload
        onChange={vi.fn()}
        uploader={failingUploader}
        transformAsset={failingTransform}
      />,
    );

    const errInput = errContainer.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(errInput, { target: { files: [rawFile] } });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Crop cancelled by user',
      );
    });
    expect(failingUploader).not.toHaveBeenCalled();
  });

  it('surfaces heicNotSupported error immediately when an untranscoded HEIC file is selected', async () => {
    const uploader = vi.fn();
    const { container } = render(
      <SingleImageUpload onChange={vi.fn()} uploader={uploader} />,
    );

    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const heicFile = new File(['heic-bytes'], 'IMG_0042.HEIC', {
      type: 'image/heic',
    });

    fireEvent.change(input, { target: { files: [heicFile] } });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'HEIC/HEIF photos must be converted to JPEG or PNG before uploading',
      );
    });
    expect(uploader).not.toHaveBeenCalled();
  });
});
