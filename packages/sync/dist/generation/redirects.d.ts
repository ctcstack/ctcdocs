import type { SyncManifest } from '../manifest.js';
export declare function createRedirectMap(manifest: SyncManifest): Record<string, string>;
export declare function serializeRedirectMap(redirects: Readonly<Record<string, string>>, sourceHeader: string): string;
