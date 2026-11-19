import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInteractiveInit } from '../../src/cli';

function createCapturedStreams() {
  const input = new PassThrough() as PassThrough & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  input.isTTY = true;
  input.setRawMode = vi.fn();

  const chunks: string[] = [];
  const output = new PassThrough() as PassThrough & {
    isTTY?: boolean;
    getOutput: () => string;
  };
  output.isTTY = false;
  output.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
  output.getOutput = () => chunks.join('');

  return { input, output };
}

describe('CLI init storage reporting for detected cloud & custom-adapter providers (L-6)', () => {
  const tempDirs: string[] = [];

  async function makeFixture(
    pkg: Record<string, unknown>,
    files: Record<string, string> = {},
  ): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-init-storage-'));
    tempDirs.push(dir);
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
    }
    return dir;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reports custom storage (not local) and prints custom StorageAdapter guidance for Express + @google-cloud/storage', async () => {
    const dir = await makeFixture({
      name: 'express-gcs-fixture',
      dependencies: {
        express: '^4.21.0',
        '@google-cloud/storage': '^7.14.0',
      },
    });
    const { input, output } = createCapturedStreams();

    const result = await runInteractiveInit({
      cwd: dir,
      yes: true,
      install: false,
      scaffold: true,
      dryRun: true,
      input,
      output,
    });

    expect(result.cancelled).toBe(false);
    expect(result.framework).toBe('server');
    expect(result.storage).toBe('custom');
    expect(result.storage).not.toBe('local');

    const printed = output.getOutput();
    expect(printed).toContain('Google Cloud Storage (Custom StorageAdapter)');
    expect(printed).toContain("import type { StorageAdapter } from 'img-upload-kit/storage';");
    expect(printed).not.toContain('createLocalFsStorageAdapter');
  });

  it('reports custom storage honestly for Azure Blob and Firebase Storage fixtures', async () => {
    const azureDir = await makeFixture({
      name: 'express-azure-fixture',
      dependencies: {
        express: '^4.21.0',
        '@azure/storage-blob': '^12.24.0',
      },
    });
    const azureStreams = createCapturedStreams();
    const azureRes = await runInteractiveInit({
      cwd: azureDir,
      yes: true,
      install: false,
      input: azureStreams.input,
      output: azureStreams.output,
    });
    expect(azureRes.storage).toBe('custom');
    expect(azureStreams.output.getOutput()).toContain('Azure Blob Storage');
    expect(azureStreams.output.getOutput()).not.toContain('createLocalFsStorageAdapter');

    const firebaseDir = await makeFixture(
      {
        name: 'next-firebase-fixture',
        dependencies: {
          next: '^15.0.0',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          'firebase-admin': '^13.0.0',
        },
      },
      { '.env.example': 'FIREBASE_STORAGE_BUCKET=demo.appspot.com\n' },
    );
    const fbStreams = createCapturedStreams();
    const fbRes = await runInteractiveInit({
      cwd: firebaseDir,
      yes: true,
      install: false,
      input: fbStreams.input,
      output: fbStreams.output,
    });
    expect(fbRes.storage).toBe('custom');
    expect(fbStreams.output.getOutput()).toContain('Firebase Storage');
    expect(fbStreams.output.getOutput()).not.toContain('createLocalFsStorageAdapter');
  });

  it('reports native/S3-compatible storage when 4-layer detector finds S3 or Supabase', async () => {
    const s3Dir = await makeFixture(
      { name: 'hono-r2-fixture', dependencies: { hono: '^4.6.0' } },
      { '.env.example': 'R2_ACCOUNT_ID=acct\nR2_BUCKET=assets\n' },
    );
    const s3Streams = createCapturedStreams();
    const s3Res = await runInteractiveInit({
      cwd: s3Dir,
      yes: true,
      install: false,
      input: s3Streams.input,
      output: s3Streams.output,
    });
    expect(s3Res.storage).toBe('s3');
    expect(s3Streams.output.getOutput()).toContain('createS3StorageAdapter');

    const sbDir = await makeFixture({
      name: 'next-supabase-fixture',
      dependencies: {
        next: '^15.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        '@supabase/supabase-js': '^2.45.0',
      },
    });
    const sbStreams = createCapturedStreams();
    const sbRes = await runInteractiveInit({
      cwd: sbDir,
      yes: true,
      install: false,
      input: sbStreams.input,
      output: sbStreams.output,
    });
    expect(sbRes.storage).toBe('supabase');
    expect(sbStreams.output.getOutput()).toContain('createSupabaseStorageAdapter');
  });
});
