import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { defineConfig, type Options } from 'tsup';

const CSS_LAYERS = [
  'src/react/styles/tokens.css',
  'src/react/styles/primitives.css',
  'src/react/styles/quality-and-inputs.css',
  'src/react/styles/dropzone-and-tiles.css',
  'src/react/styles/modals-and-dock.css',
  'src/react/styles/animated-image.css',
];

async function bundleModularStyles(): Promise<void> {
  await mkdir('dist', { recursive: true });
  const chunks = await Promise.all(
    CSS_LAYERS.map((file) => readFile(file, 'utf8')),
  );
  const banner = '/* image-upload-kit — bundled modular styles */\n';
  await writeFile('dist/styles.css', banner + chunks.join('\n\n'), 'utf8');
}

export default defineConfig(async (options): Promise<Options[]> => {
  if (!options.watch) {
    await rm('dist', { recursive: true, force: true });
  }

  return [
    {
      entry: {
        index: 'src/index.ts',
        server: 'src/server/index.ts',
        storage: 'src/storage/index.ts',
        blur: 'src/blur/index.ts',
      },
      format: ['esm', 'cjs'],
      dts: true,
      clean: false,
      sourcemap: true,
      splitting: false,
      treeshake: true,
      external: [
        'react',
        'react-dom',
        'sharp',
        'lqip-modern',
        'blurhash',
        'commander',
        'lucide-react',
      ],
    },
    {
      entry: {
        react: 'src/react/index.ts',
        headless: 'src/react/headless/index.ts',
      },
      format: ['esm', 'cjs'],
      dts: true,
      clean: false,
      sourcemap: true,
      splitting: false,
      treeshake: true,
      banner: {
        js: "'use client';",
      },
      external: ['react', 'react-dom', 'lucide-react'],
      async onSuccess() {
        await bundleModularStyles();
      },
    },
    {
      entry: {
        cli: 'src/cli/index.ts',
      },
      format: ['esm', 'cjs'],
      dts: true,
      clean: false,
      sourcemap: true,
      splitting: false,
      banner: {
        js: '#!/usr/bin/env node',
      },
      external: ['sharp', 'lqip-modern', 'blurhash', 'commander'],
    },
  ];
});
