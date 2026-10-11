/**
 * The language a deployment's documents are written in, named for the MCP
 * server's instructions (ADR-048).
 */

/**
 * A locale's language by its English name, `English` for `en-GB`; none for a
 * tag Intl cannot name, so the tools then say nothing of the language.
 */
export function languageName(locale: string): string | undefined {
  try {
    const { language } = new Intl.Locale(locale);
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(
      language,
    );
    // Intl echoes a subtag it has no name for.
    return name && name !== language ? name : undefined;
  } catch {
    return undefined;
  }
}
