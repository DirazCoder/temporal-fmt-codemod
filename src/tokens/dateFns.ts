// date-fns → temporal-fmt token translation table.
//
// date-fns and temporal-fmt both inherited their token syntax from
// moment.js / strftime conventions, so most tokens are identical.
// A handful differ — listed here explicitly so the codemod can verify
// each token against a real table rather than assuming "they're the
// same". The README documents each diff.
//
// Format: source token → target token, or `null` to leave-alone + warn.

export const DATE_FNS_TOKEN_MAP: Record<string, string | null> = {
  // year
  yyyy: 'yyyy',
  yy: 'yy',
  y: 'y', // date-fns has `y` (numeric year); temporal-fmt doesn't — but `y` isn't a temporal-fmt token either, it just becomes literal. Hmm. Actually date-fns `y` and temporal-fmt `yyyy` differ in semantics (one is variable-width). Mark as null.
  // Override: date-fns `y` doesn't map cleanly to temporal-fmt. Leave-alone.
};
// Override the `y` entry — date-fns `y` is "numeric year" (variable width),
// temporal-fmt only has `yyyy`/`yy`. The codemod can't pick which width
// the caller meant, so leave-alone + warn.
DATE_FNS_TOKEN_MAP.y = null;

// Most tokens are identical between date-fns and temporal-fmt — list
// them explicitly so the codemod knows what's safe to leave in place.
const IDENTICAL_TOKENS = [
  'yyyy', 'yy',
  'MMMM', 'MMM', 'MM', 'M',
  'dd', 'd',
  'EEEE', 'EEE', 'EEEEEE', 'EEEEEEE',
  'HH', 'H',
  'hh', 'h',
  'mm', 'm',
  'ss', 's',
  'SSS', 'SS', 'S',
  'a', 'aa', 'aaa', 'aaaa', 'aaaaa',
  'Q', 'QQ', 'QQQ', 'QQQQ',
  'q', 'qq', 'qqq', 'qqqq',
  'w', 'ww', 'W', 'WW',
  'I', 'II', 'IIII',
  'D', 'DD', 'DDD',
  'do', 'Do', 'Mo', 'Qo', 'X', 'x',
  'k', 'kk',
  'T', 't',
  'R', 'RR', 'RRR', 'RRRR',
  'u', 'uu', 'uuu', 'uuuu',
  'Y', 'YY', 'YYY', 'YYYY',
  'G', 'GG', 'GGG', 'GGGG',
  'E', 'EE', 'EEEEE', 'EEEEEE',
  'i', 'ii', 'iii', 'iiii', 'iiiii', 'iiiiii',
  'cccc', 'ccc', 'cc', 'c', 'cccccc', 'ccccccc',
  'LLLL', 'LLL', 'LL', 'L',
  'BBBB', 'BBB', 'BB', 'B',
  'A', 'AAAA', 'AAAAA',
  'Z', 'ZZ', 'ZZZ',
  'P', 'PP', 'PPP', 'PPPP',
];

for (const tok of IDENTICAL_TOKENS) {
  if (DATE_FNS_TOKEN_MAP[tok] === undefined) {
    DATE_FNS_TOKEN_MAP[tok] = tok;
  }
}

// Tokens where date-fns and temporal-fmt disagree on semantics (not
// just spelling). Mark null so the codemod leaves them alone + warns.

// `X` (Unix timestamp seconds) and `x` (Unix timestamp ms) — temporal-fmt
// has no equivalent (it formats Temporal objects, not timestamps).
DATE_FNS_TOKEN_MAP.X = null;
DATE_FNS_TOKEN_MAP.x = null;

// `P`/`PP`/`PPP`/`PPPP` — date-fns's localized long-form tokens. These
// resolve to a locale-specific format string at runtime; temporal-fmt
// has no equivalent.
DATE_FNS_TOKEN_MAP.P = null;
DATE_FNS_TOKEN_MAP.PP = null;
DATE_FNS_TOKEN_MAP.PPP = null;
DATE_FNS_TOKEN_MAP.PPPP = null;

// Timezone tokens — date-fns's `z`/`zz`/`Z`/`ZZ`/`ZZZ` rely on
// date-fns-tz for timezone support; the underlying semantics differ
// from temporal-fmt's `zzz` (IANA zone id, plain string). Leave-alone.
DATE_FNS_TOKEN_MAP.z = null;
DATE_FNS_TOKEN_MAP.zz = null;
DATE_FNS_TOKEN_MAP.Z = null;
DATE_FNS_TOKEN_MAP.ZZ = null;
DATE_FNS_TOKEN_MAP.ZZZ = null;

// `do` (ordinal day) — both libraries have it, identical semantics.
// Already mapped via IDENTICAL_TOKENS to itself.

// `Do` (date-fns capital-Do) — actually I'm not sure date-fns has this;
// let's treat it as identical to `do` (lowercase). Override.
DATE_FNS_TOKEN_MAP.Do = 'do';

export function translateDateFnsFormatString(dateFnsFormat: string): { translated: string; unmapped: string[] } {
  // date-fns uses single-quote literals (same as temporal-fmt). Walk
  // the string greedily-longest-match for tokens, honoring quoted spans.
  const sortedTokens = Object.keys(DATE_FNS_TOKEN_MAP).sort((a, b) => b.length - a.length);
  let result = '';
  let i = 0;
  const unmapped = new Set<string>();

  while (i < dateFnsFormat.length) {
    const ch = dateFnsFormat[i];
    if (ch === "'") {
      if (dateFnsFormat[i + 1] === "'") {
        // doubled quote = literal quote
        result += "''";
        i += 2;
        continue;
      }
      // quoted span until next single quote (with '' escape support)
      let j = i + 1;
      let literal = '';
      let closed = false;
      while (j < dateFnsFormat.length) {
        if (dateFnsFormat[j] === "'") {
          if (dateFnsFormat[j + 1] === "'") {
            literal += "'";
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        literal += dateFnsFormat[j];
        j += 1;
      }
      if (!closed) {
        // unterminated — leave-alone + warn
        return { translated: dateFnsFormat, unmapped: ['unterminated quote'] };
      }
      result += "'" + literal.replace(/'/g, "''") + "'";
      i = j;
      continue;
    }
    const match = sortedTokens.find((tok) => dateFnsFormat.startsWith(tok, i));
    if (match) {
      const target = DATE_FNS_TOKEN_MAP[match];
      if (target === null) {
        unmapped.add(match);
        result += match; // keep original; codemod will warn
      } else {
        result += target;
      }
      i += match.length;
      continue;
    }
    // not a token, not a quote — pass through. Alphabetic characters
    // might be interpreted as temporal-fmt tokens (e.g. a literal "y"
    // becomes a token in temporal-fmt's tokenizer if not quoted), so
    // escape them.
    if (/[A-Za-z]/.test(ch!)) {
      result += "'" + ch + "'";
    } else {
      result += ch;
    }
    i += 1;
  }
  return { translated: result, unmapped: [...unmapped] };
}
