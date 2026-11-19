import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENTS_MARKER_END,
  AGENTS_MARKER_START,
  applyFileWrites,
  buildScaffoldPlan,
  detectProject,
  findPublicSecretEnvLeaks,
  mergeAgentsMarkdown,
  mergeEnvTemplateContent,
  planDependencies,
  planEnvTemplateMerge,
  planFileWrites,
  resolveArchitecture,
} from '../../src/cli';

describe('CLI generators, env safety, AGENTS.md markers & transactional FS', () => {
  const tempDirs: string[] = [];

  async function makeTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-7b-gen-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) await fs.rm(d, { recursive: true, force: true });
    }
  });

  it('reuses existing .env.template, merges only missing keys & blocks public secret leaks', async () => {
    // 17. Existing .env.template
    const dir = await makeTempDir();
    await fs.writeFile(
      path.join(dir, '.env.template'),
      '# Existing app env\r\nAWS_REGION=eu-west-1\r\nAPP_NAME=demo\r\n',
      'utf8',
    );

    const merge = await planEnvTemplateMerge(dir, [
      { key: 'AWS_REGION', placeholder: 'us-east-1', serverOnly: true },
      { key: 'AWS_S3_BUCKET', placeholder: 'my-bucket', serverOnly: true },
      { key: 'NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY', placeholder: 'bad', serverOnly: true },
    ]);

    expect(merge.targetFileName).toBe('.env.template');
    expect(merge.reusedKeys).toEqual(['AWS_REGION']);
    expect(merge.addedKeys).toEqual(['AWS_S3_BUCKET']);
    expect(merge.rejectedPublicSecrets).toEqual(['NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY']);
    expect(merge.mergedContent).toContain('AWS_REGION=eu-west-1');
    expect(merge.mergedContent).toContain('AWS_S3_BUCKET=my-bucket');
    expect(merge.mergedContent).not.toContain('NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY');
    // Preserves existing CRLF line endings
    expect(merge.mergedContent).toContain('\r\n');

    const unitMerge = mergeEnvTemplateContent(null, [
      { key: 'VITE_SUPABASE_SERVICE_ROLE_KEY', placeholder: 'nope', serverOnly: true },
      { key: 'VITE_UPLOAD_ENDPOINT', placeholder: 'https://api.example.com/upload' },
    ]);
    expect(unitMerge.rejectedPublicSecrets).toEqual(['VITE_SUPABASE_SERVICE_ROLE_KEY']);
    expect(unitMerge.addedKeys).toEqual(['VITE_UPLOAD_ENDPOINT']);
    expect(
      findPublicSecretEnvLeaks(['NEXT_PUBLIC_API_URL', 'EXPO_PUBLIC_R2_SECRET_ACCESS_KEY']),
    ).toEqual(['EXPO_PUBLIC_R2_SECRET_ACCESS_KEY']);
  });

  it('preserves 100% of existing AGENTS.md user content outside managed markers', () => {
    // 16. Existing AGENTS.md
    const existing = '# My Project Rules\n\n- Keep custom domain rules intact.\n';
    const firstPass = mergeAgentsMarkdown(existing, '## img-upload-kit\n- First version');
    expect(firstPass.hadMarkers).toBe(false);
    expect(firstPass.changed).toBe(true);
    expect(firstPass.content).toContain('# My Project Rules');
    expect(firstPass.content).toContain('Keep custom domain rules intact.');
    expect(firstPass.content).toContain(AGENTS_MARKER_START);
    expect(firstPass.content).toContain(AGENTS_MARKER_END);

    const secondPass = mergeAgentsMarkdown(
      firstPass.content,
      '## img-upload-kit\n- Updated version',
    );
    expect(secondPass.hadMarkers).toBe(true);
    expect(secondPass.changed).toBe(true);
    expect(secondPass.content).toContain('# My Project Rules');
    expect(secondPass.content).toContain('Keep custom domain rules intact.');
    expect(secondPass.content).toContain('Updated version');
    expect(secondPass.content).not.toContain('First version');

    const idempotent = mergeAgentsMarkdown(
      secondPass.content,
      '## img-upload-kit\n- Updated version',
    );
    expect(idempotent.changed).toBe(false);
  });

  it('supports preview, conflict detection, --dry-run, and transactional rollback on failure', async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, 'existing.ts'), '// user file\n', 'utf8');

    const planned = [
      { relativePath: 'existing.ts', content: '// generated\n', description: 'conflict file', mode: 'create' as const },
      { relativePath: 'src/new-file.ts', content: 'export const ok = true;\n', description: 'new file', mode: 'create' as const },
    ];

    const preview = await planFileWrites(dir, planned);
    expect(preview.conflicts).toEqual([{ relativePath: 'existing.ts', reason: 'exists-different' }]);
    expect(preview.toCreate).toEqual(['src/new-file.ts']);

    // Dry run must write nothing
    const dryRes = await applyFileWrites(dir, planned, { dryRun: true });
    expect(dryRes.dryRun).toBe(true);
    expect(dryRes.written).toEqual(['src/new-file.ts']);
    await expect(fs.access(path.join(dir, 'src/new-file.ts'))).rejects.toThrow();

    // Rollback on mid-batch failure must restore/delete earlier writes
    const batch = [
      { relativePath: 'a/first.ts', content: 'export const a = 1;\n', description: 'first', mode: 'create' as const },
      { relativePath: 'b/second.ts', content: 'export const b = 2;\n', description: 'second', mode: 'create' as const },
    ];
    await expect(
      applyFileWrites(dir, batch, { failAtRelativePath: 'b/second.ts' }),
    ).rejects.toThrow('Simulated write failure');
    await expect(fs.access(path.join(dir, 'a/first.ts'))).rejects.toThrow();
  });

  it('generates real img-upload-kit exports for Next+S3, GCS custom adapter, and Workers edge advisory', async () => {
    // Next.js + S3
    const nextDir = await makeTempDir();
    await fs.writeFile(
      path.join(nextDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0', '@aws-sdk/client-s3': '^3.0.0' } }),
      'utf8',
    );
    const nextReport = await detectProject(nextDir);
    const nextRec = resolveArchitecture(nextReport);
    const nextPlan = await buildScaffoldPlan(
      nextReport,
      nextRec,
      planDependencies(nextReport, nextRec),
    );
    const routeFile = nextPlan.find((f) => f.relativePath === 'app/api/upload/route.ts');
    const storageFile = nextPlan.find((f) => f.relativePath === 'src/lib/upload-storage.ts');
    expect(routeFile?.content).toContain("from 'img-upload-kit/server'");
    expect(routeFile?.content).toContain("export const runtime = 'nodejs'");
    expect(storageFile?.content).toContain('createS3StorageAdapter');

    // GCS custom StorageAdapter scaffold
    const gcsDir = await makeTempDir();
    await fs.writeFile(
      path.join(gcsDir, 'package.json'),
      JSON.stringify({ dependencies: { express: '5.0.0', '@google-cloud/storage': '^7.0.0' } }),
      'utf8',
    );
    const gcsReport = await detectProject(gcsDir);
    const gcsRec = resolveArchitecture(gcsReport);
    const gcsPlan = await buildScaffoldPlan(
      gcsReport,
      gcsRec,
      planDependencies(gcsReport, gcsRec),
    );
    const gcsStorage = gcsPlan.find((f) => f.relativePath === 'src/lib/upload-storage.ts');
    expect(gcsStorage?.content).toContain('StorageAdapter');
    expect(gcsStorage?.content).toContain('@google-cloud/storage');

    // Cloudflare Workers edge advisory (no Sharp storage file)
    const workerDir = await makeTempDir();
    await fs.writeFile(path.join(workerDir, 'wrangler.toml'), 'name = "w"\n', 'utf8');
    await fs.writeFile(
      path.join(workerDir, 'package.json'),
      JSON.stringify({ dependencies: { hono: '^4.0.0' } }),
      'utf8',
    );
    const wReport = await detectProject(workerDir);
    const wRec = resolveArchitecture(wReport);
    const wPlan = await buildScaffoldPlan(wReport, wRec, planDependencies(wReport, wRec));
    const edgeFile = wPlan.find((f) => f.relativePath === 'src/server/edge-upload-handler.ts');
    expect(edgeFile?.content).toContain("from 'img-upload-kit/server/handler'");
    expect(edgeFile?.content).toContain('cannot execute Sharp');
  });
});
