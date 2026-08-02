export type GoogleApiErrorCategory = 'authentication' | 'permission' | 'rate_limit' | 'server' | 'network' | 'invalid_response';
export declare class GoogleApiError extends Error {
    readonly category: GoogleApiErrorCategory;
    readonly status: number | undefined;
    readonly requestId: string;
    readonly name = "GoogleApiError";
    constructor(message: string, category: GoogleApiErrorCategory, status: number | undefined, requestId: string, options?: ErrorOptions);
}
export declare function categorizeGoogleApiStatus(status: number): GoogleApiErrorCategory;
export declare function isRetryableGoogleApiStatus(status: number): boolean;
