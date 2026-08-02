/**
 * Builds the fixture project's corpus by running the real pipeline.
 *
 * The corpus is converter output, not hand-written Markdown. A hand-written
 * fixture drifts the first time conversion changes and nobody notices; this one
 * cannot, because CI regenerates it and fails on any diff — the same
 * idempotence the pipeline already guarantees, used as a staleness check.
 *
 * The Drive is synthetic: the exports below are the bytes Google would return,
 * and no network call is made. Real documentation content must never reach this
 * repository.
 *
 * Run it with `pnpm fixtures:generate`.
 */
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import {
  GENERATED_DIRECTORY_ALLOWLIST,
  GENERATED_FILE_ALLOWLIST,
  loadSiteConfiguration,
} from '@ctcstack/ctcdocs-core';
import {
  buildInventorySelection,
  createInventoryReport,
  createSyncContext,
  parseSyncConfiguration,
  runBasicMarkdownSync,
  StaticGoogleAccessTokenProvider,
  type DriveItem,
  type InventoryRunResult,
} from '@ctcstack/ctcdocs-sync';

const FOLDER = 'application/vnd.google-apps.folder';
const DOCUMENT = 'application/vnd.google-apps.document';

const DRIVE_ID = 'fixture-drive';
const ROOT_ID = 'folder-root';

/*
 * Fixed timestamps. A clock in the input would make an unchanged corpus
 * produce a diff on every run, which is exactly what this fixture exists to
 * detect.
 */
const CREATED_AT = '2026-01-05T09:00:00.000Z';
const MODIFIED_AT = new Map([
  ['doc-getting-started', '2026-02-02T11:30:00.000Z'],
  ['doc-overview', '2026-02-05T08:15:00.000Z'],
  ['doc-tables-and-code', '2026-02-06T16:45:00.000Z'],
  ['doc-diagrams', '2026-02-07T10:05:00.000Z'],
  ['doc-screenshots', '2026-02-08T12:20:00.000Z'],
  ['doc-cyrillic', '2026-02-09T07:40:00.000Z'],
]);
const RUN_AT = new Date('2026-02-10T06:00:00.000Z');

const projectRoot = fileURLToPath(new URL('./project/', import.meta.url));

function folder(id: string, name: string, parent: string): DriveItem {
  return {
    id,
    name,
    mimeType: FOLDER,
    parents: [parent],
    createdTime: CREATED_AT,
    modifiedTime: CREATED_AT,
    trashed: false,
  };
}

function document(id: string, name: string, parent: string): DriveItem {
  return {
    id,
    name,
    mimeType: DOCUMENT,
    parents: [parent],
    createdTime: CREATED_AT,
    modifiedTime: MODIFIED_AT.get(id) ?? CREATED_AT,
    trashed: false,
  };
}

/**
 * The synthetic Drive.
 *
 * `Handbook` holds a landing document, so its card describes itself.
 * `Reference` deliberately holds none, which is the fallback case.
 */
const items: DriveItem[] = [
  folder(ROOT_ID, 'Published', DRIVE_ID),
  folder('folder-handbook', '01 - Handbook', ROOT_ID),
  folder('folder-reference', '02 - Reference', ROOT_ID),
  document('doc-getting-started', 'Getting started', ROOT_ID),
  document('doc-cyrillic', 'Рабочие заметки', ROOT_ID),
  document('doc-overview', 'Overview', 'folder-handbook'),
  document('doc-tables-and-code', '01 - Tables and code', 'folder-handbook'),
  document('doc-diagrams', 'Diagrams', 'folder-reference'),
  document('doc-screenshots', 'Screenshots', 'folder-reference'),
];

/** Google's Markdown export, as the pipeline receives it. */
const markdownExports = new Map<string, string>([
  [
    'doc-getting-started',
    [
      '# Getting started',
      '',
      'This corpus is synthetic. It exists so the platform can prove that a',
      'documentation site builds, navigates, searches and passes accessibility',
      'checks without any real content being involved.',
      '',
      'Start with the [handbook overview](https://docs.google.com/document/d/doc-overview/edit),',
      'which describes what each section holds.',
      '',
    ].join('\n'),
  ],
  [
    'doc-overview',
    [
      '# Overview',
      '',
      'The handbook collects the working agreements a new joiner needs in their',
      'first week: how documents are published, where drafts live, and which',
      'sections are maintained by which team.',
      '',
      'Nothing in it is real. It is here so a folder has a document that speaks',
      'for it, which is what gives the folder card its description.',
      '',
    ].join('\n'),
  ],
  [
    'doc-tables-and-code',
    [
      '# Tables and code',
      '',
      'Two things a documentation platform gets wrong quietly: wide tables that',
      'push a phone layout sideways, and code blocks that lose their language.',
      '',
      '| Environment | Address                  | Protected |',
      '| ----------- | ------------------------ | --------- |',
      '| Production  | docs.example.com         | Yes       |',
      '| Preview     | not deployed             | —         |',
      '',
      'The pipeline is invoked the same way in every project:',
      '',
      '```bash',
      'pnpm sync --full',
      '```',
      '',
      'A published page carries the same body as its Markdown projection, so an',
      'agent reading `/tables-and-code/index.md` sees this table too.',
      '',
    ].join('\n'),
  ],
  [
    'doc-diagrams',
    [
      '# Diagrams',
      '',
      'A mermaid fence has to be claimed before the code-frame renderer sees it,',
      'or the diagram publishes as a listing of its own source.',
      '',
      '```mermaid',
      'flowchart LR',
      '  Drive[Google Drive] --> Sync[Sync pipeline]',
      '  Sync --> Markdown[Generated Markdown]',
      '  Markdown --> Site[Static site]',
      '```',
      '',
      'The diagram above is the whole publication path, which is also the order',
      'the pipeline writes its output in.',
      '',
    ].join('\n'),
  ],
  [
    'doc-cyrillic',
    [
      '# Рабочие заметки',
      '',
      'Этот документ существует для того, чтобы поиск и подстановка шрифтов',
      'проверялись на кириллице, а не только на латинице.',
      '',
      'Поиск должен находить документ по слову «синхронизация», а страница —',
      'загружать кириллический поднабор шрифта и ничего лишнего.',
      '',
    ].join('\n'),
  ],
  // Replaced by the HTML archive: a document with media falls back to it.
  [
    'doc-screenshots',
    '# Screenshots\n\n![placeholder](data:image/png;base64,fixture)\n',
  ],
]);

/*
 * A four-pixel PNG, written by hand so its bytes are identical everywhere.
 * `deflateSync` at a fixed level is deterministic for this input, and the
 * checksums below are computed rather than transcribed.
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
  return Buffer.concat([header, data, checksum]);
}

function syntheticPng(): Buffer {
  const width = 2;
  const height = 2;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // color type: truecolor
  const pixels = Buffer.from([
    0x00, 0x4d, 0x9b, 0xf5, 0x0e, 0x24, 0x39, 0x00, 0x0e, 0x24, 0x39, 0x4d,
    0x9b, 0xf5,
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function storedZip(
  entries: readonly { path: string; bytes: Buffer }[],
): Uint8Array {
  let localOffset = 0;
  const localEntries: Buffer[] = [];
  const centralEntries = entries.map((entry) => {
    const path = Buffer.from(entry.path, 'utf8');
    const { bytes } = entry;
    const flags = path.some((byte) => byte > 0x7f) ? 0x0800 : 0;
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30 + path.length + bytes.length);
    const central = Buffer.alloc(46 + path.length);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(path.length, 26);
    path.copy(local, 30);
    bytes.copy(local, 30 + path.length);

    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(flags, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(path.length, 28);
    central.writeUInt32LE(localOffset, 42);
    path.copy(central, 46);

    localEntries.push(local);
    localOffset += local.length;
    return central;
  });

  const localData = Buffer.concat(localEntries);
  const centralDirectory = Buffer.concat(centralEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localData.length, 16);

  return new Uint8Array(Buffer.concat([localData, centralDirectory, end]));
}

/*
 * Documents that reach the HTML archive path. Google's Markdown export mangles
 * tables and drops media, so the pipeline falls back to the HTML export for
 * both — which is why the table document has an archive even though it carries
 * no image.
 */
const htmlArchives = new Map<string, Uint8Array>([
  [
    'doc-tables-and-code',
    storedZip([
      {
        path: 'Tables and code.html',
        bytes: Buffer.from(
          [
            '<h1>Tables and code</h1>',
            '<p>Two things a documentation platform gets wrong quietly: wide',
            ' tables that push a phone layout sideways, and code blocks that',
            ' lose their language.</p>',
            '<table>',
            '<tr><td>Environment</td><td>Address</td><td>Protected</td></tr>',
            '<tr><td>Production</td><td>docs.example.com</td><td>Yes</td></tr>',
            '<tr><td>Preview</td><td>not deployed</td><td>&#8212;</td></tr>',
            '</table>',
            '<p>The pipeline is invoked the same way in every project:</p>',
            '<pre><code>pnpm sync --full</code></pre>',
            '<p>A published page carries the same body as its Markdown',
            ' projection, so an agent reading the projection sees this table',
            ' too.</p>',
          ].join(''),
          'utf8',
        ),
      },
    ]),
  ],
  [
    'doc-screenshots',
    storedZip([
      {
        path: 'Screenshots.html',
        bytes: Buffer.from(
          [
            '<h1>Screenshots</h1>',
            '<p>A document whose media forces the HTML archive path, so the',
            ' asset route and the image pipeline are exercised by the',
            ' corpus.</p>',
            '<img src="images/panel.png" alt="Two-tone reference panel">',
            '<p>The image above is a synthetic swatch, not a screenshot of',
            ' anything.</p>',
          ].join(''),
          'utf8',
        ),
      },
      { path: 'images/panel.png', bytes: syntheticPng() },
    ]),
  ],
]);

function inventory(driveItems: readonly DriveItem[]): InventoryRunResult {
  const selection = buildInventorySelection(
    [...driveItems],
    ROOT_ID,
    [],
    [DRIVE_ID],
  );
  return {
    selection,
    report: createInventoryReport(selection, DRIVE_ID, []),
  };
}

const encoder = new TextEncoder();
const dependencies = {
  inventoryResult: inventory(items),
  markdownExporter: {
    exportMarkdown: (fileId: string) => {
      const markdown = markdownExports.get(fileId);
      if (markdown === undefined) {
        throw new Error(`No synthetic export for ${fileId}.`);
      }
      return Promise.resolve(encoder.encode(markdown));
    },
    exportHtmlZip: (fileId: string) => {
      const archive = htmlArchives.get(fileId);
      if (!archive) {
        throw new Error(`No synthetic archive for ${fileId}.`);
      }
      return Promise.resolve(archive);
    },
  },
  documentInspector: {
    inspectDocument: (fileId: string) =>
      Promise.resolve({
        hasEmbeddedDrawings: false,
        hasImages: fileId === 'doc-screenshots',
        inlineObjectCount: fileId === 'doc-screenshots' ? 1 : 0,
        positionedObjectCount: 0,
        tabCount: 1,
      }),
  },
  now: () => RUN_AT,
};

/*
 * Every run starts from nothing. The corpus records a slug reseed, and a reseed
 * cannot be replayed against a manifest that already carries its result — so
 * regeneration has to mean regeneration, not a second sync on top of the first.
 * Clearing only the allowlisted paths keeps the rule the pipeline itself obeys.
 */
for (const generatedPath of [
  ...GENERATED_DIRECTORY_ALLOWLIST,
  ...GENERATED_FILE_ALLOWLIST,
]) {
  await rm(resolve(projectRoot, generatedPath), {
    force: true,
    recursive: true,
  });
}

const site = loadSiteConfiguration(projectRoot);
const context = createSyncContext(projectRoot, site);
const configuration = parseSyncConfiguration(
  {
    GOOGLE_DRIVE_ID: DRIVE_ID,
    GOOGLE_ROOT_FOLDER_ID: ROOT_ID,
    SYNC_CONCURRENCY: '1',
  },
  site,
);
const tokenProvider = new StaticGoogleAccessTokenProvider('synthetic-token');

const first = await runBasicMarkdownSync(
  context,
  configuration,
  tokenProvider,
  { dryRun: false, full: true },
  dependencies,
);

/*
 * A second run reseeds one document's slug. Stable slugs survive a rename, so a
 * retired address only appears when an operator asks for one — and the
 * generated redirect map is only exercised when it does.
 */
const renamed = items.map((item) =>
  item.id === 'doc-getting-started' ? { ...item, name: 'Start here' } : item,
);
const reseeded = await runBasicMarkdownSync(
  context,
  configuration,
  tokenProvider,
  { dryRun: false, full: true, reseedSlugFileId: 'doc-getting-started' },
  { ...dependencies, inventoryResult: inventory(renamed) },
);

console.log(
  `Fixture corpus written: ${first.report.summary.added} documents, redirect ${
    reseeded.slugChange
      ? `/${reseeded.slugChange.oldSlug}/ → /${reseeded.slugChange.newSlug}/`
      : 'missing'
  }.`,
);

if (!reseeded.slugChange) {
  throw new Error(
    'The reseed run produced no redirect; the corpus is incomplete.',
  );
}
