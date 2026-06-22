import { z } from 'zod';

/**
 * A user-facing string that must carry both Chinese and English.
 * astrolens i18n rule: every type / feature name / explanation ships zh + en.
 */
export const LocalizedString = z.object({
  zh: z.string(),
  en: z.string(),
});
export type LocalizedString = z.infer<typeof LocalizedString>;
