import fs from 'node:fs';
import path from 'node:path';
import type {
  LayoutSpec,
  TemplateManifest,
  TemplatePack,
  ThemeName,
  ThemeSpec,
  ValidationIssue,
} from './types.js';
import { readJson } from './io.js';
import { packagePath } from './paths.js';
import { validateJsonWithSchema } from './validation.js';

function templateRoot(template: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'templates', template),
    packagePath('templates', template),
  ];
  const found = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'template.json')),
  );
  if (!found)
    throw new Error(`Template pack '${template}' was not found. Checked: ${candidates.join(', ')}`);
  return found;
}

function readJsonChecked(schemaName: string, file: string): unknown {
  const value = readJson(file);
  const issues = validateJsonWithSchema(schemaName, value, file);
  if (issues.length) {
    const error = new Error(
      `Template schema validation failed for ${file} with ${issues.length} issue(s).`,
    ) as Error & { issues: ValidationIssue[] };
    error.issues = issues;
    throw error;
  }
  return value;
}

function collectTokenIssues(
  value: unknown,
  pack: TemplatePack,
  pointer: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{(colors|fonts)\.([A-Za-z0-9_-]+)\}/g)) {
      const group = match[1] as 'colors' | 'fonts';
      const key = match[2];
      if (key === undefined) continue;
      const table = group === 'colors' ? pack.theme.colors : pack.theme.fonts;
      if (!table[key])
        issues.push({
          severity: 'error',
          code: 'unknown-template-token',
          message: `Unknown template token '{${group}.${key}}'.`,
          jsonPointer: pointer,
        });
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) =>
      issues.push(...collectTokenIssues(item, pack, `${pointer}/${index}`)),
    );
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) =>
      issues.push(...collectTokenIssues(item, pack, `${pointer}/${key}`)),
    );
  }
  return issues;
}

function validateTemplateTokens(pack: TemplatePack): ValidationIssue[] {
  return [
    ...collectTokenIssues(pack.styles, pack, '/styles'),
    ...collectTokenIssues(pack.layouts, pack, '/layouts'),
  ];
}

export function resolveTemplateRoot(template: string): string {
  return templateRoot(template);
}

export function validateTemplatePack(pack: TemplatePack): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  issues.push(...validateJsonWithSchema('template.schema.json', pack.manifest, '/template'));
  issues.push(
    ...validateJsonWithSchema(
      'theme.schema.json',
      pack.theme,
      `/themes/${pack.theme.themeId || 'unknown'}`,
    ),
  );
  issues.push(...validateJsonWithSchema('styles.schema.json', pack.styles, '/styles'));
  for (const [layoutId, layout] of Object.entries(pack.layouts)) {
    issues.push(...validateJsonWithSchema('layout.schema.json', layout, `/layouts/${layoutId}`));
    if (layout.layoutId !== layoutId) {
      issues.push({
        severity: 'error',
        code: 'layout-id-mismatch',
        message: `Layout file key '${layoutId}' does not match layoutId '${layout.layoutId}'.`,
        jsonPointer: `/layouts/${layoutId}/layoutId`,
      });
    }
  }
  issues.push(...validateTemplateTokens(pack));
  return issues;
}

export function loadTemplatePack(template: string, theme: ThemeName): TemplatePack {
  const rootDir = templateRoot(template);
  const manifest = readJsonChecked(
    'template.schema.json',
    path.join(rootDir, 'template.json'),
  ) as TemplateManifest;
  const themeFile = manifest.themes[theme];
  if (!themeFile) throw new Error(`Theme '${theme}' is not declared by template '${template}'.`);
  const themeSpec = readJsonChecked(
    'theme.schema.json',
    path.join(rootDir, themeFile),
  ) as ThemeSpec;
  const styles = readJsonChecked(
    'styles.schema.json',
    path.join(rootDir, manifest.styles),
  ) as Record<string, Record<string, unknown>>;
  const layoutsDir = path.join(rootDir, manifest.layoutsDir);
  const layouts = Object.fromEntries(
    fs
      .readdirSync(layoutsDir)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => {
        const layout = readJsonChecked(
          'layout.schema.json',
          path.join(layoutsDir, file),
        ) as LayoutSpec;
        return [layout.layoutId, layout];
      }),
  );
  const pack = { rootDir, manifest, theme: themeSpec, styles, layouts };
  const issues = validateTemplatePack(pack);
  if (issues.length) {
    const error = new Error(
      `Template pack '${template}' failed validation with ${issues.length} issue(s).`,
    ) as Error & { issues: ValidationIssue[] };
    error.issues = issues;
    throw error;
  }
  return pack;
}

export function resolveToken(value: unknown, pack: TemplatePack): unknown {
  if (typeof value === 'string') {
    return value.replace(
      /\{(colors|fonts)\.([A-Za-z0-9_-]+)\}/g,
      (_match, group: 'colors' | 'fonts', key: string) => {
        const table = group === 'colors' ? pack.theme.colors : pack.theme.fonts;
        return table[key] ?? _match;
      },
    );
  }
  if (Array.isArray(value)) return value.map((item) => resolveToken(item, pack));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveToken(item, pack)]),
    );
  return value;
}
