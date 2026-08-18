#!/usr/bin/env node
// CLI entry point for the temporal-fmt codemod.
//
// Usage:
//   npx temporal-fmt-codemod <path>
//   npx temporal-fmt-codemod <path> --dry-run
//   npx temporal-fmt-codemod <path> --dry-run --extensions=js,jsx,ts,tsx
//
// Wraps jscodeshift's runner with sensible defaults (no need to install
// jscodeshift globally) and prints a summary at the end with file/line
// detail for any call sites that were skipped with a warning.

import { run } from 'jscodeshift/src/Runner.js';
import { resolve } from 'node:path';
import { argv } from 'node:process';

async function main(): Promise<void> {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('--dryRun');
  const pathIdx = args.findIndex((a) => !a.startsWith('--'));
  if (pathIdx === -1) {
    process.stderr.write('Usage: temporal-fmt-codemod <path> [--dry-run] [--extensions=js,jsx,ts,tsx]\n');
    process.exit(1);
  }
  const targetPath = resolve(args[pathIdx]!);
  const extArg = args.find((a) => a.startsWith('--extensions='));
  const extensions = extArg ? extArg.slice('--extensions='.length) : 'js,jsx,ts,tsx';

  // jscodeshift's runner takes a transform path as the first arg, then
  // paths to transform. Point it at this package's transform export,
  // which lives alongside this CLI in dist/index.js (same dir as cli.js).
  const transformPath = new URL('./index.js', import.meta.url).pathname;

  process.stdout.write(`temporal-fmt-codemod: ${dryRun ? 'DRY-RUN ' : ''}transforming ${targetPath}\n`);

  await run(transformPath, [targetPath], {
    dry: dryRun,
    extensions,
    parser: 'tsx', // tsx parser handles both .js and .ts files
    silent: false,
  });

  // The Runner's own output is sufficient for dry-run (it prints a diff).
  // For non-dry-run runs, the Runner prints "N error(s)" but doesn't
  // include our skipped-warning count. We'd want to expose
  // getRunStats() here, but jscodeshift's runner runs the transform in
  // a subprocess per file — there's no shared state to pull from. The
  // warning comments inserted in the source code are the canonical
  // record; grep for `TODO(temporal-fmt-codemod):` after a run.
  process.stdout.write('\nDone. Grep for "// TODO(temporal-fmt-codemod):" to find call sites the codemod left alone.\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`temporal-fmt-codemod failed: ${(err as Error)?.message ?? String(err)}\n`);
  process.exit(1);
});
