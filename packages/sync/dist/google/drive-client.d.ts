import type { GoogleAccessTokenProvider } from './auth.js';
import { type DriveItem } from './drive-types.js';
export declare const MAX_GOOGLE_EXPORT_BYTES: number;
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
export declare class GoogleDriveClient {
    private readonly options;
    private readonly fetchImplementation;
    private readonly sleep;
    private readonly baseUrl;
    constructor(options: GoogleDriveClientOptions);
    validateReadScope(rootFolderId: string): Promise<void>;
    listInventory(): Promise<DriveItem[]>;
    exportMarkdown(fileId: string): Promise<Uint8Array>;
    exportHtmlZip(fileId: string): Promise<Uint8Array>;
    private exportFile;
    private requestJson;
    private request;
    private retryDelayMilliseconds;
    private safeRequestId;
}
export {};
