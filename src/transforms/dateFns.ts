import { translateDateFnsFormatString } from '../tokens/dateFns.js';

// date-fns transform.
//
// What this rewrite handles:
// - `format(date, 'TOKEN_STRING')` calls (when imported from date-fns's
//   `format` export) -> `format(<converted date>, '<translated tokens>')`
//
// What it leaves alone + warns:
// - Any `format` call that isn't imported from date-fns (could be a
//   local function with the same name — don't guess).
// - Tokens that don't map cleanly to temporal-fmt (date-fns's
//   `X`/`x` timestamp, `P`/`PP` localized formats, `z`/`Z` timezone
//   tokens that need date-fns-tz).
// - `parseISO` / `parse` — leave-alone + warn, since they require
//   understanding what the caller does with the result.

export interface TransformResult {
  changed: boolean;
  skippedWithWarning: boolean;
  warningReason?: string;
}

type ASTNode = Record<string, unknown> & { type: string };
type ASTPath = { node: ASTNode; parentPath?: ASTPath | null; replace: (n: ASTNode) => void; insertBefore: (n: ASTNode) => void };

let dateFnsFormatLocalNames: Set<string> = new Set();
let dateFnsParseISOLocalNames: Set<string> = new Set();
let dateFnsParseLocalNames: Set<string> = new Set();

export function resetDateFnsLocalNames(): void {
  dateFnsFormatLocalNames = new Set();
  dateFnsParseISOLocalNames = new Set();
  dateFnsParseLocalNames = new Set();
}

export function recordDateFnsImport(path: ASTPath): void {
  const node = path.node;
  if (node.type !== 'ImportDeclaration') return;
  const source = node.source as ASTNode;
  const sourceValue = source.value as string;
  if (typeof sourceValue !== 'string') return;
  if (!sourceValue.startsWith('date-fns')) return;

  const specifiers = node.specifiers as ASTNode[];
  for (const specifier of specifiers) {
    if (specifier.type !== 'ImportSpecifier') continue;
    const importedName = (specifier.imported as ASTNode).name as string;
    const localName = (specifier.local as ASTNode).name as string;
    if (!importedName || !localName) continue;
    if (importedName === 'format') {
      dateFnsFormatLocalNames.add(localName);
    } else if (importedName === 'parseISO') {
      dateFnsParseISOLocalNames.add(localName);
    } else if (importedName === 'parse') {
      dateFnsParseLocalNames.add(localName);
    }
  }
}

export function transformDateFnsCall(path: ASTPath): TransformResult {
  const node = path.node;
  if (node.type !== 'CallExpression') {
    return { changed: false, skippedWithWarning: false };
  }
  const callee = node.callee as ASTNode;
  if (callee.type !== 'Identifier') {
    return { changed: false, skippedWithWarning: false };
  }
  const calleeName = callee.name as string;

  if (dateFnsFormatLocalNames.has(calleeName)) {
    return transformDateFnsFormat(path);
  }

  if (dateFnsParseISOLocalNames.has(calleeName)) {
    return {
      changed: false,
      skippedWithWarning: true,
      warningReason: `date-fns parseISO — rewrite to temporal-fmt's parse() requires understanding the surrounding usage; leave to human`,
    };
  }
  if (dateFnsParseLocalNames.has(calleeName)) {
    return {
      changed: false,
      skippedWithWarning: true,
      warningReason: `date-fns parse() — rewrite to temporal-fmt's parse() requires a token string and reference date; leave to human`,
    };
  }

  return { changed: false, skippedWithWarning: false };
}

function transformDateFnsFormat(path: ASTPath): TransformResult {
  const node = path.node;
  const args = node.arguments as ASTNode[];
  if (args.length < 2) {
    return { changed: false, skippedWithWarning: true, warningReason: 'date-fns format() called with < 2 args — leave to human' };
  }
  const dateArg = args[0]!;
  const formatArg = args[1]!;
  if (formatArg.type !== 'Literal' || typeof formatArg.value !== 'string') {
    return { changed: false, skippedWithWarning: true, warningReason: 'date-fns format() with non-string token literal — codemod only rewrites static string literals' };
  }
  const formatStr = formatArg.value as string;
  const { translated, unmapped } = translateDateFnsFormatString(formatStr);
  if (unmapped.length > 0) {
    return {
      changed: false,
      skippedWithWarning: true,
      warningReason: `date-fns tokens [${unmapped.join(', ')}] have no direct temporal-fmt equivalent — see temporal-fmt's README "Tokens" table. Rewrite manually if needed.`,
    };
  }

  // Same call shape — date-fns's `format(date, fmt)` is `format(date, fmt)`
  // in temporal-fmt too. Just swap the format string + leave the date arg
  // alone (the codemod doesn't rewrite Date objects to Temporal values —
  // that's a separate concern).
  const replacement: ASTNode = {
    type: 'CallExpression',
    callee: { type: 'Identifier', name: 'format' },
    arguments: [dateArg, { type: 'Literal', value: translated }],
  };

  path.replace(replacement);
  return { changed: true, skippedWithWarning: false };
}
