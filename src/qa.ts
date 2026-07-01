import type { Box, DeckElement, DeckSlide, DeckSpec, QaIssue, QaReport } from './types.js';
import { loadDeckForBuild } from './normalize.js';
import { writeJson } from './io.js';

const MIN_EDGE_MARGIN = 40;
const MIN_TEXT_FONT_SIZE = 12;
const MIN_MEANINGFUL_GAP = 16;

function boxOf(element: DeckElement): Box {
  if (element.type === 'line') {
    const x1 = element.x1 ?? element.x ?? 0;
    const y1 = element.y1 ?? element.y ?? 0;
    const x2 = element.x2 ?? x1 + (element.w ?? 0);
    const y2 = element.y2 ?? y1 + (element.h ?? 0);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  return {
    x: element.x ?? Number.NaN,
    y: element.y ?? Number.NaN,
    w: element.w ?? Number.NaN,
    h: element.h ?? Number.NaN,
  };
}

function hasBox(element: DeckElement): boolean {
  const box = boxOf(element);
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.w) &&
    Number.isFinite(box.h) &&
    box.w >= 0 &&
    box.h >= 0
  );
}

function area(box: Box): number {
  return Math.max(0, box.w) * Math.max(0, box.h);
}

function intersection(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bot = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, r - x), h: Math.max(0, bot - y) };
}

function contains(outer: Box, inner: Box, tolerance = 2): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.w <= outer.x + outer.w + tolerance &&
    inner.y + inner.h <= outer.y + outer.h + tolerance
  );
}

function isContainerRelationship(a: DeckElement, b: DeckElement): boolean {
  const ab = boxOf(a);
  const bb = boxOf(b);
  return (a.type === 'shape' && contains(ab, bb, 4)) || (b.type === 'shape' && contains(bb, ab, 4));
}

function makeIssue(
  severity: QaIssue['severity'],
  slide: DeckSlide,
  element: DeckElement | undefined,
  jsonPointer: string,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): QaIssue {
  return {
    severity,
    slideId: slide.id,
    elementId: element?.id,
    jsonPointer,
    code,
    message,
    ...extra,
  };
}

function estimateTextBox(element: DeckElement): {
  estimatedLines: number;
  estimatedHeight: number;
  fontSizePt: number;
  charCount: number;
} {
  const fontSizePt = element.fontSize ?? 18;
  const fontSizePx = fontSizePt * 1.333;
  const text = element.text ?? '';
  const charWidth = fontSizePx * 0.54;
  const lineHeight = fontSizePx * 1.18;
  const paragraphs = text.split(/\n/);
  const lines = paragraphs.reduce((sum, paragraph) => {
    const usableWidth = Math.max(1, (element.w ?? 1) - 4);
    const estimatedLineChars = Math.max(1, Math.floor(usableWidth / charWidth));
    return sum + Math.max(1, Math.ceil(paragraph.length / estimatedLineChars));
  }, 0);
  return {
    estimatedLines: lines,
    estimatedHeight: Math.ceil(lines * lineHeight),
    fontSizePt,
    charCount: text.length,
  };
}

function pointer(slideIndex: number, element: DeckElement, elementIndex: number): string {
  return element.source?.jsonPointer ?? `/slides/${slideIndex}/elements/${elementIndex}`;
}

function checkElementBounds(
  deck: DeckSpec,
  slide: DeckSlide,
  slideIndex: number,
  element: DeckElement,
  elementIndex: number,
): QaIssue[] {
  const issues: QaIssue[] = [];
  const jsonPointer = pointer(slideIndex, element, elementIndex);
  if (!hasBox(element))
    return [
      makeIssue(
        'error',
        slide,
        element,
        jsonPointer,
        'missing-box',
        'Element is missing concrete geometry.',
      ),
    ];
  const box = boxOf(element);
  if (box.w <= 0 || box.h <= 0)
    issues.push(
      makeIssue(
        'error',
        slide,
        element,
        jsonPointer,
        'non-positive-box',
        'Element box must have positive width and height.',
        { box },
      ),
    );
  if (box.x < 0 || box.y < 0 || box.x + box.w > deck.size.w || box.y + box.h > deck.size.h)
    issues.push(
      makeIssue(
        'error',
        slide,
        element,
        jsonPointer,
        'out-of-bounds',
        'Element extends outside the slide canvas.',
        {
          box,
          slideSize: deck.size,
        },
      ),
    );
  const nearEdge =
    box.x < MIN_EDGE_MARGIN ||
    box.y < MIN_EDGE_MARGIN ||
    deck.size.w - (box.x + box.w) < MIN_EDGE_MARGIN ||
    deck.size.h - (box.y + box.h) < MIN_EDGE_MARGIN;
  if (nearEdge && element.type === 'text')
    issues.push(
      makeIssue(
        'warn',
        slide,
        element,
        jsonPointer,
        'near-edge-text',
        `Text is within ${MIN_EDGE_MARGIN}px of a slide edge; verify projector safety.`,
        { box },
      ),
    );
  if (element.type === 'text') {
    const estimate = estimateTextBox(element);
    if (estimate.fontSizePt < MIN_TEXT_FONT_SIZE)
      issues.push(
        makeIssue(
          'warn',
          slide,
          element,
          jsonPointer,
          'small-text',
          `Text font size ${estimate.fontSizePt}pt is below ${MIN_TEXT_FONT_SIZE}pt.`,
          { fontSize: estimate.fontSizePt },
        ),
      );
    if (estimate.estimatedHeight > box.h * 1.12)
      issues.push(
        makeIssue(
          'warn',
          slide,
          element,
          jsonPointer,
          'text-overflow-risk',
          'Estimated text height exceeds the declared box height.',
          { box, estimate },
        ),
      );
  }
  return issues;
}

function checkPairOverlap(
  slide: DeckSlide,
  slideIndex: number,
  a: DeckElement,
  ai: number,
  b: DeckElement,
  bi: number,
): QaIssue[] {
  if (!hasBox(a) || !hasBox(b) || isContainerRelationship(a, b)) return [];
  if (a.type === 'shape' && b.type === 'shape') return [];
  const ab = boxOf(a);
  const bb = boxOf(b);
  const inter = intersection(ab, bb);
  const interArea = area(inter);
  if (interArea === 0) return [];
  const smallerArea = Math.max(1, Math.min(area(ab), area(bb)));
  const overlapRatio = interArea / smallerArea;
  const sameLayer = (a.z ?? 0) === (b.z ?? 0);
  const suspicious =
    (a.type === 'text' && b.type === 'text' && overlapRatio > 0.03) ||
    (sameLayer && overlapRatio > 0.18);
  if (!suspicious) return [];
  return [
    makeIssue(
      'warn',
      slide,
      a,
      pointer(slideIndex, a, ai),
      'overlap-risk',
      `Element overlaps '${b.id}' without an obvious container relationship.`,
      {
        otherElementId: b.id,
        otherJsonPointer: pointer(slideIndex, b, bi),
        overlapRatio: Number(overlapRatio.toFixed(3)),
        intersection: inter,
      },
    ),
  ];
}

function checkSlideRhythm(slide: DeckSlide, slideIndex: number): QaIssue[] {
  const issues: QaIssue[] = [];
  const textBoxes = slide.elements
    .map((element, index) => ({ element, index, box: boxOf(element) }))
    .filter(({ element }) => element.type === 'text' && hasBox(element))
    .sort((a, b) => a.box.y - b.box.y);
  for (let i = 1; i < textBoxes.length; i += 1) {
    const prev = textBoxes.at(i - 1);
    const curr = textBoxes.at(i);
    if (!prev || !curr) continue;
    const sameColumn =
      Math.abs(prev.box.x - curr.box.x) < 12 ||
      intersection(prev.box, curr.box).w > Math.min(prev.box.w, curr.box.w) * 0.45;
    const gap = curr.box.y - (prev.box.y + prev.box.h);
    if (sameColumn && gap > 0 && gap < MIN_MEANINGFUL_GAP)
      issues.push(
        makeIssue(
          'warn',
          slide,
          curr.element,
          pointer(slideIndex, curr.element, curr.index),
          'tight-text-gap',
          `Text gap after '${prev.element.id}' is only ${Math.round(gap)}px.`,
          { previousElementId: prev.element.id, gap },
        ),
      );
  }
  return issues;
}

export function qaDeck(deck: DeckSpec): QaReport {
  const issues: QaIssue[] = [];
  deck.slides.forEach((slide, slideIndex) => {
    slide.elements.forEach((element, elementIndex) =>
      issues.push(...checkElementBounds(deck, slide, slideIndex, element, elementIndex)),
    );
    for (let ai = 0; ai < slide.elements.length; ai += 1)
      for (let bi = ai + 1; bi < slide.elements.length; bi += 1) {
        const a = slide.elements[ai];
        const b = slide.elements[bi];
        if (a && b) issues.push(...checkPairOverlap(slide, slideIndex, a, ai, b, bi));
      }
    issues.push(...checkSlideRhythm(slide, slideIndex));
  });
  const summary = issues.reduce<Record<'error' | 'warn', number>>(
    (acc, item) => {
      acc[item.severity] += 1;
      return acc;
    },
    { error: 0, warn: 0 },
  );
  return {
    status: summary.error > 0 ? 'DECKSPEC_QA_FAIL' : 'DECKSPEC_QA_PASS',
    generatedAt: new Date().toISOString(),
    deckId: deck.deckId,
    slideCount: deck.slides.length,
    checks: [
      'normalized geometry exists',
      'positive boxes',
      'slide bounds',
      'projector edge margin warnings',
      'small text warnings',
      'estimated text overflow warnings',
      'non-container overlap warnings',
      'tight vertical text rhythm warnings',
    ],
    summary,
    issues,
  };
}

export function qaFile(input: string, output: string): QaReport {
  const deck = loadDeckForBuild(input);
  const report = qaDeck(deck);
  writeJson(output, report);
  return report;
}
