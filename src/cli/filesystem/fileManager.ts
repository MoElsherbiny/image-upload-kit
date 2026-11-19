import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  FileConflict,
  FileWritePreview,
  FileWriteResult,
  PlannedFile,
} from '../types/architecture';

export type EolStyle = '\r\n' | '\n';

export function detectEol(content: string): EolStyle {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

export function normalizeEol(content: string, eol: EolStyle): string {
  const lf = content.replace(/\r\n/g, '\n');
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

export async function planFileWrites(
  rootDir: string,
  files: readonly PlannedFile[],
): Promise<FileWritePreview> {
  const toCreate: string[] = [];
  const toUpdate: string[] = [];
  const unchanged: string[] = [];
  const conflicts: FileConflict[] = [];

  for (const file of files) {
    const absPath = path.resolve(rootDir, file.relativePath);
    const existing = await readFileIfExists(absPath);
    if (existing === null) {
      toCreate.push(file.relativePath);
      continue;
    }
    const targetEol = detectEol(existing);
    const normalizedNew = normalizeEol(file.content, targetEol);
    if (existing === normalizedNew) {
      unchanged.push(file.relativePath);
      continue;
    }
    if (file.mode === 'merge' || file.mode === 'overwrite') {
      toUpdate.push(file.relativePath);
    } else {
      conflicts.push({ relativePath: file.relativePath, reason: 'exists-different' });
    }
  }

  return { toCreate, toUpdate, unchanged, conflicts };
}

export interface ApplyFileWritesOptions {
  dryRun?: boolean;
  overwrite?: boolean;
  /** Internal test hook to simulate write failure and verify rollback */
  failAtRelativePath?: string;
}

interface RollbackRecord {
  absPath: string;
  previousContent: string | null;
}

export async function applyFileWrites(
  rootDir: string,
  files: readonly PlannedFile[],
  options: ApplyFileWritesOptions = {},
): Promise<FileWriteResult> {
  const dryRun = Boolean(options.dryRun);
  const overwrite = Boolean(options.overwrite);
  const written: string[] = [];
  const skipped: string[] = [];
  const conflicts: FileConflict[] = [];
  const rollbackLog: RollbackRecord[] = [];

  try {
    for (const file of files) {
      const absPath = path.resolve(rootDir, file.relativePath);
      const existing = await readFileIfExists(absPath);
      const eol: EolStyle =
        existing !== null ? detectEol(existing) : process.platform === 'win32' ? '\r\n' : '\n';
      const contentToWrite = normalizeEol(file.content, eol);

      if (existing !== null && existing === contentToWrite) {
        skipped.push(file.relativePath);
        continue;
      }

      if (
        existing !== null &&
        !overwrite &&
        file.mode !== 'merge' &&
        file.mode !== 'overwrite'
      ) {
        conflicts.push({ relativePath: file.relativePath, reason: 'exists-different' });
        skipped.push(file.relativePath);
        continue;
      }

      if (dryRun) {
        written.push(file.relativePath);
        continue;
      }

      if (options.failAtRelativePath === file.relativePath) {
        throw new Error(`Simulated write failure for ${file.relativePath}`);
      }

      await fs.mkdir(path.dirname(absPath), { recursive: true });
      rollbackLog.push({ absPath, previousContent: existing });
      await fs.writeFile(absPath, contentToWrite, 'utf8');
      written.push(file.relativePath);
    }

    return { dryRun, written, skipped, conflicts, rolledBack: false };
  } catch (error) {
    // Roll back any files modified in this transaction
    for (let i = rollbackLog.length - 1; i >= 0; i -= 1) {
      const rec = rollbackLog[i];
      try {
        if (rec.previousContent === null) {
          await fs.rm(rec.absPath, { force: true });
        } else {
          await fs.writeFile(rec.absPath, rec.previousContent, 'utf8');
        }
      } catch {
        // Best-effort rollback
      }
    }
    throw Object.assign(
      error instanceof Error ? error : new Error(String(error)),
      { rolledBack: true },
    );
  }
}
