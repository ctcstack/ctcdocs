export interface GoogleAccessTokenProvider {
    getAccessToken(): Promise<string>;
}
export declare class GoogleAuthenticationConfigurationError extends Error {
    readonly name = "GoogleAuthenticationConfigurationError";
}
export declare class StaticGoogleAccessTokenProvider implements GoogleAccessTokenProvider {
    private readonly accessToken;
    constructor(accessToken: string);
    getAccessToken(): Promise<string>;
}
export declare function createEnvironmentGoogleAccessTokenProvider(environment: Record<string, string | undefined>): GoogleAccessTokenProvider;
