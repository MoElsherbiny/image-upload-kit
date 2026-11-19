import type { ArchitectureRecommendation, PlannedFile } from '../types/architecture';

export interface FrameworkScaffoldOptions {
  /** True when a Next.js workspace uses `src/app` instead of root `app/`. */
  hasSrcApp?: boolean;
}

const FAIL_CLOSED_AUTHORIZE_LINES = [
  '  authorize: async ({ request }) => {',
  '    // TODO: replace with your session/JWT verification (e.g. Auth.js, Clerk, Supabase Auth)',
  "    return Boolean(request.headers.get('authorization') || request.headers.get('cookie'));",
  '  },',
];

export function buildFrameworkScaffolds(
  rec: ArchitectureRecommendation,
  options: FrameworkScaffoldOptions = {},
): PlannedFile[] {
  const files: PlannedFile[] = [];

  if (rec.backend === 'nextjs-node') {
    const useSrcApp = Boolean(options.hasSrcApp);
    const routePath = useSrcApp ? 'src/app/api/upload/route.ts' : 'app/api/upload/route.ts';
    const storageImport = useSrcApp
      ? '../../../lib/upload-storage'
      : '../../../src/lib/upload-storage';
    files.push({
      relativePath: routePath,
      description: 'Next.js App Router Node.js upload handler',
      mode: 'create',
      content: [
        "import { createImageUploader, createUploadHttpHandler } from 'img-upload-kit/server';",
        `import { uploadStorage } from '${storageImport}';`,
        '',
        "export const runtime = 'nodejs';",
        '',
        'const uploader = createImageUploader({ storage: uploadStorage });',
        '',
        'export const { POST, DELETE } = createUploadHttpHandler({',
        '  uploader,',
        ...FAIL_CLOSED_AUTHORIZE_LINES,
        '});',
        '',
      ].join('\n'),
    });
    return files;
  }

  if (rec.backend === 'nuxt-server') {
    files.push({
      relativePath: 'server/api/upload.ts',
      description: 'Nuxt / Nitro Node upload endpoint',
      mode: 'create',
      content: [
        "import { defineEventHandler, toWebRequest } from 'h3';",
        "import { createImageUploader, createUploadHttpHandler } from 'img-upload-kit/server';",
        "import { uploadStorage } from '../../src/lib/upload-storage';",
        '',
        'const uploader = createImageUploader({ storage: uploadStorage });',
        '',
        'const { POST, DELETE } = createUploadHttpHandler({',
        '  uploader,',
        ...FAIL_CLOSED_AUTHORIZE_LINES,
        '});',
        '',
        'export default defineEventHandler(async (event) => {',
        '  const request = toWebRequest(event);',
        "  if (request.method === 'DELETE') {",
        '    return DELETE(request);',
        '  }',
        '  return POST(request);',
        '});',
        '',
      ].join('\n'),
    });
    return files;
  }

  if (
    rec.backend === 'express' ||
    rec.backend === 'fastify' ||
    rec.backend === 'hono' ||
    rec.backend === 'nestjs' ||
    rec.backend === 'node' ||
    rec.backend === 'aws-lambda' ||
    rec.backend === 'firebase-functions'
  ) {
    files.push({
      relativePath: 'src/server/upload-handler.ts',
      description: `${rec.runtimeCapability.displayName} upload handler`,
      mode: 'create',
      content: [
        "import { createImageUploader, createUploadHttpHandler } from 'img-upload-kit/server';",
        "import { uploadStorage } from '../lib/upload-storage';",
        '',
        'export const imageUploader = createImageUploader({',
        '  storage: uploadStorage,',
        '});',
        '',
        'export const uploadHttpHandler = createUploadHttpHandler({',
        '  uploader: imageUploader,',
        ...FAIL_CLOSED_AUTHORIZE_LINES,
        '});',
        '',
      ].join('\n'),
    });
    return files;
  }

  if (rec.backend === 'cloudflare-workers' || rec.backend === 'vercel-edge') {
    files.push({
      relativePath: 'src/server/edge-upload-handler.ts',
      description: 'Edge-safe presign/handler advisory (no Sharp)',
      mode: 'create',
      content: [
        "import { createUploadHttpHandler } from 'img-upload-kit/server/handler';",
        '',
        `// NOTE: ${rec.runtimeCapability.displayName} cannot execute Sharp native binaries.`,
        '// Use this edge-safe entry for presigned/auth flows and delegate Sharp',
        '// AVIF/WebP optimization to an external Node.js worker or backend service.',
        'export { createUploadHttpHandler };',
        '',
      ].join('\n'),
    });
    return files;
  }

  // Frontend-only / React Native / Angular / Vue client starter
  if (rec.frontend === 'expo' || rec.frontend === 'react-native') {
    files.push({
      relativePath: 'src/lib/upload-client.ts',
      description: 'React Native / Expo upload client helper',
      mode: 'create',
      content: [
        "import { createExpoImagePickerAdapter } from 'img-upload-kit/react-native';",
        '',
        "export const uploadEndpoint = process.env.EXPO_PUBLIC_UPLOAD_ENDPOINT ?? '/api/upload';",
        'export { createExpoImagePickerAdapter };',
        '',
      ].join('\n'),
    });
    return files;
  }

  if (rec.frontend === 'angular') {
    files.push({
      relativePath: 'src/app/upload.config.ts',
      description: 'Angular img-upload-kit provider configuration',
      mode: 'create',
      content: [
        "import { provideImageUploadConfig } from 'img-upload-kit/angular';",
        '',
        'export const imageUploadProvider = provideImageUploadConfig({',
        "  endpoint: '/api/upload',",
        '});',
        '',
      ].join('\n'),
    });
    return files;
  }

  files.push({
    relativePath: 'src/lib/upload-client.ts',
    description: 'Frontend-only upload client helper (points to external Node.js API)',
    mode: 'create',
    content: [
      "import { createClientResizeTransform, uploadAsset } from 'img-upload-kit/client';",
      '',
      '// Frontend-only workspace: Sharp runs on your external Node.js backend.',
      "export const uploadEndpoint = '/api/upload';",
      'export const preUploadResize = createClientResizeTransform({ maxWidth: 2048 });',
      'export { uploadAsset };',
      '',
    ].join('\n'),
  });
  return files;
}
