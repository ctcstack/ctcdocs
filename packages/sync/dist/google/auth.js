export class GoogleAuthenticationConfigurationError extends Error {
    name = 'GoogleAuthenticationConfigurationError';
}
export class StaticGoogleAccessTokenProvider {
    accessToken;
    constructor(accessToken) {
        this.accessToken = accessToken;
        if (accessToken.trim().length === 0) {
            throw new GoogleAuthenticationConfigurationError('The Google access token is empty.');
        }
    }
    async getAccessToken() {
        return this.accessToken;
    }
}
export function createEnvironmentGoogleAccessTokenProvider(environment) {
    const accessToken = environment.GOOGLE_ACCESS_TOKEN?.trim();
    if (!accessToken) {
        throw new GoogleAuthenticationConfigurationError('GOOGLE_ACCESS_TOKEN is required. Use the protected GitHub WIF workflow to obtain a short-lived token.');
    }
    return new StaticGoogleAccessTokenProvider(accessToken);
}
