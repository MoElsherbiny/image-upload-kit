# CLI Test Matrix — 19 Fixture Topologies

The Phase 7B test suite (`tests/cli/`) verifies detection, capability honesty, recommendations, dependency safety, env merging, `AGENTS.md` marker preservation, dry-run/rollback safety, and CLI commands across 19 realistic project topologies.

## Topology Coverage

| # | Topology | Frontend | Backend | Storage | Key Assertions |
| --- | --- | --- | --- | --- | --- |
| 1 | Next.js + AWS S3 | `nextjs` | `nextjs-node` | `s3` | Native S3 adapter, Sharp installed, App Router `route.ts` |
| 2 | Next.js + Cloudflare R2 | `nextjs` | `nextjs-node` | `r2` | Verified S3-compatible (`region: 'auto'`), `@aws-sdk/client-s3` |
| 3 | Next.js + Supabase | `nextjs` | `nextjs-node` | `supabase` | Native Supabase adapter, `@supabase/supabase-js`, auth reuse |
| 4 | React + Express + S3 | `react` | `express` | `s3` | Express handler + S3 adapter + Sharp |
| 5 | React + Custom Backend | `react` | `fastify` | `local` | Fastify handler + local FS fallback |
| 6 | Vue + Nuxt | `nuxt` | `nuxt-server` | `local` | Nitro `server/api/upload.post.ts`, `vue` peer respected |
| 7 | Angular + API | `angular` | `frontend-only` | `local` | Angular provider config, no Sharp in Angular-only workspace |
| 8 | React Native + Expo | `expo` | `frontend-only` | `local` | `expo-image-picker`, **never** installs `sharp` |
| 9 | Google Cloud Storage | `nextjs` | `nextjs-node` | `gcs` | `custom-adapter-required`, `StorageAdapter` scaffold |
| 10 | Azure Blob Storage | `node`/`express` | `express` | `azure-blob` | `custom-adapter-required`, `StorageAdapter` scaffold |
| 11 | Firebase Storage | `nextjs` | `firebase-functions` | `firebase` | `custom-adapter-required`, `firebase-admin` scaffold |
| 12 | MinIO | `node`/`express` | `express` | `minio` | Verified S3-compatible (`forcePathStyle: true`) |
| 13 | Custom S3-Compatible | `node`/`hono` | `hono` | `custom-s3` | Verified S3-compatible with `S3_ENDPOINT` |
| 14 | Frontend-Only Vite | `vite` | `frontend-only` | `local` | Client-only helper, **never** installs `sharp` or S3 SDK |
| 15 | Monorepo (`pnpm-workspace.yaml` / `turbo.json`) | `nextjs` | `nextjs-node` | `s3` | Detects `pnpm` & `monorepo.isMonorepo === true` |
| 16 | Existing `AGENTS.md` | `react` | `express` | `local` | Preserves 100% of user content outside markers |
| 17 | Existing `.env.template` | `nextjs` | `nextjs-node` | `s3` | Reuses `.env.template`, merges only missing keys, no secrets |
| 18 | Ambiguous Infra (S3 + Supabase) | `nextjs` | `nextjs-node` | `supabase`/`s3` | Flags `ambiguousStorage.length > 1` in limitations |
| 19 | Cloudflare Workers (Unsupported Sharp) | `none` | `cloudflare-workers` | `r2` | `supportsSharp: false`, edge handler advisory, **never** installs `sharp` |

## Additional Safety & Regression Checks

- **Secret Leak Prevention**: Flags `NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY` and `VITE_SUPABASE_SERVICE_ROLE_KEY` in `doctor`/`validate` and rejects them in `mergeEnvTemplateContent`.
- **Never Reads `.env`**: `.env` containing `AWS_SECRET_ACCESS_KEY=super-secret-value` is ignored completely by `detectProject` and `config`.
- **Dry-Run & Rollback**: `--dry-run` writes zero files; mid-batch write error restores previously written files cleanly.
- **Backward Compatibility**: Existing `tests/cli-init.test.ts`, `tests/cli-generator.test.ts`, and `tests/cli-validation.test.ts` continue to pass unchanged.
