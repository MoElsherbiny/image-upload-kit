/**
 * Reproducible image optimization benchmark script.
 * Generates real synthetic PNG/JPEG images via Sharp, runs `optimizeImage`
 * across formats, qualities, and concurrency levels, and prints a Markdown table.
 *
 * Usage:
 *   npm run build && node scripts/benchmark-optimizer.mjs
 */
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { optimizeImage } from '../dist/server.js';

async function createSyntheticImage(width, height, format) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      raw[idx] = Math.round(((x * 255) / width + (y % 64) * 2) % 256);
      raw[idx + 1] = Math.round(((y * 255) / height + ((x ^ y) & 31)) % 256);
      raw[idx + 2] = Math.round((((x + y) * 127) / (width + height)) % 256);
    }
  }
  const base = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === 'png'
    ? base.png({ compressionLevel: 6 }).toBuffer()
    : base.jpeg({ quality: 92 }).toBuffer();
}

function fmtKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtRatio(inputBytes, outputBytes) {
  const pct = ((1 - outputBytes / inputBytes) * 100).toFixed(1);
  return `${pct}%`;
}

async function runCase(label, buffer, options, concurrency = 1) {
  const memBefore = process.memoryUsage().rss;
  const start = performance.now();

  let lastResult;
  if (concurrency <= 1) {
    lastResult = await optimizeImage(buffer, options);
  } else {
    const batch = Array.from({ length: concurrency }, () =>
      optimizeImage(buffer, options),
    );
    const results = await Promise.all(batch);
    lastResult = results[results.length - 1];
  }

  const durationMs = performance.now() - start;
  const memDeltaMb = (process.memoryUsage().rss - memBefore) / (1024 * 1024);

  return {
    label,
    format: lastResult.format,
    concurrency,
    inputSize: buffer.length,
    outputSize: lastResult.size,
    ratio: fmtRatio(buffer.length, lastResult.size),
    durationMs: durationMs.toFixed(1),
    memDeltaMb: `${memDeltaMb >= 0 ? '+' : ''}${memDeltaMb.toFixed(2)} MB`,
  };
}

async function main() {
  const png1200 = await createSyntheticImage(1200, 800, 'png');
  const jpeg1600 = await createSyntheticImage(1600, 1066, 'jpeg');

  // Warm up Sharp threadpool
  await optimizeImage(jpeg1600, { outputFormat: 'webp', quality: 80 });

  const scenarios = [
    ['PNG 1200x800 -> Auto (AVIF/WebP)', png1200, { quality: 80 }, 1],
    ['PNG 1200x800 -> WebP q80', png1200, { outputFormat: 'webp', quality: 80 }, 1],
    ['PNG 1200x800 -> AVIF q75 e4', png1200, { outputFormat: 'avif', quality: 75, effort: 4 }, 1],
    ['JPEG 1600x1066 -> Auto (AVIF/WebP)', jpeg1600, { quality: 82 }, 1],
    ['JPEG 1600x1066 -> WebP q80', jpeg1600, { outputFormat: 'webp', quality: 80 }, 1],
    ['JPEG 1600x1066 -> JPEG q80 (mozjpeg)', jpeg1600, { outputFormat: 'jpeg', quality: 80 }, 1],
    ['JPEG 1600x1066 -> 1:1 Focal Crop WebP', jpeg1600, { aspectRatio: '1:1', focalPoint: { x: 0.7, y: 0.3 }, outputFormat: 'webp', quality: 80 }, 1],
    ['JPEG 1600x1066 -> WebP q80 (x4 parallel)', jpeg1600, { outputFormat: 'webp', quality: 80 }, 4],
  ];

  const rows = [];
  for (const [label, buf, opts, conc] of scenarios) {
    rows.push(await runCase(label, buf, opts, conc));
  }

  console.log('| Scenario | Out Format | Concurrency | Input | Output | Savings | Duration (ms) | RSS Delta |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of rows) {
    console.log(
      `| ${r.label} | ${r.format} | ${r.concurrency} | ${fmtKb(r.inputSize)} | ${fmtKb(r.outputSize)} | ${r.ratio} | ${r.durationMs} | ${r.memDeltaMb} |`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
