import { z } from 'zod';

import type { GoogleAccessTokenProvider } from './auth.js';
import {
  categorizeGoogleApiStatus,
  GoogleApiError,
  isRetryableGoogleApiStatus,
} from './google-api-error.js';

const DOCS_API_BASE_URL = 'https://docs.googleapis.com/v1';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/u;
const DOCUMENT_FIELDS =
  'tabs(tabProperties(tabId),documentTab(inlineObjects,positionedObjects),childTabs(tabProperties(tabId)))';

type Sleep = (milliseconds: number) => Promise<void>;

const embeddedObjectSchema = z
  .object({
    embeddedDrawingProperties: z.object({}).passthrough().optional(),
    imageProperties: z.object({}).passthrough().optional(),
  })
  .passthrough();

const inlineObjectSchema = z
  .object({
    objectId: z.string().optional(),
    inlineObjectProperties: z
      .object({ embeddedObject: embeddedObjectSchema.optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const positionedObjectSchema = z
  .object({
    objectId: z.string().optional(),
    positionedObjectProperties: z
      .object({ embeddedObject: embeddedObjectSchema.optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const tabSchema = z
  .object({
    tabProperties: z.object({ tabId: z.string().min(1) }).passthrough(),
    documentTab: z
      .object({
        inlineObjects: z.record(z.string(), inlineObjectSchema).optional(),
        positionedObjects: z
          .record(z.string(), positionedObjectSchema)
          .optional(),
      })
      .passthrough()
      .optional(),
    childTabs: z
      .array(
        z.object({
          tabProperties: z.object({ tabId: z.string().min(1) }).passthrough(),
        }),
      )
      .optional(),
  })
  .passthrough();

const documentResponseSchema = z.object({
  tabs: z.array(tabSchema).min(1),
});

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

export class GoogleDocsClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: Sleep;
  private readonly baseUrl: string;

  constructor(private readonly options: GoogleDocsClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        }));
    this.baseUrl = options.baseUrl ?? DOCS_API_BASE_URL;
  }

  async inspectDocument(fileId: string): Promise<GoogleDocumentStructure> {
    const url = new URL(
      `${this.baseUrl}/documents/${encodeURIComponent(fileId)}`,
    );
    url.searchParams.set('includeTabsContent', 'true');
    url.searchParams.set('fields', DOCUMENT_FIELDS);
    const response = await this.request(url);

    let parsed: z.infer<typeof documentResponseSchema>;
    try {
      parsed = documentResponseSchema.parse(await response.json());
    } catch (error: unknown) {
      throw new GoogleApiError(
        'Google Docs API returned an invalid structural response.',
        'invalid_response',
        response.status,
        this.safeRequestId(response),
        { cause: error },
      );
    }

    if (parsed.tabs.some((tab) => (tab.childTabs?.length ?? 0) > 0)) {
      throw new GoogleApiError(
        'Nested Google Docs tabs are not supported by this converter version.',
        'invalid_response',
        response.status,
        this.safeRequestId(response),
      );
    }

    let inlineObjectCount = 0;
    let positionedObjectCount = 0;
    let hasEmbeddedDrawings = false;
    let hasImages = false;
    for (const tab of parsed.tabs) {
      const inlineObjects = Object.values(tab.documentTab?.inlineObjects ?? {});
      const positionedObjects = Object.values(
        tab.documentTab?.positionedObjects ?? {},
      );
      inlineObjectCount += inlineObjects.length;
      positionedObjectCount += positionedObjects.length;
      for (const embeddedObject of [
        ...inlineObjects.map(
          (object) => object.inlineObjectProperties?.embeddedObject,
        ),
        ...positionedObjects.map(
          (object) => object.positionedObjectProperties?.embeddedObject,
        ),
      ]) {
        hasEmbeddedDrawings ||= Boolean(
          embeddedObject?.embeddedDrawingProperties,
        );
        hasImages ||= Boolean(embeddedObject?.imageProperties);
      }
    }

    return {
      hasEmbeddedDrawings,
      hasImages,
      inlineObjectCount,
      positionedObjectCount,
      tabCount: parsed.tabs.length,
    };
  }

  private async request(url: URL): Promise<Response> {
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      let response: Response;
      try {
        const accessToken =
          await this.options.accessTokenProvider.getAccessToken();
        response = await this.fetchImplementation(url, {
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: 'application/json',
          },
          signal: AbortSignal.timeout(this.options.timeoutMilliseconds),
        });
      } catch (error: unknown) {
        if (attempt < this.options.maxRetries) {
          await this.sleep(this.retryDelayMilliseconds(attempt));
          continue;
        }
        throw new GoogleApiError(
          'Google Docs API network request failed.',
          'network',
          undefined,
          'unavailable',
          { cause: error },
        );
      }

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
          `Google Docs API request failed with status ${response.status}.`,
          categorizeGoogleApiStatus(response.status),
          response.status,
          this.safeRequestId(response),
        );
      }
      return response;
    }

    throw new GoogleApiError(
      'Google Docs API retry loop terminated unexpectedly.',
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
    return retryAfterSeconds === undefined
      ? Math.min(250 * 2 ** attempt, 10_000)
      : Math.min(retryAfterSeconds * 1_000, 30_000);
  }

  private safeRequestId(response: Response): string {
    const requestId = response.headers.get('x-request-id');
    return requestId && SAFE_REQUEST_ID.test(requestId)
      ? requestId
      : 'unavailable';
  }
}
