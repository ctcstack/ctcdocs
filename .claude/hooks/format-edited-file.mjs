#!/usr/bin/env node
// PostToolUse hook: format a file that a coding agent just wrote with Prettier.
//
// Reads the hook payload from stdin, extracts the edited path, and runs
// `prettier --write --ignore-unknown` on it. Prettier applies `.prettierignore`
// itself, so sync-owned generated output and byte-sensitive fixtures are left
// untouched. The hook never fails the tool call: formatting is a convenience,
// and `pnpm format:check` remains the authoritative gate.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const prettierBin = resolve(projectRoot, 'node_modules', '.bin', 'prettier');

function readStdin() {
  return new Promise((resolveStdin) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => resolveStdin(raw));
    process.stdin.on('error', () => resolveStdin(''));
  });
}

const raw = await readStdin();

let filePath;
try {
  filePath = JSON.parse(raw)?.tool_input?.file_path;
} catch {
  process.exit(0);
}

if (typeof filePath !== 'string' || filePath.length === 0) process.exit(0);

const absolutePath = isAbsolute(filePath)
  ? filePath
  : resolve(projectRoot, filePath);
const relativePath = relative(projectRoot, absolutePath);

// Stay inside the repository and skip anything Prettier should never rewrite.
if (relativePath.startsWith('..') || isAbsolute(relativePath)) process.exit(0);
if (!existsSync(absolutePath) || !statSync(absolutePath).isFile())
  process.exit(0);
if (!existsSync(prettierBin)) process.exit(0);

try {
  execFileSync(
    prettierBin,
    ['--write', '--ignore-unknown', '--log-level', 'warn', relativePath],
    {
      cwd: projectRoot,
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
} catch {
  // A syntax error means the agent is mid-edit. Leave the file as written.
}

process.exit(0);
