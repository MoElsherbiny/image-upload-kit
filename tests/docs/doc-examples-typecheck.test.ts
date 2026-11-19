import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distDir = path.join(rootDir, 'dist');
const hasDist =
  existsSync(path.join(distDir, 'index.d.ts')) &&
  existsSync(path.join(distDir, 'react.d.ts')) &&
  existsSync(path.join(distDir, 'server.d.ts'));

const API_DRIFT_CODES = new Set<number>([
  2305, // Module has no exported member
  2724, // Module has no exported member (did you mean...)
  2339, // Property does not exist on type
  2353, // Object literal may only specify known properties
  2551, // Property does not exist on type (did you mean...)
  2561, // Object literal may only specify known properties (did you mean...)
]);

interface DocCodeBlock {
  relFile: string;
  blockIndex: number;
  startLine: number;
  lang: 'ts' | 'tsx';
  code: string;
}

function extractDocBlocks(): DocCodeBlock[] {
  const mdFiles = [
    path.join(rootDir, 'README.md'),
    ...readdirSync(path.join(rootDir, 'docs'))
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map((name) => path.join(rootDir, 'docs', name)),
  ];

  const blocks: DocCodeBlock[] = [];
  const fenceRegex = /^```(tsx?|typescript)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;

  for (const absPath of mdFiles) {
    const normalized = readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n');
    const relFile = path.relative(rootDir, absPath).replace(/\\/g, '/');
    let blockIndex = 0;
    fenceRegex.lastIndex = 0;

    let match = fenceRegex.exec(normalized);
    while (match !== null) {
      blockIndex += 1;
      const rawLang = match[1];
      const code = match[2];
      const startLine = normalized.slice(0, match.index).split('\n').length + 1;
      blocks.push({
        relFile,
        blockIndex,
        startLine,
        lang: rawLang === 'tsx' ? 'tsx' : 'ts',
        code,
      });
      match = fenceRegex.exec(normalized);
    }
  }

  return blocks;
}

const TS_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  moduleDetection: ts.ModuleDetectionKind.Force,
  types: ['node'],
  typeRoots: [path.join(rootDir, 'node_modules', '@types')],
  baseUrl: rootDir,
  paths: {
    'img-upload-kit': ['dist/index.d.ts'],
    'img-upload-kit/client': ['dist/client.d.ts'],
    'img-upload-kit/server': ['dist/server.d.ts'],
    'img-upload-kit/server/handler': ['dist/server-handler.d.ts'],
    'img-upload-kit/storage': ['dist/storage.d.ts'],
    'img-upload-kit/blur': ['dist/blur.d.ts'],
    'img-upload-kit/react': ['dist/react.d.ts'],
    'img-upload-kit/headless': ['dist/headless.d.ts'],
    'img-upload-kit/vue': ['dist/vue.d.ts'],
    'img-upload-kit/angular': ['dist/angular.d.ts'],
    'img-upload-kit/react-native': ['dist/react-native.d.ts'],
    'img-upload-kit/cli': ['dist/cli.d.ts'],
    'img-upload-kit/styles.css': ['dist/styles.css.d.cts'],
    'img-upload-kit/styles/*': ['dist/styles/*'],
  },
};

const baseHost = ts.createCompilerHost(TS_OPTIONS, true);
const diskSourceFileCache = new Map<string, ts.SourceFile | undefined>();
const virtualDir = path.join(rootDir, '.virtual-doc-typecheck');

function normalizeKey(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
}

function typecheckBlockInIsolatedProgram(block: DocCodeBlock): string[] {
  const virtualFile = path.join(
    virtualDir,
    `block-${String(block.blockIndex)}.${block.lang}`,
  );
  const virtualFileKey = normalizeKey(virtualFile);
  const virtualDirKey = normalizeKey(virtualDir);

  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists: (f) => normalizeKey(f) === virtualFileKey || baseHost.fileExists(f),
    directoryExists: (d) =>
      normalizeKey(d) === virtualDirKey || Boolean(baseHost.directoryExists?.(d)),
    readFile: (f) => (normalizeKey(f) === virtualFileKey ? block.code : baseHost.readFile(f)),
    getSourceFile(fileName, languageVersion, onError, shouldCreateNew) {
      const key = normalizeKey(fileName);
      if (key === virtualFileKey) {
        return ts.createSourceFile(fileName, block.code, languageVersion, true);
      }
      if (!shouldCreateNew && diskSourceFileCache.has(key)) {
        return diskSourceFileCache.get(key);
      }
      const sf = baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNew);
      diskSourceFileCache.set(key, sf);
      return sf;
    },
  };

  // Fresh program per block: module augmentations (e.g. UploadKitRegister) never leak across blocks
  const program = ts.createProgram([virtualFile], TS_OPTIONS, host);
  const sf = program.getSourceFile(virtualFile);
  const diagnostics = ts.getPreEmitDiagnostics(program, sf);

  const driftErrors: string[] = [];
  for (const diag of diagnostics) {
    const msg = ts.flattenDiagnosticMessageText(diag.messageText, ' ');
    const isBrokenOwnSubpath =
      diag.code === 2307 && /Cannot find module ['"]img-upload-kit/.test(msg);
    if (!API_DRIFT_CODES.has(diag.code) && !isBrokenOwnSubpath) {
      continue;
    }
    const lineOffset =
      diag.file && diag.start !== undefined
        ? diag.file.getLineAndCharacterOfPosition(diag.start).line
        : 0;
    const mdLine = block.startLine + lineOffset;
    driftErrors.push(
      `${block.relFile}:${String(mdLine)} (block #${String(block.blockIndex)}): TS${String(diag.code)}: ${msg}`,
    );
  }

  return driftErrors;
}

describe.skipIf(!hasDist)('Documentation TypeScript/TSX examples match dist/*.d.ts (M-7)', () => {
  it(
    'type-checks every ts/tsx code block in README.md and docs/*.md in its own isolated program',
    () => {
      const blocks = extractDocBlocks();
      expect(blocks.length).toBeGreaterThanOrEqual(50);

      const allErrors: string[] = [];
      for (const block of blocks) {
        allErrors.push(...typecheckBlockInIsolatedProgram(block));
      }

      expect(allErrors).toEqual([]);
    },
    120_000,
  );

  it(
    'isolates UploadKitRegister module augmentation per block and catches API drift',
    () => {
      const augmentingBlock: DocCodeBlock = {
        relFile: 'virtual-a.md',
        blockIndex: 991,
        startLine: 1,
        lang: 'ts',
        code: `
import { defineUploadPresets } from 'img-upload-kit';
const customPresets = defineUploadPresets({
  onlyCustomPreset: { maxDimensions: { width: 400, height: 400 }, quality: 80 },
});
declare module 'img-upload-kit' {
  interface UploadKitRegister {
    presets: typeof customPresets;
  }
}
`,
      };
      const subsequentStandardBlock: DocCodeBlock = {
        relFile: 'virtual-b.md',
        blockIndex: 992,
        startLine: 1,
        lang: 'tsx',
        code: `
import { SingleImageUpload } from 'img-upload-kit/react';
export const Demo = () => <SingleImageUpload preset="avatar" />;
`,
      };
      const driftedBlock: DocCodeBlock = {
        relFile: 'virtual-drift.md',
        blockIndex: 993,
        startLine: 1,
        lang: 'ts',
        code: `
import { createSingleUpload } from 'img-upload-kit/angular';
const u = createSingleUpload({ endpoint: '/api/upload' });
void u.selectFiles([]);
`,
      };

      expect(typecheckBlockInIsolatedProgram(augmentingBlock)).toEqual([]);
      expect(typecheckBlockInIsolatedProgram(subsequentStandardBlock)).toEqual([]);
      expect(typecheckBlockInIsolatedProgram(driftedBlock)).toEqual([
        expect.stringContaining('TS2551'),
      ]);
    },
    30_000,
  );
});
