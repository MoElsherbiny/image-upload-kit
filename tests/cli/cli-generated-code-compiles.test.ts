import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFrameworkScaffolds,
  buildScaffoldPlan,
  buildStorageAdapterFile,
  detectProject,
  getRuntimeCapability,
  getStorageCapability,
  planDependencies,
  resolveArchitecture,
  runInteractiveInit,
  type ArchitectureRecommendation,
  type BackendRuntime,
  type FrontendFramework,
  type StorageProviderId,
} from '../../src/cli';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const virtualRoot = path.join(rootDir, '.virtual-cli-compile');

const VIRTUAL_SDK_STUBS = `
declare module '@aws-sdk/client-s3' {
  export interface S3ClientConfig {
    region?: string; endpoint?: string; forcePathStyle?: boolean;
    credentials?: { accessKeyId: string; secretAccessKey: string };
  }
  export class PutObjectCommand {
    constructor(input: { Bucket: string; Key: string; Body: Buffer | Uint8Array; ContentType: string; CacheControl?: string; Metadata?: Record<string, string>; IfNoneMatch?: string });
  }
  export class DeleteObjectCommand { constructor(input: { Bucket: string; Key: string }); }
  export class GetObjectCommand { constructor(input: { Bucket: string; Key: string }); }
  export class HeadObjectCommand { constructor(input: { Bucket: string; Key: string }); }
  export class S3Client {
    constructor(config: S3ClientConfig);
    send(command: PutObjectCommand | DeleteObjectCommand | HeadObjectCommand): Promise<Record<string, unknown>>;
    send(command: GetObjectCommand): Promise<{ Body?: Uint8Array }>;
  }
}
declare module '@supabase/supabase-js' {
  export interface SupabaseBucket {
    upload(path: string, fileBody: Buffer | Uint8Array, fileOptions?: { contentType?: string; upsert?: boolean; cacheControl?: string; metadata?: Record<string, string> }): Promise<{ data: { path: string } | null; error: { message: string } | null }>;
    remove(paths: string[]): Promise<{ data?: unknown; error: { message: string } | null }>;
    getPublicUrl(path: string): { data: { publicUrl: string } };
  }
  export interface SupabaseClient { storage: { from(bucket: string): SupabaseBucket }; }
  export function createClient(url: string, key: string): SupabaseClient;
}
declare module 'h3' {
  export interface H3Event { readonly node?: unknown; }
  export function toWebRequest(event: H3Event): Request;
  export function defineEventHandler<T>(handler: (event: H3Event) => T): (event: H3Event) => T;
}
`;

const diskSourceFileCache = new Map<string, ts.SourceFile | undefined>();
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
  isolatedModules: true,
  types: ['node'],
  typeRoots: [path.join(rootDir, 'node_modules', '@types')],
  baseUrl: rootDir,
  paths: {
    'img-upload-kit': ['src/index.ts'],
    'img-upload-kit/client': ['src/client/index.ts'],
    'img-upload-kit/server': ['src/server/index.ts'],
    'img-upload-kit/server/handler': ['src/server/handler/index.ts'],
    'img-upload-kit/storage': ['src/storage/index.ts'],
    'img-upload-kit/blur': ['src/blur/index.ts'],
    'img-upload-kit/angular': ['src/angular/index.ts'],
    'img-upload-kit/react-native': ['src/react-native/index.ts'],
    'img-upload-kit/react': ['src/react/index.ts'],
    'img-upload-kit/vue': ['src/vue/index.ts'],
  },
};
const baseHost = ts.createCompilerHost(TS_OPTIONS, true);

function normalizePath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function compileVirtualFiles(files: Record<string, string>): string[] {
  const virtualMap = new Map<string, string>();
  const virtualDirs = new Set<string>();
  const rootNames: string[] = [];
  const register = (abs: string, content: string) => {
    virtualMap.set(normalizePath(abs), content);
    rootNames.push(abs);
    let dir = path.dirname(abs);
    while (dir && !virtualDirs.has(normalizePath(dir))) {
      virtualDirs.add(normalizePath(dir));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  };
  register(path.join(virtualRoot, 'virtual-sdk-stubs.d.ts'), VIRTUAL_SDK_STUBS);
  for (const [rel, content] of Object.entries(files)) {
    register(path.join(virtualRoot, rel), content);
  }

  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists: (f) => virtualMap.has(normalizePath(f)) || baseHost.fileExists(f),
    directoryExists: (d) =>
      virtualDirs.has(normalizePath(d)) || Boolean(baseHost.directoryExists?.(d)),
    readFile: (f) => virtualMap.get(normalizePath(f)) ?? baseHost.readFile(f),
    getSourceFile(fileName, languageVersion, onError, shouldCreateNew) {
      const key = normalizePath(fileName);
      const hit = virtualMap.get(key);
      if (hit !== undefined) return ts.createSourceFile(fileName, hit, languageVersion, true);
      if (!shouldCreateNew && diskSourceFileCache.has(key)) return diskSourceFileCache.get(key);
      const sf = baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNew);
      diskSourceFileCache.set(key, sf);
      return sf;
    },
  };

  const program = ts.createProgram(rootNames, TS_OPTIONS, host);
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const file = d.file ? path.relative(virtualRoot, d.file.fileName) : '<global>';
    return `${file}: TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
  });
}

function makeRecommendation(
  frontend: FrontendFramework,
  backend: BackendRuntime,
  storage: StorageProviderId = 'local',
): ArchitectureRecommendation {
  const storageCapability = getStorageCapability(storage);
  const runtimeCapability = getRuntimeCapability(backend);
  return {
    frontend,
    backend,
    storage,
    storageCapability,
    runtimeCapability,
    selectedReason: 'test',
    reusedInfrastructure: [],
    requiresCustomAdapter: storageCapability.requiresCustomAdapter,
    requiresSeparateProcessingBackend: !runtimeCapability.supportsSharp,
    requiredEnvVars: [...storageCapability.requiredEnvironmentVariables],
    securityConsiderations: [],
    knownLimitations: [],
    alternatives: [],
  };
}

describe('CLI generated templates compile cleanly under strict TypeScript', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) await fs.rm(d, { recursive: true, force: true });
    }
  });

  const allStorages: StorageProviderId[] = [
    'local',
    's3',
    'r2',
    'minio',
    'spaces',
    'b2',
    'custom-s3',
    'supabase',
    'memory',
    'gcs',
    'azure-blob',
    'firebase',
  ];

  it.each(allStorages)('compiles generated %s storage adapter with zero diagnostics', (storage) => {
    const generated = buildStorageAdapterFile(storage);
    const errors = compileVirtualFiles({ [generated.relativePath]: generated.content });
    expect(errors).toEqual([]);
  });

  const frameworkCases: Array<{
    label: string;
    frontend: FrontendFramework;
    backend: BackendRuntime;
    hasSrcApp?: boolean;
    needsStorage?: boolean;
  }> = [
    { label: 'nextjs-node (app/)', frontend: 'nextjs', backend: 'nextjs-node', hasSrcApp: false, needsStorage: true },
    { label: 'nextjs-node (src/app/)', frontend: 'nextjs', backend: 'nextjs-node', hasSrcApp: true, needsStorage: true },
    { label: 'nuxt-server', frontend: 'nuxt', backend: 'nuxt-server', needsStorage: true },
    { label: 'express', frontend: 'none', backend: 'express', needsStorage: true },
    { label: 'cloudflare-workers', frontend: 'none', backend: 'cloudflare-workers', needsStorage: false },
    { label: 'angular', frontend: 'angular', backend: 'frontend-only', needsStorage: false },
    { label: 'expo', frontend: 'expo', backend: 'frontend-only', needsStorage: false },
    { label: 'vite frontend-only', frontend: 'vite', backend: 'frontend-only', needsStorage: false },
  ];

  it.each(frameworkCases)('compiles generated $label template with zero diagnostics', (tc) => {
    const rec = makeRecommendation(tc.frontend, tc.backend, 'local');
    const files: Record<string, string> = {};
    if (tc.needsStorage) {
      const storageFile = buildStorageAdapterFile('local');
      files[storageFile.relativePath] = storageFile.content;
    }
    for (const planned of buildFrameworkScaffolds(rec, { hasSrcApp: tc.hasSrcApp })) {
      files[planned.relativePath] = planned.content;
      if (tc.needsStorage) {
        expect(planned.content).not.toContain('authorize: async () => true');
        expect(planned.content).toContain("request.headers.get('authorization')");
      }
    }
    expect(compileVirtualFiles(files)).toEqual([]);
  });

  it('wires 4-layer engine into init (never installs sharp on Vite React or Workers) & detects Next.js src/app', async () => {
    const viteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-vite-init-'));
    tempDirs.push(viteDir);
    await fs.writeFile(
      path.join(viteDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { vite: '^6.0.0' } }),
      'utf8',
    );
    const viteRes = await runInteractiveInit({
      cwd: viteDir,
      yes: true,
      dryRun: true,
      input: new PassThrough(),
      output: new PassThrough(),
    });
    expect(viteRes.packages).not.toContain('sharp');

    const workerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-worker-init-'));
    tempDirs.push(workerDir);
    await fs.writeFile(path.join(workerDir, 'wrangler.toml'), 'name = "w"\n', 'utf8');
    await fs.writeFile(
      path.join(workerDir, 'package.json'),
      JSON.stringify({ dependencies: { hono: '^4.0.0' }, devDependencies: { wrangler: '^4.0.0' } }),
      'utf8',
    );
    const workerRes = await runInteractiveInit({
      cwd: workerDir,
      yes: true,
      dryRun: true,
      input: new PassThrough(),
      output: new PassThrough(),
    });
    expect(workerRes.packages).not.toContain('sharp');

    const nextSrcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-next-srcapp-'));
    tempDirs.push(nextSrcDir);
    await fs.mkdir(path.join(nextSrcDir, 'src', 'app'), { recursive: true });
    await fs.writeFile(
      path.join(nextSrcDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }),
      'utf8',
    );
    const report = await detectProject(nextSrcDir);
    const rec = resolveArchitecture(report);
    const plan = await buildScaffoldPlan(report, rec, planDependencies(report, rec));
    const route = plan.find((f) => f.relativePath === 'src/app/api/upload/route.ts');
    expect(route?.content).toContain("from '../../../lib/upload-storage'");
  });
});
