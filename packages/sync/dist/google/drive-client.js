import { driveFileListResponseSchema, rootFolderResponseSchema, sharedDriveResponseSchema, } from './drive-types.js';
import { categorizeGoogleApiStatus, GoogleApiError, isRetryableGoogleApiStatus, } from './google-api-error.js';
const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const MAX_INVENTORY_PAGES = 10_000;
export const MAX_GOOGLE_EXPORT_BYTES = 10 * 1024 * 1024;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/u;
export class GoogleDriveClient {
    options;
    fetchImplementation;
    sleep;
    baseUrl;
    constructor(options) {
        this.options = options;
        this.fetchImplementation = options.fetchImplementation ?? fetch;
        this.sleep =
            options.sleep ??
                ((milliseconds) => new Promise((resolve) => {
                    setTimeout(resolve, milliseconds);
                }));
        this.baseUrl = options.baseUrl ?? DRIVE_API_BASE_URL;
    }
    async validateReadScope(rootFolderId) {
        const drive = await this.requestJson(`drives/${encodeURIComponent(this.options.driveId)}`, { fields: 'id' }, sharedDriveResponseSchema);
        if (drive.id !== this.options.driveId) {
            throw new GoogleApiError('The returned Shared Drive does not match the configured scope.', 'invalid_response', undefined, 'unavailable');
        }
        const rootFolder = await this.requestJson(`files/${encodeURIComponent(rootFolderId)}`, {
            fields: 'id,driveId,mimeType,trashed',
            supportsAllDrives: 'true',
        }, rootFolderResponseSchema);
        if (rootFolder.id !== rootFolderId ||
            rootFolder.driveId !== this.options.driveId ||
            rootFolder.mimeType !== 'application/vnd.google-apps.folder' ||
            rootFolder.trashed) {
            throw new GoogleApiError('The configured root is not an active folder in the configured Shared Drive.', 'invalid_response', undefined, 'unavailable');
        }
    }
    async listInventory() {
        const items = [];
        const seenPageTokens = new Set();
        let pageToken;
        let pageCount = 0;
        do {
            if (pageCount >= MAX_INVENTORY_PAGES) {
                throw new GoogleApiError('Google Drive inventory exceeded the page safety limit.', 'invalid_response', undefined, 'unavailable');
            }
            if (pageToken && seenPageTokens.has(pageToken)) {
                throw new GoogleApiError('Google Drive returned a repeated inventory page token.', 'invalid_response', undefined, 'unavailable');
            }
            if (pageToken) {
                seenPageTokens.add(pageToken);
            }
            const page = await this.requestJson('files', {
                corpora: 'drive',
                driveId: this.options.driveId,
                includeItemsFromAllDrives: 'true',
                supportsAllDrives: 'true',
                spaces: 'drive',
                pageSize: '1000',
                q: 'trashed = false',
                fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,modifiedTime,createdTime,trashed,webViewLink,shortcutDetails(targetId,targetMimeType),size)',
                ...(pageToken ? { pageToken } : {}),
            }, driveFileListResponseSchema);
            if (page.incompleteSearch) {
                throw new GoogleApiError('Google Drive reported an incomplete inventory search.', 'invalid_response', undefined, 'unavailable');
            }
            items.push(...page.files);
            pageToken = page.nextPageToken;
            pageCount += 1;
        } while (pageToken);
        return items;
    }
    async exportMarkdown(fileId) {
        return this.exportFile(fileId, 'text/markdown');
    }
    async exportHtmlZip(fileId) {
        return this.exportFile(fileId, 'application/zip');
    }
    async exportFile(fileId, mimeType) {
        const response = await this.request(`files/${encodeURIComponent(fileId)}/export`, { mimeType }, mimeType);
        const declaredLength = response.headers.get('content-length');
        if (declaredLength &&
            /^\d+$/u.test(declaredLength) &&
            Number.parseInt(declaredLength, 10) > MAX_GOOGLE_EXPORT_BYTES) {
            throw new GoogleApiError('Google Drive export exceeded the 10 MB limit.', 'invalid_response', response.status, this.safeRequestId(response));
        }
        const reader = response.body?.getReader();
        if (!reader) {
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.byteLength > MAX_GOOGLE_EXPORT_BYTES) {
                throw new GoogleApiError('Google Drive export exceeded the 10 MB limit.', 'invalid_response', response.status, this.safeRequestId(response));
            }
            return bytes;
        }
        const chunks = [];
        let totalBytes = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            totalBytes += value.byteLength;
            if (totalBytes > MAX_GOOGLE_EXPORT_BYTES) {
                await reader.cancel();
                throw new GoogleApiError('Google Drive export exceeded the 10 MB limit.', 'invalid_response', response.status, this.safeRequestId(response));
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
    async requestJson(path, searchParameters, schema) {
        const response = await this.request(path, searchParameters, 'application/json');
        try {
            return schema.parse(await response.json());
        }
        catch (error) {
            throw new GoogleApiError('Google Drive API returned an invalid JSON response.', 'invalid_response', response.status, this.safeRequestId(response), { cause: error });
        }
    }
    async request(path, searchParameters, accept) {
        const url = new URL(`${this.baseUrl}/${path}`);
        for (const [name, value] of Object.entries(searchParameters)) {
            url.searchParams.set(name, value);
        }
        for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
            let response;
            try {
                const accessToken = await this.options.accessTokenProvider.getAccessToken();
                response = await this.fetchImplementation(url, {
                    headers: {
                        authorization: `Bearer ${accessToken}`,
                        accept,
                    },
                    signal: AbortSignal.timeout(this.options.timeoutMilliseconds),
                });
            }
            catch (error) {
                if (attempt < this.options.maxRetries) {
                    await this.sleep(this.retryDelayMilliseconds(attempt));
                    continue;
                }
                throw new GoogleApiError('Google Drive API network request failed.', 'network', undefined, 'unavailable', { cause: error });
            }
            const requestId = this.safeRequestId(response);
            if (!response.ok) {
                if (isRetryableGoogleApiStatus(response.status) &&
                    attempt < this.options.maxRetries) {
                    await this.sleep(this.retryDelayMilliseconds(attempt, response.headers.get('retry-after')));
                    continue;
                }
                throw new GoogleApiError(`Google Drive API request failed with status ${response.status}.`, categorizeGoogleApiStatus(response.status), response.status, requestId);
            }
            return response;
        }
        throw new GoogleApiError('Google Drive API retry loop terminated unexpectedly.', 'invalid_response', undefined, 'unavailable');
    }
    retryDelayMilliseconds(attempt, retryAfter = null) {
        const retryAfterSeconds = retryAfter && /^\d+$/u.test(retryAfter)
            ? Number.parseInt(retryAfter, 10)
            : undefined;
        if (retryAfterSeconds !== undefined) {
            return Math.min(retryAfterSeconds * 1_000, 30_000);
        }
        return Math.min(250 * 2 ** attempt, 10_000);
    }
    safeRequestId(response) {
        const requestId = response.headers.get('x-guploader-uploadid') ??
            response.headers.get('x-request-id');
        return requestId && SAFE_REQUEST_ID.test(requestId)
            ? requestId
            : 'unavailable';
    }
}
