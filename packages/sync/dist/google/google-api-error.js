export class GoogleApiError extends Error {
    category;
    status;
    requestId;
    name = 'GoogleApiError';
    constructor(message, category, status, requestId, options) {
        super(message, options);
        this.category = category;
        this.status = status;
        this.requestId = requestId;
    }
}
export function categorizeGoogleApiStatus(status) {
    if (status === 401) {
        return 'authentication';
    }
    if (status === 403) {
        return 'permission';
    }
    if (status === 429) {
        return 'rate_limit';
    }
    return status >= 500 ? 'server' : 'invalid_response';
}
export function isRetryableGoogleApiStatus(status) {
    return status === 429 || [500, 502, 503, 504].includes(status);
}
