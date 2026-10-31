import type { ChangeEvent, DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  HeadlessMultiUpload, HeadlessSingleUpload, useDragAndDrop, useDropzone,
  useFilePreview, useImageUpload, useMultiUpload, useSingleUpload,
} from '../src/react/headless';
import type { UploadedImageData } from '../src/types';

const noop = () => {};

const makeImage = (id: string, url: string): UploadedImageData => ({
  url, blurDataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
  blurColor: '#10B981', altText: `Alt for ${id}`, width: 640, height: 480, format: 'webp',
  size: 18000, originalSize: 54000, contentHash: `hash-${id}`, uploadedAt: '2026-01-01T00:00:00.000Z',
});

const sample1 = makeImage('a', 'https://cdn.example.com/asset-a.webp');
const sample2 = makeImage('b', 'https://cdn.example.com/asset-b.webp');

function getSingleCtrl(props: Partial<Parameters<typeof useSingleUpload>[0]> = {}) {
  let ctrl: ReturnType<typeof useSingleUpload> | null = null;
  renderToStaticMarkup(
    <HeadlessSingleUpload value={null} onChange={noop} {...props}>
      {(c) => { ctrl = c; return null; }}
    </HeadlessSingleUpload>,
  );
  return ctrl!;
}

function getMultiCtrl(props: Partial<Parameters<typeof useMultiUpload>[0]> = {}) {
  let ctrl: ReturnType<typeof useMultiUpload> | null = null;
  renderToStaticMarkup(
    <HeadlessMultiUpload value={[]} onChange={noop} {...props}>
      {(c) => { ctrl = c; return null; }}
    </HeadlessMultiUpload>,
  );
  return ctrl!;
}

describe('Headless Subpath Re-exports (Feature 12)', () => {
  it('re-exports hooks, aliases, and primitives from image-upload-kit/headless', () => {
    [useDragAndDrop, useDropzone, useFilePreview, useImageUpload, useSingleUpload, useMultiUpload, HeadlessSingleUpload, HeadlessMultiUpload].forEach((fn) => {
      expect(typeof fn).toBe('function');
    });
    expect(useDropzone).toBe(useDragAndDrop);
  });

  it('useDropzone tracks drag state and dispatches drop events with disabled guard', () => {
    const onDrop = vi.fn();
    let captured!: ReturnType<typeof useDropzone>;
    function Consumer() { captured = useDropzone({ onDrop }); return null; }
    renderToStaticMarkup(<Consumer />);
    expect(captured.isDragging).toBe(false);

    const dummyFile = { name: 'test.png', size: 1024 } as unknown as File;
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    captured.dragHandlers.onDrop({
      preventDefault, stopPropagation, dataTransfer: { files: [dummyFile] as unknown as FileList },
    } as unknown as DragEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledWith([dummyFile]);

    const onDropDisabled = vi.fn();
    function DisabledConsumer() { captured = useDropzone({ disabled: true, onDrop: onDropDisabled }); return null; }
    renderToStaticMarkup(<DisabledConsumer />);
    captured.dragHandlers.onDrop({
      preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: { files: [dummyFile] as unknown as FileList },
    } as unknown as DragEvent);
    expect(onDropDisabled).not.toHaveBeenCalled();
  });

  it('useFilePreview exposes createPreview function', () => {
    let captured!: ReturnType<typeof useFilePreview>;
    function Consumer() { captured = useFilePreview(); return null; }
    renderToStaticMarkup(<Consumer />);
    expect(typeof captured.createPreview).toBe('function');
  });

  it('useImageUpload initializes with default idle state and exposes upload action', () => {
    let captured!: ReturnType<typeof useImageUpload>;
    function Consumer() { captured = useImageUpload({ preset: 'thumbnail' }); return null; }
    renderToStaticMarkup(<Consumer />);
    expect(typeof captured.uploadImage).toBe('function');
    expect(typeof captured.reset).toBe('function');
    expect(captured.isUploading).toBe(false);
    expect(captured.progress).toBe(0);
    expect(captured.uploadMessage).toBe('');
  });
});

describe('useSingleUpload - Prop Getters & Controller State', () => {
  it('generates compliant dropzone props via getDropzoneProps()', () => {
    const props = getSingleCtrl().getDropzoneProps();
    expect(props.role).toBe('button');
    expect(props.tabIndex).toBe(0);
    expect(props['aria-label']).toBe('Upload image');
    expect(props['data-state']).toBe('idle');
    expect(props['aria-disabled']).toBeUndefined();
    expect(props['data-disabled']).toBeUndefined();
    expect(typeof props.onClick).toBe('function');
    expect(typeof props.onKeyDown).toBe('function');
    expect(typeof props.onDrop).toBe('function');
  });

  it('handles keyboard navigation on getDropzoneProps()', () => {
    const props = getSingleCtrl().getDropzoneProps();
    const target = {};
    const checkKey = (key: string, expectedPrevented: boolean) => {
      const preventDefault = vi.fn();
      props.onKeyDown?.({ key, target, currentTarget: target, preventDefault, defaultPrevented: false } as unknown as KeyboardEvent<HTMLElement>);
      expect(preventDefault).toHaveBeenCalledTimes(expectedPrevented ? 1 : 0);
    };
    checkKey('Enter', true);
    checkKey(' ', true);
    checkKey('Tab', false);

    const preventBubbled = vi.fn();
    props.onKeyDown?.({ key: 'Enter', target: {}, currentTarget: {}, preventDefault: preventBubbled, defaultPrevented: false } as unknown as KeyboardEvent<HTMLElement>);
    expect(preventBubbled).not.toHaveBeenCalled();
  });

  it('merges custom overrides into getDropzoneProps without erasing defaults', () => {
    const customClick = vi.fn();
    const props = getSingleCtrl().getDropzoneProps({
      className: 'bespoke-dropzone', id: 'dz-custom', tabIndex: 2, onClick: customClick,
    });
    expect(props.className).toBe('bespoke-dropzone');
    expect(props.id).toBe('dz-custom');
    expect(props.tabIndex).toBe(2);
    expect(props.role).toBe('button');
    expect(props['data-state']).toBe('idle');
    props.onClick?.({ target: {}, defaultPrevented: false } as unknown as MouseEvent<HTMLElement>);
    expect(customClick).toHaveBeenCalledTimes(1);
  });

  it('generates hidden file input props via getInputProps() with clip style and handlers', () => {
    const ctrl = getSingleCtrl();
    const inProps = ctrl.getInputProps();
    expect(inProps.type).toBe('file');
    expect(inProps.accept).toContain('image/jpeg');
    expect(inProps.disabled).toBe(false);
    expect(inProps['aria-label']).toBe('File input');
    expect(inProps.style?.clip).toBe('rect(0, 0, 0, 0)');
    expect(inProps.style?.position).toBe('absolute');

    const stopPropagation = vi.fn();
    const customClick = vi.fn();
    ctrl.getInputProps({ onClick: customClick }).onClick?.({ stopPropagation } as unknown as MouseEvent<HTMLInputElement>);
    expect(customClick).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);

    const customChange = vi.fn();
    const target = { files: null, value: 'upload.jpg' };
    ctrl.getInputProps({ onChange: customChange }).onChange?.({ target, defaultPrevented: false } as unknown as ChangeEvent<HTMLInputElement>);
    expect(customChange).toHaveBeenCalledTimes(1);
    expect(target.value).toBe('');
  });

  it('reflects disabled state across getDropzoneProps and getInputProps', () => {
    const ctrl = getSingleCtrl({ disabled: true });
    const dzProps = ctrl.getDropzoneProps();
    expect(dzProps.tabIndex).toBe(-1);
    expect(dzProps['aria-disabled']).toBe(true);
    expect(dzProps['data-disabled']).toBe(true);
    expect(dzProps['data-state']).toBe('disabled');

    const preventDefault = vi.fn();
    dzProps.onKeyDown?.({
      key: 'Enter', target: {}, currentTarget: {}, preventDefault, defaultPrevented: false,
    } as unknown as KeyboardEvent<HTMLElement>);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(ctrl.getInputProps().disabled).toBe(true);
  });
});

describe('useMultiUpload - Queue Management, Stats & Prop Getters', () => {
  it('initializes queue stats, item arrays, and capacity calculation', () => {
    const ctrl = getMultiCtrl({ value: [sample1, sample2], maxImages: 6 });
    expect(ctrl.items).toHaveLength(2);
    expect(ctrl.completedItems).toHaveLength(2);
    expect(ctrl.uploadingItems).toHaveLength(0);
    expect(ctrl.remainingCount).toBe(4);
    expect(ctrl.state).toBe('ready');
    expect(ctrl.stats).toEqual({ total: 0, completed: 0, failed: 0 });
  });

  it('clamps remaining capacity to 0 when item count reaches or exceeds maxImages', () => {
    expect(getMultiCtrl({ value: [sample1, sample2], maxImages: 2 }).remainingCount).toBe(0);
    expect(getMultiCtrl({ value: [sample1, sample2], maxImages: 1 }).remainingCount).toBe(0);
  });

  it('provides selection interface and bound action handlers without mutation crash', () => {
    const ctrl = getMultiCtrl({ value: [sample1, sample2] });
    expect(ctrl.selectedIds).toBeInstanceOf(Set);
    expect(ctrl.selectedIds.size).toBe(0);
    expect(ctrl.selectedIds.has(sample1.url)).toBe(false);

    const actionKeys = [
      'toggleSelect', 'selectAll', 'clearSelection', 'remove',
      'removeSelected', 'retryFailed', 'openFileDialog', 'openFolderDialog',
    ] as const;
    actionKeys.forEach((key) => {
      expect(typeof ctrl[key]).toBe('function');
    });

    expect(() => {
      ctrl.toggleSelect(sample1.url);
      ctrl.selectAll();
      ctrl.clearSelection();
      ctrl.remove(sample1.url);
      ctrl.removeSelected();
    }).not.toThrow();
  });

  it('provides multi-file and folder input prop getters with directory attributes', () => {
    const ctrl = getMultiCtrl({ value: [] });
    const fileProps = ctrl.getInputProps();
    expect(fileProps.multiple).toBe(true);
    expect(fileProps.type).toBe('file');
    expect(fileProps['aria-label']).toBe('Select files');
    expect(fileProps.style?.clip).toBe('rect(0, 0, 0, 0)');
    expect('webkitdirectory' in fileProps).toBe(false);

    const folderProps = ctrl.getFolderInputProps();
    expect(folderProps.multiple).toBe(true);
    expect(folderProps.webkitdirectory).toBe('');
    expect(folderProps.directory).toBe('');
    expect(folderProps['aria-label']).toBe('Select folder');
    expect(folderProps.style?.clip).toBe('rect(0, 0, 0, 0)');

    const customFolder = ctrl.getFolderInputProps({ 'aria-label': 'Pick directory' });
    expect(customFolder['aria-label']).toBe('Pick directory');
    expect(customFolder.webkitdirectory).toBe('');
  });

  it('generates dropzone props in useMultiUpload with keyboard handler', () => {
    const dz = getMultiCtrl({ value: [sample1] }).getDropzoneProps();
    expect(dz.role).toBe('button');
    expect(dz.tabIndex).toBe(0);
    expect(dz['aria-label']).toBe('Select files');
    expect(dz['data-state']).toBe('ready');

    const target = {};
    const preventDefault = vi.fn();
    dz.onKeyDown?.({
      key: 'Enter', target, currentTarget: target, preventDefault, defaultPrevented: false,
    } as unknown as KeyboardEvent<HTMLElement>);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('Headless Primitives - Zero DOM Overhead & Slot Delegation', () => {
  it('HeadlessSingleUpload renders children directly without wrapper DOM tags', () => {
    let captured!: ReturnType<typeof useSingleUpload>;
    const html = renderToStaticMarkup(
      <HeadlessSingleUpload value={sample1} onChange={noop}>
        {(ctrl) => {
          captured = ctrl;
          return <div data-testid="custom-single" data-state={ctrl.state}>{ctrl.preview}</div>;
        }}
      </HeadlessSingleUpload>,
    );
    expect(captured.state).toBe('ready');
    expect(captured.preview).toBe(sample1.url);
    expect(html).toBe(`<div data-testid="custom-single" data-state="ready">${sample1.url}</div>`);
    expect(html).not.toContain('iuk-');
  });

  it('HeadlessMultiUpload renders children directly without wrapper DOM tags', () => {
    let captured!: ReturnType<typeof useMultiUpload>;
    const html = renderToStaticMarkup(
      <HeadlessMultiUpload value={[sample1, sample2]} maxImages={5} onChange={noop}>
        {(ctrl) => {
          captured = ctrl;
          return (
            <section data-testid="custom-multi" data-remaining={ctrl.remainingCount}>
              {ctrl.items.map((it) => <span key={it.id}>{it.url}</span>)}
            </section>
          );
        }}
      </HeadlessMultiUpload>,
    );
    expect(captured.remainingCount).toBe(3);
    expect(captured.items).toHaveLength(2);
    expect(html).toContain('data-testid="custom-multi"');
    expect(html).toContain('data-remaining="3"');
    expect(html).toContain(sample1.url);
    expect(html).toContain(sample2.url);
    expect(html).not.toContain('iuk-');
  });
});
