import fs from 'node:fs/promises';
import path from 'node:path';
import type { SelectOption } from './tui';

export type InitFramework =
  | 'react'
  | 'vue'
  | 'angular'
  | 'react-native'
  | 'server'
  | 'client';

export type InitStorageAdapter = 'local' | 's3' | 'supabase' | 'memory';
export type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface DetectedEnvironment {
  pm: PackageManagerName;
  framework: InitFramework;
  detectedFrameworkName: string | null;
  installedPackages: Set<string>;
}

export const BASE_FRAMEWORK_OPTIONS: ReadonlyArray<SelectOption<InitFramework>> = [
  {
    value: 'react',
    label: 'React / Next.js',
    hint: 'img-upload-kit/react + headless + Sharp server pipeline',
  },
  {
    value: 'vue',
    label: 'Vue 3.5+ / Nuxt 4',
    hint: 'img-upload-kit/vue plugin, v-model components & composables',
  },
  {
    value: 'angular',
    label: 'Angular 17–21+',
    hint: 'img-upload-kit/angular signals, Zoneless & Reactive Forms',
  },
  {
    value: 'react-native',
    label: 'React Native / Expo',
    hint: 'img-upload-kit/react-native + Expo/RN image picker adapters',
  },
  {
    value: 'server',
    label: 'Node.js / Edge Server Only',
    hint: 'img-upload-kit/server + Sharp AVIF/WebP + presigned routes',
  },
  {
    value: 'client',
    label: 'Headless / Vanilla JS',
    hint: 'img-upload-kit/client universal XHR, resize & presigned engine',
  },
];

export const STORAGE_OPTIONS: ReadonlyArray<SelectOption<InitStorageAdapter>> = [
  {
    value: 'local',
    label: 'Local Filesystem',
    hint: 'createLocalFsStorageAdapter (./public/uploads — zero cloud keys)',
  },
  {
    value: 's3',
    label: 'AWS S3 / Cloudflare R2',
    hint: 'createS3StorageAdapter + direct presigned PUT uploads',
  },
  {
    value: 'supabase',
    label: 'Supabase Storage',
    hint: 'createSupabaseStorageAdapter',
  },
  {
    value: 'memory',
    label: 'In-Memory Adapter',
    hint: 'createMemoryStorageAdapter (testing & ephemeral sandboxes)',
  },
];

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function detectProjectEnvironment(
  cwd: string = process.cwd(),
): Promise<DetectedEnvironment> {
  let pm: PackageManagerName = 'npm';
  const ua = process.env.npm_config_user_agent ?? '';
  if (ua.startsWith('pnpm') || (await fileExists(path.join(cwd, 'pnpm-lock.yaml')))) {
    pm = 'pnpm';
  } else if (ua.startsWith('yarn') || (await fileExists(path.join(cwd, 'yarn.lock')))) {
    pm = 'yarn';
  } else if (
    ua.startsWith('bun') ||
    (await fileExists(path.join(cwd, 'bun.lockb'))) ||
    (await fileExists(path.join(cwd, 'bun.lock')))
  ) {
    pm = 'bun';
  }

  const installedPackages = new Set<string>();
  let framework: InitFramework = 'react';
  let detectedFrameworkName: string | null = null;

  try {
    const raw = await fs.readFile(path.join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
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

  return { pm, framework, detectedFrameworkName, installedPackages };
}

export function resolvePackagesToInstall(
  framework: InitFramework,
  storage: InitStorageAdapter,
  installed: ReadonlySet<string> = new Set(),
): string[] {
  const required: string[] = ['img-upload-kit'];

  if (framework === 'react' && !installed.has('react')) {
    required.push('react', 'react-dom');
  } else if (framework === 'vue' && !installed.has('vue')) {
    required.push('vue');
  } else if (framework === 'angular' && !installed.has('@angular/core')) {
    required.push('@angular/core');
  } else if (framework === 'react-native' && !installed.has('expo-image-picker')) {
    required.push('expo-image-picker');
  }

  if (framework !== 'react-native' && framework !== 'client') {
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
