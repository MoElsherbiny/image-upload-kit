# Security Policy

## Supported Versions

Only the latest `2.x` release line of `img-upload-kit` receives security updates.

| Version | Supported |
|---|---|
| `2.2.x` | ✅ Supported |
| `2.1.x` | ✅ Supported |
| `< 2.1.0` | ❌ Upgrade to `>= 2.2.0` |

---

## Supply-Chain & Runtime Security Architecture

- **Zero Runtime Dependencies**: `img-upload-kit` ships with `"dependencies": {}` in `package.json`. All UI frameworks (`react`, `vue`, `@angular/core`, `react-native`) and native server encoders (`sharp`) are optional peer dependencies.
- **No `eval` or Dynamic Code Execution**: Verified on every build by `scripts/check-dist.mjs`.
- **No Install Scripts**: `img-upload-kit` defines no `preinstall`, `install`, or `postinstall` lifecycle hooks and is published with `--provenance --ignore-scripts` via GitHub Actions OIDC provenance.
- **Defense-in-Depth Upload Verification**:
  - Magic-byte signature sniffing (`sniffImageFormat`) validates every upload buffer against allowed image formats before decoding.
  - SVG uploads are disabled by default (`allowSvg: false`) and sanitized through an allowlist sanitizer (`sanitizeSvg`) when explicitly enabled.
  - Sharp pixel-bomb protection (`limitInputPixels: 50_000_000`) and bounded concurrency (`createSemaphore`) prevent memory exhaustion.
  - Presigned upload tokens (`signUploadToken` / `verifyUploadToken`) use WebCrypto HMAC-SHA256 with constant-time comparison, short TTLs, and single-use replay protection.

---

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report vulnerabilities privately via:
- **Email**: `mo@buildwithsherbo.com`
- **GitHub Private Vulnerability Reporting**: `https://github.com/MoElsherbiny/image-upload-kit/security/advisories/new`

Include a minimal reproduction, affected version, and impact description. You will receive an acknowledgment within 48 hours.
