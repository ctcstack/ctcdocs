import type { z } from 'zod';

import type { GoogleAccessTokenProvider } from './auth.js';
import {
  driveFileListResponseSchema,
  rootFolderResponseSchema,
  sharedDriveResponseSchema,
  type DriveItem,
} from './drive-types.js';
import {
  categorizeGoogleApiStatus,
  GoogleApiError,
  isRetryableGoogleApiStatus,
} from './google-api-error.js';

const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const MAX_INVENTORY_PAGES = 10_000;
export const MAX_GOOGLE_EXPORT_BYTES = 10 * 1024 * 1024;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/u;

type Sleep = (milliseconds: number) => Promise<void>;

export interface GoogleDriveClientOptions {
  driveId: string;
  accessTokenProvider: GoogleAccessTokenProvider;
  maxRetries: number;
  timeoutMilliseconds: number;
  fetchImplementation?: typeof fetch;
  sleep?: Sleep;
  baseUrl?: string;
}

export class GoogleDriveClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: Sleep;
  private readonly baseUrl: string;

  constructor(private readonly options: GoogleDriveClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        }));
    this.baseUrl = options.baseUrl ?? DRIVE_API_BASE_URL;
  }

  async validateReadScope(rootFolderId: string): Promise<void> {
    const drive = await this.requestJson(
      `drives/${encodeURIComponent(this.options.driveId)}`,
      { fields: 'id' },
      sharedDriveResponseSchema,
    );
    if (drive.id !== this.options.driveId) {
      throw new GoogleApiError(
        'The returned Shared Drive does not match the configured scope.',
        'invalid_response',
        undefined,
        'unavailable',
      );
    }

    const rootFolder = await this.requestJson(
      `files/${encodeURIComponent(rootFolderId)}`,
      {
        fields: 'id,driveId,mimeType,trashed',
        supportsAllDrives: 'true',
      },
      rootFolderResponseSchema,
    );
    if (
      rootFolder.id !== rootFolderId ||
      rootFolder.driveId !== this.options.driveId ||
      rootFolder.mimeType !== 'application/vnd.google-apps.folder' ||
      rootFolder.trashed
    ) {
      throw new GoogleApiError(
        'The configured root is not an active folder in the configured Shared Drive.',
        'invalid_response',
        undefined,
        'unavailable',
      );
    }
  }

  async listInventory(): Promise<DriveItem[]> {
    const items: DriveItem[] = [];
    const seenPageTokens = new Set<string>();
    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      if (pageCount >= MAX_INVENTORY_PAGES) {
        throw new GoogleApiError(
          'Google Drive inventory exceeded the page safety limit.',
          'invalid_response',
          undefined,
          'unavailable',
        );
      }
      if (pageToken && seenPageTokens.has(pageToken)) {
        throw new GoogleApiError(
          'Google Drive returned a repeated inventory page token.',
          'invalid_response',
          undefined,
          'unavailable',
        );
      }
      if (pageToken) {
        seenPageTokens.add(pageToken);
      }

      const page = await this.requestJson(
        'files',
        {
          corpora: 'drive',
          driveId: this.options.driveId,
          includeItemsFromAllDrives: 'true',
          supportsAllDrives: 'true',
          spaces: 'drive',
          pageSize: '1000',
          q: 'trashed = false',
          fields:
            'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,modifiedTime,createdTime,trashed,webViewLink,shortcutDetails(targetId,targetMimeType),size)',
          ...(pageToken ? { pageToken } : {}),
        },
        driveFileListResponseSchema,
      );
      if (page.incompleteSearch) {
        throw new GoogleApiError(
          'Google Drive reported an incomplete inventory search.',
          'invalid_response',
          undefined,
          'unavailable',
        );
      }

      items.push(...page.files);
      pageToken = page.nextPageToken;
      pageCount += 1;
    } while (pageToken);

    return items;
  }

  async exportMarkdown(fileId: string): Promise<Uint8Array> {
    return this.exportFile(fileId, 'text/markdown');
  }

  async exportHtmlZip(fileId: string): Promise<Uint8Array> {
    return this.exportFile(fileId, 'application/zip');
  }

  private async exportFile(
    fileId: string,
    mimeType: 'application/zip' | 'text/markdown',
  ): Promise<Uint8Array> {
    const response = await this.request(
      `files/${encodeURIComponent(fileId)}/export`,
      { mimeType },
      mimeType,
    );
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength &&
      /^\d+$/u.test(declaredLength) &&
      Number.parseInt(declaredLength, 10) > MAX_GOOGLE_EXPORT_BYTES
    ) {
      throw new GoogleApiError(
        'Google Drive export exceeded the 10 MB limit.',
        'invalid_response',
        response.status,
        this.safeRequestId(response),
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_GOOGLE_EXPORT_BYTES) {
        throw new GoogleApiError(
          'Google Drive export exceeded the 10 MB limit.',
          'invalid_response',
          response.status,
          this.safeRequestId(response),
        );
      }
      return bytes;
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_GOOGLE_EXPORT_BYTES) {
        await reader.cancel();
        throw new GoogleApiError(
          'Google Drive export exceeded the 10 MB limit.',
          'invalid_response',
          response.status,
          this.safeRequestId(response),
        );
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  private async requestJson<TSchema extends z.ZodType>(
    path: string,
    searchParameters: Record<string, string>,
    schema: TSchema,
  ): Promise<z.infer<TSchema>> {
    const response = await this.request(
      path,
      searchParameters,
      'application/json',
    );
    try {
      return schema.parse(await response.json()) as z.infer<TSchema>;
    } catch (error: unknown) {
      throw new GoogleApiError(
        'Google Drive API returned an invalid JSON response.',
        'invalid_response',
        response.status,
        this.safeRequestId(response),
        { cause: error },
      );
    }
  }

  private async request(
    path: string,
    searchParameters: Record<string, string>,
    accept: string,
  ): Promise<Response> {
    const url = new URL(`${this.baseUrl}/${path}`);
    for (const [name, value] of Object.entries(searchParameters)) {
      url.searchParams.set(name, value);
    }

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      let response: Response;
      try {
        const accessToken =
          await this.options.accessTokenProvider.getAccessToken();
        response = await this.fetchImplementation(url, {
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept,
          },
          signal: AbortSignal.timeout(this.options.timeoutMilliseconds),
        });
      } catch (error: unknown) {
        if (attempt < this.options.maxRetries) {
          await this.sleep(this.retryDelayMilliseconds(attempt));
          continue;
        }
        throw new GoogleApiError(
          'Google Drive API network request failed.',
          'network',
          undefined,
          'unavailable',
          { cause: error },
        );
      }

      const requestId = this.safeRequestId(response);
      if (!response.ok) {
        if (
          isRetryableGoogleApiStatus(response.status) &&
          attempt < this.options.maxRetries
        ) {
          await this.sleep(
            this.retryDelayMilliseconds(
              attempt,
              response.headers.get('retry-after'),
            ),
          );
          continue;
        }

        throw new GoogleApiError(
          `Google Drive API request failed with status ${response.status}.`,
          categorizeGoogleApiStatus(response.status),
          response.status,
          requestId,
        );
      }

      return response;
    }

    throw new GoogleApiError(
      'Google Drive API retry loop terminated unexpectedly.',
      'invalid_response',
      undefined,
      'unavailable',
    );
  }

  private retryDelayMilliseconds(
    attempt: number,
    retryAfter: string | null = null,
  ): number {
    const retryAfterSeconds =
      retryAfter && /^\d+$/u.test(retryAfter)
        ? Number.parseInt(retryAfter, 10)
        : undefined;
    if (retryAfterSeconds !== undefined) {
      return Math.min(retryAfterSeconds * 1_000, 30_000);
    }

    return Math.min(250 * 2 ** attempt, 10_000);
  }

  private safeRequestId(response: Response): string {
    const requestId =
      response.headers.get('x-guploader-uploadid') ??
      response.headers.get('x-request-id');
    return requestId && SAFE_REQUEST_ID.test(requestId)
      ? requestId
      : 'unavailable';
  }
}
