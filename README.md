# temporal-fmt-codemod

jscodeshift codemod that rewrites dayjs and date-fns call sites to temporal-fmt equivalents. AST-based, not regex — safe to run unsupervised on a real production codebase.

The contract: this tool's error mode is "did nothing, told you why" — never "silently produced wrong dates." Any call site the codemod isn't confident about is left alone with a `// TODO(temporal-fmt-codemod):` warning comment naming the reason. Grep for that marker after a run to find anything that needs human attention.

## Install

```sh
npm install --save-dev temporal-fmt-codemod jscodeshift
```

## Usage

```sh
# Dry-run (prints a diff, writes nothing)
npx temporal-fmt-codemod ./src --dry-run

# Apply
npx temporal-fmt-codemod ./src

# With explicit extensions
npx temporal-fmt-codemod ./src --extensions=js,jsx,ts,tsx
```

After a run, grep for skipped call sites:

```sh
grep -rn 'TODO(temporal-fmt-codemod)' ./src
```

Each warning comment names the specific reason the call was left alone — most commonly, a token that doesn't have a 1:1 temporal-fmt equivalent.

## What it rewrites

### dayjs

- `dayjs(x).format('TOKEN_STRING')` → `format(x, '<translated tokens>')`
- `dayjs(x).add(N, 'unit').format(...)` → `format(x.add({ units: N }), '<translated>')` (chains collapse into a single `format()` call)
- `dayjs(x).subtract(N, 'unit').format(...)` → `format(x.add({ units: -N }), '<translated>')` (negated amount)

Tokens that don't have a 1:1 temporal-fmt equivalent (see table below) leave the call alone with a warning comment.

### date-fns

- `format(date, 'TOKEN_STRING')` (when imported from `date-fns`) → `format(date, '<translated tokens>')`. Most date-fns tokens are identical to temporal-fmt's — the rewrite mostly leaves the token string alone, just removes the date-fns dependency.
- `parseISO(...)`, `parse(...)` → leave-alone + warning (rewriting requires understanding what the caller does with the result).

A locally-defined function named `format` that isn't imported from date-fns is NOT rewritten — the codemod only rewrites calls it can attribute to date-fns.

## Token translation tables

### dayjs → temporal-fmt

| dayjs | temporal-fmt | Notes |
|-------|--------------|-------|
| YYYY | yyyy | 4-digit year |
| YY | yy | 2-digit year |
| MMMM | MMMM | full month name |
| MMM | MMM | short month name |
| MM | MM | 2-digit month |
| M | M | month |
| DD | dd | 2-digit day (case differs) |
| D | d | day (case differs) |
| dddd | EEEE | full weekday |
| ddd | EEE | short weekday |
| HH | HH | 24-hour, padded |
| H | H | 24-hour |
| hh | hh | 12-hour, padded |
| h | h | 12-hour |
| mm | mm | minute, padded |
| m | m | minute |
| ss | ss | second, padded |
| s | s | second |
| SSS | SSS | milliseconds |
| A | a | AM/PM (case differs; locale-aware in temporal-fmt) |
| a | a | am/pm (case differs) |
| Q | Q | quarter |
| Do | do | ordinal day (case differs) |
| ww | ww | ISO week |
| **DD** | — | day-of-year, no equivalent — leave-alone + warn |
| **DDD** | — | day-of-year (3-digit), no equivalent — leave-alone + warn |
| **w** | — | locale-dependent week, semantics differ — leave-alone + warn |
| **z** | — | timezone abbreviation, needs dayjs timezone plugin — leave-alone + warn |
| **zz** | — | timezone abbreviation (long), needs plugin — leave-alone + warn |
| **Z** | — | ISO 8601 offset, no equivalent — leave-alone + warn |

dayjs bracket-literal syntax (`[at]`) is converted to temporal-fmt's single-quote-literal syntax (`'at'`).

### date-fns → temporal-fmt

Most tokens are identical between date-fns and temporal-fmt — both inherit from the same moment.js / strftime conventions. The table below lists only the differences.

| date-fns | temporal-fmt | Notes |
|----------|--------------|-------|
| yyyy, yy, MMMM, MMM, MM, M, dd, d, EEEE, EEE, HH, H, hh, h, mm, m, ss, s, SSS, a, Q, QQQ, do, ww | same | identical, no translation needed |
| **y** | — | variable-width year, no equivalent — leave-alone + warn |
| **X** | — | Unix timestamp seconds, no equivalent — leave-alone + warn |
| **x** | — | Unix timestamp ms, no equivalent — leave-alone + warn |
| **P, PP, PPP, PPPP** | — | localized long-form tokens, no equivalent — leave-alone + warn |
| **z, zz, Z, ZZ, ZZZ** | — | timezone tokens, need date-fns-tz — leave-alone + warn |
| **D, DD, DDD** | — | day-of-year variants, no equivalent — leave-alone + warn |
| **Do** | do | ordinal day (capital D in date-fns) — translated to lowercase |

date-fns single-quote-literal syntax (`'at'`) is preserved as-is — both libraries use the same syntax.

## Known unsupported patterns (check manually after running)

- **dayjs constructor calls used for parsing** (`dayjs(str)` without a chained `.format()`): the codemod leaves these alone. If the surrounding code only uses `.year()` / `.month()` accessors, a human can rewrite to `Temporal.PlainDate.from(str).year` etc.; if the code uses other methods, the rewrite depends on which methods.
- **date-fns `parseISO` / `parse`**: rewriting requires a format string and reference date, which the caller doesn't have at the call site. Left alone with a warning.
- **dayjs plugins** (timezone, quarter-of-year, etc.): tokens that depend on plugins don't have temporal-fmt equivalents. Left alone with a warning.
- **dynamic format strings** (variables, template literals with interpolation, ternaries): the codemod only rewrites static string literals. Left alone silently — no warning, since the codemod can't know whether the runtime value would be valid.
- **method chains beyond `.add()`/`.subtract()`/`.format()`**: any other dayjs method (`.year()`, `.month()`, `.toISOString()`, etc.) leaves the whole chain alone with a warning.

## License

MIT
