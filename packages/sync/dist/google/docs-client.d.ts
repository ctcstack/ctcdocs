import type { GoogleAccessTokenProvider } from './auth.js';
type Sleep = (milliseconds: number) => Promise<void>;
export interface GoogleDocumentStructure {
    hasEmbeddedDrawings: boolean;
    hasImages: boolean;
    inlineObjectCount: number;
    positionedObjectCount: number;
    tabCount: number;
}
export interface GoogleDocsClientOptions {
    accessTokenProvider: GoogleAccessTokenProvider;
    maxRetries: number;
    timeoutMilliseconds: number;
    fetchImplementation?: typeof fetch;
    sleep?: Sleep;
    baseUrl?: string;
}
export declare class GoogleDocsClient {
    private readonly options;
    private readonly fetchImplementation;
    private readonly sleep;
    private readonly baseUrl;
    constructor(options: GoogleDocsClientOptions);
    inspectDocument(fileId: string): Promise<GoogleDocumentStructure>;
    private request;
    private retryDelayMilliseconds;
    private safeRequestId;
}
export {};
