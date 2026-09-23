import { parse as parseToml } from 'smol-toml';

/**
 * Every `paths` entry of every allowlist in a gitleaks configuration: the files
 * the secret scanner is told not to read.
 *
 * Two checks depend on this list. `validate` refuses an exemption that covers a
 * file Git tracks, and the sync's secret scan refuses one that covers a file
 * the run is about to commit.
 */
export function gitleaksExemptPatterns(content: string): string[] {
  const parsed = parseToml(content) as Record<string, unknown>;
  const allowlists = [
    ...(Array.isArray(parsed.allowlists) ? parsed.allowlists : []),
    ...(parsed.allowlist === undefined ? [] : [parsed.allowlist]),
  ];

  return allowlists.flatMap((allowlist) => {
    const paths = (allowlist as Record<string, unknown>).paths;
    return Array.isArray(paths)
      ? paths.filter((path): path is string => typeof path === 'string')
      : [];
  });
}
