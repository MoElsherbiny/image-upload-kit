import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Options } from 'tsup';

const CSS_LAYERS = [
  'src/react/styles/tokens.css',
  'src/react/styles/primitives.css',
  'src/react/styles/quality-and-inputs.css',
  'src/react/styles/dropzone-and-tiles.css',
  'src/react/styles/modals-and-dock.css',
  'src/react/styles/animated-image.css',
];

/** Entry outputs that are React Web client modules and must start with 'use client'. */
const CLIENT_ENTRIES = new Set(['react', 'headless']);
const USE_CLIENT = "'use client';";
const REACT_IMPORT_RE =
  /(?:from\s*|import\s*\(\s*|require\(\s*)["']react(?:\/jsx-runtime|-dom)?["']/;

const PEER_EXTERNALS: (string | RegExp)[] = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react-native',
  'vue',
  /^@angular\//,
  'sharp',
];

async function bundleModularStyles(): Promise<void> {
  await mkdir('dist/styles', { recursive: true });
  const chunks = await Promise.all(
    CSS_LAYERS.map((file) => readFile(file, 'utf8')),
  );
  const banner = '/* image-upload-kit - bundled modular styles */\n';
  const cssDts = 'export {};\n';
  await writeFile('dist/styles.css', banner + chunks.join('\n\n'), 'utf8');
  await writeFile('dist/styles.css.d.cts', cssDts, 'utf8');
  await Promise.all(
    CSS_LAYERS.flatMap((file) => {
      const base = path.basename(file);
      return [
        copyFile(file, path.join('dist/styles', base)),
        writeFile(path.join('dist/styles', `${base}.d.cts`), cssDts, 'utf8'),
      ];
    }),
  );
}

function isClientFile(entryName: string, code: string): boolean {
  if (CLIENT_ENTRIES.has(entryName)) return true;
  return entryName.startsWith('chunk-') && REACT_IMPORT_RE.test(code);
}

/**
 * esbuild drops module-level directives while bundling, so 'use client' is
 * (re)applied here as the very first statement of every client entry and of
 * every shared chunk that imports React. Server-reachable files never import
 * React, so they never receive the directive.
 */
async function applyUseClientDirectives(): Promise<void> {
  const files = await readdir('dist');
  await Promise.all(
    files
      .filter((file) => /\.c?js$/.test(file))
      .map(async (file) => {
        const entryName = file.replace(/\.c?js$/, '');
        const fullPath = path.join('dist', file);
        const code = await readFile(fullPath, 'utf8');
        if (!isClientFile(entryName, code)) return;
        if (/^["']use client["']/.test(code)) return;
        await writeFile(fullPath, `${USE_CLIENT}\n${code}`);
        await shiftSourceMapOneLine(`${fullPath}.map`);
      }),
  );
}

/** Keeps a sibling source map accurate after one line was prepended. */
async function shiftSourceMapOneLine(mapPath: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(mapPath, 'utf8');
  } catch {
    return;
  }
  const map = JSON.parse(raw) as { mappings?: string };
  map.mappings = `;${map.mappings ?? ''}`;
  await writeFile(mapPath, JSON.stringify(map));
}

export default defineConfig(async (options): Promise<Options[]> => {
  if (!options.watch) {
    await rm('dist', { recursive: true, force: true });
  }

  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
    version?: string;
  };
  const pkgVersion = pkg.version || '2.2.0';

  return [
    {
      // One build graph for every library entry so that stateful modules
      // (ImageUploadContext, the blurService singleton, i18n) live in exactly
      // one shared chunk per format instead of being duplicated per entry.
      entry: {
        index: 'src/index.ts',
        client: 'src/client/index.ts',
        server: 'src/server/index.ts',
        'server-handler': 'src/server/handler/index.ts',
        storage: 'src/storage/index.ts',
        blur: 'src/blur/index.ts',
        react: 'src/react/index.ts',
        headless: 'src/react/headless/index.ts',
        vue: 'src/vue/index.ts',
        angular: 'src/angular/index.ts',
        'react-native': 'src/react-native/index.ts',
      },
      format: ['esm', 'cjs'],
      dts: true,
      clean: false,
      sourcemap: true,
      splitting: true,
      treeshake: false,
      external: PEER_EXTERNALS,
      define: {
        __PKG_VERSION__: JSON.stringify(pkgVersion),
      },
      async onSuccess() {
        await applyUseClientDirectives();
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
      external: PEER_EXTERNALS,
      define: {
        __PKG_VERSION__: JSON.stringify(pkgVersion),
      },
    },
    {
      entry: {
        bin: 'src/cli/bin.ts',
      },
      format: ['esm'],
      dts: false,
      clean: false,
      sourcemap: true,
      splitting: false,
      banner: {
        js: '#!/usr/bin/env node',
      },
      external: PEER_EXTERNALS,
      define: {
        __PKG_VERSION__: JSON.stringify(pkgVersion),
      },
    },
  ];
});
