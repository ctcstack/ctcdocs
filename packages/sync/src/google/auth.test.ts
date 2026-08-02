import { describe, expect, it } from 'vitest';

import {
  GoogleAuthenticationConfigurationError,
  StaticGoogleAccessTokenProvider,
  createEnvironmentGoogleAccessTokenProvider,
} from './auth.js';

describe('Google access token providers', () => {
  it('returns the configured short-lived token', async () => {
    const provider = createEnvironmentGoogleAccessTokenProvider({
      GOOGLE_ACCESS_TOKEN: ' short-lived-token ',
    });

    await expect(provider.getAccessToken()).resolves.toBe('short-lived-token');
  });

  it('rejects missing or empty credentials without including their value', () => {
    expect(() => createEnvironmentGoogleAccessTokenProvider({})).toThrow(
      GoogleAuthenticationConfigurationError,
    );
    expect(() => new StaticGoogleAccessTokenProvider('  ')).toThrow(
      'The Google access token is empty.',
    );
  });
});
