#!/usr/bin/env node
import path from 'node:path';
import { readJson } from './io.js';
import { validateDeck, throwIfIssues, validateDeckSchema } from './validation.js';
import { loadTemplatePack } from './templates.js';
import { normalizeFile } from './normalize.js';
import { qaFile } from './qa.js';
import { buildPptx, verifyPptx } from './pptx.js';
import { renderPptx } from './render.js';
import { smoke } from './smoke.js';
import type { DeckSpec } from './types.js';

type ValueOption = '--out' | '--outDir';
type FlagOption = '--normalized' | '--render';

interface CliArgs {
  positionals: string[];
  values: Map<ValueOption, string>;
  flags: Set<FlagOption>;
}

const valueOptions = new Set<string>(['--out', '--outDir']);
const flagOptions = new Set<string>(['--normalized', '--render']);

function usage(exitCode = 2, detail?: string): never {
  const text = `Usage: deckspec <validate|normalize|qa|build|render|smoke> <input> [--out file] [--outDir dir] [--render]`;
  const output = detail ? `${detail}\n${text}` : text;
  if (exitCode === 0) console.log(output);
  else console.error(output);
  process.exit(exitCode);
}

function parseArgs(rawArgs: string[]): CliArgs {
  const args: CliArgs = { positionals: [], values: new Map(), flags: new Set() };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === undefined) continue;
    if (!arg.startsWith('--')) {
      args.positionals.push(arg);
      continue;
    }
    if (valueOptions.has(arg)) {
      const value = rawArgs[index + 1];
      if (value === undefined || value.startsWith('--')) usage(2, `Missing value for ${arg}.`);
      args.values.set(arg as ValueOption, value);
      index += 1;
      continue;
    }
    if (flagOptions.has(arg)) {
      args.flags.add(arg as FlagOption);
      continue;
    }
    usage(2, `Unknown option ${arg}.`);
  }
  return args;
}

function option(args: CliArgs, name: ValueOption): string | undefined;
function option(args: CliArgs, name: ValueOption, fallback: string): string;
function option(args: CliArgs, name: ValueOption, fallback?: string): string | undefined {
  return args.values.get(name) ?? fallback;
}

function hasFlag(args: CliArgs, name: FlagOption): boolean {
  return args.flags.has(name);
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === '--help' || command === '-h') usage(0);
  const args = parseArgs(process.argv.slice(3));
  const input = args.positionals[0];
  if (command === undefined || input === undefined) usage();
  if (args.positionals.length > 1) usage(2, `Unexpected argument ${args.positionals[1]}.`);
  if (command === 'validate') {
    const deck = readJson(input) as DeckSpec;
    throwIfIssues(validateDeckSchema(deck), 'Deck schema validation');
    const pack = loadTemplatePack(deck.template, deck.theme);
    const issues = validateDeck(deck, {
      normalized: deck.normalized === true || hasFlag(args, '--normalized'),
      pack,
      skipSchema: true,
    });
    throwIfIssues(issues, 'Deck validation');
    print({
      status: 'DECKSPEC_VALIDATE_PASS',
      input,
      normalized: deck.normalized === true || hasFlag(args, '--normalized'),
      slideCount: deck.slides.length,
    });
  } else if (command === 'normalize') {
    const out = option(args, '--out', 'dist/deckspec/deck.normalized.json');
    const deck = normalizeFile(input, out);
    print({
      status: 'DECKSPEC_NORMALIZE_PASS',
      input,
      output: out,
      slideCount: deck.slides.length,
    });
  } else if (command === 'qa') {
    const out = option(args, '--out', 'dist/deckspec/layout-report.json');
    const report = qaFile(input, out);
    print({
      status: report.status,
      input,
      output: out,
      slideCount: report.slideCount,
      summary: report.summary,
    });
    if (report.summary.error > 0) process.exit(1);
  } else if (command === 'build') {
    const out = option(args, '--out', 'dist/deckspec/deck.pptx');
    const result = await buildPptx(input, out);
    const integrity = await verifyPptx(result.output, result.deck.slides.length);
    print({
      status: 'DECKSPEC_BUILD_PASS',
      input,
      output: out,
      slideCount: result.deck.slides.length,
      pptx: integrity,
    });
  } else if (command === 'render') {
    const outDir = option(args, '--outDir', path.join('render', path.basename(input, '.pptx')));
    print(await renderPptx(input, outDir));
  } else if (command === 'smoke') {
    print(
      await smoke(input, { outDir: option(args, '--outDir'), render: hasFlag(args, '--render') }),
    );
  } else usage();
}

main().catch((error: unknown) => {
  const err = error as Error & { issues?: unknown[] };
  console.error(
    JSON.stringify(
      { status: 'DECKSPEC_FAIL', message: err.message, issues: err.issues ?? [] },
      null,
      2,
    ),
  );
  process.exit(1);
});
