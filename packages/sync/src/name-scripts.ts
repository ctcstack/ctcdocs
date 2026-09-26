import type {
  InventoryIssue,
  InventorySelection,
  SelectedInventoryItem,
} from './inventory/inventory-graph.js';

/**
 * Scripts whose letters pass for one another. A Cyrillic `С`, `Т`, `О` or `е`
 * sits on the key of a Latin letter it cannot be told from, so a word holding
 * both was typed on the wrong layout, not written that way. Scripts that are
 * mixed on purpose, as Japanese mixes Han and kana, are not in this list.
 */
const CONFUSABLE_SCRIPTS = ['Latin', 'Cyrillic', 'Greek'] as const;

/** Scripts a diagnostic can name; any other letter is reported as `Other`. */
const NAMED_SCRIPTS = [
  ...CONFUSABLE_SCRIPTS,
  'Armenian',
  'Georgian',
  'Hebrew',
  'Arabic',
  'Devanagari',
  'Thai',
  'Hangul',
  'Hiragana',
  'Katakana',
  'Han',
] as const;

/** At most this many letters are named per item; one is usually enough. */
const MAX_REPORTED_LETTERS = 3;

const LETTER = /^\p{Letter}$/u;
const WORD_SEPARATOR = /[^\p{Letter}\p{Mark}]/u;

function scriptPattern(script: string): RegExp {
  return new RegExp(`^\\p{Script=${script}}$`, 'u');
}

const NAMED_SCRIPT_PATTERNS = NAMED_SCRIPTS.map(
  (script) => [script, scriptPattern(script)] as const,
);

function scriptOf(character: string): string {
  return (
    NAMED_SCRIPT_PATTERNS.find(([, pattern]) => pattern.test(character))?.[0] ??
    'Other'
  );
}

function isConfusable(script: string): boolean {
  return (CONFUSABLE_SCRIPTS as readonly string[]).includes(script);
}

interface Letter {
  character: string;
  /** One-based position among the name's characters, as an editor counts. */
  position: number;
  script: string;
  word: number;
}

function lettersOf(name: string): Letter[] {
  const letters: Letter[] = [];
  let word = 0;
  let inWord = false;
  Array.from(name).forEach((character, index) => {
    if (WORD_SEPARATOR.test(character)) {
      inWord = false;
      return;
    }
    if (!inWord) {
      word += 1;
      inWord = true;
    }
    if (LETTER.test(character)) {
      letters.push({
        character,
        position: index + 1,
        script: scriptOf(character),
        word,
      });
    }
  });
  return letters;
}

/**
 * Names a letter without quoting the name it came from. The name is a
 * document title, and titles stay out of logs; the item ID and a position are
 * enough to find the letter in Drive.
 */
function describeLetters(letters: readonly Letter[]): string {
  const described = letters
    .slice(0, MAX_REPORTED_LETTERS)
    .map(
      (letter) =>
        `U+${letter.character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')} ${letter.script} at character ${letter.position}`,
    );
  if (letters.length > MAX_REPORTED_LETTERS) {
    described.push(`${letters.length - MAX_REPORTED_LETTERS} more`);
  }
  return described.join(', ');
}

/**
 * The letters that do not belong to the script the rest of the name is
 * written in. The name decides, not the word: a word as short as `Сt` holds
 * one letter of each script, and only the rest of the name can say which of
 * them is the stray. On a tie, the script the name opens with wins.
 */
function strayLetters(letters: readonly Letter[]): Letter[] {
  const confusable = letters.filter((letter) => isConfusable(letter.script));
  const counts = new Map<string, number>();
  for (const letter of confusable) {
    counts.set(letter.script, (counts.get(letter.script) ?? 0) + 1);
  }
  const dominant = [...counts].sort(
    ([, left], [, right]) => right - left,
  )[0]?.[0];

  const scriptsByWord = new Map<number, Set<string>>();
  for (const letter of confusable) {
    const scripts = scriptsByWord.get(letter.word) ?? new Set<string>();
    scripts.add(letter.script);
    scriptsByWord.set(letter.word, scripts);
  }
  return confusable.filter(
    (letter) =>
      (scriptsByWord.get(letter.word)?.size ?? 0) > 1 &&
      letter.script !== dominant,
  );
}

function nameIssue(
  item: SelectedInventoryItem,
  allowedPatterns: readonly RegExp[] | null,
): InventoryIssue | undefined {
  const letters = lettersOf(item.item.name);
  if (allowedPatterns) {
    const disallowed = letters.filter(
      (letter) =>
        !allowedPatterns.some((pattern) => pattern.test(letter.character)),
    );
    if (disallowed.length > 0) {
      return {
        code: 'disallowed_name_script',
        itemId: item.item.id,
        detail: describeLetters(disallowed),
      };
    }
  }
  const stray = strayLetters(letters);
  if (stray.length > 0) {
    return {
      code: 'mixed_script_name',
      itemId: item.item.id,
      detail: describeLetters(stray),
    };
  }
  return undefined;
}

/**
 * Reports the published names a reader would see with a letter from the wrong
 * alphabet in them (ADR-020).
 *
 * Every folder and document below the root is checked; the root's own name is
 * never published. A word that mixes Latin, Cyrillic and Greek letters is
 * always reported. When the project names the scripts it writes in, a letter
 * from any other script is reported as well.
 */
export function findNameScriptIssues(
  selection: InventorySelection,
  nameScripts: readonly string[] | null,
): InventoryIssue[] {
  const allowedPatterns = nameScripts?.map(scriptPattern) ?? null;
  return [...selection.folders, ...selection.documents]
    .filter((item) => item.item.id !== selection.rootFolderId)
    .map((item) => nameIssue(item, allowedPatterns))
    .filter((issue): issue is InventoryIssue => issue !== undefined)
    .sort((left, right) =>
      left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0,
    );
}
