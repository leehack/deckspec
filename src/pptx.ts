import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import pptxgenModule from 'pptxgenjs';
import type {
  CustomGeometryCommand,
  CustomGeometryPathSpec,
  CustomGeometrySpec,
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

interface ImageShapePatch {
  slideNumber: number;
  objectName: string;
  element: DeckElement;
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
  const aliases: Record<string, string> = {
    circle: 'ellipse',
    elipse: 'ellipse',
    oval: 'ellipse',
    rectangle: 'rect',
  };
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

function addImageShape(
  pptx: PptxDeck,
  slide: PptxSlide,
  element: DeckElement,
  size: DeckSize,
  slideNumber: number,
  imageShapePatches: ImageShapePatch[],
): void {
  if (!element.imagePath && !element.imageData)
    throw new Error(`ImageShape element '${element.id}' is missing imagePath or imageData.`);
  const objectName = element.objectName ?? `deckspec-image-shape-${element.id}`;
  addShape(
    pptx,
    slide,
    {
      ...element,
      shape: element.customGeometry ? 'rect' : element.shape,
      objectName,
      fill: element.fill ?? { color: 'FFFFFF', transparency: 100 },
    },
    size,
  );
  imageShapePatches.push({ slideNumber, objectName, element: { ...element, objectName } });
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

function addElement(
  pptx: PptxDeck,
  slide: PptxSlide,
  element: DeckElement,
  size: DeckSize,
  slideNumber: number,
  imageShapePatches: ImageShapePatch[],
): void {
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
    case 'imageShape':
      addImageShape(pptx, slide, element, size, slideNumber, imageShapePatches);
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mediaContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.png':
    default:
      return 'image/png';
  }
}

function imagePayload(element: DeckElement): { bytes: Buffer; ext: string; contentType: string } {
  if (element.imageData) {
    const dataUrl = /^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/s.exec(element.imageData);
    if (dataUrl) {
      const contentType = dataUrl[1] ?? 'image/png';
      const ext = contentType.includes('jpeg') ? '.jpg' : `.${contentType.split('/')[1] ?? 'png'}`;
      return { bytes: Buffer.from(dataUrl[2] ?? '', 'base64'), ext, contentType };
    }
    return {
      bytes: Buffer.from(element.imageData, 'base64'),
      ext: '.png',
      contentType: 'image/png',
    };
  }
  if (!element.imagePath)
    throw new Error(`ImageShape element '${element.id}' is missing imagePath.`);
  const ext = path.extname(element.imagePath).toLowerCase() || '.png';
  return { bytes: fs.readFileSync(element.imagePath), ext, contentType: mediaContentType(ext) };
}

function ensureContentType(contentTypesXml: string, ext: string, contentType: string): string {
  const extension = ext.replace(/^\./, '');
  if (new RegExp(`<Default\\s+Extension="${extension}"\\b`).test(contentTypesXml))
    return contentTypesXml;
  return contentTypesXml.replace(
    '</Types>',
    `<Default Extension="${extension}" ContentType="${contentType}"/></Types>`,
  );
}

function ensureSlideRels(relsXml: string | undefined): string {
  return (
    relsXml ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  );
}

function nextRelId(relsXml: string): string {
  const max = [...relsXml.matchAll(/Id="rId(\d+)"/g)].reduce(
    (current, match) => Math.max(current, Number(match[1])),
    0,
  );
  return `rId${max + 1}`;
}

function toPathCoord(value: number): number {
  return Math.round(value * 100000);
}

function toAngle(value: number): number {
  return Math.round(value * 60000);
}

function pathPointXml(x: number, y: number): string {
  return `<a:pt x="${toPathCoord(x)}" y="${toPathCoord(y)}"/>`;
}

function commandXml(command: CustomGeometryCommand): string {
  switch (command.type) {
    case 'moveTo':
      return `<a:moveTo>${pathPointXml(command.x, command.y)}</a:moveTo>`;
    case 'lineTo':
      return `<a:lnTo>${pathPointXml(command.x, command.y)}</a:lnTo>`;
    case 'quadBezTo':
      return `<a:quadBezTo>${pathPointXml(command.x1, command.y1)}${pathPointXml(command.x, command.y)}</a:quadBezTo>`;
    case 'cubicBezTo':
      return `<a:cubicBezTo>${pathPointXml(command.x1, command.y1)}${pathPointXml(command.x2, command.y2)}${pathPointXml(command.x, command.y)}</a:cubicBezTo>`;
    case 'arcTo':
      return `<a:arcTo wR="${toPathCoord(command.wR)}" hR="${toPathCoord(command.hR)}" stAng="${toAngle(command.stAng)}" swAng="${toAngle(command.swAng)}"/>`;
    case 'close':
      return '<a:close/>';
  }
}

function pointPathXml(points: Array<[number, number]>, close: boolean | undefined): string {
  const [first, ...rest] = points;
  if (!first || rest.length < 2)
    throw new Error('customGeometry.points requires at least 3 points.');
  const pathItems = [
    `<a:moveTo>${pathPointXml(first[0], first[1])}</a:moveTo>`,
    ...rest.map(([x, y]) => `<a:lnTo>${pathPointXml(x, y)}</a:lnTo>`),
    close === false ? '' : '<a:close/>',
  ].join('');
  return `<a:path w="100000" h="100000">${pathItems}</a:path>`;
}

function customPathXml(pathSpec: CustomGeometryPathSpec): string {
  const width = Math.round(pathSpec.w ?? 100000);
  const height = Math.round(pathSpec.h ?? 100000);
  return `<a:path w="${width}" h="${height}">${pathSpec.commands.map((command) => commandXml(command)).join('')}</a:path>`;
}

function safeRawCustomGeometryXml(rawXml: string): string {
  const trimmed = rawXml.trim();
  if (!/^<a:custGeom[\s\S]*<\/a:custGeom>$/.test(trimmed))
    throw new Error('customGeometry.rawXml must be a complete <a:custGeom> element.');
  if (/<\/?(?:p|r|rel|Relationship|Relationships)[:\s>]/i.test(trimmed))
    throw new Error('customGeometry.rawXml must contain only DrawingML custom geometry XML.');
  return trimmed;
}

function customGeometryXml(geometry: CustomGeometrySpec): string {
  if (geometry.rawXml) return safeRawCustomGeometryXml(geometry.rawXml);
  const pathXml = geometry.paths?.length
    ? geometry.paths.map((pathSpec) => customPathXml(pathSpec)).join('')
    : geometry.points
      ? pointPathXml(geometry.points, geometry.close)
      : '';
  if (!pathXml) throw new Error('customGeometry requires points, paths, or rawXml.');
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="100000" b="100000"/><a:pathLst>${pathXml}</a:pathLst></a:custGeom>`;
}

function patchCustomGeometry(block: string, geometry: CustomGeometrySpec | undefined): string {
  if (!geometry) return block;
  const xml = customGeometryXml(geometry);
  let patched = block.replace(/<a:prstGeom[\s\S]*?<\/a:prstGeom>/, xml);
  if (patched === block) patched = block.replace(/<a:custGeom>[\s\S]*?<\/a:custGeom>/, xml);
  if (patched === block) throw new Error('Could not inject customGeometry into shape XML.');
  return patched;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface FillRectSpec {
  srcRectAttrs: string;
  fillRectAttrs: string;
}

function rectAttrs(values: Record<'l' | 't' | 'r' | 'b', number>): string {
  return (['l', 't', 'r', 'b'] as const)
    .filter((key) => values[key] > 0)
    .map((key) => `${key}="${Math.round(values[key] * 100000)}"`)
    .join(' ');
}

function imageShapeFillRectSpec(element: DeckElement, dimensions: ImageDimensions): FillRectSpec {
  const sizing = element.sizing;
  if (!sizing) return { srcRectAttrs: '', fillRectAttrs: '' };
  if (sizing.type === 'crop') {
    const cropX = sizing.x ?? 0;
    const cropY = sizing.y ?? 0;
    const cropW = sizing.w;
    const cropH = sizing.h;
    return {
      srcRectAttrs: rectAttrs({
        l: Math.max(0, cropX / dimensions.width),
        t: Math.max(0, cropY / dimensions.height),
        r: Math.max(0, 1 - (cropX + cropW) / dimensions.width),
        b: Math.max(0, 1 - (cropY + cropH) / dimensions.height),
      }),
      fillRectAttrs: '',
    };
  }

  const boxW = element.w ?? sizing.w;
  const boxH = element.h ?? sizing.h;
  const boxAspect = boxW / boxH;
  const imageAspect = dimensions.width / dimensions.height;
  if (sizing.type === 'cover') {
    if (imageAspect > boxAspect) {
      const visibleWidth = dimensions.height * boxAspect;
      const crop = Math.max(0, (dimensions.width - visibleWidth) / 2 / dimensions.width);
      return { srcRectAttrs: rectAttrs({ l: crop, t: 0, r: crop, b: 0 }), fillRectAttrs: '' };
    }
    const visibleHeight = dimensions.width / boxAspect;
    const crop = Math.max(0, (dimensions.height - visibleHeight) / 2 / dimensions.height);
    return { srcRectAttrs: rectAttrs({ l: 0, t: crop, r: 0, b: crop }), fillRectAttrs: '' };
  }

  if (imageAspect > boxAspect) {
    const displayHeight = boxW / imageAspect;
    const pad = Math.max(0, (boxH - displayHeight) / 2 / boxH);
    return { srcRectAttrs: '', fillRectAttrs: rectAttrs({ l: 0, t: pad, r: 0, b: pad }) };
  }
  const displayWidth = boxH * imageAspect;
  const pad = Math.max(0, (boxW - displayWidth) / 2 / boxW);
  return { srcRectAttrs: '', fillRectAttrs: rectAttrs({ l: pad, t: 0, r: pad, b: 0 }) };
}

function blipFillXml(relId: string, fillSpec: FillRectSpec): string {
  const srcRect = fillSpec.srcRectAttrs ? `<a:srcRect ${fillSpec.srcRectAttrs}/>` : '<a:srcRect/>';
  const fillRect = fillSpec.fillRectAttrs
    ? `<a:fillRect ${fillSpec.fillRectAttrs}/>`
    : '<a:fillRect/>';
  return `<a:blipFill><a:blip r:embed="${relId}"/>${srcRect}<a:stretch>${fillRect}</a:stretch></a:blipFill>`;
}

function patchShapeBlipFill(
  slideXml: string,
  objectName: string,
  relId: string,
  element: DeckElement,
  fillSpec: FillRectSpec,
): string {
  const escapedName = escapeXml(objectName);
  const block = [...slideXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)]
    .map((match) => match[0])
    .find((candidate) => candidate.includes(`name="${escapedName}"`));
  if (!block) throw new Error(`Could not find imageShape object '${objectName}' in slide XML.`);
  const blipFill = blipFillXml(relId, fillSpec);
  const geometryBlock = patchCustomGeometry(block, element.customGeometry);
  let patchedBlock = geometryBlock.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>/, blipFill);
  if (patchedBlock === geometryBlock)
    patchedBlock = geometryBlock.replace(/<a:noFill\s*\/>/, blipFill);
  if (patchedBlock === geometryBlock)
    patchedBlock = geometryBlock.replace(
      /(<a:(?:prstGeom|custGeom)[\s\S]*?<\/a:(?:prstGeom|custGeom)>)/,
      `$1${blipFill}`,
    );
  if (patchedBlock === geometryBlock)
    throw new Error(`Could not inject image fill into imageShape object '${objectName}'.`);
  const xmlWithNamespace = slideXml.includes('xmlns:r=')
    ? slideXml
    : slideXml.replace(
        '<p:sld ',
        '<p:sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ',
      );
  return xmlWithNamespace.replace(block, patchedBlock);
}

async function patchImageShapes(pptxFile: string, patches: ImageShapePatch[]): Promise<void> {
  if (patches.length === 0) return;
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxFile));
  const contentTypesFile = zip.file('[Content_Types].xml');
  if (!contentTypesFile) throw new Error('PPTX is missing [Content_Types].xml.');
  let contentTypesXml = await contentTypesFile.async('string');
  for (const patch of patches) {
    const { bytes, ext, contentType } = imagePayload(patch.element);
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height)
      throw new Error(`Could not read dimensions for imageShape element '${patch.element.id}'.`);
    const fillSpec = imageShapeFillRectSpec(patch.element, {
      width: metadata.width,
      height: metadata.height,
    });
    const safeId = patch.element.id.replace(/[^A-Za-z0-9_-]/g, '-');
    const mediaName = `imageShape-${patch.slideNumber}-${safeId}${ext}`;
    zip.file(`ppt/media/${mediaName}`, bytes);
    contentTypesXml = ensureContentType(contentTypesXml, ext, contentType);

    const relsPath = `ppt/slides/_rels/slide${patch.slideNumber}.xml.rels`;
    const relsFile = zip.file(relsPath);
    let relsXml = ensureSlideRels(relsFile ? await relsFile.async('string') : undefined);
    const relId = nextRelId(relsXml);
    relsXml = relsXml.replace(
      '</Relationships>',
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/></Relationships>`,
    );
    zip.file(relsPath, relsXml);

    const slidePath = `ppt/slides/slide${patch.slideNumber}.xml`;
    const slideFile = zip.file(slidePath);
    if (!slideFile) throw new Error(`PPTX is missing ${slidePath}.`);
    const slideXml = await slideFile.async('string');
    zip.file(
      slidePath,
      patchShapeBlipFill(slideXml, patch.objectName, relId, patch.element, fillSpec),
    );
  }
  zip.file('[Content_Types].xml', contentTypesXml);
  const updated = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(pptxFile, updated);
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
  const imageShapePatches: ImageShapePatch[] = [];
  for (const [slideIndex, deckSlide] of deck.slides.entries()) {
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
      addElement(pptx, slide, element, deck.size, slideIndex + 1, imageShapePatches);
    if (deckSlide.notes) slide.addNotes(deckSlide.notes);
  }
  const out = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await pptx.writeFile({ fileName: out });
  await patchImageShapes(out, imageShapePatches);
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
