/**
 * The words of a query, as the weekly report groups queries by them
 * (ADR-051): lower case, without punctuation, without the stop words of
 * English and of the documents' language, each once, sorted.
 *
 * Assistants often ask in English whatever the documents' language is, so
 * English stop words are always dropped. Another language's are dropped
 * when the platform has a list for it; without one, its queries group by
 * all their words, which is coarser but never wrong.
 */

const ENGLISH = `a about above after again against all am an and any are as at be
because been before being below between both but by can could did do does
doing down during each few for from further had has have having he her here
hers herself him himself his how i if in into is it its itself just me more
most my myself no nor not now of off on once only or other our ours ourselves
out over own same she should so some such than that the their theirs them
themselves then there these they this those through to too under until up
very was we were what when where which while who whom why will with would you
your yours yourself yourselves`;

const RUSSIAN = `а без более бы был была были было быть в вам вас весь во вот все
всего всех вы где да даже для до его ее ей ему если есть еще же за здесь и из
или им их к как какая какие какой ко когда кто ли либо мне может мы на над
надо наш не него нее нет ни них но ну о об однако он она они оно от очень по
под при про с со так также такой там те тем то того тоже той только том ты у
уже хотя чего чей чем что чтобы чье чья эта эти это этого этой этом я`;

const STOP_WORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set(ENGLISH.split(/\s+/u)),
  ru: new Set(RUSSIAN.split(/\s+/u)),
};

/** The stop words for a language tag such as `en-GB`; English's always. */
export function stopWordsFor(language: string | undefined): Set<string> {
  const base = language?.split('-')[0]?.toLowerCase();
  return new Set([
    ...(STOP_WORDS.en ?? []),
    ...((base && STOP_WORDS[base]) || []),
  ]);
}

/**
 * The words a query groups by. A query of stop words only keeps them all,
 * so that "how to" is still a question; one with no letter or digit has
 * none, and is not grouped.
 */
export function queryWords(
  query: string,
  stopWords: ReadonlySet<string>,
): string[] {
  const tokens = query
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((token) => token.length > 0);
  const kept = tokens.filter((token) => !stopWords.has(token));
  return [...new Set(kept.length > 0 ? kept : tokens)].sort();
}
