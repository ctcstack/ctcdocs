/**
 * Proves a release candidate on real deployments before anything is published.
 *
 * The fixture corpus is synthetic, so it cannot show how a change meets a
 * deployment's own documents: a test that picks the page with the most
 * headings, say, meets that author's heading levels. A release that fails
 * there is found out only after npm and every subscriber have it, and the
 * fix is another public release. This check moves that moment before the
 * tag.
 *
 * It packs the three packages as `pnpm publish` would, clones each deployment
 * given (its committed state, so the checkout itself is never touched),
 * points the clone at the packed tarballs, installs, and runs the
 * deployment's own `pnpm verify` against its real corpus. Nothing is
 * published and nothing leaves the machine.
 *
 *   pnpm release:check ../my-deployment [../another-deployment] [--keep]
 *
 * `--keep` leaves the temporary directory for inspection; it is also kept
 * whenever a deployment fails, and its path is printed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = [
  { directory: 'packages/core', name: '@ctcstack/ctcdocs-core' },
  { directory: 'packages/sync', name: '@ctcstack/ctcdocs-sync' },
  { directory: 'packages/astro', name: '@ctcstack/ctcdocs' },
];

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const deployments = args
  .filter((arg) => arg !== '--keep')
  .map((arg) => resolve(arg));
if (deployments.length === 0) {
  console.error(
    'Usage: pnpm release:check <deployment directory>... [--keep]\n' +
      'Name every deployment checkout you have; the tag waits for all of them.',
  );
  process.exit(2);
}
for (const deployment of deployments) {
  if (!existsSync(join(deployment, '.git'))) {
    console.error(`${deployment} is not a Git checkout.`);
    process.exit(2);
  }
}

const work = mkdtempSync(join(tmpdir(), 'ctcdocs-candidate-'));
const tarballs = join(work, 'tarballs');
mkdirSync(tarballs);

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit' });
  return result.status === 0;
}

/** Packs one package and returns the tarball it wrote. */
function pack({ directory, name }) {
  const before = new Set(readdirSync(tarballs));
  execFileSync('pnpm', ['pack', '--pack-destination', tarballs], {
    cwd: join(root, directory),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const written = readdirSync(tarballs).find((file) => !before.has(file));
  if (!written) {
    throw new Error(`pnpm pack wrote no tarball for ${name}.`);
  }
  return join(tarballs, written);
}

/*
 * The project depends on the site and sync packages; the site package's own
 * dependency on core was rewritten by `pnpm pack` to a version npm may not
 * have yet, so core is overridden everywhere it is asked for.
 */
function pointAtCandidate(clone, packed) {
  const manifestPath = join(clone, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const field of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (packed[name]) {
        manifest[field][name] = `file:${packed[name]}`;
      }
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const workspacePath = join(clone, 'pnpm-workspace.yaml');
  const workspace = existsSync(workspacePath)
    ? readFileSync(workspacePath, 'utf8')
    : '';
  const entries = Object.entries(packed)
    .map(([name, file]) => `  '${name}': 'file:${file}'`)
    .join('\n');
  writeFileSync(
    workspacePath,
    /^overrides:\s*$/mu.test(workspace)
      ? workspace.replace(/^overrides:\s*$/mu, `overrides:\n${entries}`)
      : `${workspace.trimEnd()}\n\noverrides:\n${entries}\n`,
  );
}

const packed = Object.fromEntries(PACKAGES.map((pkg) => [pkg.name, pack(pkg)]));
const version = JSON.parse(
  readFileSync(join(root, 'packages/astro/package.json'), 'utf8'),
).version;
console.log(`\nCandidate ${version} packed into ${tarballs}.\n`);

const failed = [];
for (const deployment of deployments) {
  const name = basename(deployment);
  const clone = join(work, name);
  console.log(`\n=== ${name}: cloning its committed state ===\n`);
  const ok =
    run('git', ['clone', '--quiet', '--no-hardlinks', deployment, clone]) &&
    (pointAtCandidate(clone, packed), true) &&
    run('pnpm', ['install', '--no-frozen-lockfile'], clone) &&
    run('pnpm', ['verify'], clone);
  console.log(`\n=== ${name}: ${ok ? 'passed' : 'FAILED'} ===\n`);
  if (!ok) {
    failed.push(name);
  }
}

if (failed.length > 0 || keep) {
  console.log(`Kept ${work} for inspection.`);
} else {
  rmSync(work, { recursive: true, force: true });
}
if (failed.length > 0) {
  console.error(
    `Candidate ${version} failed on ${failed.join(', ')}. Do not tag it: fix the branch and run this again.`,
  );
  process.exit(1);
}
console.log(
  `Candidate ${version} passed on ${deployments.length} deployment(s). It may be tagged.`,
);
