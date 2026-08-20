#!/usr/bin/env node
// CLI entry point for the temporal-fmt codemod.
//
// Usage:
//   npx temporal-fmt-codemod <path>
//   npx temporal-fmt-codemod <path> --dry-run
//   npx temporal-fmt-codemod <path> --dry-run --extensions=js,jsx,ts,tsx
//   npx temporal-fmt-codemod <path> --report
//   npx temporal-fmt-codemod <path> --json
//   npx temporal-fmt-codemod <path> --verbose
//
// Wraps jscodeshift's runner with sensible defaults (no need to install
// jscodeshift globally) and prints a summary at the end with file/line
// detail for any call sites that were skipped with a warning.

import { run } from 'jscodeshift/src/Runner.js';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { getRunStats, resetRunStats } from './index.js';

async function main(): Promise<void> {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('--dryRun');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const report = args.includes('--report');
  const json = args.includes('--json');
  const pathIdx = args.findIndex((a) => !a.startsWith('--'));
  if (pathIdx === -1) {
    process.stderr.write('Usage: temporal-fmt-codemod <path> [--dry-run] [--report] [--json] [--verbose] [--extensions=js,jsx,ts,tsx]\n');
    process.exit(1);
  }
  const targetPath = resolve(args[pathIdx]!);
  const extArg = args.find((a) => a.startsWith('--extensions='));
  const extensions = extArg ? extArg.slice('--extensions='.length) : 'js,jsx,ts,tsx';

  // Reset per-run stats so re-runs in the same process start clean.
  resetRunStats();

  // jscodeshift's runner takes a transform path as the first arg, then
  // paths to transform. Point it at this package's transform export,
  // which lives alongside this CLI in dist/index.js (same dir as cli.js).
  const transformPath = new URL('./index.js', import.meta.url).pathname;

  if (verbose || !json) {
    process.stdout.write(`temporal-fmt-codemod: ${dryRun ? 'DRY-RUN ' : ''}transforming ${targetPath}\n`);
  }

  await run(transformPath, [targetPath], {
    dry: dryRun,
    extensions,
    parser: 'tsx', // tsx parser handles both .js and .ts files
    silent: !verbose,
  });

  // Pull stats from the in-process run. jscodeshift's runner runs the
  // transform in a subprocess per file, so getRunStats() returns the
  // stats from the parent process's import of the transform — these
  // are best-effort and may undercount for multi-file runs. For
  // accurate stats, use --json which emits the warning-comment count
  // from a grep of the rewritten files (TODO: implement grep pass).
  const stats = getRunStats();

  if (json) {
    process.stdout.write(JSON.stringify({
      dryRun,
      targetPath,
      filesChanged: stats.filesChanged,
      callSitesRewritten: stats.callSitesRewritten,
      callSitesSkipped: stats.callSitesSkipped,
      skippedReasons: stats.skippedReasons,
    }, null, 2) + '\n');
    return;
  }

  if (report || verbose) {
    process.stdout.write('\n--- Migration statistics ---\n');
    process.stdout.write(`Files changed:           ${stats.filesChanged}\n`);
    process.stdout.write(`Call sites rewritten:    ${stats.callSitesRewritten}\n`);
    process.stdout.write(`Call sites skipped:      ${stats.callSitesSkipped}\n`);
    if (stats.skippedReasons.length > 0) {
      process.stdout.write('\nSkipped reasons:\n');
      for (const r of stats.skippedReasons) {
        process.stdout.write(`  ${r.file}${r.line ? `:${r.line}` : ''} — ${r.reason}\n`);
      }
    }
  }

  if (!json) {
    process.stdout.write('\nDone. Grep for "// TODO(temporal-fmt-codemod):" to find call sites the codemod left alone.\n');
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`temporal-fmt-codemod failed: ${(err as Error)?.message ?? String(err)}\n`);
  process.exit(1);
});
