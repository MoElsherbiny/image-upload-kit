import { describe, expect, it } from 'vitest';
import {
  buildResizePlan,
  createImageUploader,
  createUploadHttpHandler,
} from '../src/server';
import { createMemoryStorageAdapter } from '../src/storage';
import { solidImage, toFile } from './helpers/imageFixtures';

describe('Server-side aspect-ratio smart cropping (WP1)', () => {
  it('buildResizePlan computes cover crop within source & maxDimensions or inside fit when aspectRatio is omitted', () => {
    const storyPlan = buildResizePlan({
      source: { width: 1600, height: 900 },
      maxDimensions: { width: 1080, height: 1920 },
      aspectRatio: '9:16',
    });
    expect(storyPlan).toEqual({
      width: 506,
      height: 900,
      fit: 'cover',
      position: 'attention',
    });

    const squarePlan = buildResizePlan(
      { width: 1600, height: 900 },
      { width: 1600, height: 1600 },
      '1:1',
      'center',
    );
    expect(squarePlan).toEqual({
      width: 900,
      height: 900,
      fit: 'cover',
      position: 'center',
    });

    const insidePlan = buildResizePlan({
      width: 1600,
      height: 900,
      maxDimensions: { width: 1200, height: 900 },
    });
    expect(insidePlan).toEqual({
      width: 1200,
      height: 900,
      fit: 'inside',
      withoutEnlargement: true,
    });
  });

  it('crops 1600x900 landscape fixture using preset "story" (9:16) to vertical 9:16', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage });
    const landscapeBuf = await solidImage(1600, 900, 'png', '#2563eb');

    const result = await uploader.uploadImage(
      { buffer: landscapeBuf, name: 'banner.png', type: 'image/png' },
      { preset: 'story' },
    );

    expect(result.height).toBeGreaterThan(result.width);
    expect(Math.abs(result.width / result.height - 9 / 16)).toBeLessThanOrEqual(
      0.02,
    );
  });

  it('crops 1600x900 landscape fixture using preset "portrait" (4:5) and preserves 4:5 on variants', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage });
    const landscapeBuf = await solidImage(1600, 900, 'png', '#16a34a');

    const result = await uploader.uploadImage(
      { buffer: landscapeBuf, name: 'lookbook.png', type: 'image/png' },
      { preset: 'portrait' },
    );

    expect(result.height).toBeGreaterThan(result.width);
    expect(Math.abs(result.width / result.height - 0.8)).toBeLessThanOrEqual(
      0.02,
    );
    expect(result.variants?.length).toBeGreaterThan(0);
    for (const variant of result.variants ?? []) {
      expect(
        Math.abs(variant.width / variant.height - 0.8),
      ).toBeLessThanOrEqual(0.02);
    }
  });

  it('crops 1600x900 landscape fixture using preset "square" (1:1) to exact square', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage });
    const landscapeBuf = await solidImage(1600, 900, 'png', '#ea580c');

    const result = await uploader.uploadImage(
      { buffer: landscapeBuf, name: 'product.png', type: 'image/png' },
      { preset: 'square' },
    );

    expect(result.width).toBe(result.height);
    expect(result.variants?.length).toBeGreaterThan(0);
    for (const variant of result.variants ?? []) {
      expect(variant.width).toBe(variant.height);
    }
  });

  it('preserves 16:9 source aspect ratio on presets without aspectRatio ("card", "cover")', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage });
    const landscapeBuf = await solidImage(1600, 900, 'png', '#7c3aed');

    const cardResult = await uploader.uploadImage(
      { buffer: landscapeBuf, name: 'card.png', type: 'image/png' },
      { preset: 'card' },
    );
    expect(
      Math.abs(cardResult.width / cardResult.height - 16 / 9),
    ).toBeLessThanOrEqual(0.02);

    const coverResult = await uploader.uploadImage(
      { buffer: landscapeBuf, name: 'cover.png', type: 'image/png' },
      { preset: 'cover' },
    );
    expect(coverResult.width).toBe(1600);
    expect(coverResult.height).toBe(900);
  });

  it('parses client aspectRatio and crop overrides in createUploadHttpHandler when allowClientOverrides is enabled', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage });
    const handler = createUploadHttpHandler({
      uploader,
      allowClientOverrides: { aspectRatio: true },
    });

    const landscapeBuf = await solidImage(800, 450, 'png', '#0891b2');
    const form = new FormData();
    form.append('file', toFile(landscapeBuf, 'feed.png', 'image/png'));
    form.append('preset', 'card');
    form.append('aspectRatio', '1:1');
    form.append('crop', 'center');

    const res = await handler.POST(
      new Request('http://localhost/api/upload', {
        method: 'POST',
        body: form,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { width: number; height: number };
    expect(body.width).toBe(450);
    expect(body.height).toBe(450);
  });
});
