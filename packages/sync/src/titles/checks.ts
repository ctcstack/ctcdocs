/**
 * What the content health page asks editors to fix, and how (ADR-024).
 *
 * Each check is one action a person can take in Google Docs or Drive, worded
 * for the person taking it. The wording lives here, once, and travels in the
 * report, so the page, the job summary and the terminal say the same thing.
 */

export type CheckSeverity = 'fix' | 'convention' | 'note';

export type CheckCode =
  | 'heading-mixes-alphabets'
  | 'heading-from-another-document'
  | 'empty-document'
  | 'title-styled-as-heading-1'
  | 'title-missing'
  | 'title-not-first'
  | 'title-style-on-section'
  | 'file-name-copy-of'
  | 'file-name-extension'
  | 'file-name-underscores'
  | 'file-name-spaces';

export interface Check {
  code: CheckCode;
  severity: CheckSeverity;
  title: string;
  instruction: string;
}

export const SEVERITY_LABELS: Readonly<Record<CheckSeverity, string>> = {
  fix: 'Fix',
  convention: 'Proposed convention: one Title line',
  note: 'Worth a look',
};

/** In the order the page shows them: what is wrong first, tidiness last. */
export const CHECKS: readonly Check[] = [
  {
    code: 'heading-mixes-alphabets',
    severity: 'fix',
    title: 'A heading mixes alphabets',
    instruction:
      'A letter in the heading was typed on the other keyboard layout. It looks right, but search does not find the word. Open the heading and retype the letter named below.',
  },
  {
    code: 'heading-from-another-document',
    severity: 'fix',
    title: "The document opens with another document's title",
    instruction:
      "The first heading is the title of a different document, most likely copied along with a template. Replace it with this document's own title.",
  },
  {
    code: 'empty-document',
    severity: 'fix',
    title: 'The document is empty',
    instruction:
      'Nothing in it can be published. Write the content, or move the document out of the published folders.',
  },
  {
    code: 'title-styled-as-heading-1',
    severity: 'convention',
    title: 'The title is styled as Heading 1',
    instruction:
      "The first line reads like the document's title. Select it and choose Format → Paragraph styles → Title.",
  },
  {
    code: 'title-missing',
    severity: 'convention',
    title: 'The document has no title line',
    instruction:
      "Type the document's name as its first line and choose Format → Paragraph styles → Title.",
  },
  {
    code: 'title-not-first',
    severity: 'convention',
    title: 'The title is not the first line',
    instruction:
      'Move the line in the Title style to the top of the document, above everything else.',
  },
  {
    code: 'title-style-on-section',
    severity: 'convention',
    title: 'The Title style is used for a section',
    instruction:
      "Only the document's name takes the Title style. Change the lines below to Format → Paragraph styles → Heading 1.",
  },
  {
    code: 'file-name-copy-of',
    severity: 'note',
    title: 'The file name starts with “Copy of”',
    instruction:
      'Google adds this when a file is copied. Rename the file in Drive without it.',
  },
  {
    code: 'file-name-extension',
    severity: 'note',
    title: 'The file name ends with a file extension',
    instruction:
      'Remove the extension, such as “.doc”, from the name in Drive. It is left over from an upload.',
  },
  {
    code: 'file-name-underscores',
    severity: 'note',
    title: 'The file name uses underscores',
    instruction:
      'The site shows the file name as the page title, underscores included. Use spaces instead, or “ — ” where Drive replaced a colon with “_”.',
  },
  {
    code: 'file-name-spaces',
    severity: 'note',
    title: 'The file name has extra spaces',
    instruction:
      'Remove the spaces at the start or end of the name, or doubled between words.',
  },
];

const SECTION_WORDS = new Set([
  'all together',
  'background',
  'contents',
  'details',
  'en version',
  'full version',
  'general',
  'general information',
  'intro',
  'introduction',
  'notes',
  'overview',
  'purpose',
  'ru version',
  'short version',
  'summary',
  'table of contents',
  'tabs',
]);

/**
 * Whether a heading reads like a section of a document rather than its name:
 * numbered (`1. Scope`, `Part 2`, `Этап 3`), ending in a colon, or one of the
 * words a document uses for a part of itself. It is a heuristic, and the page
 * says "looks like" wherever it is used.
 */
export function looksLikeSection(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.endsWith(':')) {
    return true;
  }
  if (/^(?:\d+|[ivx]+)[.)]\s/iu.test(trimmed)) {
    return true;
  }
  if (
    /^(?:part|stage|step|section|chapter|phase|tab|часть|этап|шаг|раздел)\s*\d+/iu.test(
      trimmed,
    )
  ) {
    return true;
  }
  const words = trimmed
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return SECTION_WORDS.has(words);
}
