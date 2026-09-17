/**
 * The two catalogues must offer the same keys.
 *
 * `translate` falls back to the Vietnamese catalogue when a key is missing
 * from the active one:
 *
 *   CATALOGS[locale]?.[key] ?? CATALOGS.vi[key]
 *
 * That fallback is deliberate -- a blank label is worse than a label in the
 * wrong language -- but it also means a missing English string is *invisible*
 * in development and ships as Vietnamese text inside an English UI. It did:
 * every `role.*` key existed in `vi` and none in `en`, so an English user saw
 * "Chủ sở hữu" in the workspace switcher and on the members screen. Nothing
 * failed, which is exactly why nobody noticed.
 *
 * Comparing key sets is the check the fallback removes the pressure to do.
 */

import { describe, expect, it } from 'vitest';

import { CATALOGS, LOCALE_NAMES } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';

describe('translation catalogues', () => {
  const reference = 'vi' as const;
  const LOCALES = Object.keys(LOCALE_NAMES) as Locale[];

  it('every locale offers the same keys as the reference catalogue', () => {
    const expected = Object.keys(CATALOGS[reference]).sort();

    for (const locale of LOCALES) {
      if (locale === reference) continue;
      const actual = Object.keys(CATALOGS[locale]).sort();

      const missing = expected.filter((key) => !actual.includes(key));
      const extra = actual.filter((key) => !expected.includes(key));

      expect(missing, `${locale} is missing keys that ${reference} defines`).toEqual([]);
      expect(extra, `${locale} defines keys ${reference} does not`).toEqual([]);
    }
  });

  it('no translation is left empty', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(CATALOGS[locale])) {
        expect(value, `${locale}.${key} is empty`).not.toBe('');
      }
    }
  });
});
