import fs from 'node:fs/promises';
import path from 'node:path';
import type { SelectOption } from './tui';

export type InitFramework = 'react' | 'vue' | 'angular' | 'react-native' | 'server' | 'client';
export type InitStorageAdapter = 'local' | 's3' | 'supabase' | 'memory';
export type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface DetectedEnvironment {
  pm: PackageManagerName;
  framework: InitFramework;
  detectedFrameworkName: string | null;
  installedPackages: Set<string>;
}

export const BASE_FRAMEWORK_OPTIONS: ReadonlyArray<SelectOption<InitFramework>> = [
  { value: 'react', label: 'React / Next.js', hint: 'img-upload-kit/react + headless + Sharp server pipeline' },
  { value: 'vue', label: 'Vue 3.5+ / Nuxt 4', hint: 'img-upload-kit/vue plugin, v-model components & composables' },
  { value: 'angular', label: 'Angular 17–21+', hint: 'img-upload-kit/angular signals, Zoneless & Reactive Forms' },
  { value: 'react-native', label: 'React Native / Expo', hint: 'img-upload-kit/react-native + Expo/RN image picker adapters' },
  { value: 'server', label: 'Node.js / Edge Server Only', hint: 'img-upload-kit/server + Sharp AVIF/WebP + presigned routes' },
  { value: 'client', label: 'Headless / Vanilla JS', hint: 'img-upload-kit/client universal XHR, resize & presigned engine' },
];

export const STORAGE_OPTIONS: ReadonlyArray<SelectOption<InitStorageAdapter>> = [
  { value: 'local', label: 'Local Filesystem', hint: 'createLocalFsStorageAdapter (./public/uploads — zero cloud keys)' },
  { value: 's3', label: 'AWS S3 / Cloudflare R2', hint: 'createS3StorageAdapter + direct presigned PUT uploads' },
  { value: 'supabase', label: 'Supabase Storage', hint: 'createSupabaseStorageAdapter' },
  { value: 'memory', label: 'In-Memory Adapter', hint: 'createMemoryStorageAdapter (testing & ephemeral sandboxes)' },
];

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function detectLockfilePm(dir: string): Promise<PackageManagerName | null> {
  if (
    (await fileExists(path.join(dir, 'pnpm-lock.yaml'))) ||
    (await fileExists(path.join(dir, 'pnpm-workspace.yaml')))
  ) {
    return 'pnpm';
  }
  if (await fileExists(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (
    (await fileExists(path.join(dir, 'bun.lockb'))) ||
    (await fileExists(path.join(dir, 'bun.lock')))
  ) {
    return 'bun';
  }
  if (await fileExists(path.join(dir, 'package-lock.json'))) return 'npm';
  return null;
}

export function normalizeFrameworkOption(raw?: string): InitFramework | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'react' || v === 'next' || v === 'nextjs') return 'react';
  if (v === 'vue' || v === 'nuxt' || v === 'nuxtjs') return 'vue';
  if (v === 'angular' || v === 'ng') return 'angular';
  if (v === 'react-native' || v === 'rn' || v === 'expo') return 'react-native';
  if (v === 'server' || v === 'node' || v === 'edge' || v === 'hono' || v === 'express') {
    return 'server';
  }
  if (v === 'client' || v === 'headless' || v === 'vanilla') return 'client';
  throw new Error(
    `Invalid --framework "${raw}". Expected one of: react, vue, angular, react-native, server, client.`,
  );
}

export function normalizeStorageOption(raw?: string): InitStorageAdapter | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'local' || v === 'fs' || v === 'disk' || v === 'filesystem') return 'local';
  if (v === 's3' || v === 'r2' || v === 'aws' || v === 'cloudflare') return 's3';
  if (v === 'supabase' || v === 'sb') return 'supabase';
  if (v === 'memory' || v === 'mem') return 'memory';
  throw new Error(
    `Invalid --storage "${raw}". Expected one of: local, s3, supabase, memory.`,
  );
}

export function normalizePmOption(raw?: string): PackageManagerName | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'npm' || v === 'pnpm' || v === 'yarn' || v === 'bun') return v;
  throw new Error(`Invalid --pm "${raw}". Expected one of: npm, pnpm, yarn, bun.`);
}

export async function detectProjectEnvironment(
  cwd: string = process.cwd(),
): Promise<DetectedEnvironment> {
  const installedPackages = new Set<string>();
  let framework: InitFramework = 'react';
  let detectedFrameworkName: string | null = null;
  let declaredPm: PackageManagerName | null = null;

  try {
    const raw = await fs.readFile(path.join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as {
      packageManager?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const pmSpec = pkg.packageManager?.split('@')[0]?.trim().toLowerCase();
    if (pmSpec === 'pnpm' || pmSpec === 'yarn' || pmSpec === 'bun' || pmSpec === 'npm') {
      declaredPm = pmSpec;
    }
    for (const group of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
      if (group) {
        for (const key of Object.keys(group)) installedPackages.add(key);
      }
    }

    if (installedPackages.has('expo') || installedPackages.has('react-native')) {
      framework = 'react-native';
      detectedFrameworkName = installedPackages.has('expo') ? 'Expo / React Native' : 'React Native';
    } else if (installedPackages.has('@angular/core')) {
      framework = 'angular';
      detectedFrameworkName = 'Angular';
    } else if (installedPackages.has('nuxt') || installedPackages.has('vue')) {
      framework = 'vue';
      detectedFrameworkName = installedPackages.has('nuxt') ? 'Nuxt / Vue' : 'Vue 3';
    } else if (installedPackages.has('next') || installedPackages.has('react')) {
      framework = 'react';
      detectedFrameworkName = installedPackages.has('next') ? 'Next.js / React' : 'React';
    } else if (
      installedPackages.has('hono') ||
      installedPackages.has('express') ||
      installedPackages.has('fastify')
    ) {
      framework = 'server';
      detectedFrameworkName = 'Node.js Server';
    }
  } catch {
    // No package.json in cwd — default to react + npm
  }

  let pm: PackageManagerName | null = declaredPm;
  for (const dir of [cwd, path.dirname(cwd), path.dirname(path.dirname(cwd))]) {
    if (pm) break;
    pm = await detectLockfilePm(dir);
  }
  if (!pm) {
    const ua = process.env.npm_config_user_agent ?? '';
    if (ua.startsWith('pnpm')) pm = 'pnpm';
    else if (ua.startsWith('yarn')) pm = 'yarn';
    else if (ua.startsWith('bun')) pm = 'bun';
    else pm = 'npm';
  }

  return { pm, framework, detectedFrameworkName, installedPackages };
}

export function resolvePackagesToInstall(
  framework: InitFramework,
  storage: InitStorageAdapter,
  installed: ReadonlySet<string> = new Set(),
): string[] {
  const required: string[] = ['img-upload-kit'];

  if (framework === 'react') {
    if (!installed.has('react')) required.push('react');
    if (!installed.has('react-dom')) required.push('react-dom');
  } else if (framework === 'vue' && !installed.has('vue')) {
    required.push('vue');
  } else if (framework === 'angular' && !installed.has('@angular/core')) {
    required.push('@angular/core');
  } else if (
    framework === 'react-native' &&
    !installed.has('expo-image-picker') &&
    !installed.has('react-native-image-picker')
  ) {
    required.push('expo-image-picker');
  }

  if (framework !== 'react-native' && framework !== 'client' && !installed.has('sharp')) {
    required.push('sharp');
  }

  if (storage === 's3' && !installed.has('@aws-sdk/client-s3')) {
    required.push('@aws-sdk/client-s3');
  } else if (storage === 'supabase' && !installed.has('@supabase/supabase-js')) {
    required.push('@supabase/supabase-js');
  }

  return Array.from(new Set(required));
}

export function buildInstallCommand(
  pm: PackageManagerName,
  packages: readonly string[],
): string {
  const list = packages.join(' ');
  if (pm === 'pnpm') return `pnpm add ${list}`;
  if (pm === 'yarn') return `yarn add ${list}`;
  if (pm === 'bun') return `bun add ${list}`;
  return `npm i ${list}`;
}

export function buildStarterSnippet(
  framework: InitFramework,
  storage: InitStorageAdapter,
): string[] {
  const storageImport =
    storage === 's3'
      ? "import { createS3StorageAdapter } from 'img-upload-kit/storage';"
      : storage === 'supabase'
        ? "import { createSupabaseStorageAdapter } from 'img-upload-kit/storage';"
        : storage === 'memory'
          ? "import { createMemoryStorageAdapter } from 'img-upload-kit/storage';"
          : "import { createLocalFsStorageAdapter } from 'img-upload-kit/storage';";

  if (framework === 'vue') {
    return [
      "import { createImageUpload, SingleImageUpload, MultiImageUpload } from 'img-upload-kit/vue';",
      "import 'img-upload-kit/styles.css';",
      storageImport,
    ];
  }
  if (framework === 'angular') {
    return [
      "import { provideImageUploadConfig, createSingleUpload, withAngularSignals } from 'img-upload-kit/angular';",
      "import 'img-upload-kit/styles.css';",
      storageImport,
    ];
  }
  if (framework === 'react-native') {
    return [
      "import { NativeImageUploadProvider, SingleImageUpload, createExpoImagePickerAdapter } from 'img-upload-kit/react-native';",
    ];
  }
  if (framework === 'server') {
    return [
      "import { createImageUploader, createUploadHttpHandler } from 'img-upload-kit/server';",
      storageImport,
    ];
  }
  if (framework === 'client') {
    return [
      "import { uploadAsset, createClientResizeTransform } from 'img-upload-kit/client';",
    ];
  }
  return [
    "import { ImageUploadProvider, SingleImageUpload, AnimatedImage } from 'img-upload-kit/react';",
    "import 'img-upload-kit/styles.css';",
    storageImport,
  ];
}
