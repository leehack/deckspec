import Ajv2020Module from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { DeckElement, DeckSpec, TemplatePack, ValidationIssue } from './types.js';
import { isRecord, readJson } from './io.js';
import { packagePath } from './paths.js';
import { isReservedNativeAssignKey, isUnsafeNativeKey } from './native-options.js';

const validators = new Map<string, ValidateFunction>();
const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ??
  Ajv2020Module) as new (options?: Record<string, unknown>) => {
  compile(schema: unknown): ValidateFunction;
};

function issue(
  code: string,
  message: string,
  jsonPointer: string,
  extra: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { severity: 'error', code, message, jsonPointer, ...extra };
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function schemaPointer(error: ErrorObject): string {
  return error.instancePath || '/';
}

function schemaMessage(error: ErrorObject): string {
  if (
    error.keyword === 'additionalProperties' &&
    isRecord(error.params) &&
    typeof error.params.additionalProperty === 'string'
  ) {
    return `Unsupported property '${error.params.additionalProperty}'.`;
  }
  return error.message
    ? `Schema violation: ${error.message}.`
    : `Schema violation: ${error.keyword}.`;
}

function loadSchemaValidator(schemaName: string): ValidateFunction {
  const cached = validators.get(schemaName);
  if (cached) return cached;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    allowUnionTypes: false,
  });
  const schema = readJson(packagePath('schemas', schemaName)) as Record<string, unknown>;
  const validate = ajv.compile(schema);
  validators.set(schemaName, validate);
  return validate;
}

export function validateJsonWithSchema(
  schemaName: string,
  value: unknown,
  pointerPrefix = '',
): ValidationIssue[] {
  const validate = loadSchemaValidator(schemaName);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) =>
    issue(
      'schema-validation',
      schemaMessage(error),
      `${pointerPrefix}${schemaPointer(error)}`.replace(/\/\/$/, '/'),
      {
        schema: schemaName,
        schemaKeyword: error.keyword,
        schemaPath: error.schemaPath,
        schemaParams: error.params,
      },
    ),
  );
}

export function validateDeckSchema(deck: unknown): ValidationIssue[] {
  return validateJsonWithSchema('deck.schema.json', deck);
}

function checkBox(element: DeckElement, pointer: string, slideId: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    if (typeof element[key] !== 'number' || !Number.isFinite(element[key])) {
      out.push(
        issue(
          'missing-geometry',
          `Normalized element is missing numeric ${key}.`,
          `${pointer}/${key}`,
          {
            slideId,
            elementId: element.id,
          },
        ),
      );
    }
  }
  if (typeof element.w === 'number' && element.w <= 0)
    out.push(
      issue('non-positive-width', 'Element width must be positive.', `${pointer}/w`, {
        slideId,
        elementId: element.id,
      }),
    );
  if (typeof element.h === 'number' && element.h <= 0)
    out.push(
      issue('non-positive-height', 'Element height must be positive.', `${pointer}/h`, {
        slideId,
        elementId: element.id,
      }),
    );
  return out;
}

function checkLine(element: DeckElement, pointer: string, slideId: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const hasBox = ['x', 'y', 'w', 'h'].every(
    (key) =>
      typeof element[key as keyof DeckElement] === 'number' &&
      Number.isFinite(element[key as keyof DeckElement] as number),
  );
  const hasEndpoints = ['x1', 'y1', 'x2', 'y2'].every(
    (key) =>
      typeof element[key as keyof DeckElement] === 'number' &&
      Number.isFinite(element[key as keyof DeckElement] as number),
  );
  if (!hasBox && !hasEndpoints) {
    out.push(
      issue(
        'missing-line-geometry',
        'Normalized line element requires numeric x/y/w/h or x1/y1/x2/y2 geometry.',
        pointer,
        { slideId, elementId: element.id },
      ),
    );
  }
  if (hasBox) {
    if (typeof element.w === 'number' && element.w < 0)
      out.push(
        issue('negative-line-width', 'Line box width must be non-negative.', `${pointer}/w`, {
          slideId,
          elementId: element.id,
        }),
      );
    if (typeof element.h === 'number' && element.h < 0)
      out.push(
        issue('negative-line-height', 'Line box height must be non-negative.', `${pointer}/h`, {
          slideId,
          elementId: element.id,
        }),
      );
  }
  return out;
}

function chartDataHasAlignedSeries(element: DeckElement): boolean {
  return (
    Array.isArray(element.data) &&
    element.data.every(
      (series) =>
        Array.isArray(series.labels) &&
        Array.isArray(series.values) &&
        series.labels.length === series.values.length,
    )
  );
}

function collectTokenIssues(
  value: unknown,
  pack: TemplatePack,
  pointer: string,
  extra: Partial<ValidationIssue> = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{(colors|fonts)\.([A-Za-z0-9_-]+)\}/g)) {
      const group = match[1] as 'colors' | 'fonts';
      const key = match[2];
      if (key === undefined) continue;
      const table = group === 'colors' ? pack.theme.colors : pack.theme.fonts;
      if (!table[key])
        issues.push(
          issue('unknown-token', `Unknown template token '{${group}.${key}}'.`, pointer, extra),
        );
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) =>
      issues.push(...collectTokenIssues(item, pack, `${pointer}/${index}`, extra)),
    );
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) =>
      issues.push(...collectTokenIssues(item, pack, `${pointer}/${key}`, extra)),
    );
  }
  return issues;
}

function resolveReferenceToken(value: unknown, pack?: TemplatePack): unknown {
  if (!pack || typeof value !== 'string') return value;
  return value.replace(
    /\{(colors|fonts)\.([A-Za-z0-9_-]+)\}/g,
    (_match, group: 'colors' | 'fonts', key: string) => {
      const table = group === 'colors' ? pack.theme.colors : pack.theme.fonts;
      return table[key] ?? _match;
    },
  );
}

function collectNativeKeyIssues(
  value: unknown,
  pointer: string,
  extra: Partial<ValidationIssue> = {},
  blockReserved = false,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      issues.push(...collectNativeKeyIssues(item, `${pointer}/${index}`, extra, blockReserved)),
    );
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => {
      if (isUnsafeNativeKey(key) || (blockReserved && isReservedNativeAssignKey(key))) {
        issues.push(
          issue(
            'unsafe-native-option-key',
            `Unsafe native option key '${key}'.`,
            `${pointer}/${key}`,
            extra,
          ),
        );
      }
      issues.push(...collectNativeKeyIssues(item, `${pointer}/${key}`, extra, blockReserved));
    });
  }
  return issues;
}

function validateElementTokens(
  element: DeckElement,
  pack: TemplatePack,
  pointer: string,
  extra: Partial<ValidationIssue>,
): ValidationIssue[] {
  return collectTokenIssues(element, pack, pointer, extra);
}

export function validateDeck(
  deck: unknown,
  options: { normalized?: boolean; pack?: TemplatePack; skipSchema?: boolean } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = options.skipSchema ? [] : [...validateDeckSchema(deck)];
  if (!isRecord(deck))
    return issues.length ? issues : [issue('deck-not-object', 'Deck must be an object.', '/')];
  const rawDeck = deck;
  const d = deck as unknown as DeckSpec;
  if (typeof d.deckId !== 'string' || !d.deckId.trim())
    issues.push(issue('missing-deck-id', 'deckId is required.', '/deckId'));
  if (typeof d.template !== 'string' || !d.template.trim())
    issues.push(issue('missing-template', 'template is required.', '/template'));
  if (rawDeck.theme !== 'dark' && rawDeck.theme !== 'light')
    issues.push(issue('invalid-theme', 'theme must be dark or light.', '/theme'));
  if (!isRecord(d.size) || !isPositiveNumber(d.size.w) || !isPositiveNumber(d.size.h))
    issues.push(issue('invalid-size', 'size.w and size.h must be positive numbers.', '/size'));
  if (!Array.isArray(d.slides) || d.slides.length === 0)
    return [...issues, issue('missing-slides', 'slides must be a non-empty array.', '/slides')];
  if (options.pack) {
    for (const key of ['nativeOptions', 'sections', 'slideMasters'] as const) {
      if (d[key] !== undefined) issues.push(...collectTokenIssues(d[key], options.pack, `/${key}`));
    }
  }
  if (d.nativeOptions !== undefined)
    issues.push(...collectNativeKeyIssues(d.nativeOptions, '/nativeOptions', {}, true));
  if (d.slideMasters !== undefined)
    issues.push(...collectNativeKeyIssues(d.slideMasters, '/slideMasters', {}, true));

  const declaredSections = new Set(
    (d.sections ?? [])
      .map((section) => resolveReferenceToken(section.title, options.pack))
      .filter((title): title is string => typeof title === 'string' && title.trim().length > 0),
  );
  const declaredMasters = new Set(
    (d.slideMasters ?? [])
      .map((master) => resolveReferenceToken(master.title, options.pack))
      .filter((title): title is string => typeof title === 'string' && title.trim().length > 0),
  );

  const slideIds = new Set<string>();
  d.slides.forEach((slide, slideIndex) => {
    const slidePointer = `/slides/${slideIndex}`;
    if (!isRecord(slide)) {
      issues.push(issue('slide-not-object', 'Slide must be an object.', slidePointer));
      return;
    }
    if (typeof slide.id !== 'string' || !slide.id.trim())
      issues.push(issue('missing-slide-id', 'Slide id is required.', `${slidePointer}/id`));
    else if (slideIds.has(slide.id))
      issues.push(
        issue('duplicate-slide-id', `Duplicate slide id '${slide.id}'.`, `${slidePointer}/id`, {
          slideId: slide.id,
        }),
      );
    else slideIds.add(slide.id);
    if (typeof slide.layout !== 'string' || !slide.layout.trim())
      issues.push(
        issue('missing-layout', 'Slide layout is required.', `${slidePointer}/layout`, {
          slideId: slide.id,
        }),
      );
    if (options.pack && slide.background !== undefined)
      issues.push(
        ...collectTokenIssues(slide.background, options.pack, `${slidePointer}/background`, {
          slideId: slide.id,
        }),
      );
    if (options.pack) {
      for (const key of [
        'nativeOptions',
        'slideNumber',
        'color',
        'backgroundImage',
        'backgroundData',
        'sectionTitle',
        'masterName',
      ] as const) {
        if (slide[key] !== undefined)
          issues.push(
            ...collectTokenIssues(slide[key], options.pack, `${slidePointer}/${key}`, {
              slideId: slide.id,
            }),
          );
      }
    }
    if (slide.nativeOptions !== undefined)
      issues.push(
        ...collectNativeKeyIssues(
          slide.nativeOptions,
          `${slidePointer}/nativeOptions`,
          { slideId: slide.id },
          true,
        ),
      );
    if (slide.slideNumber !== undefined)
      issues.push(
        ...collectNativeKeyIssues(
          slide.slideNumber,
          `${slidePointer}/slideNumber`,
          { slideId: slide.id },
          true,
        ),
      );
    if (options.pack && slide.layout && !options.pack.layouts[slide.layout])
      issues.push(
        issue('unknown-layout', `Unknown layout '${slide.layout}'.`, `${slidePointer}/layout`, {
          slideId: slide.id,
        }),
      );
    const resolvedSectionTitle = resolveReferenceToken(slide.sectionTitle, options.pack);
    const resolvedMasterName = resolveReferenceToken(slide.masterName, options.pack);
    if (
      typeof resolvedSectionTitle === 'string' &&
      resolvedSectionTitle.trim() &&
      !declaredSections.has(resolvedSectionTitle)
    ) {
      issues.push(
        issue(
          'unknown-section-title',
          `Slide sectionTitle '${slide.sectionTitle}' does not match any deck.sections[].title.`,
          `${slidePointer}/sectionTitle`,
          { slideId: slide.id },
        ),
      );
    }
    if (
      typeof resolvedMasterName === 'string' &&
      resolvedMasterName.trim() &&
      !declaredMasters.has(resolvedMasterName)
    ) {
      issues.push(
        issue(
          'unknown-slide-master',
          `Slide masterName '${slide.masterName}' does not match any deck.slideMasters[].title.`,
          `${slidePointer}/masterName`,
          { slideId: slide.id },
        ),
      );
    }
    if (!Array.isArray(slide.elements)) {
      issues.push(
        issue('missing-elements', 'Slide elements must be an array.', `${slidePointer}/elements`, {
          slideId: slide.id,
        }),
      );
      return;
    }
    const elementIds = new Set<string>();
    slide.elements.forEach((element, elementIndex) => {
      const elementPointer = `${slidePointer}/elements/${elementIndex}`;
      if (!isRecord(element)) {
        issues.push(
          issue('element-not-object', 'Element must be an object.', elementPointer, {
            slideId: slide.id,
          }),
        );
        return;
      }
      const e = element;
      if (typeof e.id !== 'string' || !e.id.trim())
        issues.push(
          issue('missing-element-id', 'Element id is required.', `${elementPointer}/id`, {
            slideId: slide.id,
          }),
        );
      else if (elementIds.has(e.id))
        issues.push(
          issue(
            'duplicate-element-id',
            `Duplicate element id '${e.id}' in slide '${slide.id}'.`,
            `${elementPointer}/id`,
            { slideId: slide.id, elementId: e.id },
          ),
        );
      else elementIds.add(e.id);
      const elementType = typeof e.type === 'string' ? e.type : '';
      if (!['text', 'shape', 'line', 'image', 'table', 'chart', 'media'].includes(elementType))
        issues.push(
          issue(
            'invalid-element-type',
            `Unsupported element type '${elementType || 'unknown'}'.`,
            `${elementPointer}/type`,
            {
              slideId: slide.id,
              elementId: e.id,
            },
          ),
        );
      if (e.style && options.pack && !options.pack.styles[e.style])
        issues.push(
          issue('unknown-style', `Unknown style '${e.style}'.`, `${elementPointer}/style`, {
            slideId: slide.id,
            elementId: e.id,
          }),
        );
      if (e.slot && options.pack) {
        const layout = options.pack.layouts[slide.layout];
        if (layout && !layout.slots[e.slot])
          issues.push(
            issue(
              'unknown-slot',
              `Unknown slot '${e.slot}' for layout '${slide.layout}'.`,
              `${elementPointer}/slot`,
              {
                slideId: slide.id,
                elementId: e.id,
              },
            ),
          );
      }
      if (options.normalized)
        issues.push(
          ...(e.type === 'line'
            ? checkLine(e, elementPointer, slide.id)
            : checkBox(e, elementPointer, slide.id)),
        );
      if (e.type === 'text' && typeof e.text !== 'string' && !Array.isArray(e.runs))
        issues.push(
          issue('missing-text', 'Text element requires text or runs.', `${elementPointer}/text`, {
            slideId: slide.id,
            elementId: e.id,
          }),
        );
      if (e.type === 'image' && typeof e.imagePath !== 'string' && typeof e.imageData !== 'string')
        issues.push(
          issue(
            'missing-image-path',
            'Image element requires imagePath or imageData.',
            `${elementPointer}/imagePath`,
            {
              slideId: slide.id,
              elementId: e.id,
            },
          ),
        );
      if (e.type === 'table' && !Array.isArray(e.rows))
        issues.push(
          issue('missing-table-rows', 'Table element requires rows.', `${elementPointer}/rows`, {
            slideId: slide.id,
            elementId: e.id,
          }),
        );
      if (e.type === 'chart' && !chartDataHasAlignedSeries(e))
        issues.push(
          issue(
            'invalid-chart-data',
            'Chart series labels and values must be arrays of equal length.',
            `${elementPointer}/data`,
            { slideId: slide.id, elementId: e.id },
          ),
        );
      if (e.type === 'media' && !e.link && !e.path)
        issues.push(
          issue(
            'missing-media-source',
            'Media element requires link or path.',
            `${elementPointer}/link`,
            {
              slideId: slide.id,
              elementId: e.id,
            },
          ),
        );
      if (options.pack)
        issues.push(
          ...validateElementTokens(e, options.pack, elementPointer, {
            slideId: slide.id,
            elementId: e.id,
          }),
        );
      if (e.nativeOptions !== undefined)
        issues.push(
          ...collectNativeKeyIssues(
            e.nativeOptions,
            `${elementPointer}/nativeOptions`,
            { slideId: slide.id, elementId: e.id },
            true,
          ),
        );
      if (e.options !== undefined)
        issues.push(
          ...collectNativeKeyIssues(e.options, `${elementPointer}/options`, {
            slideId: slide.id,
            elementId: e.id,
          }),
        );
    });
  });
  return issues;
}

export function throwIfIssues(issues: ValidationIssue[], label: string): void {
  if (issues.length === 0) return;
  const error = new Error(`${label} failed with ${issues.length} issue(s).`) as Error & {
    issues: ValidationIssue[];
  };
  error.issues = issues;
  throw error;
}
