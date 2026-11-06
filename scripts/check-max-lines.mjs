/**
 * Enforces the repository-wide <= 300 lines guardrail across all source, test,
 * script, stylesheet, and documentation files.
 *
 *   node scripts/check-max-lines.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_LINES = 300;
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.pnpm-store',
]);
const CHECKED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.md',
]);
const IGNORED_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json']);

function walkDir(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkDir(full, out);
    } else if (
      !IGNORED_FILES.has(entry) &&
      CHECKED_EXTENSIONS.has(path.extname(entry))
    ) {
      out.push(full);
    }
  }
  return out;
}

export function runMaxLinesCheck(rootDir = process.cwd()) {
  const files = walkDir(rootDir);
  const violations = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/).length;
    // Allow trailing newline at line 301 if line 301 is empty, matching ESLint max-lines
    const effectiveLines =
      lines === MAX_LINES + 1 && content.endsWith('\n') ? MAX_LINES : lines;
    if (effectiveLines > MAX_LINES) {
      violations.push({
        file: path.relative(rootDir, file).replace(/\\/g, '/'),
        lines: effectiveLines,
      });
    }
  }

  return { checkedCount: files.length, violations };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  const { checkedCount, violations } = runMaxLinesCheck(rootDir);
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`  FAIL ${v.file}: ${v.lines} lines (max ${MAX_LINES})`);
    }
    process.exit(1);
  }
  console.log(
    `check-max-lines: ${checkedCount} files verified (all <= ${MAX_LINES} lines)`,
  );
}
