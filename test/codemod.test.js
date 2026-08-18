import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as jscodeshiftNS from 'jscodeshift';

import transform, {
  resetRunStats,
  translateDayjsFormatString,
  translateDateFnsFormatString,
} from '../dist/index.js';

// jscodeshift is exported as the namespace's `default` property.
const jscodeshift = jscodeshiftNS.default;

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, 'fixtures');

// Fixture-based tests: read input + expected, run the transform, assert
// the output matches expected. Mirrors the same pattern the existing
// temporal-fmt test suite uses (hand-picked cases), just adapted to
// codemod transforms instead of date formatting.

function runTransform(source) {
  resetRunStats();
  // The transform expects `api.jscodeshift` to be the callable
  // jscodeshift function (its standard signature). Build a minimal
  // api object that exposes the default import as `.jscodeshift`.
  const result = transform({ path: 'test.js', source }, { jscodeshift });
  return result;
}

test('sample fixture: mixed dayjs + date-fns usage rewrites correctly', () => {
  const input = readFileSync(resolve(FIXTURES, 'sample.input.js'), 'utf8');
  const expected = readFileSync(resolve(FIXTURES, 'sample.expected.js'), 'utf8');
  const output = runTransform(input);
  assert.ok(output, 'transform should have produced output (input has rewritable calls)');
  // Trim trailing whitespace — recast's printer is inconsistent about a
  // final newline vs not, which isn't a meaningful diff for the test.
  assert.equal(output.replace(/\s+$/, ''), expected.replace(/\s+$/, ''));
});

test('simple dayjs format call: tokens translated correctly', () => {
  const input = `dayjs(d).format('YYYY-MM-DD HH:mm:ss')`;
  const output = runTransform(input);
  assert.ok(output);
  assert.match(output, /format\(d, ['\"]yyyy-MM-dd HH:mm:ss['\"]\)/);
});

test('simple date-fns format call: tokens translated correctly', () => {
  const input = `import { format } from 'date-fns';\nformat(d, 'yyyy-MM-dd HH:mm:ss');`;
  const output = runTransform(input);
  assert.ok(output);
  // date-fns and temporal-fmt share most token names — output should
  // leave them as-is since they're already in temporal-fmt's table.
  assert.match(output, /format\(d, ['"]yyyy-MM-dd HH:mm:ss['"]\)/);
});

test('chained dayjs arithmetic: dayjs(x).add(1, "day").format("...") collapses to format(x.add({days: 1}), "...")', () => {
  const input = `dayjs(x).add(1, 'day').format('YYYY-MM-DD')`;
  const output = runTransform(input);
  assert.ok(output);
  // The chained call should be collapsed — dayjs's mutable chain isn't
  // preserved; temporal-fmt values are immutable and arithmetic happens
  // via .add({days: 1}).
  assert.match(output, /format\(x\.add\(\{\s*days: 1\s*\}\), ['"]yyyy-MM-dd['"]\)/);
});

test('dayjs .subtract() also translates (with negated amount)', () => {
  const input = `dayjs(x).subtract(2, 'hour').format('HH:mm')`;
  const output = runTransform(input);
  assert.ok(output);
  assert.match(output, /format\(x\.add\(\{\s*hours: -2\s*\}\), ['"]HH:mm['"]\)/);
});

test('ambiguous case: dayjs format with "X" (unix timestamp) leaves the call alone with a warning comment', () => {
  const input = `dayjs(d).format('X')`;
  const output = runTransform(input);
  // Transform returns null (no changes) when only warnings are emitted
  // — but the warning comment is inserted via the codemod's
  // insertBefore. Let's actually check that the output (if any)
  // doesn't silently produce a wrong-date equivalent.
  //
  // Wait — actually transform returns the modified source when changes
  // happen, including comment insertions. So output should include the
  // TODO warning comment + leave the call alone.
  assert.ok(output);
  assert.match(output, /\/\/ TODO\(temporal-fmt-codemod\):/);
  assert.match(output, /dayjs\(d\)\.format\(['"]X['"]\)/);
});

test('non-date-fns format() call is left alone (no false positive)', () => {
  // A locally-defined function named `format` that isn't imported from
  // date-fns should NOT be rewritten — the codemod only rewrites calls
  // it can attribute to date-fns.
  const input = `function format(x, fmt) { return x + fmt; }\nformat(d, 'yyyy-MM-dd');`;
  const output = runTransform(input);
  // Should return null (no changes — the local `format` isn't imported from date-fns)
  assert.equal(output, null);
});

test('mixed dayjs + date-fns in the same file handled in one pass', () => {
  const input = readFileSync(resolve(FIXTURES, 'sample.input.js'), 'utf8');
  const output = runTransform(input);
  assert.ok(output);
  // Both the date-fns and dayjs calls should be rewritten
  assert.match(output, /format\(d, ['"]yyyy-MM-dd HH:mm:ss['"]\)/);
  assert.match(output, /format\(d\.add\(\{\s*days: 1\s*\}\), ['"]yyyy-MM-dd['"]\)/);
});

test('dayjs token table: translateDayjsFormatString translates the documented tokens', () => {
  // Spot-check a few: YYYY->yyyy, DD->dd, HH->HH, etc.
  const out = translateDayjsFormatString('YYYY-MM-DD HH:mm:ss');
  assert.equal(out.translated, 'yyyy-MM-dd HH:mm:ss');
  assert.equal(out.unmapped.length, 0);
});

test('dayjs token table: [X] (unix timestamp) is in the unmappable list', () => {
  const out = translateDayjsFormatString('X');
  assert.ok(out.unmapped.includes('X'));
});

test('date-fns token table: most tokens are identical, only a few differ', () => {
  // Spot-check: yyyy, MM, dd, HH, mm, ss all map to themselves
  const out = translateDateFnsFormatString('yyyy-MM-dd HH:mm:ss');
  assert.equal(out.translated, 'yyyy-MM-dd HH:mm:ss');
  assert.equal(out.unmapped.length, 0);
});

test('date-fns token table: P (localized long format) is unmappable', () => {
  const out = translateDateFnsFormatString('P');
  assert.ok(out.unmapped.includes('P'));
});

test('dayjs bracket-escaping: text in [..] converts to single-quoted literals', () => {
  // dayjs uses [at] for literal text; temporal-fmt uses 'at'.
  const out = translateDayjsFormatString('YYYY [at] HH:mm');
  assert.equal(out.translated, "yyyy 'at' HH:mm");
});

test('date-fns local name tracking: aliased imports work', () => {
  // import { format as dfnsFormat } from 'date-fns'; dfnsFormat(d, ...)
  const input = `import { format as dfnsFormat } from 'date-fns';\ndfnsFormat(d, 'yyyy-MM-dd');`;
  const output = runTransform(input);
  assert.ok(output);
  // The aliased name should be tracked and rewritten. The output's
  // quote style is recast's choice (single or double) — match either.
  assert.match(output, /format\(d, ['"]yyyy-MM-dd['"]\)/);
});
