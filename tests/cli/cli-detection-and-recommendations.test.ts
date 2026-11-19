import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectProject,
  getRuntimeCapability,
  getStorageCapability,
  planDependencies,
  resolveArchitecture,
} from '../../src/cli';

interface FixtureSpec {
  pkg?: Record<string, unknown>;
  files?: Record<string, string>;
}

describe('CLI 4-layer detection, honest capabilities & recommendations', () => {
  const tempDirs: string[] = [];

  async function makeFixture(spec: FixtureSpec): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-7b-det-'));
    tempDirs.push(dir);
    if (spec.pkg) {
      await fs.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify(spec.pkg, null, 2),
        'utf8',
      );
    }
    for (const [rel, content] of Object.entries(spec.files ?? {})) {
      const target = path.join(dir, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
    }
    return dir;
  }

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) await fs.rm(d, { recursive: true, force: true });
    }
  });

  it('enforces honest storage capability metadata (never claims native GCS/Azure/Firebase)', () => {
    for (const id of ['local', 's3', 'supabase', 'memory'] as const) {
      const cap = getStorageCapability(id);
      expect(cap.supportLevel).toBe('native');
      expect(cap.nativeAdapterAvailable).toBe(true);
      expect(cap.requiresCustomAdapter).toBe(false);
    }
    for (const id of ['r2', 'minio', 'spaces', 'b2', 'custom-s3'] as const) {
      const cap = getStorageCapability(id);
      expect(cap.supportLevel).toBe('verified-s3-compatible');
      expect(cap.requiresCustomAdapter).toBe(false);
    }
    for (const id of ['gcs', 'azure-blob', 'firebase'] as const) {
      const cap = getStorageCapability(id);
      expect(cap.supportLevel).toBe('custom-adapter-required');
      expect(cap.nativeAdapterAvailable).toBe(false);
      expect(cap.requiresCustomAdapter).toBe(true);
    }
    expect(getRuntimeCapability('cloudflare-workers').supportsSharp).toBe(false);
    expect(getRuntimeCapability('vercel-edge').supportsSharp).toBe(false);
    expect(getRuntimeCapability('frontend-only').supportsSharp).toBe(false);
    expect(getRuntimeCapability('nextjs-node').supportsSharp).toBe(true);
  });

  it('detects Next.js + S3, R2, and Supabase topologies accurately', async () => {
    // 1. Next + S3
    const nextS3 = await makeFixture({
      pkg: { dependencies: { next: '15.0.0', react: '19.0.0', 'react-dom': '19.0.0', '@aws-sdk/client-s3': '^3.0.0' } },
      files: { '.env.example': 'AWS_REGION=us-east-1\nAWS_S3_BUCKET=bucket\n', 'pnpm-lock.yaml': '' },
    });
    const r1 = await detectProject(nextS3);
    const rec1 = resolveArchitecture(r1);
    const dep1 = planDependencies(r1, rec1);
    expect(r1.frontend.detected).toBe('nextjs');
    expect(r1.backend.detected).toBe('nextjs-node');
    expect(r1.storage.detected).toBe('s3');
    expect(rec1.storageCapability.supportLevel).toBe('native');
    expect(dep1.pm).toBe('pnpm');
    expect(dep1.toInstall).toEqual(['img-upload-kit', 'sharp']);
    expect(dep1.alreadyInstalled).toContain('@aws-sdk/client-s3');

    // 2. Next + R2
    const nextR2 = await makeFixture({
      pkg: { dependencies: { next: '15.0.0', react: '19.0.0', 'react-dom': '19.0.0' } },
      files: { '.env.example': 'R2_ACCOUNT_ID=abc\nR2_BUCKET=media\n' },
    });
    const r2 = await detectProject(nextR2);
    const rec2 = resolveArchitecture(r2);
    expect(r2.storage.detected).toBe('r2');
    expect(rec2.storageCapability.supportLevel).toBe('verified-s3-compatible');
    expect(planDependencies(r2, rec2).toInstall).toContain('@aws-sdk/client-s3');

    // 3. Next + Supabase + Auth
    const nextSb = await makeFixture({
      pkg: { dependencies: { next: '15.0.0', react: '19.0.0', '@supabase/supabase-js': '^2.0.0', '@supabase/ssr': '^0.5.0' } },
    });
    const r3 = await detectProject(nextSb);
    const rec3 = resolveArchitecture(r3);
    expect(r3.storage.detected).toBe('supabase');
    expect(r3.auth.detected).toBe('supabase-auth');
    expect(rec3.reusedInfrastructure).toContain('Supabase Storage');
    expect(rec3.reusedInfrastructure).toContain('Auth (supabase-auth)');
  });

  it('detects React+Express+S3, React+Fastify, Vue+Nuxt, Angular, and RN+Expo', async () => {
    // 4. React + Express + S3
    const reactExp = await makeFixture({
      pkg: { dependencies: { react: '19.0.0', express: '5.0.0', '@aws-sdk/client-s3': '^3.0.0' } },
    });
    const d4 = await detectProject(reactExp);
    expect(d4.frontend.detected).toBe('react');
    expect(d4.backend.detected).toBe('express');
    expect(d4.storage.detected).toBe('s3');

    // 5. React + Fastify custom backend
    const reactFastify = await makeFixture({
      pkg: { dependencies: { react: '19.0.0', fastify: '5.0.0' } },
    });
    const d5 = await detectProject(reactFastify);
    expect(d5.backend.detected).toBe('fastify');
    expect(resolveArchitecture(d5).storage).toBe('local');

    // 6. Vue + Nuxt
    const nuxt = await makeFixture({
      pkg: { dependencies: { nuxt: '4.0.0', vue: '3.5.0' } },
      files: { 'nuxt.config.ts': 'export default {}' },
    });
    const d6 = await detectProject(nuxt);
    expect(d6.frontend.detected).toBe('nuxt');
    expect(d6.backend.detected).toBe('nuxt-server');
    expect(resolveArchitecture(d6).runtimeCapability.supportsSharp).toBe(true);

    // 7. Angular + external API
    const ng = await makeFixture({
      pkg: { dependencies: { '@angular/core': '19.0.0' } },
      files: { 'angular.json': '{}' },
    });
    const d7 = await detectProject(ng);
    const rec7 = resolveArchitecture(d7);
    expect(d7.frontend.detected).toBe('angular');
    expect(d7.backend.detected).toBe('frontend-only');
    expect(planDependencies(d7, rec7).toInstall).not.toContain('sharp');

    // 8. RN + Expo
    const expo = await makeFixture({
      pkg: { dependencies: { expo: '52.0.0', 'react-native': '0.76.0' } },
      files: { 'app.json': '{}' },
    });
    const d8 = await detectProject(expo);
    const dep8 = planDependencies(d8, resolveArchitecture(d8));
    expect(d8.frontend.detected).toBe('expo');
    expect(dep8.toInstall).toContain('expo-image-picker');
    expect(dep8.toInstall).not.toContain('sharp');
  });

  it('detects GCS, Azure Blob, Firebase, MinIO, and Custom S3 honestly', async () => {
    // 9. GCS
    const gcsDir = await makeFixture({
      pkg: { dependencies: { next: '15.0.0', '@google-cloud/storage': '^7.0.0' } },
    });
    const recGcs = resolveArchitecture(await detectProject(gcsDir));
    expect(recGcs.storage).toBe('gcs');
    expect(recGcs.requiresCustomAdapter).toBe(true);

    // 10. Azure Blob
    const azDir = await makeFixture({
      pkg: { dependencies: { express: '5.0.0', '@azure/storage-blob': '^12.0.0' } },
    });
    const recAz = resolveArchitecture(await detectProject(azDir));
    expect(recAz.storage).toBe('azure-blob');
    expect(recAz.requiresCustomAdapter).toBe(true);

    // 11. Firebase
    const fbDir = await makeFixture({
      pkg: { dependencies: { 'firebase-admin': '^13.0.0', 'firebase-functions': '^6.0.0' } },
      files: { 'firebase.json': '{}' },
    });
    const dFb = await detectProject(fbDir);
    const recFb = resolveArchitecture(dFb);
    expect(dFb.backend.detected).toBe('firebase-functions');
    expect(recFb.storage).toBe('firebase');
    expect(recFb.requiresCustomAdapter).toBe(true);

    // 12. MinIO
    const minioDir = await makeFixture({
      pkg: { dependencies: { express: '5.0.0' } },
      files: { '.env.example': 'MINIO_ENDPOINT=http://localhost:9000\nMINIO_BUCKET=img\n' },
    });
    const recMinio = resolveArchitecture(await detectProject(minioDir));
    expect(recMinio.storage).toBe('minio');
    expect(recMinio.storageCapability.supportLevel).toBe('verified-s3-compatible');

    // 13. Custom S3
    const customS3Dir = await makeFixture({
      pkg: { dependencies: { hono: '^4.0.0' } },
      files: { '.env.example': 'S3_ENDPOINT=https://s3.custom.dev\nS3_BUCKET=media\n' },
    });
    const recCustom = resolveArchitecture(await detectProject(customS3Dir));
    expect(recCustom.storage).toBe('custom-s3');
    expect(recCustom.storageCapability.supportLevel).toBe('verified-s3-compatible');
  });

  it('handles Frontend-only Vite, Monorepo, Ambiguous storage, Workers & NEVER reads .env secrets', async () => {
    // 14. Frontend-only Vite
    const viteDir = await makeFixture({
      pkg: { devDependencies: { vite: '^6.0.0' }, dependencies: { react: '19.0.0' } },
      files: { 'vite.config.ts': 'export default {}', '.env': 'AWS_SECRET_ACCESS_KEY=super-secret-value\n' },
    });
    const dVite = await detectProject(viteDir);
    const recVite = resolveArchitecture(dVite);
    const depVite = planDependencies(dVite, recVite);
    expect(dVite.backend.detected).toBe('frontend-only');
    expect(dVite.envFiles).toEqual([]); // .env MUST NEVER be read!
    expect(recVite.requiresSeparateProcessingBackend).toBe(true);
    expect(depVite.toInstall).not.toContain('sharp');
    expect(depVite.skippedServerDeps).toContain('sharp');

    // 15. Monorepo
    const monoRoot = await makeFixture({
      pkg: { private: true, workspaces: ['apps/*'] },
      files: {
        'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
        'apps/web/package.json': JSON.stringify({ dependencies: { next: '15.0.0', '@aws-sdk/client-s3': '^3.0.0' } }),
      },
    });
    const dMono = await detectProject(path.join(monoRoot, 'apps', 'web'));
    expect(dMono.packageManager).toBe('pnpm');
    expect(dMono.monorepo.isMonorepo).toBe(true);
    expect(dMono.monorepo.tool).toBe('pnpm');

    // 18. Ambiguous infra (S3 + Supabase)
    const ambigDir = await makeFixture({
      pkg: { dependencies: { next: '15.0.0', '@aws-sdk/client-s3': '^3.0.0', '@supabase/supabase-js': '^2.0.0' } },
    });
    const dAmbig = await detectProject(ambigDir);
    const recAmbig = resolveArchitecture(dAmbig);
    expect(dAmbig.ambiguousStorage.length).toBeGreaterThanOrEqual(2);
    expect(recAmbig.knownLimitations.some((l) => l.includes('Multiple storage providers'))).toBe(true);

    // 19. Cloudflare Workers (unsupported Sharp runtime)
    const workerDir = await makeFixture({
      pkg: { dependencies: { hono: '^4.0.0' }, devDependencies: { wrangler: '^4.0.0' } },
      files: { 'wrangler.toml': 'name = "upload-worker"\n' },
    });
    const dWorker = await detectProject(workerDir);
    const recWorker = resolveArchitecture(dWorker);
    const depWorker = planDependencies(dWorker, recWorker);
    expect(dWorker.backend.detected).toBe('cloudflare-workers');
    expect(recWorker.storage).toBe('r2');
    expect(recWorker.runtimeCapability.supportsSharp).toBe(false);
    expect(recWorker.requiresSeparateProcessingBackend).toBe(true);
    expect(depWorker.toInstall).not.toContain('sharp');
  });
});
