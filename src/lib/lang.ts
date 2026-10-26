/**
 * Which language is this item in?
 *
 * A pasted list may mix English and Vietnamese lines:
 *
 *   criminal
 *   trách nhiệm dân sự
 *   environmental protection
 *   bảo vệ môi trường
 *
 * Detecting this per item (never per whole list) is what lets the importer send
 * Vietnamese items down the translation path and English items straight to the
 * dictionary path.
 *
 * The test is deliberately a script/diacritic test rather than a model call:
 * it must be free, instant, deterministic and testable. Vietnamese is written
 * in the Latin script, so the signal is the vowels and letters English does not
 * use (ă â đ ê ô ơ ư) plus the tone marks on vowels.
 *
 * Known and accepted limit: a Vietnamese item typed without any diacritic
 * ("bao ve moi truong") looks like English to this function. The learner sees
 * the row in the preview, unedited, and the AI explanation of such an item
 * comes back as gibberish rather than as a wrong translation, so nothing is
 * saved silently. Detecting it reliably would need a model call per item.
 */

export type InputLanguage = 'en' | 'vi' | 'unknown';

/** Letters that exist in Vietnamese but not in English. */
const VI_LETTERS = /[ăâđêôơư]/i;

/** Vowels carrying a tone mark (à á ả ã ạ è é … ỳ ỹ ỵ) and â/ê/ô/ơ/ư variants. */
const VI_TONE_MARKS =
  /[\u00C0-\u00C3\u00C8-\u00CB\u00CC-\u00CF\u00D2-\u00D5\u00D9-\u00DC\u00E0-\u00E3\u00E8-\u00EB\u00EC-\u00EF\u00F2-\u00F5\u00F9-\u00FC\u0100-\u0103\u0128-\u0129\u0168-\u0169\u01A0-\u01B0\u1EA0-\u1EFF]/;

/** Headwords and phrases: letters, spaces, apostrophes, hyphens and dots. */
const HEADWORD = /^[a-z][a-z'’.\- ]*[a-z.]$/i;

export function hasVietnameseMarks(value: string): boolean {
  return VI_LETTERS.test(value) || VI_TONE_MARKS.test(value);
}

export function detectLanguage(value: string): InputLanguage {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'unknown';
  if (hasVietnameseMarks(clean)) return 'vi';
  if (HEADWORD.test(clean)) return 'en';
  // Latin letters with punctuation is still English-style input ("Hello!!!");
  // digits, emoji or other scripts are neither language we can translate.
  return /[a-z]/i.test(clean) ? 'en' : 'unknown';
}

export function isVietnamese(value: string): boolean {
  return detectLanguage(value) === 'vi';
}

/** Keep the learner's order; split one list into the two work queues. */
export function splitByLanguage<T extends { value: string; language: InputLanguage }>(
  items: readonly T[],
): { english: T[]; vietnamese: T[] } {
  return {
    english: items.filter((item) => item.language === 'en'),
    vietnamese: items.filter((item) => item.language === 'vi'),
  };
}
