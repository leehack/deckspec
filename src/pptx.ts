import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import pptxgenModule from 'pptxgenjs';
import type {
  DeckElement,
  DeckSize,
  DeckSlide,
  DeckSpec,
  PptxIntegrityReport,
  TableCell,
  TableRow,
} from './types.js';
import { loadDeckForBuild } from './normalize.js';
import { stripHash } from './io.js';
import { applyNativeOptions, sanitizeNativeValue } from './native-options.js';

const PptxGenJS = ((pptxgenModule as unknown as { default?: unknown }).default ??
  pptxgenModule) as new () => PptxDeck;
const SLIDE_WIDTH_IN = 13.3333333333;

interface PptxSlide {
  [key: string]: unknown;
  addText(text: unknown, options: unknown): void;
  addShape(shape: unknown, options: unknown): void;
  addImage(options: unknown): void;
  addTable(rows: unknown, options: unknown): void;
  addChart(type: unknown, data: unknown, options: unknown): void;
  addMedia(options: unknown): void;
  addNotes(notes: string): void;
  background: unknown;
  color?: string;
  slideNumber?: unknown;
  hidden?: boolean;
}

interface PptxDeck {
  [key: string]: unknown;
  ShapeType: Record<string, unknown>;
  ChartType: Record<string, unknown>;
  defineLayout(layout: unknown): void;
  defineSlideMaster(master: unknown): void;
  addSection(section: unknown): void;
  addSlide(options?: unknown): PptxSlide;
  writeFile(options: { fileName: string }): Promise<void>;
  layout: string;
  author: string;
  company: string;
  subject: string;
  title: string;
  lang: string;
  theme: unknown;
}

function pxToIn(px: number, size: DeckSize): number {
  return px / (size.w / SLIDE_WIDTH_IN);
}
function geom(element: DeckElement, size: DeckSize): Record<string, number> {
  return {
    x: pxToIn(element.x ?? 0, size),
    y: pxToIn(element.y ?? 0, size),
    w: pxToIn(element.w ?? 1, size),
    h: pxToIn(element.h ?? 1, size),
  };
}
function convertSizing(value: unknown, size: DeckSize): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const sizing = { ...(value as Record<string, unknown>) };
  for (const key of ['x', 'y', 'w', 'h'])
    if (typeof sizing[key] === 'number') sizing[key] = pxToIn(sizing[key], size);
  return sizing;
}

function clean<T>(value: T): T {
  if (Array.isArray(value)) return (value as unknown[]).map((item) => clean(item)) as T;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, key === 'color' ? stripHash(item) : clean(item)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

function elementOptions(
  element: DeckElement,
  size: DeckSize,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...geom(element, size),
    ...(sanitizeNativeValue(element.options ?? {}, {
      pointer: `/elements/${element.id}/options`,
    }) as Record<string, unknown>),
  };
  for (const key of keys) {
    const value = element[key];
    if (value !== undefined) out[key] = value;
  }
  Object.assign(
    out,
    sanitizeNativeValue(element.nativeOptions ?? {}, {
      pointer: `/elements/${element.id}/nativeOptions`,
      blockReserved: true,
    }) as Record<string, unknown>,
  );
  if (out.sizing) out.sizing = convertSizing(out.sizing, size);
  if (out.valign === 'middle') out.valign = 'mid';
  return clean(out);
}

function shapeName(pptx: PptxDeck, shape: unknown): unknown {
  const raw = typeof shape === 'string' ? shape : 'rect';
  const aliases: Record<string, string> = { rectangle: 'rect' };
  const key = aliases[raw] ?? raw;
  return pptx.ShapeType[key] ?? key;
}

function chartName(pptx: PptxDeck, type: unknown): unknown {
  const raw = typeof type === 'string' ? type : 'bar';
  const aliases: Record<string, string> = { bar3D: 'bar3d' };
  const key = aliases[raw] ?? raw;
  return pptx.ChartType[key] ?? key;
}

function addText(slide: PptxSlide, element: DeckElement, size: DeckSize): void {
  const textValue = element.runs ? clean(element.runs) : (element.text ?? '');
  slide.addText(
    textValue,
    elementOptions(element, size, [
      'fontFace',
      'fontSize',
      'bold',
      'italic',
      'color',
      'margin',
      'breakLine',
      'charSpace',
      'align',
      'valign',
      'fit',
      'hyperlink',
      'rotate',
      'shadow',
      'objectName',
      'underline',
      'highlight',
      'lineSpacingMultiple',
      'lineSpacing',
      'wrap',
      'bullet',
    ]),
  );
}

function addShape(pptx: PptxDeck, slide: PptxSlide, element: DeckElement, size: DeckSize): void {
  slide.addShape(
    shapeName(pptx, element.shape),
    elementOptions(element, size, [
      'fill',
      'line',
      'rectRadius',
      'rotate',
      'transparency',
      'shadow',
      'hyperlink',
      'objectName',
      'align',
      'valign',
    ]),
  );
}

function addLine(slide: PptxSlide, element: DeckElement, size: DeckSize): void {
  const x1 = pxToIn(element.x1 ?? element.x ?? 0, size);
  const y1 = pxToIn(element.y1 ?? element.y ?? 0, size);
  const x2 = pxToIn(element.x2 ?? (element.x ?? 0) + (element.w ?? 0), size);
  const y2 = pxToIn(element.y2 ?? (element.y ?? 0) + (element.h ?? 0), size);
  slide.addShape(
    'line',
    clean({
      x: x1,
      y: y1,
      w: x2 - x1,
      h: y2 - y1,
      line: element.line,
      ...(sanitizeNativeValue(element.options ?? {}, {
        pointer: `/elements/${element.id}/options`,
      }) as Record<string, unknown>),
      ...(sanitizeNativeValue(element.nativeOptions ?? {}, {
        pointer: `/elements/${element.id}/nativeOptions`,
        blockReserved: true,
      }) as Record<string, unknown>),
    }),
  );
}

function addImage(slide: PptxSlide, element: DeckElement, size: DeckSize): void {
  if (!element.imagePath && !element.imageData)
    throw new Error(`Image element '${element.id}' is missing imagePath or imageData.`);
  const source = element.imageData ? { data: element.imageData } : { path: element.imagePath };
  slide.addImage({
    ...source,
    ...elementOptions(element, size, [
      'altText',
      'flipH',
      'flipV',
      'hyperlink',
      'rotate',
      'rounding',
      'shadow',
      'sizing',
      'transparency',
      'objectName',
    ]),
  });
}

function addSlideBackgroundImage(slide: PptxSlide, deckSlide: DeckSlide, size: DeckSize): void {
  if (!deckSlide.backgroundImage && !deckSlide.backgroundData) return;
  const source = deckSlide.backgroundData
    ? { data: deckSlide.backgroundData }
    : { path: deckSlide.backgroundImage };
  slide.addImage(
    clean({
      ...source,
      x: 0,
      y: 0,
      w: SLIDE_WIDTH_IN,
      h: layoutHeightIn(size),
      transparency: deckSlide.backgroundTransparency,
      objectName: 'slide-background-image',
    }),
  );
}

function normalizeTableCell(cell: TableCell): unknown {
  if (typeof cell === 'string' || typeof cell === 'number') return String(cell);
  return clean(cell);
}

function normalizeRows(rows: TableRow[] | undefined): unknown[] {
  return (rows ?? []).map((row) => row.map((cell) => normalizeTableCell(cell)));
}

function addTable(slide: PptxSlide, element: DeckElement, size: DeckSize): void {
  slide.addTable(
    normalizeRows(element.rows),
    elementOptions(element, size, [
      'fontFace',
      'fontSize',
      'bold',
      'italic',
      'color',
      'margin',
      'align',
      'valign',
      'fill',
      'border',
      'colW',
      'rowH',
      'autoPage',
      'autoPageRepeatHeader',
      'autoPageHeaderRows',
    ]),
  );
}

function addChart(pptx: PptxDeck, slide: PptxSlide, element: DeckElement, size: DeckSize): void {
  slide.addChart(
    chartName(pptx, element.chartType),
    clean(element.data ?? []),
    elementOptions(element, size, [
      'showLegend',
      'showTitle',
      'showValue',
      'chartColors',
      'catAxisLabelColor',
      'valAxisLabelColor',
      'catAxisLabelFontFace',
      'catAxisLabelFontSize',
      'valAxisLabelFontFace',
      'valAxisLabelFontSize',
      'ser',
      'catAxisTitle',
      'valAxisTitle',
      'valAxisMinVal',
      'valAxisMaxVal',
      'valGridLine',
    ]),
  );
}

function addMedia(slide: PptxSlide, element: DeckElement, size: DeckSize): void {
  const options = elementOptions(element, size, ['link', 'path', 'cover', 'extn', 'objectName']);
  options.type = element.mediaType;
  slide.addMedia(options);
}

function addElement(pptx: PptxDeck, slide: PptxSlide, element: DeckElement, size: DeckSize): void {
  switch (element.type) {
    case 'text':
      addText(slide, element, size);
      return;
    case 'shape':
      addShape(pptx, slide, element, size);
      return;
    case 'line':
      addLine(slide, element, size);
      return;
    case 'image':
      addImage(slide, element, size);
      return;
    case 'table':
      addTable(slide, element, size);
      return;
    case 'chart':
      addChart(pptx, slide, element, size);
      return;
    case 'media':
      addMedia(slide, element, size);
      return;
  }
}

function layoutHeightIn(size: DeckSize): number {
  return SLIDE_WIDTH_IN * (size.h / size.w);
}

function sortedElements(elements: DeckElement[]): DeckElement[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => (a.element.z ?? 0) - (b.element.z ?? 0) || a.index - b.index)
    .map(({ element }) => element);
}

export async function buildPptx(
  inputFile: string,
  outputFile: string,
): Promise<{ deck: DeckSpec; output: string }> {
  const deck = loadDeckForBuild(inputFile);
  const pptx = new PptxGenJS();
  const layoutName = `DECKSPEC_${deck.size.w}x${deck.size.h}`;
  pptx.defineLayout({ name: layoutName, width: SLIDE_WIDTH_IN, height: layoutHeightIn(deck.size) });
  pptx.layout = layoutName;
  pptx.author = deck.meta?.author ?? 'DeckSpec Demo';
  pptx.company = deck.meta?.company ?? 'npmjs.com/package/deckspec';
  pptx.subject = deck.meta?.subject ?? 'Deterministic DeckSpec deck';
  pptx.title = deck.title ?? deck.deckId;
  pptx.lang = deck.meta?.lang ?? 'en-US';
  pptx.theme = { headFontFace: 'Open Sans', bodyFontFace: 'Open Sans' };
  applyNativeOptions(pptx, deck.nativeOptions, '/nativeOptions');
  for (const [masterIndex, master] of (deck.slideMasters ?? []).entries()) {
    const { nativeOptions, ...masterBase } = master;
    pptx.defineSlideMaster(
      clean({
        ...(sanitizeNativeValue(masterBase, {
          pointer: `/slideMasters/${masterIndex}`,
          blockReserved: true,
        }) as Record<string, unknown>),
        ...(sanitizeNativeValue(nativeOptions ?? {}, {
          pointer: `/slideMasters/${masterIndex}/nativeOptions`,
          blockReserved: true,
        }) as Record<string, unknown>),
      }),
    );
  }
  for (const [sectionIndex, section] of (deck.sections ?? []).entries())
    pptx.addSection(
      clean(
        sanitizeNativeValue(section, { pointer: `/sections/${sectionIndex}`, blockReserved: true }),
      ),
    );
  for (const deckSlide of deck.slides) {
    const slide = pptx.addSlide(
      clean({ masterName: deckSlide.masterName, sectionTitle: deckSlide.sectionTitle }),
    );
    slide.background = { color: stripHash(deckSlide.background ?? 'FFFFFF') };
    addSlideBackgroundImage(slide, deckSlide, deck.size);
    if (deckSlide.color) slide.color = stripHash(deckSlide.color);
    if (deckSlide.slideNumber)
      slide.slideNumber = clean(
        sanitizeNativeValue(deckSlide.slideNumber, {
          pointer: `/slides/${deckSlide.id}/slideNumber`,
          blockReserved: true,
        }),
      );
    applyNativeOptions(slide, deckSlide.nativeOptions, `/slides/${deckSlide.id}/nativeOptions`);
    if (deckSlide.hidden) slide.hidden = true;
    for (const element of sortedElements(deckSlide.elements))
      addElement(pptx, slide, element, deck.size);
    if (deckSlide.notes) slide.addNotes(deckSlide.notes);
  }
  const out = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await pptx.writeFile({ fileName: out });
  return { deck, output: out };
}

export async function verifyPptx(
  file: string,
  expectedSlideCount: number,
): Promise<PptxIntegrityReport> {
  if (!fs.existsSync(file)) throw new Error(`PPTX was not generated: ${file}`);
  const bytes = fs.statSync(file).size;
  if (bytes <= 0) throw new Error(`PPTX is empty: ${file}`);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.keys(zip.files);
  const slideXmlCount = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  const notesXmlCount = names.filter((name) =>
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name),
  ).length;
  const hasContentTypes = names.includes('[Content_Types].xml');
  if (slideXmlCount !== expectedSlideCount || !hasContentTypes)
    throw new Error(
      `PPTX integrity failed for ${file}: slides=${slideXmlCount}, expected=${expectedSlideCount}, hasContentTypes=${hasContentTypes}`,
    );
  return { file, bytes, slideXmlCount, notesXmlCount, hasContentTypes };
}
