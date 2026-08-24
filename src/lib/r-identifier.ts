// Helpers for safely emitting R string literals and identifiers in generated code.
// Centralizing these avoids the ad-hoc string interpolation that previously risked
// quote-escaping bugs (and, on the backend, code injection via object names).

/** A syntactically valid, unquoted R name: starts with a letter or dot, no leading dot-digit. */
const VALID_R_NAME = /^(?:[a-zA-Z]|\.(?![0-9]))[a-zA-Z0-9._]*$/

/** Returns an R double-quoted string literal with backslashes and quotes escaped. */
export function rStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** True when `name` can be used as a bare R identifier without backtick-quoting. */
export function isValidRName(name: string): boolean {
  return VALID_R_NAME.test(name)
}

/**
 * Quote an arbitrary string so it is safe to use as an R name. Valid names are
 * returned unchanged; anything else is wrapped in backticks (with embedded
 * backticks escaped) so non-syntactic names cannot break out into code.
 */
export function quoteRName(name: string): string {
  if (isValidRName(name)) return name
  return `\`${name.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
}
