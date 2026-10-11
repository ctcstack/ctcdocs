import { describe, expect, it } from 'vitest';

import { languageName } from './language-name.js';

describe('languageName', () => {
  it('names a locale by its language, in English', () => {
    expect(languageName('en')).toBe('English');
    expect(languageName('en-GB')).toBe('English');
    expect(languageName('uk')).toBe('Ukrainian');
  });

  it('names nothing it cannot read', () => {
    expect(languageName('zz')).toBeUndefined();
    expect(languageName('zz-YY')).toBeUndefined();
    expect(languageName('not a tag')).toBeUndefined();
  });
});
