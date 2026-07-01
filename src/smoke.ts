import path from 'node:path';
import { normalizeDeck } from './normalize.js';
import { qaDeck } from './qa.js';
import { buildPptx, verifyPptx } from './pptx.js';
import { renderPptx } from './render.js';
import { readJson, writeJson } from './io.js';
import type { DeckSpec, SmokeReport } from './types.js';
import { throwIfIssues, validateDeck, validateDeckSchema } from './validation.js';
import { loadTemplatePack } from './templates.js';

export interface SmokeOptions {
  outDir?: string;
  render?: boolean;
}

export async function smoke(input: string, options: SmokeOptions = {}): Promise<SmokeReport> {
  const outDir = options.outDir ?? 'dist/deckspec';
  const source = readJson(input) as DeckSpec;
  throwIfIssues(validateDeckSchema(source), 'Source deck schema validation');
  const pack = loadTemplatePack(source.template, source.theme);
  throwIfIssues(validateDeck(source, { pack, skipSchema: true }), 'Source deck validation');
  const normalized = normalizeDeck(source);
  const normalizedPath = path.join(outDir, `${normalized.deckId}.deck.normalized.json`);
  writeJson(normalizedPath, normalized);
  const qaReport = qaDeck(normalized);
  const qaPath = path.join(outDir, `${normalized.deckId}.layout-report.json`);
  writeJson(qaPath, qaReport);
  if (qaReport.summary.error > 0 || qaReport.summary.warn > 0)
    throw new Error(`Layout QA is not clean: ${JSON.stringify(qaReport.summary)}`);
  const pptxPath = path.join(outDir, `${normalized.deckId}.pptx`);
  await buildPptx(normalizedPath, pptxPath);
  const integrity = await verifyPptx(pptxPath, normalized.slides.length);
  const render = options.render
    ? await renderPptx(pptxPath, path.join('render', normalized.deckId))
    : undefined;
  return {
    status: 'DECKSPEC_SMOKE_PASS',
    input,
    outputs: {
      normalized: normalizedPath,
      qaReport: qaPath,
      pptx: pptxPath,
      ...(render ? { render } : {}),
    },
    slideCount: normalized.slides.length,
    qaSummary: qaReport.summary,
    pptx: integrity,
  };
}
