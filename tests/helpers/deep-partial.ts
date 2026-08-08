/**
 * DeepPartial — enables partial overrides on nested object types.
 *
 * Used by test fixture builders so tests can override specific sub-fields
 * (e.g., trigger.accessibleName) without providing every required field.
 *
 * The fixture builder merges the partial override with a complete default,
 * so the returned object is always fully typed. No assertions are weakened —
 * the test still validates against the full type at expect() time.
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? U[] // Arrays: replace wholesale (common test pattern)
    : T[P] extends readonly (infer U)[]
      ? readonly U[]
      : T[P] extends object
        ? DeepPartial<T[P]>
        : T[P];
};

/**
 * Deep merge: for each key in overrides, if both default and override are
 * plain objects, merge recursively. Otherwise, override wins.
 */
export function deepMerge<T>(defaults: T, overrides: DeepPartial<T>): T {
  if (overrides === null || overrides === undefined) return defaults;
  if (typeof defaults !== 'object' || defaults === null) {
    return overrides as T;
  }
  if (Array.isArray(defaults)) {
    return (overrides as unknown as T) ?? defaults;
  }

  const result = { ...defaults } as Record<string, unknown>;
  const ov = overrides as Record<string, unknown>;
  for (const key of Object.keys(ov)) {
    if (
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key]) &&
      typeof ov[key] === 'object' &&
      ov[key] !== null &&
      !Array.isArray(ov[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, ov[key] as Record<string, unknown>) as unknown;
    } else if (ov[key] !== undefined) {
      result[key] = ov[key];
    }
  }
  return result as T;
}
