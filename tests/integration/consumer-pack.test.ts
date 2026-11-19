import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distDir = path.join(rootDir, 'dist');
const hasDist =
  existsSync(path.join(distDir, 'index.d.ts')) &&
  existsSync(path.join(distDir, 'client.d.ts')) &&
  existsSync(path.join(distDir, 'server.d.ts')) &&
  existsSync(path.join(distDir, 'server-handler.d.ts')) &&
  existsSync(path.join(distDir, 'storage.d.ts')) &&
  existsSync(path.join(distDir, 'blur.d.ts')) &&
  existsSync(path.join(distDir, 'cli.d.ts'));

const CONSUMER_SOURCE = `
import {
  STANDARD_PRESETS,
  UploadKitError,
  type UploadedImageData,
} from 'img-upload-kit';
import {
  createClientResizeTransform,
  uploadAsset,
} from 'img-upload-kit/client';
import {
  createImageUploader,
  createUploadHttpHandler,
} from 'img-upload-kit/server';
import {
  createUploadHttpHandler as createEdgeUploadHandler,
  signUploadToken,
  verifyUploadToken,
} from 'img-upload-kit/server/handler';
import {
  createLocalFsStorageAdapter,
  createMemoryStorageAdapter,
  createS3StorageAdapter,
  createSupabaseStorageAdapter,
} from 'img-upload-kit/storage';
import {
  blurService,
  decodeBlurHash,
  isBlurhashValid,
} from 'img-upload-kit/blur';
import {
  detectProject,
  planDependencies,
  resolveArchitecture,
} from 'img-upload-kit/cli';

export const presetWidth: number = STANDARD_PRESETS.avatar.maxDimensions?.width ?? 512;
export const resizeTransform = createClientResizeTransform({ maxWidth: 1600 });
export const memoryStorage = createMemoryStorageAdapter();
export const localStorageAdapter = createLocalFsStorageAdapter({
  rootDir: './public/uploads',
  baseUrl: '/uploads',
});
export const uploader = createImageUploader({ storage: memoryStorage });
export const httpHandlers = createUploadHttpHandler({
  uploader,
  authorize: async ({ request }) => Boolean(request.headers.get('authorization')),
});
export const edgeHandlers = createEdgeUploadHandler({ uploader });

export type SampleImage = UploadedImageData;
export const checkRefs = {
  UploadKitError,
  uploadAsset,
  signUploadToken,
  verifyUploadToken,
  createS3StorageAdapter,
  createSupabaseStorageAdapter,
  blurService,
  decodeBlurHash,
  isBlurhashValid,
  detectProject,
  resolveArchitecture,
  planDependencies,
};
`;

function compileConsumer(
  consumerFile: string,
  resolution: 'NodeNext' | 'Node16' | 'Bundler',
): string[] {
  const isBundler = resolution === 'Bundler';
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: isBundler
      ? ts.ModuleKind.ESNext
      : resolution === 'Node16'
        ? ts.ModuleKind.Node16
        : ts.ModuleKind.NodeNext,
    moduleResolution: isBundler
      ? ts.ModuleResolutionKind.Bundler
      : resolution === 'Node16'
        ? ts.ModuleResolutionKind.Node16
        : ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    isolatedModules: true,
    types: ['node'],
    typeRoots: [path.join(rootDir, 'node_modules', '@types')],
  };

  const program = ts.createProgram([consumerFile], options);
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const file = d.file ? path.basename(d.file.fileName) : '<global>';
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    return `${file}: TS${d.code}: ${msg}`;
  });
}

describe.skipIf(!hasDist)('consumer package resolution against dist/ exports', () => {
  let consumerDir = '';
  let consumerFile = '';

  beforeAll(async () => {
    consumerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-consumer-pack-'));
    await fs.writeFile(
      path.join(consumerDir, 'package.json'),
      JSON.stringify({ name: 'iuk-consumer-check', private: true, type: 'module' }, null, 2),
      'utf8',
    );
    const nodeModulesDir = path.join(consumerDir, 'node_modules');
    await fs.mkdir(nodeModulesDir, { recursive: true });
    await fs.symlink(
      rootDir,
      path.join(nodeModulesDir, 'img-upload-kit'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    consumerFile = path.join(consumerDir, 'consumer.ts');
    await fs.writeFile(consumerFile, CONSUMER_SOURCE, 'utf8');
  });

  afterAll(async () => {
    if (consumerDir) {
      await fs.rm(consumerDir, { recursive: true, force: true });
    }
  });

  it('compiles all core & server subpaths with zero errors under NodeNext resolution', () => {
    expect(compileConsumer(consumerFile, 'NodeNext')).toEqual([]);
  });

  it('compiles all core & server subpaths with zero errors under Node16 resolution', () => {
    expect(compileConsumer(consumerFile, 'Node16')).toEqual([]);
  });

  it('compiles all core & server subpaths with zero errors under Bundler resolution', () => {
    expect(compileConsumer(consumerFile, 'Bundler')).toEqual([]);
  });
});
