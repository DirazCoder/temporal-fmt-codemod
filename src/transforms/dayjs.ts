// dayjs transform.
//
// What this rewrite handles:
// - `dayjs(x).format('TOKEN_STRING')` -> `format(<converted x>, '<translated tokens>')`
// - `dayjs(x).add(1, 'day').format(...)` -> the chain is collapsed to
//   `format(<converted x>.add({ days: 1 }), '<translated>')`
//
// What it leaves alone + warns:
// - dayjs constructor calls used only for parsing (not formatting), unless
//   the surrounding code only uses accessor methods like `.year()`/`.month()`
//   that map cleanly to a Temporal read.
// - dayjs's 2-digit year token, timezone tokens, locale-plugin-dependent
//   tokens, or any token not in the translation table.
//
// The "did nothing, told you why" failure mode is the contract — never
// "silently produced wrong dates". A `// TODO(temporal-fmt-codemod):` warning
// comment is emitted above any call that couldn't be confidently rewritten,
// so a human can find them post-run.

import { translateDayjsFormatString } from '../tokens/dayjs.js';

export interface TransformResult {
  changed: boolean;
  skippedWithWarning: boolean;
  warningReason?: string;
}

type ASTNode = Record<string, unknown> & { type: string };
type ASTPath = { node: ASTNode; parentPath?: ASTPath | null; replace: (n: ASTNode) => void; insertBefore: (n: ASTNode) => void };

// This transform fires on the OUTER CallExpression of a dayjs chain:
// `dayjs(x).add(1, 'day').format('...')`. The outer call's callee is a
// MemberExpression; we walk DOWN the chain from the outer call into the
// inner `dayjs(x)` call, collecting intermediate `.add(...)` /
// `.subtract(...)` steps along the way.
//
// Important: we only fire when the chain BOTTOMS OUT at a `dayjs(...)`
// call. Without that check, this transform would also fire on unrelated
// `foo.bar().baz()` chains (e.g. `console.log(...)`), producing false
// positives on every MemberExpression-call in the file.
export function transformDayjsCall(path: ASTPath): TransformResult {
  const node = path.node;
  if (node.type !== 'CallExpression') {
    return { changed: false, skippedWithWarning: false };
  }
  const callee = node.callee as ASTNode;
  if (callee.type !== 'MemberExpression') {
    return { changed: false, skippedWithWarning: false };
  }

  // Pre-flight: walk down the chain to see if it bottoms out at a
  // `dayjs(...)` call. If not, this isn't a dayjs chain — return early
  // without any warning, so unrelated calls (console.log, lodash.map,
  // etc.) stay silent.
  if (!chainBottomsOutAtDayjs(node)) {
    return { changed: false, skippedWithWarning: false };
  }

  // Walk DOWN the chain, collecting steps. (Same walk as
  // chainBottomsOutAtDayjs but with side effects: collecting chainSteps
  // and formatArg.)
  const chainSteps: Array<{ method: string; args: ASTNode[] }> = [];
  let formatArg: ASTNode | null = null;
  let current: ASTNode = node;
  let dayjsArg: ASTNode | null = null;

  while (current && current.type === 'CallExpression') {
    const curCallee = current.callee as ASTNode;
    if (curCallee.type === 'Identifier' && curCallee.name === 'dayjs') {
      dayjsArg = (current.arguments as ASTNode[])[0] ?? null;
      break;
    }
    if (curCallee.type !== 'MemberExpression') break;
    const property = curCallee.property as ASTNode;
    if (property.type !== 'Identifier') break;
    const methodName = property.name as string;

    if (methodName === 'format') {
      const args = current.arguments as ASTNode[];
      if (args.length === 0) {
        return { changed: false, skippedWithWarning: true, warningReason: 'dayjs(x).format() with no token string maps to ISO format, no temporal-fmt equivalent' };
      }
      const arg = args[0]!;
      if (arg.type !== 'Literal' || typeof arg.value !== 'string') {
        return { changed: false, skippedWithWarning: true, warningReason: 'dayjs(x).format(<dynamic>) — codemod only rewrites static string literals' };
      }
      formatArg = arg;
      current = curCallee.object as ASTNode;
      continue;
    }

    if (methodName === 'add' || methodName === 'subtract') {
      const args = current.arguments as ASTNode[];
      if (args.length !== 2) {
        return { changed: false, skippedWithWarning: true, warningReason: `dayjs().${methodName}() with unexpected arg count — leave to human` };
      }
      const unit = args[1]!;
      if (unit.type !== 'Literal' || typeof unit.value !== 'string') {
        return { changed: false, skippedWithWarning: true, warningReason: `dayjs().${methodName}() with non-string unit — leave to human` };
      }
      chainSteps.push({ method: methodName, args });
      current = curCallee.object as ASTNode;
      continue;
    }

    return { changed: false, skippedWithWarning: true, warningReason: `dayjs().${methodName}() — out of scope for this codemod pass` };
  }

  if (!formatArg || formatArg.type !== 'Literal' || !dayjsArg) {
    // The visited CallExpression bottoms out at dayjs(x) but doesn't
    // have a .format() call at the top — likely just `dayjs(x)` used
    // as a value (without a chained method), or a chain that ends
    // in a non-format method that's also not .add/.subtract.
    return { changed: false, skippedWithWarning: false };
  }
  const formatStr = formatArg.value as string;
  const { translated, unmapped } = translateDayjsFormatString(formatStr);

  if (unmapped.length > 0) {
    return {
      changed: false,
      skippedWithWarning: true,
      warningReason: `dayjs tokens [${unmapped.join(', ')}] have no direct temporal-fmt equivalent — see temporal-fmt's README "Tokens" table. Rewrite manually if needed.`,
    };
  }

  let inner: ASTNode = dayjsArg;
  for (const step of chainSteps) {
    const amount = step.args[0]!;
    const unit = step.args[1]!.value as string;
    const temporalUnit = dayjsUnitToTemporalUnit(unit);
    if (!temporalUnit) {
      return {
        changed: false,
        skippedWithWarning: true,
        warningReason: `dayjs unit "${unit}" doesn't map to a Temporal.Duration unit — leave to human`,
      };
    }
    const sign = step.method === 'subtract' ? -1 : 1;
    let amountValue: ASTNode = amount;
    if (amount.type === 'Literal' && typeof amount.value === 'number') {
      amountValue = { type: 'Literal', value: sign * (amount.value as number) };
    } else if (sign < 0) {
      amountValue = { type: 'UnaryExpression', operator: '-', argument: amount };
    }
    inner = {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        object: inner,
        property: { type: 'Identifier', name: 'add' },
      },
      arguments: [
        {
          type: 'ObjectExpression',
          properties: [
            {
              type: 'Property',
              shorthand: true,
              key: { type: 'Identifier', name: temporalUnit },
              value: amountValue,
              kind: 'init',
            },
          ],
        },
      ],
    };
  }

  const replacement: ASTNode = {
    type: 'CallExpression',
    callee: { type: 'Identifier', name: 'format' },
    arguments: [inner, { type: 'Literal', value: translated }],
  };

  path.replace(replacement);
  return { changed: true, skippedWithWarning: false };
}

// Walk down the chain to see if it eventually reaches an inner
// `dayjs(...)` call. If it doesn't (e.g. `console.log(...)` whose
// callee.object is `console` Identifier, not a CallExpression), this
// isn't a dayjs chain — return false so the outer transform doesn't
// fire any warnings on it.
function chainBottomsOutAtDayjs(node: ASTNode): boolean {
  let current: ASTNode | undefined = node;
  let guard = 0;
  while (current && current.type === 'CallExpression' && guard++ < 20) {
    const curCallee = current.callee as ASTNode;
    if (curCallee.type === 'Identifier' && curCallee.name === 'dayjs') {
      return true;
    }
    if (curCallee.type !== 'MemberExpression') return false;
    current = curCallee.object as ASTNode;
  }
  return false;
}

// dayjs unit strings -> Temporal.Duration unit field names.
function dayjsUnitToTemporalUnit(unit: string): string | null {
  const map: Record<string, string> = {
    year: 'years',
    years: 'years',
    y: 'years',
    month: 'months',
    months: 'months',
    M: 'months',
    week: 'weeks',
    weeks: 'weeks',
    w: 'weeks',
    day: 'days',
    days: 'days',
    d: 'days',
    hour: 'hours',
    hours: 'hours',
    h: 'hours',
    minute: 'minutes',
    minutes: 'minutes',
    m: 'minutes',
    second: 'seconds',
    seconds: 'seconds',
    s: 'seconds',
    millisecond: 'milliseconds',
    milliseconds: 'milliseconds',
    ms: 'milliseconds',
  };
  return map[unit] ?? null;
}
