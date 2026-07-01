import fs from 'node:fs';
import path from 'node:path';

export function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function repoPath(...parts: string[]): string {
  return path.resolve(process.cwd(), ...parts);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stripHash(color: unknown): string | undefined {
  if (color === undefined || color === null || color === '') return undefined;
  if (typeof color !== 'string' && typeof color !== 'number') return undefined;
  return String(color).replace(/^#/, '');
}
