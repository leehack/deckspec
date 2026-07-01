import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { readJson } from '../src/io.js';
import { validateDeck, validateJsonWithSchema } from '../src/validation.js';
import { loadTemplatePack, validateTemplatePack } from '../src/templates.js';
import { normalizeDeck, loadDeckForBuild } from '../src/normalize.js';
import { qaDeck } from '../src/qa.js';
import { buildPptx, verifyPptx } from '../src/pptx.js';
import { smoke } from '../src/smoke.js';
import type { DeckSpec } from '../src/types.js';

function validDeck(): DeckSpec {
  return readJson('examples/framework-smoke/deck.source.json') as DeckSpec;
}

function validateWithPack(deck: DeckSpec) {
  return validateDeck(deck, { pack: loadTemplatePack(deck.template, deck.theme) });
}

void test('tracked source and docs stay anonymized', () => {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  const forbiddenTerms = [
    [106, 104, 105, 110],
    [51060, 51652, 49437],
    [104, 111, 114, 109, 115, 98, 111, 116],
    [53, 49, 57, 48, 54, 56, 48, 56],
    [108, 101, 101, 104, 97, 99, 107, 64, 103, 109, 97, 105, 108, 46, 99, 111, 109],
  ].map((codes) => String.fromCharCode(...codes));
  const forbidden = new RegExp(forbiddenTerms.join('|'), 'i');
  const ignored = new Set(['package-lock.json']);
  const binary = /\.(png|jpg|jpeg|webp|pptx|pdf|wav)$/i;
  const hits: string[] = [];
  for (const file of files) {
    if (!fs.existsSync(file) || ignored.has(file) || binary.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (forbidden.test(text)) hits.push(file);
  }
  assert.deepEqual(hits, []);
});

void test('valid source deck normalizes and layout QA is clean', () => {
  const normalized = normalizeDeck(validDeck());
  assert.equal(normalized.normalized, true);
  assert.equal(normalized.slides.length, 2);
  const report = qaDeck(normalized);
  assert.deepEqual(report.summary, { error: 0, warn: 0 });
});

void test('normalization preserves slide-level hidden metadata', () => {
  const deck = validDeck();
  deck.slides[0]!.hidden = true;
  const normalized = normalizeDeck(deck);
  assert.equal(normalized.slides[0]!.hidden, true);
});

void test('validator rejects duplicate element ids', () => {
  const deck = readJson('fixtures/invalid/duplicate-element.deck.source.json') as DeckSpec;
  const issues = validateWithPack(deck);
  assert.ok(issues.some((issue) => issue.code === 'duplicate-element-id'));
});

void test('schema rejects unsupported top-level and element properties', () => {
  const deck = readJson('fixtures/invalid/malformed.deck.source.json') as DeckSpec;
  const issues = validateDeck(deck);
  assert.ok(
    issues.some((issue) => issue.code === 'schema-validation' && issue.jsonPointer === '/'),
  );
  assert.ok(
    issues.some(
      (issue) => issue.code === 'schema-validation' && issue.jsonPointer.includes('/slides/0'),
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'schema-validation' && issue.jsonPointer.includes('/slides/0/elements/0'),
    ),
  );
});

void test('schema rejects image elements without imagePath', () => {
  const deck = validDeck();
  deck.slides[0]!.elements.push({ id: 'bad-image', type: 'image', slot: 'heroCard' });
  const issues = validateWithPack(deck);
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'schema-validation' && issue.jsonPointer.includes('/slides/0/elements/'),
    ),
  );
  assert.ok(issues.some((issue) => issue.code === 'missing-image-path'));
});

void test('validator rejects unknown tokens inside element options', () => {
  const deck = validDeck();
  deck.slides[0]!.elements[0]!.options = { fill: { color: '{colors.missingAccent}' } };
  const issues = validateWithPack(deck);
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'unknown-token' && issue.jsonPointer.endsWith('/options/fill/color'),
    ),
  );
});

void test('validator rejects unknown tokens inside promoted chart fields', () => {
  const deck = validDeck();
  deck.slides[0]!.elements.push({
    id: 'bad-chart-tokens',
    type: 'chart',
    x: 80,
    y: 80,
    w: 400,
    h: 260,
    chartType: 'bar',
    data: [{ name: 'Coverage', labels: ['Schema'], values: [100] }],
    chartColors: ['{colors.missingChart}'],
    valGridLine: { color: '{colors.missingGrid}' },
  });
  const issues = validateWithPack(deck);
  assert.ok(
    issues.some(
      (issue) => issue.code === 'unknown-token' && issue.jsonPointer.endsWith('/chartColors/0'),
    ),
  );
  assert.ok(
    issues.some(
      (issue) => issue.code === 'unknown-token' && issue.jsonPointer.endsWith('/valGridLine/color'),
    ),
  );
});

void test('validator rejects unknown tokens anywhere in nativeOptions', () => {
  const deck = validDeck();
  deck.nativeOptions = { theme: { headFontFace: '{fonts.missingDeckFont}' } };
  deck.sections = [{ title: '{colors.missingSectionColor}' }];
  deck.slides[0]!.nativeOptions = { color: '{colors.missingSlideColor}' };
  deck.slides[0]!.elements[0]!.nativeOptions = { margin: '{colors.missingElementColor}' };
  const issues = validateWithPack(deck);
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'unknown-token' &&
        issue.jsonPointer.endsWith('/nativeOptions/theme/headFontFace'),
    ),
  );
  assert.ok(
    issues.some(
      (issue) => issue.code === 'unknown-token' && issue.jsonPointer.endsWith('/sections/0/title'),
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'unknown-token' &&
        issue.jsonPointer.endsWith('/slides/0/nativeOptions/color'),
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'unknown-token' && issue.jsonPointer.endsWith('/nativeOptions/margin'),
    ),
  );
});

void test('validator rejects unsafe native option keys before live object assignment', () => {
  const deck = JSON.parse(JSON.stringify(validDeck())) as DeckSpec;
  const unsafeNativeOptions = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
  deck.nativeOptions = unsafeNativeOptions as DeckSpec['nativeOptions'];
  deck.slides[0]!.nativeOptions = { addText: 'clobber' };
  deck.slides[0]!.elements[0]!.nativeOptions = { constructor: { prototype: { polluted: true } } };
  const issues = validateWithPack(deck);
  assert.ok(
    issues.some(
      (issue) => issue.code === 'schema-validation' && issue.jsonPointer.endsWith('/nativeOptions'),
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'unsafe-native-option-key' && issue.jsonPointer.endsWith('/__proto__'),
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'unsafe-native-option-key' &&
        issue.jsonPointer.endsWith('/nativeOptions/addText'),
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'unsafe-native-option-key' &&
        issue.jsonPointer.endsWith('/nativeOptions/constructor'),
    ),
  );
});

void test('validator rejects slide section and master references that PptxGenJS cannot resolve', () => {
  const deck = validDeck();
  deck.sections = [{ title: 'Declared Section' }];
  deck.slideMasters = [{ title: 'declared-master' }];
  deck.slides[0]!.sectionTitle = 'Missing Section';
  deck.slides[0]!.masterName = 'missing-master';
  const issues = validateWithPack(deck);
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'unknown-section-title' && issue.jsonPointer.endsWith('/sectionTitle'),
    ),
  );
  assert.ok(
    issues.some(
      (issue) => issue.code === 'unknown-slide-master' && issue.jsonPointer.endsWith('/masterName'),
    ),
  );
});

void test('validator resolves section and master reference tokens before comparison', () => {
  const deck = validDeck();
  deck.sections = [{ title: '{colors.good}' }];
  deck.slideMasters = [{ title: '{fonts.heading}' }];
  deck.slides[0]!.sectionTitle = '34D399';
  deck.slides[0]!.masterName = 'Open Sans';
  assert.deepEqual(validateWithPack(deck), []);

  const reverseDeck = validDeck();
  reverseDeck.sections = [{ title: '34D399' }];
  reverseDeck.slideMasters = [{ title: 'Open Sans' }];
  reverseDeck.slides[0]!.sectionTitle = '{colors.good}';
  reverseDeck.slides[0]!.masterName = '{fonts.heading}';
  assert.deepEqual(validateWithPack(reverseDeck), []);

  deck.slides[0]!.sectionTitle = '{colors.accent}';
  deck.slides[0]!.masterName = '{fonts.mono}';
  const issues = validateWithPack(deck);
  assert.ok(issues.some((issue) => issue.code === 'unknown-section-title'));
  assert.ok(issues.some((issue) => issue.code === 'unknown-slide-master'));
});

void test('normalization resolves tokens inside native PptxGenJS support fields', () => {
  const deck = validDeck();
  deck.nativeOptions = { theme: { headFontFace: '{fonts.heading}' } };
  deck.sections = [
    { title: '{colors.accent}', order: 1 },
    { title: '{colors.good}', order: 2 },
  ];
  deck.slideMasters = [
    {
      title: 'native-master',
      background: { color: '{colors.surface}' },
      slideNumber: { color: '{colors.text}' },
      nativeOptions: { margin: 0.1 },
    },
  ];
  deck.slides[0]!.masterName = 'native-master';
  deck.slides[0]!.sectionTitle = '{colors.good}';
  deck.slides[0]!.color = '{colors.text}';
  deck.slides[0]!.slideNumber = { color: '{colors.muted}' };
  deck.slides[0]!.nativeOptions = { background: { color: '{colors.bg}' } };
  deck.slides[0]!.elements[0]!.nativeOptions = { color: '{colors.warn}', fontFace: '{fonts.mono}' };
  const normalized = normalizeDeck(deck);
  const normalizedNative = normalized.nativeOptions as { theme?: { headFontFace?: string } };
  const normalizedSlideNative = normalized.slides[0]!.nativeOptions as {
    background?: { color?: string };
  };
  assert.equal(normalizedNative.theme?.headFontFace, 'Open Sans');
  assert.ok(normalized.sections);
  assert.ok(normalized.slideMasters);
  const firstSection = normalized.sections[0];
  const firstMaster = normalized.slideMasters[0];
  assert.ok(firstSection);
  assert.ok(firstMaster);
  const firstMasterBackground = firstMaster.background;
  const firstMasterSlideNumber = firstMaster.slideNumber;
  assert.ok(firstMasterBackground);
  assert.ok(firstMasterSlideNumber);
  assert.equal(firstSection.title, '67D8FF');
  assert.equal(firstMasterBackground.color, '0B1729');
  assert.equal(firstMasterSlideNumber.color, 'F8FAFC');
  assert.equal(normalized.slides[0]!.sectionTitle, '34D399');
  assert.equal(normalized.slides[0]!.color, 'F8FAFC');
  assert.equal(normalized.slides[0]!.slideNumber?.color, 'E2E8F0');
  assert.equal(normalizedSlideNative.background?.color, '07111F');
  assert.equal(normalized.slides[0]!.elements[0]!.nativeOptions!.color, 'FDBA74');
  assert.equal(normalized.slides[0]!.elements[0]!.nativeOptions!.fontFace, 'Roboto Mono');
});

void test('normalized validation rejects unresolved geometry', () => {
  const deck = normalizeDeck(validDeck());
  delete deck.slides[0]!.elements[0]!.x;
  const issues = validateDeck(deck, {
    normalized: true,
    pack: loadTemplatePack(deck.template, deck.theme),
  });
  assert.ok(issues.some((issue) => issue.code === 'missing-geometry'));
});

void test('normalized validation rejects unresolved line geometry', () => {
  const deck = normalizeDeck(readJson('examples/feature-gallery/deck.source.json') as DeckSpec);
  const line = deck.slides
    .flatMap((slide) => slide.elements)
    .find((element) => element.type === 'line')!;
  delete line.x;
  delete line.y;
  delete line.w;
  delete line.h;
  delete line.x1;
  delete line.y1;
  delete line.x2;
  delete line.y2;
  const issues = validateDeck(deck, {
    normalized: true,
    pack: loadTemplatePack(deck.template, deck.theme),
  });
  assert.ok(issues.some((issue) => issue.code === 'missing-line-geometry'));
});

void test('normalized build input is schema-validated before template loading', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deckspec-test-'));
  const file = path.join(tmp, 'bad-normalized.deck.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      deckId: 'bad-normalized',
      template: '',
      theme: 'dark',
      normalized: true,
      size: { w: 1920, h: 1080 },
      slides: [
        { id: 's01', layout: 'split-hero', elements: [{ id: 't', type: 'text', text: 'x' }] },
      ],
    }),
  );
  assert.throws(() => loadDeckForBuild(file), /Normalized deck schema validation/);
});

void test('normalized geometry preserves intentional slide 2 subtitle/card gap', () => {
  const deck = normalizeDeck(validDeck());
  const slide = deck.slides[1]!;
  const body = slide.elements.find((element) => element.id === 'body')!;
  const card = slide.elements.find((element) => element.id === 'card1-bg')!;
  assert.equal((card.y ?? 0) - ((body.y ?? 0) + (body.h ?? 0)), 90);
});

void test('feature gallery source exercises rendered PptxGenJS support surfaces', () => {
  const source = readJson('examples/feature-gallery/deck.source.json') as DeckSpec;
  const pack = loadTemplatePack(source.template, source.theme);
  assert.deepEqual(validateDeck(source, { pack }), []);
  const normalized = normalizeDeck(source);
  assert.equal(normalized.slides.length, 10);
  const report = qaDeck(normalized);
  assert.deepEqual(report.summary, { error: 0, warn: 0 });
  const types = new Set<string>(
    normalized.slides.flatMap((slide) => slide.elements.map((element) => element.type)),
  );
  for (const type of ['text', 'shape', 'line', 'image', 'table', 'chart', 'media'])
    assert.ok(types.has(type), `missing ${type}`);
  assert.equal(normalized.sections?.length, 2);
  assert.equal(normalized.slideMasters?.length, 1);
  const sectionTitles = new Set(normalized.sections.map((section) => section.title));
  const masterTitles = new Set(normalized.slideMasters.map((master) => master.title));
  for (const slide of normalized.slides) {
    if (slide.sectionTitle)
      assert.ok(
        sectionTitles.has(slide.sectionTitle),
        `unknown sectionTitle ${slide.sectionTitle}`,
      );
    if (slide.masterName)
      assert.ok(masterTitles.has(slide.masterName), `unknown masterName ${slide.masterName}`);
  }
  const chartTypes = new Set<string>(
    normalized.slides
      .flatMap((slide) => slide.elements)
      .filter((element) => element.type === 'chart')
      .map((element) => String(element.chartType)),
  );
  const expectedChartTypes = ['bar', 'line', 'pie', 'area'] as const;
  for (const chartType of expectedChartTypes)
    assert.ok(chartTypes.has(chartType), `missing ${chartType} chart`);
  assert.ok(normalized.slides.some((slide) => slide.slideNumber));
  assert.ok(normalized.slides.some((slide) => slide.backgroundImage));
  assert.ok(normalized.slides.some((slide) => slide.notes));
  assert.ok(
    normalized.slides.some((slide) =>
      slide.elements.some(
        (element) =>
          element.type === 'image' && element.imagePath && element.sizing?.type === 'contain',
      ),
    ),
  );
  assert.ok(
    normalized.slides.some((slide) =>
      slide.elements.some((element) => element.type === 'image' && element.imageData),
    ),
  );
  assert.ok(
    normalized.slides.some((slide) =>
      slide.elements.some(
        (element) => element.type === 'media' && element.path?.endsWith('beep.wav'),
      ),
    ),
  );
  assert.ok(
    normalized.slides.some((slide) =>
      slide.elements.some(
        (element) =>
          element.type === 'table' && element.colW && element.rowH && element.autoPageRepeatHeader,
      ),
    ),
  );
  assert.ok(normalized.slides.some((slide) => slide.elements.some((element) => element.runs)));
  assert.ok(
    normalized.slides.some((slide) => slide.elements.some((element) => element.nativeOptions)),
  );
  assert.ok(normalized.slides.some((slide) => slide.elements.some((element) => element.options)));
});

void test('light feature gallery exercises the light theme rendered path', () => {
  const source = readJson('examples/feature-gallery-light/deck.source.json') as DeckSpec;
  const pack = loadTemplatePack(source.template, source.theme);
  assert.equal(source.theme, 'light');
  assert.deepEqual(validateDeck(source, { pack }), []);
  const normalized = normalizeDeck(source);
  assert.equal(normalized.slides.length, 3);
  assert.deepEqual(qaDeck(normalized).summary, { error: 0, warn: 0 });
  assert.ok(normalized.slides.some((slide) => slide.masterName === 'light-master'));
  assert.ok(
    normalized.slides.some((slide) => slide.elements.some((element) => element.type === 'chart')),
  );
  assert.ok(
    normalized.slides.some((slide) => slide.elements.some((element) => element.type === 'table')),
  );
  assert.ok(
    normalized.slides.some((slide) =>
      slide.elements.some(
        (element) => element.type === 'image' && element.sizing?.type === 'contain',
      ),
    ),
  );
});

void test('schema accepts the curated PptxGenJS slide add* surface', () => {
  const deck: DeckSpec = {
    deckId: 'pptx-surface',
    template: 'hybrid-keynote',
    theme: 'dark',
    size: { w: 1920, h: 1080 },
    nativeOptions: { rtlMode: false },
    sections: [{ title: 'Surface', order: 1 }],
    slideMasters: [
      {
        title: 'native-master',
        background: { color: '07111F' },
        slideNumber: { x: 12.2, y: 7.0, color: 'FFFFFF' },
      },
    ],
    slides: [
      {
        id: 's01',
        layout: 'split-hero',
        masterName: 'native-master',
        sectionTitle: 'Surface',
        color: 'FFFFFF',
        slideNumber: { x: 12.2, y: 7.0, color: 'FFFFFF', fontSize: 8 },
        nativeOptions: { color: 'FFFFFF' },
        elements: [
          {
            id: 'label',
            type: 'text',
            runs: [
              { text: 'Docs', options: { bold: true } },
              { text: ' link', options: { italic: true } },
            ],
            x: 80,
            y: 80,
            w: 320,
            h: 80,
            hyperlink: { url: 'https://example.com', tooltip: 'Open docs' },
            align: 'center',
            valign: 'mid',
            underline: true,
            wrap: true,
            nativeOptions: { objectName: 'Native Label' },
          },
          {
            id: 'image',
            type: 'image',
            imagePath: 'examples/shared/demo-qr.png',
            x: 80,
            y: 200,
            w: 240,
            h: 240,
            altText: 'QR code',
            sizing: { type: 'contain', w: 240, h: 240 },
            transparency: 5,
          },
          {
            id: 'image-data',
            type: 'image',
            imageData: 'image/png;base64,iVBORw0KGgo=',
            x: 80,
            y: 460,
            w: 80,
            h: 80,
          },
          {
            id: 'table',
            type: 'table',
            x: 380,
            y: 200,
            w: 500,
            h: 240,
            rows: [
              [
                { text: 'Metric', options: { bold: true } },
                { text: 'Value', options: { bold: true } },
              ],
              ['QA', 'PASS'],
            ],
            options: { border: { color: '334155', width: 1 }, margin: 0.04 },
          },
          {
            id: 'chart',
            type: 'chart',
            x: 940,
            y: 180,
            w: 520,
            h: 320,
            chartType: 'bar',
            data: [{ name: 'Coverage', labels: ['Line', 'Branch'], values: [90, 64] }],
            options: { showLegend: false, showValue: true },
          },
          {
            id: 'media',
            type: 'media',
            x: 80,
            y: 520,
            w: 480,
            h: 270,
            mediaType: 'online',
            link: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          },
        ],
      },
    ],
  };
  const issues = validateDeck(deck, { pack: loadTemplatePack(deck.template, deck.theme) });
  assert.deepEqual(issues, []);
});

void test('template pack schemas validate bundled template files', () => {
  const pack = loadTemplatePack('hybrid-keynote', 'dark');
  assert.deepEqual(validateTemplatePack(pack), []);
  const invalidLayout = { layoutId: 'bad', slots: { hero: { x: 0, y: 0, w: -1, h: 100 } } };
  assert.ok(
    validateJsonWithSchema('layout.schema.json', invalidLayout).some(
      (issue) => issue.code === 'schema-validation',
    ),
  );
});

void test('QA catches overlap, out-of-bounds, and tight text rhythm regressions', () => {
  const deck = normalizeDeck(validDeck());
  const slide = deck.slides[0]!;
  slide.elements = [
    { id: 'a', type: 'text', text: 'A', x: 20, y: 20, w: 200, h: 40, fontSize: 24 },
    { id: 'b', type: 'text', text: 'B', x: 50, y: 30, w: 200, h: 40, fontSize: 24 },
    { id: 'c', type: 'text', text: 'C', x: 40, y: 72, w: 200, h: 40, fontSize: 24 },
    { id: 'd', type: 'shape', x: 1900, y: 1000, w: 80, h: 80 },
  ];
  const codes = qaDeck(deck).issues.map((issue) => issue.code);
  assert.ok(codes.includes('overlap-risk'));
  assert.ok(codes.includes('out-of-bounds'));
  assert.ok(codes.includes('tight-text-gap'));
});

void test('CLI help exits successfully for subprocess users', () => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--help'], {
    encoding: 'utf8',
  });
  assert.match(output, /Usage: deckspec/);
});

void test('CLI accepts flags before input and reports missing option values', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deckspec-cli-'));
  const normalizedFile = path.join(tmp, 'framework.normalized.json');
  fs.writeFileSync(normalizedFile, JSON.stringify(normalizeDeck(validDeck())));
  const validateOutput = execFileSync(
    process.execPath,
    ['--import', 'tsx', 'src/cli.ts', 'validate', '--normalized', normalizedFile],
    { encoding: 'utf8' },
  );
  const validateResult = JSON.parse(validateOutput) as { status?: string; normalized?: boolean };
  assert.equal(validateResult.status, 'DECKSPEC_VALIDATE_PASS');
  assert.equal(validateResult.normalized, true);

  const missingValue = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/cli.ts',
      'normalize',
      'examples/framework-smoke/deck.source.json',
      '--out',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(missingValue.status, 2);
  assert.match(missingValue.stderr, /Missing value for --out/);
  assert.match(missingValue.stderr, /Usage: deckspec/);
});

void test('PPTX builder renders table, chart, image, notes, and integrity metadata', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deckspec-pptx-'));
  const sourceFile = path.join(tmp, 'surface.deck.source.json');
  const pptxFile = path.join(tmp, 'surface.pptx');
  const deck: DeckSpec = {
    deckId: 'surface-build',
    template: 'hybrid-keynote',
    theme: 'dark',
    size: { w: 1920, h: 1080 },
    nativeOptions: { rtlMode: false },
    sections: [{ title: 'Build', order: 1 }],
    slides: [
      {
        id: 's01',
        layout: 'split-hero',
        sectionTitle: 'Build',
        notes: 'Builder regression notes.',
        hidden: true,
        backgroundImage: 'examples/shared/demo-qr.png',
        backgroundTransparency: 20,
        elements: [
          {
            id: 'title',
            type: 'text',
            text: 'Surface',
            x: 80,
            y: 80,
            w: 500,
            h: 80,
            fontSize: 34,
            color: 'FFFFFF',
            hyperlink: { url: 'https://example.com' },
            nativeOptions: { objectName: 'Native Text Proof' },
          },
          {
            id: 'table',
            type: 'table',
            x: 80,
            y: 200,
            w: 520,
            h: 240,
            rows: [
              ['Metric', 'Value'],
              ['Build', 'PASS'],
            ],
            options: { border: { color: '334155', width: 1 }, fontSize: 14 },
          },
          {
            id: 'chart',
            type: 'chart',
            x: 680,
            y: 180,
            w: 600,
            h: 320,
            chartType: 'bar',
            data: [{ name: 'Coverage', labels: ['Line', 'Branch'], values: [90, 64] }],
            options: { showLegend: false },
          },
          {
            id: 'image',
            type: 'image',
            imagePath: 'examples/shared/demo-qr.png',
            x: 1340,
            y: 160,
            w: 220,
            h: 220,
            altText: 'QR proof',
            sizing: { type: 'contain', w: 220, h: 220 },
            nativeOptions: { objectName: 'Sized Image Proof' },
          },
        ],
      },
    ],
  };
  fs.writeFileSync(sourceFile, JSON.stringify(deck));
  const result = await buildPptx(sourceFile, pptxFile);
  assert.equal(result.deck.slides.length, 1);
  const integrity = await verifyPptx(pptxFile, 1);
  assert.equal(integrity.slideXmlCount, 1);
  assert.equal(integrity.notesXmlCount, 1);
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxFile));
  const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  assert.doesNotMatch(slideXml, /cx="220"\s+cy="220"/);
  const sizedImagePic =
    /<p:pic>[\s\S]*?<p:cNvPr[^>]*name="Sized Image Proof"[\s\S]*?<\/p:pic>/.exec(slideXml)?.[0];
  assert.ok(sizedImagePic, 'sized image object must be present by objectName');
  const sizedImageExtents = [...sizedImagePic.matchAll(/<a:ext cx="(\d+)" cy="(\d+)"/g)].map(
    (match) => ({
      cx: Number(match[1]),
      cy: Number(match[2]),
    }),
  );
  assert.ok(
    sizedImageExtents.some(
      (extent) =>
        extent.cx > 1_250_000 &&
        extent.cx < 1_550_000 &&
        extent.cy > 1_250_000 &&
        extent.cy < 1_550_000,
    ),
    'specific sized image must convert 220px to roughly 1.53in once, not twice',
  );
  assert.match(slideXml, /Native Text Proof/);
  assert.match(slideXml, /show="0"/);
  assert.ok((slideXml.match(/<p:pic/g) ?? []).length >= 2);
});

void test('smoke writes normalized, QA, and PPTX outputs without render', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deckspec-smoke-'));
  const sourceFile = path.join(tmp, 'deck.source.json');
  fs.writeFileSync(sourceFile, JSON.stringify(validDeck()));
  const report = await smoke(sourceFile, { outDir: tmp, render: false });
  assert.equal(report.status, 'DECKSPEC_SMOKE_PASS');
  assert.equal(report.qaSummary.error, 0);
  assert.ok(fs.existsSync(report.outputs.normalized));
  assert.ok(fs.existsSync(report.outputs.qaReport));
  assert.ok(fs.existsSync(report.outputs.pptx));
});
