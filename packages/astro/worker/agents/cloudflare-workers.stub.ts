/**
 * Stands in for the `cloudflare:workers` module in Node tests. The OAuth
 * library imports `WorkerEntrypoint` for its RPC entry, which these tests do
 * not use.
 */
export class WorkerEntrypoint {
  readonly stub = true;
}
