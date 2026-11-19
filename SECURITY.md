# Security Policy

## Supported Versions

Only the latest `2.x` release line of `img-upload-kit` receives security updates.

| Version | Supported |
|---|---|
| `2.x` | ✅ Supported |
| `< 2.0.0` | ❌ Upgrade to `>= 2.x` |

---

## Supply-Chain & Runtime Security Architecture

- **Zero Runtime Dependencies**: `img-upload-kit` ships with `"dependencies": {}` in `package.json`. All UI frameworks (`react`, `vue`, `@angular/core`, `react-native`) and native server encoders (`sharp`) are optional peer dependencies.
- **No `eval` or Dynamic Code Execution**: Verified on every build by `scripts/check-dist.mjs`.
- **No Install Scripts**: `img-upload-kit` defines no `preinstall`, `install`, or `postinstall` lifecycle hooks and is published with `--provenance --ignore-scripts` via GitHub Actions OIDC provenance.
- **Defense-in-Depth Upload Verification**:
  - Magic-byte signature sniffing (`sniffImageFormat`) validates every upload buffer through `createImageUploader` (direct, presigned-finalize, and resumable) before decoding, and `createMultipartUploadHandler` validates assembled objects on completion (`validateOnComplete: true` by default when `storage.download` is supported).
  - SVG uploads are disabled by default (`allowSvg: false`) and sanitized through an allowlist XML sanitizer (`sanitizeSvg`) when explicitly enabled.
  - Sharp pixel-bomb protection (`limitInputPixels: 50_000_000`) and bounded concurrency (`AsyncSemaphore`) prevent memory exhaustion.
  - Presigned upload tokens (`signUploadToken` / `verifyUploadToken`) use WebCrypto HMAC-SHA256 with constant-time secret rotation, subject (`sub`) ownership binding, verify-before-consume replay protection, and support for dedicated private `presigned.stagingBucket` isolation.
  - Rate-limit IP fallback ignores untrusted `X-Forwarded-For` headers unless `trustProxy` is explicitly opted in; delete routes support per-user path ownership enforcement via `authorize` (see `docs/SECURITY_GUIDE.md`).

---

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report vulnerabilities privately via:
- **Email**: `mo@buildwithsherbo.com`
- **GitHub Private Vulnerability Reporting**: `https://github.com/MoElsherbiny/image-upload-kit/security/advisories/new`

Include a minimal reproduction, affected version, and impact description. You will receive an acknowledgment within 48 hours.
