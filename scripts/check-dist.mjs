/**
 * Post-build integrity checks for the published `dist/` output.
 *
 *   node scripts/check-dist.mjs        # exits 1 on any failure
 *
 * The pure `runDistChecks()` function is also imported by
 * `tests/dist-smoke.test.ts`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLIENT_ENTRIES = ['react', 'headless'];
const SERVER_SAFE_ENTRIES = [
  'index',
  'client',
  'server',
  'server-handler',
  'storage',
  'blur',
  'angular',
];
const REACT_IMPORT_RE =
  /(?:from\s*|import\s*\(\s*|require\(\s*)["']react(?:\/jsx-runtime|-dom)?["']/;
const REACT_DOM_IMPORT_RE =
  /(?:from\s*|import\s*\(\s*|require\(\s*)["']react-dom["']/;
const SHARP_IMPORT_RE =
  /(?:from\s*|import\s*\(\s*|require\(\s*)["'](?:sharp|lqip-modern)["']/;
const FS_IMPORT_RE =
  /(?:from\s*|import\s*\(\s*|require\(\s*)["'](?:node:)?fs(?:\/promises)?["']/;
const CANVAS_RE = /createElement\(\s*["']canvas["']\s*\)|decodeBlurHashToDataURL/;
const LOCAL_IMPORT_RE =
  /(?:from\s*|import\s*\(\s*|require\(\s*|^import\s*)["'](\.\/[^"']+)["']/gm;
const CONTEXT_DEF_RE = /\bImageUploadContext\s*=\s*(?:\(0,\s*)?[\w$.]*createContext/g;
const NATIVE_CONTEXT_DEF_RE =
  /\bNativeImageUploadContext\s*=\s*(?:\(0,\s*)?[\w$.]*createContext/g;

function read(distDir, file) {
  return readFileSync(path.join(distDir, file), 'utf8');
}

/** Transitive closure of relative imports starting at `file` (inside distDir). */
export function collectGraph(distDir, file) {
  const seen = new Set();
  const stack = [file];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current) || !existsSync(path.join(distDir, current))) continue;
    seen.add(current);
    const code = read(distDir, current);
    for (const match of code.matchAll(LOCAL_IMPORT_RE)) {
      stack.push(path.posix.normalize(match[1]));
    }
  }
  return [...seen];
}

function startsWithUseClient(code) {
  return /^["']use client["'];?/.test(code);
}

function collectExportTargets(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectExportTargets(value, out);
  }
  return out;
}

/**
 * Runs every static dist assertion.
 * @returns {{ failures: string[], passes: string[] }}
 */
export function runDistChecks(rootDir = process.cwd()) {
  const distDir = path.join(rootDir, 'dist');
  const failures = [];
  const passes = [];
  const check = (ok, message) => (ok ? passes : failures).push(message);

  if (!existsSync(distDir)) {
    return { failures: ['dist/ does not exist — run `npm run build` first'], passes };
  }

  const files = readdirSync(distDir);
  for (const ext of ['js', 'cjs']) {
    const jsFiles = files.filter((file) => file.endsWith(`.${ext}`));

    // 1. 'use client' is the first statement of every client entry + React chunk.
    for (const entry of CLIENT_ENTRIES) {
      const file = `${entry}.${ext}`;
      check(
        existsSync(path.join(distDir, file)) && startsWithUseClient(read(distDir, file)),
        `'use client' is the first statement of dist/${file}`,
      );
    }
    for (const file of jsFiles.filter((name) => name.startsWith('chunk-'))) {
      const code = read(distDir, file);
      if (REACT_IMPORT_RE.test(code)) {
        check(startsWithUseClient(code), `'use client' is the first statement of React chunk dist/${file}`);
      }
    }

    // 2. Exactly one ImageUploadContext and one NativeImageUploadContext definition per module format.
    const contextDefs = jsFiles.reduce(
      (count, file) => count + (read(distDir, file).match(CONTEXT_DEF_RE)?.length ?? 0),
      0,
    );
    check(contextDefs === 1, `exactly one ImageUploadContext createContext() in *.${ext} (found ${contextDefs})`);

    const nativeContextDefs = jsFiles.reduce(
      (count, file) => count + (read(distDir, file).match(NATIVE_CONTEXT_DEF_RE)?.length ?? 0),
      0,
    );
    check(
      nativeContextDefs === 1,
      `exactly one NativeImageUploadContext createContext() in *.${ext} (found ${nativeContextDefs})`,
    );

    // 3. Exactly one blurService singleton instantiation per module format.
    const blurSingletons = jsFiles.reduce(
      (count, file) => count + (read(distDir, file).match(/blurService\s*=\s*new BlurService\(\)/g)?.length ?? 0),
      0,
    );
    check(blurSingletons === 1, `exactly one blurService singleton in *.${ext} (found ${blurSingletons})`);

    // 4. Server-safe & non-React entries never pull in React or 'use client';
    //    root/client/angular/react-native never pull in sharp / lqip-modern.
    for (const entry of SERVER_SAFE_ENTRIES) {
      const graph = collectGraph(distDir, `${entry}.${ext}`);
      const reactFiles = graph.filter((file) => {
        const code = read(distDir, file);
        return REACT_IMPORT_RE.test(code) || startsWithUseClient(code);
      });
      check(reactFiles.length === 0, `dist/${entry}.${ext} graph is free of React/'use client' ${reactFiles.join(', ')}`.trim());
    }
    const rootGraph = collectGraph(distDir, `index.${ext}`);
    const sharpFiles = rootGraph.filter((file) => SHARP_IMPORT_RE.test(read(distDir, file)));
    check(sharpFiles.length === 0, `dist/index.${ext} graph does not import sharp/lqip-modern ${sharpFiles.join(', ')}`.trim());

    const clientGraph = collectGraph(distDir, `client.${ext}`);
    const clientHeavyFiles = clientGraph.filter((file) => {
      const code = read(distDir, file);
      return SHARP_IMPORT_RE.test(code) || FS_IMPORT_RE.test(code) || CANVAS_RE.test(code);
    });
    check(
      clientHeavyFiles.length === 0,
      `dist/client.${ext} graph is free of sharp/fs/canvas ${clientHeavyFiles.join(', ')}`.trim(),
    );

    const rnGraph = collectGraph(distDir, `react-native.${ext}`);
    const rnDomFiles = rnGraph.filter((file) => {
      const code = read(distDir, file);
      return REACT_DOM_IMPORT_RE.test(code) || CANVAS_RE.test(code);
    });
    check(
      rnDomFiles.length === 0,
      `dist/react-native.${ext} graph is free of react-dom/canvas ${rnDomFiles.join(', ')}`.trim(),
    );

    const handlerGraph = collectGraph(distDir, `server-handler.${ext}`);
    const handlerHeavyFiles = handlerGraph.filter((file) => {
      const code = read(distDir, file);
      return SHARP_IMPORT_RE.test(code) || FS_IMPORT_RE.test(code);
    });
    check(
      handlerHeavyFiles.length === 0,
      `dist/server-handler.${ext} graph does not import sharp/lqip-modern/fs ${handlerHeavyFiles.join(', ')}`.trim(),
    );
  }

  // 5. Every package.json export target exists.
  const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const targets = [...new Set(collectExportTargets(pkg.exports))];
  for (const target of targets) {
    if (target.includes('*')) {
      const dir = path.join(rootDir, path.dirname(target));
      const suffix = path.basename(target).replace('*', '');
      const matches = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(suffix)) : [];
      check(matches.length > 0, `export pattern ${target} matches files (${matches.length})`);
    } else {
      check(existsSync(path.join(rootDir, target)), `export target ${target} exists`);
    }
  }
  for (const bin of Object.values(pkg.bin ?? {})) {
    check(existsSync(path.join(rootDir, bin)), `bin target ${bin} exists`);
  }

  return { failures, passes };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { failures, passes } = runDistChecks(rootDir);
  for (const message of passes) console.log(`  ok   ${message}`);
  for (const message of failures) console.error(`  FAIL ${message}`);
  console.log(`\ncheck-dist: ${passes.length} passed, ${failures.length} failed`);
  process.exit(failures.length > 0 ? 1 : 0);
}
