export interface DistCheckResult {
  failures: string[];
  passes: string[];
}

/** Runs every static assertion against `<rootDir>/dist`. */
export function runDistChecks(rootDir?: string): DistCheckResult;

/** Transitive closure of relative imports starting at `file` inside `distDir`. */
export function collectGraph(distDir: string, file: string): string[];
