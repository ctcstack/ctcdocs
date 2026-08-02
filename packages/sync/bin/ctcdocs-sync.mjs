#!/usr/bin/env node

/**
 * Launcher for the compiled command line.
 *
 * A package manager creates the executable link at install time, and pnpm skips
 * one whose target does not exist. `dist/` is built by `prepack` and absent
 * from a fresh clone, so pointing `bin` straight at it would leave the command
 * unlinked in this workspace — where the fixture project calls it — while
 * working in every published install. This file always exists.
 */
import '../dist/cli.js';
