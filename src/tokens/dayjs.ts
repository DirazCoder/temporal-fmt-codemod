// dayjs → temporal-fmt token translation table.
//
// dayjs tokens differ from temporal-fmt's in two ways:
// - different case (dayjs YYYY vs temporal-fmt yyyy)
// - different multipliers/widths (dayjs YY = 2-digit year, same as temporal-fmt yy)
//
// Where the token has the same name in both libraries (just a case swap),
// we map it directly. Where semantics diverge (dayjs's 2-digit year
// token, timezone tokens, locale-plugin-dependent tokens), we DON'T
// map — the codemod leaves the call alone with a warning comment so a
// human can decide what to do. Silently rewriting a token whose
// semantics are different is exactly the "silently produced wrong
// dates" failure mode this tool refuses to allow.
//
// Format: source token → target token, or `null` to leave-alone + warn.

export const DAYJS_TOKEN_MAP: Record<string, string | null> = {
  // year
  YYYY: 'yyyy',
  YY: 'yy',
  // month
  MMMM: 'MMMM',
  MMM: 'MMM',
  MM: 'MM',
  M: 'M',
  // day
  DD: 'dd',
  D: 'd',
  // weekday
  dddd: 'EEEE',
  ddd: 'EEE',
  // hour (24h)
  HH: 'HH',
  H: 'H',
  // hour (12h)
  hh: 'hh',
  h: 'h',
  // minute
  mm: 'mm',
  m: 'm',
  // second
  ss: 'ss',
  s: 's',
  // millisecond
  SSS: 'SSS',
  // AM/PM
  A: 'a',
  a: 'a', // dayjs's lowercase `a` and temporal-fmt's `a` are both case-insensitive on the AM/PM marker, so this maps cleanly now (temporal-fmt/#issue — 'a' used to be exact-case only, was a semantic mismatch before that changed).

  // ----- tokens that don't map 1:1 to temporal-fmt -----

  // dayjs `Q` (quarter) — same as temporal-fmt Q. Maps directly.
  Q: 'Q',
  // dayjs `Do` (ordinal day) — temporal-fmt uses `do` (lowercase).
  // dayjs also has `DDdd` (day-of-year "Day of Year (3 digit with leading zeros)")
  // which doesn't have a temporal-fmt equivalent — left unmapped.
  Do: 'do',
  // dayjs `Ddd` (day of year) — no temporal-fmt equivalent.
  DDD: null, // leave-alone + warn
  // dayjs `H` (24-hour) — maps directly to temporal-fmt `H`. Already listed.

  // timezone tokens — dayjs's z/zz tokens depend on the timezone plugin
  // and don't map cleanly to temporal-fmt's `zzz` (which is just the
  // IANA zone id, not a localized abbreviation). Leave-alone + warn.
  z: null,
  zz: null,
  Z: null, // ISO 8601 offset — temporal-fmt has no equivalent

  // epoch / week-of-year tokens — temporal-fmt has `ww` for ISO week
  // but dayjs's `w` is locale-dependent and uses different numbering
  // in some configurations. Leave-alone + warn.
  ww: 'ww', // dayjs ww = ISO week, maps directly
  w: null,

  // dayjs `X` (seconds since epoch) and `x` (ms since epoch) — temporal-fmt
  // formats Temporal objects, not raw timestamps, so there's no
  // equivalent for what dayjs means by these. Note temporal-fmt does
  // define X/x itself (UTC offset tokens, 0.8.7) — same spelling,
  // different meaning, still not a valid target for these.
  X: null,
  x: null,
};

// Builds the translated format string + a list of tokens that couldn't
// be translated (for the warning-comment path). Used by the dayjs
// transform.
export function translateDayjsFormatString(dayjsFormat: string): { translated: string; unmapped: string[] } {
  // Greedy longest-match: dayjs tokens range from 4 chars (YYYY) down
  // to 1 char (Q, M, D, etc.). Sort by length descending so YYYY is
  // tried before YY, etc.
  const sortedTokens = Object.keys(DAYJS_TOKEN_MAP).sort((a, b) => b.length - a.length);
  let result = '';
  let i = 0;
  const unmapped = new Set<string>();
  // dayjs supports bracket-escaping: text in [..] is literal. Mirror
  // the behavior — walk the string, recognize brackets, recognize tokens,
  // everything else is literal.
  while (i < dayjsFormat.length) {
    const ch = dayjsFormat[i];
    if (ch === '[') {
      // literal span until ']'
      const end = dayjsFormat.indexOf(']', i + 1);
      if (end === -1) {
        // unterminated — leave the rest of the string alone (it'll
        // be analyzed as tokens, which may produce more errors, but
        // that's the caller's problem)
        result += dayjsFormat.slice(i);
        break;
      }
      // temporal-fmt uses single-quote literals, not brackets. Convert.
      result += "'" + dayjsFormat.slice(i + 1, end).replace(/'/g, "''") + "'";
      i = end + 1;
      continue;
    }
    const match = sortedTokens.find((tok) => dayjsFormat.startsWith(tok, i));
    if (match) {
      const target = DAYJS_TOKEN_MAP[match];
      if (target === null) {
        unmapped.add(match);
        // leave the original token in place — the codemod will emit
        // a warning comment above the call so a human knows to fix it
        result += match;
      } else {
        result += target;
      }
      i += match.length;
      continue;
    }
    // not a token, not a bracket — pass through as literal. temporal-fmt
    // treats unquoted text as literal too, but to avoid any character
    // accidentally matching a temporal-fmt token, escape it in single
    // quotes when it's alphabetic.
    if (/[A-Za-z]/.test(ch!)) {
      result += "'" + ch + "'";
    } else {
      result += ch;
    }
    i += 1;
  }
  return { translated: result, unmapped: [...unmapped] };
}