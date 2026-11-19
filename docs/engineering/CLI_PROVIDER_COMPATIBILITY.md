# CLI Provider & Runtime Compatibility Matrix

This document defines the honest support contract enforced by `src/cli/capabilities/storageRegistry.ts` and `src/cli/capabilities/runtimeRegistry.ts`.

## Storage Provider Capabilities

| Provider ID | Display Name | Support Level | Native Adapter | Custom Adapter Required | Signed Uploads | Required SDK |
| --- | --- | --- | --- | --- | --- | --- |
| `local` | Local Filesystem | `native` | Yes | No | No | None |
| `s3` | AWS S3 | `native` | Yes | No | Yes | `@aws-sdk/client-s3` |
| `supabase` | Supabase Storage | `native` | Yes | No | Yes | `@supabase/supabase-js` |
| `memory` | In-Memory Storage | `native` | Yes | No | No | None |
| `r2` | Cloudflare R2 | `verified-s3-compatible` | No (uses S3 adapter) | No | Yes | `@aws-sdk/client-s3` |
| `minio` | MinIO | `verified-s3-compatible` | No (uses S3 adapter) | No | Yes | `@aws-sdk/client-s3` |
| `spaces` | DigitalOcean Spaces | `verified-s3-compatible` | No (uses S3 adapter) | No | Yes | `@aws-sdk/client-s3` |
| `b2` | Backblaze B2 | `verified-s3-compatible` | No (uses S3 adapter) | No | Yes | `@aws-sdk/client-s3` |
| `custom-s3` | Custom S3-Compatible | `verified-s3-compatible` | No (uses S3 adapter) | No | Yes | `@aws-sdk/client-s3` |
| `gcs` | Google Cloud Storage | `custom-adapter-required` | No | **Yes** | Yes (custom) | `@google-cloud/storage` |
| `azure-blob` | Azure Blob Storage | `custom-adapter-required` | No | **Yes** | Yes (custom) | `@azure/storage-blob` |
| `firebase` | Firebase Storage | `custom-adapter-required` | No | **Yes** | Yes (custom) | `firebase-admin` |

### Honesty Policy

- `img-upload-kit` **never** claims native adapters exist for Google Cloud Storage, Azure Blob Storage, or Firebase Storage.
- When one of those providers is detected, the CLI reuses the user's existing infrastructure by generating a typed `StorageAdapter` scaffold in `src/lib/upload-storage.ts` and noting native alternatives (AWS S3 / Cloudflare R2).

## Backend / Runtime Sharp Compatibility

| Runtime ID | Supports Sharp | Node `fs` | Web Fetch | Recommended Server Entry |
| --- | --- | --- | --- | --- |
| `nextjs-node` | Yes | Yes | Yes | `img-upload-kit/server` |
| `node` | Yes | Yes | Yes | `img-upload-kit/server` |
| `express` | Yes | Yes | No | `img-upload-kit/server` |
| `fastify` | Yes | Yes | No | `img-upload-kit/server` |
| `hono` (Node/Bun) | Yes | Yes | Yes | `img-upload-kit/server` |
| `nestjs` | Yes | Yes | No | `img-upload-kit/server` |
| `nuxt-server` | Yes | Yes | Yes | `img-upload-kit/server` |
| `aws-lambda` | Yes | No (ephemeral) | Yes | `img-upload-kit/server` |
| `firebase-functions` | Yes | No (ephemeral) | No | `img-upload-kit/server` |
| `cloudflare-workers` | **No** | No | Yes | `img-upload-kit/server/handler` |
| `vercel-edge` | **No** | No | Yes | `img-upload-kit/server/handler` |
| `frontend-only` | **No** | No | No | `none` (client only) |
| `none` | **No** | No | No | `none` |

### Runtime Safety Rules

- `dependencyPlanner.ts` **never** installs `sharp` or server storage SDKs in `frontend-only`, `cloudflare-workers`, `vercel-edge`, `expo`, or `react-native` workspaces.
- `doctor` and `validate` emit an error (`SHARP_INCOMPATIBLE_RUNTIME`) if `sharp` is found in `package.json` for an incompatible runtime.
