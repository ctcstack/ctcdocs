/**
 * Regenerates the fixture corpus and fails if a single byte moved.
 *
 * The pipeline guarantees that a full run over unchanged input produces no
 * diff. Running that guarantee against a committed corpus turns it into a
 * staleness check: if conversion changes and nobody regenerates the fixture,
 * this fails instead of the fixture quietly describing an older converter.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

execFileSync(
  process.execPath,
  [fileURLToPath(new URL('./generate-corpus.ts', import.meta.url))],
  { cwd: repositoryRoot, stdio: 'inherit' },
);

/*
 * Two questions, because one command answers neither on its own: did
 * regeneration change a file Git already knows about, and did it produce one
 * Git has never seen? A staged-but-unchanged file is neither.
 */
const changed = execFileSync(
  'git',
  ['diff', '--name-only', 'HEAD', '--', 'fixtures/project'],
  { cwd: repositoryRoot, encoding: 'utf8' },
);
const untracked = execFileSync(
  'git',
  ['ls-files', '--others', '--exclude-standard', '--', 'fixtures/project'],
  { cwd: repositoryRoot, encoding: 'utf8' },
);
const status = `${changed}${untracked}`;

if (status.trim().length > 0) {
  console.error(
    'The fixture corpus is stale. Regenerating it changed these paths:',
  );
  console.error(status.trimEnd());
  console.error('Run `pnpm fixtures:generate` and commit the result.');
  process.exitCode = 1;
} else {
  console.log('Fixture corpus is current.');
}
