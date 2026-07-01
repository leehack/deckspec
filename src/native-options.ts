export const UNSAFE_NATIVE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export const RESERVED_NATIVE_ASSIGN_KEYS = new Set([
  'addChart',
  'addImage',
  'addMedia',
  'addNotes',
  'addSection',
  'addShape',
  'addSlide',
  'addTable',
  'addText',
  'defineLayout',
  'defineSlideMaster',
  'writeFile',
]);

export function isUnsafeNativeKey(key: string): boolean {
  return UNSAFE_NATIVE_KEYS.has(key);
}

export function isReservedNativeAssignKey(key: string): boolean {
  return RESERVED_NATIVE_ASSIGN_KEYS.has(key);
}

function pointer(parent: string, key: string | number): string {
  return `${parent.replace(/\/$/, '')}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

export function sanitizeNativeValue<T>(
  value: T,
  options: { pointer?: string; blockReserved?: boolean } = {},
): T {
  const basePointer = options.pointer ?? '/';
  if (Array.isArray(value)) {
    const items = value as unknown[];
    return items.map((item, index) =>
      sanitizeNativeValue(item, { ...options, pointer: pointer(basePointer, index) }),
    ) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isUnsafeNativeKey(key) || (options.blockReserved && isReservedNativeAssignKey(key))) {
        throw new Error(`Unsafe native option key '${key}' at ${pointer(basePointer, key)}.`);
      }
      out[key] = sanitizeNativeValue(item, { ...options, pointer: pointer(basePointer, key) });
    }
    return out as T;
  }
  return value;
}

export function applyNativeOptions(
  target: Record<string, unknown>,
  nativeOptions: unknown,
  label: string,
): void {
  if (!nativeOptions) return;
  const clean = sanitizeNativeValue(nativeOptions, {
    pointer: label,
    blockReserved: true,
  }) as Record<string, unknown>;
  for (const [key, value] of Object.entries(clean)) {
    if (isReservedNativeAssignKey(key) || typeof target[key] === 'function') {
      throw new Error(
        `Unsafe native option key '${key}' at ${label}/${key}: would clobber a PptxGenJS API member.`,
      );
    }
    target[key] = value;
  }
}
