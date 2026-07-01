import type { DeckElement, DeckSlide, DeckSpec, LayoutSpec, TemplatePack } from './types.js';
import { readJson, writeJson } from './io.js';
import { loadTemplatePack, resolveToken } from './templates.js';
import { throwIfIssues, validateDeck, validateDeckSchema } from './validation.js';

function resolveStyle(styleName: string | undefined, pack: TemplatePack): Record<string, unknown> {
  if (!styleName) return {};
  const style = pack.styles[styleName];
  if (!style) throw new Error(`Unknown style '${styleName}'.`);
  return resolveToken(style, pack) as Record<string, unknown>;
}

function resolveSlideBackground(
  slide: DeckSlide,
  layout: LayoutSpec,
  pack: TemplatePack,
): string | undefined {
  const raw = slide.background ?? layout.background;
  const resolved = resolveToken(raw, pack);
  return typeof resolved === 'string' ? resolved : undefined;
}

function normalizeElement(
  element: DeckElement,
  layout: LayoutSpec,
  pack: TemplatePack,
  jsonPointer: string,
): DeckElement {
  const slot = element.slot ? layout.slots[element.slot] : undefined;
  const style = resolveStyle(element.style, pack);
  const resolvedStyle = resolveToken(style, pack) as Record<string, unknown>;
  const merged = {
    ...resolvedStyle,
    ...(slot ?? {}),
    ...element,
    source: {
      style: element.style,
      slot: element.slot,
      jsonPointer,
    },
  } as DeckElement;
  const resolved = resolveToken(merged, pack) as DeckElement;
  delete resolved.slot;
  delete resolved.style;
  return resolved;
}

export function normalizeDeck(source: DeckSpec): DeckSpec {
  throwIfIssues(validateDeckSchema(source), 'Source deck schema validation');
  const pack = loadTemplatePack(source.template, source.theme);
  throwIfIssues(validateDeck(source, { pack, skipSchema: true }), 'Source deck validation');
  const normalized: DeckSpec = {
    deckId: source.deckId,
    title: source.title,
    template: pack.manifest.templateId,
    theme: source.theme,
    size: source.size,
    meta: source.meta,
    sections: resolveToken(source.sections, pack) as DeckSpec['sections'],
    slideMasters: resolveToken(source.slideMasters, pack) as DeckSpec['slideMasters'],
    nativeOptions: resolveToken(source.nativeOptions, pack) as DeckSpec['nativeOptions'],
    normalized: true,
    slides: source.slides.map((slide, slideIndex) => {
      const layout = pack.layouts[slide.layout];
      if (!layout) throw new Error(`Unknown layout '${slide.layout}'.`);
      return {
        id: slide.id,
        layout: slide.layout,
        masterName: resolveToken(slide.masterName, pack) as string | undefined,
        sectionTitle: resolveToken(slide.sectionTitle, pack) as string | undefined,
        notes: slide.notes,
        hidden: slide.hidden,
        background: resolveSlideBackground(slide, layout, pack),
        backgroundImage: resolveToken(slide.backgroundImage, pack) as string | undefined,
        backgroundData: resolveToken(slide.backgroundData, pack) as string | undefined,
        backgroundTransparency: slide.backgroundTransparency,
        color: resolveToken(slide.color, pack) as string | undefined,
        slideNumber: resolveToken(slide.slideNumber, pack) as DeckSlide['slideNumber'],
        nativeOptions: resolveToken(slide.nativeOptions, pack) as DeckSlide['nativeOptions'],
        elements: slide.elements.map((element, elementIndex) =>
          normalizeElement(element, layout, pack, `/slides/${slideIndex}/elements/${elementIndex}`),
        ),
      };
    }),
  };
  throwIfIssues(validateDeck(normalized, { normalized: true, pack }), 'Normalized deck validation');
  return normalized;
}

export function loadDeckForBuild(file: string): DeckSpec {
  const deck = readJson(file) as DeckSpec;
  if (deck.normalized) {
    throwIfIssues(validateDeckSchema(deck), 'Normalized deck schema validation');
    const pack = loadTemplatePack(deck.template, deck.theme);
    throwIfIssues(
      validateDeck(deck, { normalized: true, pack, skipSchema: true }),
      'Normalized deck validation',
    );
    return deck;
  }
  return normalizeDeck(deck);
}

export function normalizeFile(input: string, output: string): DeckSpec {
  const deck = normalizeDeck(readJson(input) as DeckSpec);
  writeJson(output, deck);
  return deck;
}
