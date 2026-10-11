/**
 * A settled site search, as the page reports it (ADR-051), at
 * `POST /_kb/insights/search`.
 *
 * The gate has identified the reader before this is asked, and sends a
 * request from another site, or from a machine, away. What the body says is
 * the query, the results it showed and the page opened from them; who asked
 * is the session's, and the classes are the access decision's, never the
 * body's. The page opened is kept only when it is a page of this build the
 * reader may read. Each person records at most 30 a minute in an isolate;
 * past it, as when the database cannot write, the answer is the same: the
 * page learns nothing from it.
 */
import type { AccessMapFile } from '../access-map.js';
import { mayRead, recordedClasses, type Reader } from '../decide.js';
import { canonicalPath } from '../paths.js';
import type { StateContext } from '../handler.js';
import type { StateLog } from '../state/record.js';
import { siteSearchRecorder } from '../state/site-searches.js';

/** Bytes of a report the route reads at most. */
const BODY_BYTES = 4096;
/** Results a search can show at most, as far as a record believes. */
const RESULTS = 10_000;

/** The body as text, or nothing when it is longer than `limit` bytes. */
async function boundedText(
  request: Request,
  limit: number,
): Promise<string | undefined> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > limit || !request.body) {
    return declared > limit ? undefined : '';
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The page opened, as the access map names it, if the reader may read it. */
function openedPage(
  value: unknown,
  {
    map,
    reader,
    stale,
    origin,
  }: Pick<Context, 'map' | 'reader' | 'stale' | 'origin'>,
): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) {
    return null;
  }
  const path = canonicalPath(url);
  const fileClass = path === undefined ? undefined : map.files[path];
  return path !== undefined &&
    fileClass !== undefined &&
    mayRead(map, reader, fileClass, stale)
    ? path
    : null;
}

interface Context {
  readonly request: Request;
  readonly map: AccessMapFile;
  readonly reader: Reader & { readonly kind: 'person' };
  readonly stale: boolean;
  readonly origin: string;
  readonly state: StateContext | undefined;
  readonly now: number;
  readonly log: StateLog;
}

const accepted = () => new Response(null, { status: 204 });

export async function siteSearchAnswer(context: Context): Promise<Response> {
  const { request, map, reader, stale, state, now, log } = context;
  const text = await boundedText(request, BODY_BYTES);
  if (text === undefined) {
    return new Response('Too large', { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const { query, results, opened } = (
    typeof body === 'object' && body !== null ? body : {}
  ) as Record<string, unknown>;
  if (
    typeof query !== 'string' ||
    query.trim().length === 0 ||
    typeof results !== 'number' ||
    !Number.isInteger(results) ||
    results < 0 ||
    results > RESULTS
  ) {
    return new Response('Bad request', { status: 400 });
  }
  const { insights } = map.site;
  if (!insights.enabled || insights.siteSearch === false || !state) {
    return accepted();
  }
  const { record, dropped } = state.limits.searches.take(reader.sub, now);
  if (!record) {
    if (dropped === 1) {
      log({ event: 'state-record-limited', table: 'site_searches' });
    }
    return accepted();
  }
  siteSearchRecorder({
    database: state.database,
    schedule: state.schedule,
    log,
  })({
    at: new Date(now).toISOString(),
    query: query.trim(),
    classes: recordedClasses(map, reader, stale),
    results,
    opened: openedPage(opened, context),
  });
  return accepted();
}
