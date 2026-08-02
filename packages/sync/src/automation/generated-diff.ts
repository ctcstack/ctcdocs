import {
  isGeneratedPathAllowed,
  normalizeRepositoryPath,
} from '@ctcstack/ctcdocs-core';

export class GeneratedDiffValidationError extends Error {
  override readonly name = 'GeneratedDiffValidationError';

  constructor(readonly rejectedPaths: readonly string[]) {
    super(
      `Generated diff contains non-allowlisted paths: ${rejectedPaths.join(', ')}`,
    );
  }
}

export function validateGeneratedDiffPaths(
  paths: readonly string[],
): readonly string[] {
  const normalizedPaths = [
    ...new Set(
      paths.map((path) => {
        const normalized = normalizeRepositoryPath(path);
        return normalized ?? path;
      }),
    ),
  ].sort((left, right) => left.localeCompare(right, 'en'));
  const rejectedPaths = normalizedPaths.filter(
    (path) => !isGeneratedPathAllowed(path),
  );

  if (rejectedPaths.length > 0) {
    throw new GeneratedDiffValidationError(rejectedPaths);
  }

  return normalizedPaths;
}
