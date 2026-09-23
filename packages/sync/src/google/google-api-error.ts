export type GoogleApiErrorCategory =
  | 'authentication'
  | 'permission'
  | 'download_restricted'
  | 'export_size_limit'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'invalid_response';

/*
 * Google names the cause of a failure twice: in a human message, which can
 * quote a file name, a project, or a URL, and in a reason code. Only the code
 * is kept. Drive's legacy `errors[].reason` is camelCase and AIP-193's
 * `ErrorInfo.reason` is UPPER_SNAKE_CASE; anything else is not a code.
 */
const SAFE_REASON = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const SAFE_FILE_ID = /^[A-Za-z0-9_-]{1,256}$/u;
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_ERROR_REASONS = 8;
const ERROR_INFO_TYPE = 'type.googleapis.com/google.rpc.ErrorInfo';

/*
 * Drive answers several unrelated conditions with 403. The reason code is what
 * tells a quota Google asks callers to back off from apart from a document an
 * editor has to change.
 */
const RETRYABLE_RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
]);
const RATE_LIMIT_REASONS = new Set([
  ...RETRYABLE_RATE_LIMIT_REASONS,
  'dailyLimitExceeded',
]);
const EXPORT_SIZE_LIMIT_REASONS = new Set(['exportSizeLimitExceeded']);
const DOWNLOAD_RESTRICTED_REASONS = new Set([
  'cannotDownloadFile',
  'cannotExportFile',
]);

export interface GoogleApiErrorOptions extends ErrorOptions {
  reasons?: readonly string[] | undefined;
  fileId?: string | undefined;
}

export class GoogleApiError extends Error {
  override readonly name = 'GoogleApiError';
  /** Google's reason codes for the failure, reduced to safe codes. */
  readonly reasons: readonly string[];
  /** The Google file the failed request was about, when it was about one. */
  readonly fileId: string | undefined;

  constructor(
    message: string,
    readonly category: GoogleApiErrorCategory,
    readonly status: number | undefined,
    readonly requestId: string,
    options: GoogleApiErrorOptions = {},
  ) {
    const { reasons = [], fileId, ...errorOptions } = options;
    super(message, errorOptions);
    this.reasons = selectSafeReasons(reasons);
    this.fileId =
      fileId !== undefined && SAFE_FILE_ID.test(fileId) ? fileId : undefined;
  }
}

export function categorizeGoogleApiStatus(
  status: number,
): GoogleApiErrorCategory {
  return categorizeGoogleApiFailure(status, []);
}

export function categorizeGoogleApiFailure(
  status: number,
  reasons: readonly string[],
): GoogleApiErrorCategory {
  if (status === 401) {
    return 'authentication';
  }
  if (status === 403) {
    if (reasons.some((reason) => RATE_LIMIT_REASONS.has(reason))) {
      return 'rate_limit';
    }
    if (reasons.some((reason) => EXPORT_SIZE_LIMIT_REASONS.has(reason))) {
      return 'export_size_limit';
    }
    if (reasons.some((reason) => DOWNLOAD_RESTRICTED_REASONS.has(reason))) {
      return 'download_restricted';
    }
    return 'permission';
  }
  if (status === 429) {
    return 'rate_limit';
  }
  return status >= 500 ? 'server' : 'invalid_response';
}

export function isRetryableGoogleApiStatus(status: number): boolean {
  return isRetryableGoogleApiFailure(status, []);
}

export function isRetryableGoogleApiFailure(
  status: number,
  reasons: readonly string[],
): boolean {
  if (status === 403) {
    return reasons.some((reason) => RETRYABLE_RATE_LIMIT_REASONS.has(reason));
  }
  return status === 429 || [500, 502, 503, 504].includes(status);
}

/**
 * Reads the reason codes out of a failed response. The body is read only up
 * to a fixed size, and a body that is larger, unreadable, or not Google's JSON
 * error shape yields no reasons rather than an error of its own.
 */
export async function readGoogleApiErrorReasons(
  response: Response,
): Promise<string[]> {
  const reader = response.body?.getReader();
  if (!reader) {
    return [];
  }

  const decoder = new TextDecoder();
  let body = '';
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_ERROR_BODY_BYTES) {
        return [];
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch {
    return [];
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return parseGoogleApiErrorReasons(body);
}

export function parseGoogleApiErrorReasons(body: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const error = isRecord(parsed) ? parsed.error : undefined;
  if (!isRecord(error)) {
    return [];
  }

  const reasons: unknown[] = [];
  if (Array.isArray(error.errors)) {
    for (const entry of error.errors) {
      if (isRecord(entry)) {
        reasons.push(entry.reason);
      }
    }
  }
  if (Array.isArray(error.details)) {
    for (const detail of error.details) {
      if (isRecord(detail) && detail['@type'] === ERROR_INFO_TYPE) {
        reasons.push(detail.reason);
      }
    }
  }
  return selectSafeReasons(reasons);
}

/**
 * The fields the command line prints for a failed Google request. Every value
 * is one the error has already reduced to a code or an identifier.
 */
export function describeGoogleApiError(error: GoogleApiError): string {
  return [
    `status=${error.status ?? 'unavailable'}`,
    ...(error.reasons.length > 0 ? [`reason=${error.reasons.join(',')}`] : []),
    ...(error.fileId ? [`fileId=${error.fileId}`] : []),
    `requestId=${error.requestId}`,
  ].join(' ');
}

function selectSafeReasons(candidates: readonly unknown[]): string[] {
  const reasons: string[] = [];
  for (const candidate of candidates) {
    if (
      typeof candidate === 'string' &&
      SAFE_REASON.test(candidate) &&
      !reasons.includes(candidate)
    ) {
      reasons.push(candidate);
      if (reasons.length === MAX_ERROR_REASONS) {
        break;
      }
    }
  }
  return reasons;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
