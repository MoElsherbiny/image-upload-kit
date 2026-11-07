import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeImagePath } from '../blur/pathMapper';
import type { BlurManifestData, BlurManifestEntry } from '../blur/types';
import { ZeroDepCliProgram } from './argv';
import { generateBlurManifest } from './generator';
import {
  type InitFramework,
  type InitStorageAdapter,
  type PackageManagerName,
  runInteractiveInit,
} from './init';
import {
  autoSyncCheck,
  cleanupOrphanedHashes,
  generateHealthReport,
  validateBlurHashFile,
} from './validation';

declare const __PKG_VERSION__: string | undefined;

const CLI_VERSION =
  typeof __PKG_VERSION__ === 'string' && __PKG_VERSION__.length > 0
    ? __PKG_VERSION__
    : '2.2.0';

const DEFAULT_IMAGES_DIR = 'public/images';
const DEFAULT_MANIFEST_FILE = 'src/blur-hashes.json';

function findManifestEntry(
  hashes: Record<string, BlurManifestEntry>,
  imageKey: string,
): { key: string; entry: BlurManifestEntry } | null {
  const candidates = [
    imageKey,
    normalizeImagePath(imageKey).normalizedPath,
    normalizeImagePath(imageKey, { stripPrefixes: [] }).normalizedPath,
  ];
  for (const candidate of candidates) {
    if (hashes[candidate]) return { key: candidate, entry: hashes[candidate] };
    const noSlash = candidate.replace(/^\/+/, '');
    if (hashes[noSlash]) return { key: noSlash, entry: hashes[noSlash] };
  }
  return null;
}

export function createCliProgram(): ZeroDepCliProgram {
  const program = new ZeroDepCliProgram();

  program
    .name('img-upload-kit')
    .description('Interactive framework setup + LQIP, BlurHash & dominant color CLI')
    .version(CLI_VERSION);

  const registerInitCommand = (cmdName: string) => {
    program
      .command(cmdName)
      .description('Interactive terminal dropdown to select framework, storage, and install packages')
      .option('-f, --framework <fw>', 'Target framework (react|vue|angular|react-native|server|client)')
      .option('-s, --storage <adapter>', 'Storage adapter (local|s3|supabase|memory)')
      .option('-p, --pm <pm>', 'Package manager (npm|pnpm|yarn|bun)')
      .option('-y, --yes', 'Accept detected defaults without interactive prompts', false)
      .option('--no-install', 'Print install command and starter imports without running install')
      .action(
        async (opts: {
          framework?: InitFramework;
          storage?: InitStorageAdapter;
          pm?: PackageManagerName;
          yes?: boolean;
          install?: boolean;
        }) => {
          await runInteractiveInit({
            framework: opts.framework,
            storage: opts.storage,
            pm: opts.pm,
            yes: Boolean(opts.yes),
            install: opts.install === false ? false : undefined,
            version: CLI_VERSION,
          });
        },
      );
  };

  registerInitCommand('init');
  registerInitCommand('setup');

  program
    .command('generate')
    .description('Scan an image directory and generate a blur-hashes JSON manifest')
    .option('-d, --dir <dir>', 'Source images directory', DEFAULT_IMAGES_DIR)
    .option('-o, --out <file>', 'Output manifest JSON path', DEFAULT_MANIFEST_FILE)
    .option('-f, --force', 'Force regenerate all entries ignoring cache', false)
    .option('-c, --concurrency <n>', 'Max parallel processing workers', '4')
    .option('--no-medium', 'Skip generating medium (128px) LQIP variants')
    .action(
      async (opts: {
        dir: string;
        out: string;
        force?: boolean;
        concurrency: string;
        medium: boolean;
      }) => {
        const concurrency = Math.max(1, Number.parseInt(opts.concurrency, 10) || 4);
        const result = await generateBlurManifest(opts.dir, opts.out, {
          concurrency,
          force: Boolean(opts.force),
          includeMedium: opts.medium,
        });
        console.log(
          `Generated ${result.outputPath} (total: ${result.manifest.totalImages}, processed: ${result.processed}, cached: ${result.cached}, failed: ${result.failed})`,
        );
      },
    );

  program
    .command('validate')
    .description('Validate a blur manifest JSON file')
    .option('-f, --file <file>', 'Manifest JSON path', DEFAULT_MANIFEST_FILE)
    .action(async (opts: { file: string }) => {
      const result = await validateBlurHashFile(opts.file);
      for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
      if (!result.valid) {
        for (const error of result.errors) console.error(`Error: ${error}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Manifest is valid (${result.totalEntries} entries).`);
    });

  program
    .command('sync')
    .description('Check whether disk images and manifest entries are in sync')
    .option('-d, --dir <dir>', 'Source images directory', DEFAULT_IMAGES_DIR)
    .option('-f, --file <file>', 'Manifest JSON path', DEFAULT_MANIFEST_FILE)
    .option('--fix', 'Generate missing and remove orphaned blur manifest entries automatically', false)
    .action(async (opts: { dir: string; file: string; fix?: boolean }) => {
      const sync = await autoSyncCheck(opts.dir, opts.file);
      if (sync.inSync) {
        console.log(`In sync (${sync.totalEntries} entries).`);
        return;
      }
      console.log(
        `Out of sync: ${sync.missingKeys.length} missing, ${sync.orphanedKeys.length} orphaned.`,
      );
      if (opts.fix) {
        if (sync.missingKeys.length > 0) {
          const result = await generateBlurManifest(opts.dir, opts.file);
          console.log(
            `Synced manifest (processed: ${result.processed}, cached: ${result.cached}, removed orphans: ${sync.orphanedKeys.length}).`,
          );
          return;
        }
        if (sync.orphanedKeys.length > 0) {
          const cleaned = await cleanupOrphanedHashes(opts.dir, opts.file);
          console.log(
            `Synced manifest (removed ${cleaned.removedCount} orphaned entries).`,
          );
          return;
        }
      }
      if (!opts.fix) process.exitCode = 1;
    });

  program
    .command('cleanup')
    .description('Remove orphaned entries from the blur manifest')
    .option('-d, --dir <dir>', 'Source images directory', DEFAULT_IMAGES_DIR)
    .option('-f, --file <file>', 'Manifest JSON path', DEFAULT_MANIFEST_FILE)
    .option('--dry-run', 'Preview orphaned keys without writing changes', false)
    .action(async (opts: { dir: string; file: string; dryRun?: boolean }) => {
      const result = await cleanupOrphanedHashes(opts.dir, opts.file, {
        dryRun: Boolean(opts.dryRun),
      });
      const prefix = result.dryRun ? '[Dry Run] Would remove' : 'Removed';
      console.log(`${prefix} ${result.removedCount} orphaned entries.`);
    });

  program
    .command('health')
    .description('Generate a comprehensive manifest health and coverage report')
    .option('-d, --dir <dir>', 'Source images directory', DEFAULT_IMAGES_DIR)
    .option('-f, --file <file>', 'Manifest JSON path', DEFAULT_MANIFEST_FILE)
    .action(async (opts: { dir: string; file: string }) => {
      const report = await generateHealthReport(opts.dir, opts.file);
      console.log(
        `Health: valid=${report.validManifest}, coverage=${report.coveragePercent}% (${report.totalManifestEntries} entries / ${report.totalImagesOnDisk} disk images)`,
      );
      for (const warning of report.warnings) console.warn(`Warning: ${warning}`);
      for (const error of report.errors) console.error(`Error: ${error}`);
      if (!report.validManifest || report.errors.length > 0) {
        process.exitCode = 1;
      }
    });

  program
    .command('inspect <imageKey>')
    .description('Inspect a single image entry inside the blur manifest')
    .option('-f, --file <file>', 'Manifest JSON path', DEFAULT_MANIFEST_FILE)
    .action(async (imageKey: string, opts: { file: string }) => {
      const raw = await fs.readFile(path.resolve(opts.file), 'utf8');
      const parsed = JSON.parse(raw) as Partial<BlurManifestData>;
      const match = parsed.hashes ? findManifestEntry(parsed.hashes, imageKey) : null;
      if (!match) {
        console.error(`Entry not found for key: ${imageKey}`);
        process.exitCode = 1;
        return;
      }
      console.log(
        JSON.stringify(
          {
            key: match.key,
            hash: match.entry.hash,
            color: match.entry.color,
            width: match.entry.width,
            height: match.entry.height,
            variants: {
              smallChars: match.entry.variants.small.length,
              mediumChars: match.entry.variants.medium?.length ?? 0,
              hasMedium: Boolean(match.entry.variants.medium),
            },
            metadata: match.entry.metadata,
          },
          null,
          2,
        ),
      );
    });

  return program;
}
