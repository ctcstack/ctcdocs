/**
 * Published documents that hold the same text (ADR-049).
 *
 * Two copies of a checklist, or a policy pasted whole into another document,
 * drift apart as one of them is edited, and an assistant that finds both
 * answers from either. The names can differ, so `duplicate-name` does not see
 * them: the text does.
 *
 * Each document's text, without its Markdown syntax or link targets, becomes
 * a set of five-word shingles. Two documents are near duplicates when most of
 * their shingles are shared (Jaccard similarity at least `SIMILAR`), or when
 * nearly all of the shorter one's are in the other (containment at least
 * `CONTAINED`). A document too short to judge is left out. Candidates come
 * from an index of shingles that skips those in many documents, the phrases a
 * template or a footer repeats, and every candidate is then compared whole,
 * so the result is exact and does not depend on the order documents arrive in.
 */
import type { Nodes, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/** Shared shingles over all of either document's, at which two are alike. */
export const SIMILAR = 0.8;
/** Shared shingles over the shorter document's, at which it is inside. */
export const CONTAINED = 0.95;
/** Fewer shingles than this, and a document is too short to compare. */
export const SHORTEST = 50;
const SHINGLE_WORDS = 5;
/** A shingle in more documents than this proves nothing about two of them. */
const COMMON = 32;

export interface NearDuplicate {
  /** The other document. */
  readonly id: string;
  /** Jaccard similarity of the two, rounded down to a whole percent. */
  readonly similarPercent: number;
  /** How the two relate: alike, or this one's text inside the other's. */
  readonly relation: 'alike' | 'inside' | 'holds';
}

const parser = unified().use(remarkParse).use(remarkGfm);

/** The words of a node: its text, code and image descriptions, not its URLs. */
function collectText(node: Nodes, into: string[]): void {
  if (node.type === 'text' || node.type === 'inlineCode') {
    into.push(node.value);
    return;
  }
  if (node.type === 'code') {
    into.push(node.value);
    return;
  }
  if (node.type === 'image' && node.alt) {
    into.push(node.alt);
    return;
  }
  if ('children' in node) {
    for (const child of node.children) {
      collectText(child, into);
    }
    // Block boundaries separate words.
    into.push(' ');
  }
}

/** A 32-bit FNV-1a hash of a shingle. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** The hashed five-word shingles of a Markdown body. */
export function shingles(markdown: string): Set<number> {
  const parts: string[] = [];
  collectText(parser.parse(markdown) as Root, parts);
  const words =
    parts
      .join(' ')
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const set = new Set<number>();
  for (let start = 0; start + SHINGLE_WORDS <= words.length; start += 1) {
    set.add(hash(words.slice(start, start + SHINGLE_WORDS).join(' ')));
  }
  return set;
}

function sharedCount(a: ReadonlySet<number>, b: ReadonlySet<number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const shingle of small) {
    if (large.has(shingle)) {
      shared += 1;
    }
  }
  return shared;
}

/**
 * The near duplicates of each document among `bodies`, Markdown by document
 * ID. A document with none is absent; each list is ordered by ID.
 */
export function findNearDuplicates(
  bodies: ReadonlyMap<string, string>,
): Map<string, NearDuplicate[]> {
  const sets = new Map<string, Set<number>>();
  for (const id of [...bodies.keys()].sort()) {
    const set = shingles(bodies.get(id) ?? '');
    if (set.size >= SHORTEST) {
      sets.set(id, set);
    }
  }

  const postings = new Map<number, string[]>();
  for (const [id, set] of sets) {
    for (const shingle of set) {
      const list = postings.get(shingle);
      if (list) {
        list.push(id);
      } else {
        postings.set(shingle, [id]);
      }
    }
  }
  // Pairs sharing at least one uncommon shingle, each counted once.
  const candidates = new Set<string>();
  for (const ids of postings.values()) {
    if (ids.length < 2 || ids.length > COMMON) {
      continue;
    }
    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        candidates.add(`${ids[left]}\n${ids[right]}`);
      }
    }
  }

  const found = new Map<string, NearDuplicate[]>();
  const add = (id: string, duplicate: NearDuplicate) => {
    found.set(id, [...(found.get(id) ?? []), duplicate]);
  };
  for (const pair of [...candidates].sort()) {
    const [first, second] = pair.split('\n') as [string, string];
    const a = sets.get(first);
    const b = sets.get(second);
    if (!a || !b) {
      continue;
    }
    const shared = sharedCount(a, b);
    const jaccard = shared / (a.size + b.size - shared);
    const containment = shared / Math.min(a.size, b.size);
    if (jaccard < SIMILAR && containment < CONTAINED) {
      continue;
    }
    const similarPercent = Math.floor(jaccard * 100);
    if (jaccard >= SIMILAR || a.size === b.size) {
      add(first, { id: second, similarPercent, relation: 'alike' });
      add(second, { id: first, similarPercent, relation: 'alike' });
    } else {
      const [inner, outer] =
        a.size < b.size ? [first, second] : [second, first];
      add(inner, { id: outer, similarPercent, relation: 'inside' });
      add(outer, { id: inner, similarPercent, relation: 'holds' });
    }
  }
  for (const list of found.values()) {
    list.sort((left, right) => (left.id < right.id ? -1 : 1));
  }
  return found;
}
