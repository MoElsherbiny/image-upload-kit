import type { RuntimeCapability } from '../types/architecture';
import type { BackendRuntime } from '../types/detection';

export const RUNTIME_CAPABILITIES: Readonly<Record<BackendRuntime, RuntimeCapability>> = {
  'nextjs-node': {
    id: 'nextjs-node',
    displayName: 'Next.js Node.js Runtime',
    supportsSharp: true,
    supportsNodeFs: true,
    supportsWebFetch: true,
    recommendedHandlerEntry: 'img-upload-kit/server',
    notes: 'Set `export const runtime = "nodejs"` on upload routes so Sharp runs on Node.js.',
  },
  node: {
    id: 'node',
    displayName: 'Node.js Server',
    supportsSharp: true,
    supportsNodeFs: true,
    supportsWebFetch: true,
    recommendedHandlerEntry: 'img-upload-kit/server',
    notes: 'Full Sharp AVIF/WebP optimization, BlurHash, LQIP, and StorageAdapter support.',
  },
  express: {
    id: 'express',
    displayName: 'Express (Node.js)',
    supportsSharp: true,
    supportsNodeFs: true,
    supportsWebFetch: false,
    recommendedHandlerEntry: 'img-upload-kit/server',
    notes: 'Use createImageUploader directly with multer/busboy or adapt Request/Response.',
  },
  fastify: {
    id: 'fastify',
    displayName: 'Fastify (Node.js)',
    supportsSharp: true,
    supportsNodeFs: true,
    supportsWebFetch: false,
    recommendedHandlerEntry: 'img-upload-kit/server',
    notes: 'Use createImageUploader with @fastify/multipart for full Sharp optimization.',
  },
  hono: {
    id: 'hono',
    displayName: 'Hono',
    supportsSharp: true,
    supportsNodeFs: true,
    supportsWebFetch: true,
    recommendedHandlerEntry: 'img-upload-kit/server',
    notes: 'On Node.js/Bun, createUploadHttpHandler works directly with c.req.raw. On Cloudflare Workers, Sharp is unavailable.',
  },
  nestjs: {
    id: 'nestjs',
    displayName: 'NestJS (Node.js)',
    supportsSharp: true,
    supportsNodeFs: true,
    supportsWebFetch: false,
    recommendedHandlerEntry: 'img-upload-kit/server',
    notes: 'Inject createImageUploader inside a NestJS service and handle FileInterceptor buffers.',
  },
  'nuxt-server': {
    id: 'nuxt-server',
    displayName: 'Nuxt / Nitro Node Server',
    supportsSharp: true,
    supportsNodeFs: true,
    supportsWebFetch: true,
    recommendedHandlerEntry: 'img-upload-kit/server',
    notes: 'Full Sharp optimization in Nitro Node.js presets. Edge Nitro presets cannot run Sharp.',
  },
  'aws-lambda': {
    id: 'aws-lambda',
    displayName: 'AWS Lambda (Node.js)',
    supportsSharp: true,
    supportsNodeFs: false,
    supportsWebFetch: true,
    recommendedHandlerEntry: 'img-upload-kit/server',
    notes: 'Sharp works with Linux x64/arm64 prebuilds; use S3/R2 storage instead of local filesystem.',
  },
  'firebase-functions': {
    id: 'firebase-functions',
    displayName: 'Firebase Cloud Functions (Node.js)',
    supportsSharp: true,
    supportsNodeFs: false,
    supportsWebFetch: false,
    recommendedHandlerEntry: 'img-upload-kit/server',
    notes: 'Node.js runtime supports Sharp; pair with a custom Firebase StorageAdapter or S3/R2.',
  },
  'cloudflare-workers': {
    id: 'cloudflare-workers',
    displayName: 'Cloudflare Workers',
    supportsSharp: false,
    supportsNodeFs: false,
    supportsWebFetch: true,
    recommendedHandlerEntry: 'img-upload-kit/server/handler',
    notes: 'Sharp native binaries cannot run on Cloudflare Workers. Use img-upload-kit/server/handler for presigned flows or offload Sharp processing to a Node.js service.',
  },
  'vercel-edge': {
    id: 'vercel-edge',
    displayName: 'Vercel Edge Runtime',
    supportsSharp: false,
    supportsNodeFs: false,
    supportsWebFetch: true,
    recommendedHandlerEntry: 'img-upload-kit/server/handler',
    notes: 'Sharp cannot run in Vercel Edge isolates. Switch upload routes to Node.js runtime or offload processing.',
  },
  'frontend-only': {
    id: 'frontend-only',
    displayName: 'Frontend-Only App (No Local Backend)',
    supportsSharp: false,
    supportsNodeFs: false,
    supportsWebFetch: false,
    recommendedHandlerEntry: 'none',
    notes: 'Install only client/UI packages here. Do not install Sharp or cloud SDK secrets in a browser-only bundle; point uploadEndpoint to an external Node.js API.',
  },
  none: {
    id: 'none',
    displayName: 'No Backend Detected',
    supportsSharp: false,
    supportsNodeFs: false,
    supportsWebFetch: false,
    recommendedHandlerEntry: 'none',
    notes: 'Add a Node.js upload endpoint or connect to an existing backend API.',
  },
};

export function getRuntimeCapability(id: BackendRuntime): RuntimeCapability {
  return RUNTIME_CAPABILITIES[id] ?? RUNTIME_CAPABILITIES.none;
}

export function listRuntimeCapabilities(): RuntimeCapability[] {
  return Object.values(RUNTIME_CAPABILITIES);
}
