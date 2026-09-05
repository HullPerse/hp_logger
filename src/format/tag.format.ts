import type { TagCase } from "../types/logger.js";

const TAG_CASE_TRANSFORMS: Record<TagCase, (value: string) => string> = {
  lower: (value) => value.toLowerCase(),
  none: (value) => value,
  upper: (value) => value.toUpperCase(),
};

export const caseTag = (value: string, tagCase: TagCase): string =>
  TAG_CASE_TRANSFORMS[tagCase](value);
