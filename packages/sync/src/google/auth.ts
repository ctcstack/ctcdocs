export interface GoogleAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export class GoogleAuthenticationConfigurationError extends Error {
  override readonly name = 'GoogleAuthenticationConfigurationError';
}

export class StaticGoogleAccessTokenProvider implements GoogleAccessTokenProvider {
  constructor(private readonly accessToken: string) {
    if (accessToken.trim().length === 0) {
      throw new GoogleAuthenticationConfigurationError(
        'The Google access token is empty.',
      );
    }
  }

  async getAccessToken(): Promise<string> {
    return this.accessToken;
  }
}

export function createEnvironmentGoogleAccessTokenProvider(
  environment: Record<string, string | undefined>,
): GoogleAccessTokenProvider {
  const accessToken = environment.GOOGLE_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new GoogleAuthenticationConfigurationError(
      'GOOGLE_ACCESS_TOKEN is required. Use the protected GitHub WIF workflow to obtain a short-lived token.',
    );
  }

  return new StaticGoogleAccessTokenProvider(accessToken);
}
