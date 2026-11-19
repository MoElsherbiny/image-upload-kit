# CLI & Infrastructure Guide (`npx img-upload-kit`)

`img-upload-kit` ships a zero-dependency CLI (`dist/bin.js`, powered by `ZeroDepCliProgram` on `node:util` `parseArgs`) for interactive project setup, 4-layer architecture detection, non-destructive scaffolding, diagnostics, and static LQIP/BlurHash manifest generation.

```bash
# Interactive setup (or pass top-level flags directly to init):
npx img-upload-kit@latest init
npx img-upload-kit@latest -f vue -s r2 --yes
```

---

## 1. Project Setup, Diagnostics & Scaffolding Commands

### `init` (alias: `setup`)

Detects your framework, backend runtime, storage provider, and package manager (`npm`, `pnpm`, `yarn`, `bun`), installs only required peer/SDK packages, and optionally scaffolds starter files.

```bash
npx img-upload-kit init [options]
```

| Flag | Description |
| --- | --- |
| `-f, --framework <fw>` | Target platform: `react` (`nextjs`), `vue` (`nuxt`), `angular` (`ng`), `react-native` (`expo`/`rn`), `server` (`node`/`edge`/`hono`/`express`), or `client` (`headless`/`vanilla`). |
| `-s, --storage <adapter>` | Storage adapter: `local` (`fs`/`disk`), `s3` (`r2`/`aws`/`cloudflare`), `supabase` (`sb`), or `memory` (`mem`). |
| `-p, --pm <pm>` | Package manager override (`npm \| pnpm \| yarn \| bun`). |
| `-y, --yes` | Accept detected defaults without interactive prompts. |
| `--no-install` | Print the install command and starter imports without running package installation. |
| `--scaffold` | Generate typed storage adapter, upload route/client starter, `.env.example` entries, and `AGENTS.md` section. |
| `--dry-run` | Preview planned package installs and file writes without modifying disk. |

### `doctor`

Audits your project for `sharp` runtime incompatibilities (such as Cloudflare Workers or Vercel Edge), browser-exposed secret env keys (`NEXT_PUBLIC_*SECRET*`), missing `.env.example` keys, and `AGENTS.md` drift.

```bash
npx img-upload-kit doctor              # Inspect project health
npx img-upload-kit doctor --fix        # Safely merge missing .env.example keys & AGENTS.md section
npx img-upload-kit doctor --fix --dry-run
npx img-upload-kit doctor --json       # Machine-readable DoctorReport JSON (CI-friendly)
```

### `validate`, `agents` & `config`

```bash
# Validate project integration checks (or pass -f/--manifest to validate a blur JSON manifest):
npx img-upload-kit validate
npx img-upload-kit validate --cwd ./apps/web

# Create AGENTS.md or update only the <!-- img-upload-kit:start/end --> block:
npx img-upload-kit agents
npx img-upload-kit agents --update --dry-run

# Print detected & resolved 4-layer architecture JSON with sensitive env keys marked redacted:
npx img-upload-kit config
```

---

## 2. Static Blur Manifest Commands

Pre-compute WebP LQIP data URLs, BlurHash strings, and 4-edge ambient colors for static public assets (`public/images` -> `src/blur-hashes.json` by default):

```bash
# Scan images and build manifest (-c concurrency, -f force rebuild, --no-medium skips 128px LQIP):
npx img-upload-kit generate -d public/images -o src/blur-hashes.json -c 4

# Validate manifest schema and base64/BlurHash entries:
npx img-upload-kit validate -f src/blur-hashes.json

# Verify disk <-> manifest parity (exits 1 in CI if out of sync; --fix adds missing & prunes orphans):
npx img-upload-kit sync -d public/images -f src/blur-hashes.json --fix

# Remove orphaned entries for deleted images (preview first with --dry-run):
npx img-upload-kit cleanup -d public/images -f src/blur-hashes.json --dry-run

# Coverage report & single-key inspection:
npx img-upload-kit health -d public/images -f src/blur-hashes.json
npx img-upload-kit inspect /hero/banner.jpg -f src/blur-hashes.json
```

---

## 3. 4-Layer Architecture Detection & File Safety

When `init`, `doctor`, `validate`, `agents`, or `config` runs, `detectProject` + `resolveArchitecture` + `planDependencies` inspect four independent layers:

1. **Frontend Layer**: Detects `nextjs`, `nuxt`, `angular`, `expo`, `react-native`, `vue`, `react`, `vite`, or `none`.
2. **Backend & Sharp Runtime Check**: Distinguishes Sharp-capable Node runtimes (`nextjs-node`, `nuxt-server`, `node`, `express`, `fastify`, `hono`, `nestjs`, `aws-lambda`, `firebase-functions`) from `frontend-only` SPAs, `cloudflare-workers`, and `vercel-edge`. Browser-only Vite apps, React Native apps, and Edge runtimes **never** receive `sharp` in their install plan (`img-upload-kit/server/handler` is recommended on Edge).
3. **Storage Layer**: Detects configured providers from `package.json`, config files, and key names in allowlisted template files.
4. **CDN & Auth Layer**: Recognizes CloudFront, Cloudflare, and Supabase CDNs alongside Auth.js/NextAuth, Clerk, Supabase Auth, Lucia, and Firebase Auth to tailor guidance.

### Zero Secret Exposure & Non-Destructive Merging

- **Secret-Safe Env Inspection**: The CLI **only** reads key names from `.env.example`, `.env.sample`, and `.env.template`. Secret-bearing `.env`, `.env.local`, and `.env.production` files are never read.
- **Safe `.env.example` Merging**: Appends only missing placeholder keys, preserves line endings (`LF`/`CRLF`), and blocks secret-like keys (`SECRET`, `SERVICE_ROLE`, `PRIVATE_KEY`, `ACCESS_KEY_ID`, etc.) if prefixed with `NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`, or `NUXT_PUBLIC_`.
- **Marker-Based `AGENTS.md` Updates**: Managed guidance is fenced between `<!-- img-upload-kit:start -->` and `<!-- img-upload-kit:end -->`. Running `agents --update` or `doctor --fix` updates only the fenced block and never overwrites custom team rules outside those markers.

---

## 4. Storage Provider Support Matrix

The CLI reports storage capabilities transparently across three tiers:

| Tier | Provider IDs | CLI & Runtime Behavior |
| --- | --- | --- |
| **Native Built-In** | `local`, `s3`, `supabase`, `memory` | Uses built-in factories from `img-upload-kit/storage` (`createLocalFsStorageAdapter`, `createS3StorageAdapter`, `createSupabaseStorageAdapter`, `createMemoryStorageAdapter`). |
| **Verified S3-Compatible** | `r2`, `minio`, `spaces`, `b2`, `custom-s3` | Uses `createS3StorageAdapter` + `@aws-sdk/client-s3` configured with the provider's S3 endpoint (`region: 'auto'` for R2, `forcePathStyle: true` for MinIO). |
| **Custom `StorageAdapter` Scaffold** | `gcs`, `azure-blob`, `firebase` | No built-in adapter ships in core; CLI reports `storage: 'custom'` and `--scaffold` generates a typed `createStorageAdapter(...)` wrapper for `@google-cloud/storage`, `@azure/storage-blob`, or `firebase-admin`. |

---

## 5. Programmatic CLI API (`img-upload-kit/cli`)

Importing `img-upload-kit/cli` has zero side effects, allowing build scripts and custom tooling to run detection, diagnostics, or manifest generation directly:

```ts
import {
  detectProject,
  generateBlurManifest,
  planDependencies,
  resolveArchitecture,
  runDoctor,
} from 'img-upload-kit/cli';

const detected = await detectProject(process.cwd());
const architecture = resolveArchitecture(detected);
const deps = planDependencies(detected, architecture);
const health = await runDoctor({ cwd: process.cwd(), dryRun: true });

if (health.ok) {
  await generateBlurManifest('public/images', 'src/blur-hashes.json', { concurrency: 4 });
}
console.log(architecture.storage, deps.installCommand);
```
