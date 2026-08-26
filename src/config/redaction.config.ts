export const DEFAULT_REDACT_KEYS =
  /(?<secret>password|token|secret|authorization|cookie|drawing|replay|chat|payload)/iu;

export const BEARER_PATTERN = /bearer\s+[^\s]+/giu;
export const KEY_VALUE_PATTERN = /(?<key>password|token|secret|authorization|cookie)=?[^\s,;]+/giu;
export const MESSAGE_REDACTION_PATTERN = /bearer\s+|password|token|secret|authorization|cookie/iu;

/**
 * Opt-in free-text detectors for `settings.redactPii`. The card pattern is
 * a deliberate heuristic: 13-19 digits grouped in 4s with optional
 * separators, so phone numbers and plain ids mostly pass through while
 * payment-card shapes do not. Both patterns are stateful (`g`) and must
 * run through the stateful-safe matcher.
 */
export const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu;
export const CARD_PATTERN = /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,4}\b/gu;

/**
 * Fast pre-filter for redaction: keys containing any of these fragments
 * can carry secrets. Used to skip the deep-copy scan when a context object
 * has no candidate keys at all.
 */
export const SENSITIVE_KEY_FRAGMENTS =
  /(?:password|token|secret|authorization|cookie|drawing|replay|chat|payload)/iu;
