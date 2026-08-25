/**
 * Terminal attention escape sequences for `settings.attention`. All of them
 * are logger-generated constants (never built from logged data) and are
 * written only when stdout is a TTY, so pipes and files stay clean.
 */
export const BELL_SEQUENCE = "\u0007";

/** OSC 0 sets window and icon title together; BEL terminator works everywhere. */
export const TITLE_PREFIX = "\u001B]0;";
export const TITLE_SUFFIX = "\u0007";

/** Title shown while an adaptive error storm is active. Cleared on storm end. */
export const STORM_TITLE = "hp_logger: storm";

/** OSC 9;4 taskbar progress (Windows Terminal, ConEmu). */
export const PROGRESS_PREFIX = "\u001B]9;4;";
export const PROGRESS_SUFFIX = "\u0007";
/** Subcommands: 0 remove, 2 error state, 3 indeterminate. */
export const PROGRESS_REMOVE = "0;0";
export const PROGRESS_ERROR = "2;0";
export const PROGRESS_INDETERMINATE = "3;0";
