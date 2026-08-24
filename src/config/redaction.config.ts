export const DEFAULT_REDACT_KEYS =
  /(?<secret>password|token|secret|authorization|cookie|drawing|replay|chat|payload)/iu;

export const BEARER_PATTERN = /bearer\s+[^\s]+/giu;
export const KEY_VALUE_PATTERN = /(?<key>password|token|secret|authorization|cookie)=?[^\s,;]+/giu;
export const MESSAGE_REDACTION_PATTERN = /bearer\s+|password|token|secret|authorization|cookie/iu;

/**
 * Fast pre-filter for redaction: keys containing any of these fragments
 * can carry secrets. Used to skip the deep-copy scan when a context object
 * has no candidate keys at all.
 */
export const SENSITIVE_KEY_FRAGMENTS =
  /(?:password|token|secret|authorization|cookie|drawing|replay|chat|payload)/iu;
