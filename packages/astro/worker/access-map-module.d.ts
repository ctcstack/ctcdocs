/*
 * The access map of the build being deployed. The project's Wrangler
 * configuration aliases this name to `.ctcdocs/access-map.json`, so the Worker
 * is always bundled with the map of the files it serves (ADR-039).
 */
declare module 'ctcdocs-access-map' {
  import type { AccessMapFile } from './access-map.js';

  const map: AccessMapFile;
  export default map;
}
