export type GoogleApiErrorCategory =
  | 'authentication'
  | 'permission'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'invalid_response';

export class GoogleApiError extends Error {
  override readonly name = 'GoogleApiError';

  constructor(
    message: string,
    readonly category: GoogleApiErrorCategory,
    readonly status: number | undefined,
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function categorizeGoogleApiStatus(
  status: number,
): GoogleApiErrorCategory {
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

export function isRetryableGoogleApiStatus(status: number): boolean {
  return status === 429 || [500, 502, 503, 504].includes(status);
}
