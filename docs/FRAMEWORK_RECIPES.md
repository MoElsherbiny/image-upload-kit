# Framework & Storage Recipes

Copy-paste integration patterns for popular React meta-frameworks, Node/Edge servers, cloud object stores, and SQL ORMs.

---

## 1. Next.js App Router + Custom `next/image` Renderer

`image-upload-kit` has zero `next/*` dependencies, so it works seamlessly in Next.js App Router while letting you plug `next/image` into `<ImageUploadProvider>`.

### Route Handler (`app/api/upload/route.ts`)

```ts
import { createUploadHttpHandler } from 'image-upload-kit/server';
import { uploader } from '@/lib/uploader';

export const runtime = 'nodejs'; // Required for Sharp native processing

export const { POST, DELETE } = createUploadHttpHandler({
  uploader,
  authorize: async (req) => Boolean(req.headers.get('cookie')),
});
```

### Client Provider with `next/image` (`app/providers/UploadProvider.tsx`)

```tsx
'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import { ImageUploadProvider } from 'image-upload-kit/react';
import 'image-upload-kit/styles.css';

export function AppUploadProvider({ children }: { children: ReactNode }) {
  return (
    <ImageUploadProvider
      endpoint="/api/upload"
      renderImage={({ src, alt, className, style, onLoad }) => (
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized={src.startsWith('blob:') || src.startsWith('data:')}
          sizes="(max-width: 768px) 100vw, 600px"
          className={className}
          style={style}
          onLoad={(e) => onLoad?.(e.currentTarget)}
        />
      )}
    >
      {children}
    </ImageUploadProvider>
  );
}
```

---

## 2. Vite + Hono or Express

### Option A: Hono Server (Native Web Fetch)

Because Hono uses Web Standard `Request` and `Response`, `{ POST, DELETE }` mount directly:

```ts
import { Hono } from 'hono';
import { createUploadHttpHandler } from 'image-upload-kit/server';
import { uploader } from './uploader';

const app = new Hono();
const handler = createUploadHttpHandler({ uploader });

app.post('/api/upload', (c) => handler.POST(c.req.raw));
app.delete('/api/upload', (c) => handler.DELETE(c.req.raw));

export default app;
```

### Option B: Express Server (`Readable.toWeb` Fetch Bridge)

```ts
import express from 'express';
import { Readable } from 'node:stream';
import { createUploadHttpHandler } from 'image-upload-kit/server';
import { uploader } from './uploader';

const app = express();
const handler = createUploadHttpHandler({ uploader });

app.all('/api/upload', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const webReq = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    // @ts-expect-error Nodeundici duplex flag required for streaming request bodies
    duplex: hasBody ? 'half' : undefined,
  });

  const webRes = req.method === 'DELETE'
    ? await handler.DELETE(webReq)
    : await handler.POST(webReq);

  res.status(webRes.status).type('application/json').send(await webRes.text());
});
```

---

## 3. Remix / React Router v7 Resource Route

```ts
// app/routes/api.upload.ts
import type { ActionFunctionArgs } from 'react-router';
import { createUploadHttpHandler } from 'image-upload-kit/server';
import { uploader } from '~/lib/uploader.server';

const { POST, DELETE } = createUploadHttpHandler({ uploader });

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === 'POST') return POST(request);
  if (request.method === 'DELETE') return DELETE(request);
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

---

## 4. AWS S3 & Cloudflare R2 via `createS3StorageAdapter`

`createS3StorageAdapter` uses a lightweight structural interface (`putObject`, `deleteObject`, optional `listObjectsV2`) so you bring your own `@aws-sdk/client-s3` version:

```ts
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createImageUploader } from 'image-upload-kit/server';
import { createS3StorageAdapter } from 'image-upload-kit/storage';

const s3 = new S3Client({
  region: 'auto', // Use 'auto' for Cloudflare R2, or e.g. 'us-east-1' for AWS S3
  endpoint: process.env.R2_ENDPOINT, // Omit for standard AWS S3
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

export const r2Storage = createS3StorageAdapter({
  publicBaseUrl: process.env.PUBLIC_CDN_URL!, // e.g. 'https://cdn.example.com'
  includeBucketInUrl: false, // R2 custom domains map directly to a single bucket
  defaultBucket: process.env.S3_BUCKET!,
  putObject: (input) => s3.send(new PutObjectCommand(input)),
  deleteObject: (input) => s3.send(new DeleteObjectCommand(input)),
  listObjectsV2: (input) => s3.send(new ListObjectsV2Command(input)),
});

export const uploader = createImageUploader({
  storage: r2Storage,
  defaultBucket: process.env.S3_BUCKET!,
});
```

---

## 5. Supabase Storage (`createSupabaseStorageAdapter`)

Pass a server-side service-role Supabase client directly — no wrapper classes required:

```ts
import { createClient } from '@supabase/supabase-js';
import { createImageUploader } from 'image-upload-kit/server';
import { createSupabaseStorageAdapter } from 'image-upload-kit/storage';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const uploader = createImageUploader({
  storage: createSupabaseStorageAdapter(supabaseAdmin),
  defaultBucket: 'public-media',
});
```

---

## 6. Database Persistence with Prisma or Drizzle (`onUploadRecord`)

Use `onUploadRecord` on `createImageUploader` to store optimized dimensions, LQIP `blurDataUrl`, `blurColor`, `blurHash`, SHA-256 `contentHash`, and custom `metadata` in SQL:

### Prisma Example

```ts
export const uploader = createImageUploader({
  storage,
  awaitRecordHook: true, // Guarantee DB row exists before returning HTTP 200
  async onUploadRecord(record) {
    await prisma.imageAsset.create({
      data: {
        url: record.url,
        storagePath: record.storagePath ?? '',
        bucket: record.bucket ?? 'media',
        width: record.width,
        height: record.height,
        format: record.format,
        sizeBytes: record.size,
        quality: record.quality,
        blurDataUrl: record.blurDataUrl,
        blurColor: record.blurColor,
        blurHash: record.blurHash,
        contentHash: record.contentHash,
        entityId: record.metadata?.entityId,
      },
    });
  },
});
```

### Drizzle ORM Example

```ts
export const uploader = createImageUploader({
  storage,
  awaitRecordHook: true,
  async onUploadRecord(record) {
    await db.insert(imageAssets).values({
      url: record.url,
      storagePath: record.storagePath ?? '',
      width: record.width,
      height: record.height,
      format: record.format,
      sizeBytes: record.size,
      blurDataUrl: record.blurDataUrl,
      blurColor: record.blurColor,
      contentHash: record.contentHash,
    });
  },
});
```
