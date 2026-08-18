// Main jscodeshift transform entry point.
//
// Exports a transform function with the standard jscodeshift signature
// (fileInfo, api, options) -> string | null. Runs both the dayjs and
// date-fns transforms against the same file, so a file with mixed
// dayjs + date-fns usage gets both rewritten in a single pass.
//
// Aggregates statistics for the summary print at the end of a CLI run:
// files changed, call sites rewritten, call sites skipped with warnings.

import { transformDayjsCall } from './transforms/dayjs.js';
import { transformDateFnsCall, recordDateFnsImport, resetDateFnsLocalNames } from './transforms/dateFns.js';
import { translateDayjsFormatString } from './tokens/dayjs.js';
import { translateDateFnsFormatString } from './tokens/dateFns.js';

// Re-export the token-translation tables + helpers so tests and
// external tooling can inspect them. The README documents these as
// "inspectable, exported, not buried in the transform logic" — keeping
// them as real exports honors that.
export { translateDayjsFormatString, translateDateFnsFormatString };
export { DAYJS_TOKEN_MAP } from './tokens/dayjs.js';
export { DATE_FNS_TOKEN_MAP } from './tokens/dateFns.js';
export { transformDayjsCall, transformDateFnsCall };

export interface TransformStats {
  filesChanged: number;
  callSitesRewritten: number;
  callSitesSkipped: number;
  skippedReasons: Array<{ file: string; line?: number; reason: string }>;
}

// Per-run aggregate stats. Stored on the api object so callers (the CLI)
// can pull them after the transform finishes — jscodeshift doesn't
// expose a per-run summary API itself.
const RUN_STATS: TransformStats = {
  filesChanged: 0,
  callSitesRewritten: 0,
  callSitesSkipped: 0,
  skippedReasons: [],
};

export function getRunStats(): TransformStats {
  return RUN_STATS;
}

export function resetRunStats(): void {
  RUN_STATS.filesChanged = 0;
  RUN_STATS.callSitesRewritten = 0;
  RUN_STATS.callSitesSkipped = 0;
  RUN_STATS.skippedReasons = [];
}

// Loosely-typed jscodeshift — the strict types from @types/jscodeshift
// make AST construction more friction than it's worth, and the runtime
// shape is duck-typed by jscodeshift anyway.
type ASTNode = Record<string, unknown> & { type: string };
type ASTPath = { node: ASTNode; parentPath?: ASTPath | null; replace: (n: ASTNode) => void; insertBefore: (n: ASTNode) => void };
type JSCodeshiftAPI = {
  jscodeshift: {
    (source: string): { toSource: (options?: { lineTerminator?: string }) => string; find: (selector: unknown) => Array<ASTPath> };
    ImportDeclaration: unknown;
    CallExpression: unknown;
    commentLine: (text: string) => ASTNode;
  };
};

export default function transform(fileInfo: { path: string; source: string }, api: JSCodeshiftAPI): string | null {
  const j = api.jscodeshift;
  const source = fileInfo.source;
  if (!source) return null;

  // Reset per-file state for date-fns local name tracking (each file
  // has its own imports).
  resetDateFnsLocalNames();

  const root = j(source);
  let changed = false;

  // Pass 1: collect date-fns import local names. The visitor pattern
  // accumulates them into the module-level sets so the call-expression
  // pass can look them up.
  for (const path of root.find(j.ImportDeclaration)) {
    recordDateFnsImport(path);
  }

  // Pass 2: walk every CallExpression. Try the dayjs transform first
  // (it's more specific — looks for `dayjs(...)`), then the date-fns
  // transform (which looks for any `format(...)` / `parseISO(...)` /
  // `parse(...)` call where the local name is one of date-fns's).
  for (const path of root.find(j.CallExpression)) {
    const dayjsResult = transformDayjsCall(path);
    if (dayjsResult.changed) {
      changed = true;
      RUN_STATS.callSitesRewritten += 1;
      continue;
    }
    if (dayjsResult.skippedWithWarning && dayjsResult.warningReason) {
      const line = (path.node.loc as { start?: { line?: number } } | undefined)?.start?.line;
      RUN_STATS.callSitesSkipped += 1;
      RUN_STATS.skippedReasons.push({ file: fileInfo.path, line, reason: dayjsResult.warningReason });
      // Attach the warning comment as a leading comment on the wrapping
      // ExpressionStatement. recast's `insertBefore` only works when
      // the comment is the only statement in the list — attaching as
      // a `comments` array on the existing statement is the safe way
      // that always works.
      const comment = j.commentLine(` TODO(temporal-fmt-codemod): ${dayjsResult.warningReason}`);
      const parent = path.parentPath;
      if (parent && parent.node) {
        const parentNode = parent.node as { comments?: unknown[] };
        if (!parentNode.comments) {
          parentNode.comments = [];
        }
        (parentNode.comments as unknown[]).push(comment);
        changed = true;
      }
      continue;
    }
    const dateFnsResult = transformDateFnsCall(path);
    if (dateFnsResult.changed) {
      changed = true;
      RUN_STATS.callSitesRewritten += 1;
      continue;
    }
    if (dateFnsResult.skippedWithWarning && dateFnsResult.warningReason) {
      const line = (path.node.loc as { start?: { line?: number } } | undefined)?.start?.line;
      RUN_STATS.callSitesSkipped += 1;
      RUN_STATS.skippedReasons.push({ file: fileInfo.path, line, reason: dateFnsResult.warningReason });
      const comment = j.commentLine(` TODO(temporal-fmt-codemod): ${dateFnsResult.warningReason}`);
      const parent = path.parentPath;
      if (parent && parent.node) {
        const parentNode = parent.node as { comments?: unknown[] };
        if (!parentNode.comments) {
          parentNode.comments = [];
        }
        (parentNode.comments as unknown[]).push(comment);
        changed = true;
      }
      continue;
    }
  }

  if (changed) {
    RUN_STATS.filesChanged += 1;
  }

  // Force LF regardless of host OS. recast falls back to os.EOL when no
  // lineTerminator is given, which means the exact same source produces
  // different output on Windows vs. Linux/macOS. Pinning this keeps CI,
  // local dev, and downstream diffs consistent no matter where the
  // codemod runs.
  return changed ? root.toSource({ lineTerminator: '\n' }) : null;
}