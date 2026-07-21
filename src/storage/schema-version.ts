/**
 * Schema versioning for persisted objects.
 *
 * Phase 3 Task 5 (R3 / G8).
 *
 * Phase 2 Engineering Specifications §7.2 recommends adding a schemaVersion
 * field to persisted objects for future migration paths.
 *
 * Design:
 * - schemaVersion is OPTIONAL on read (old data without it = version 1).
 * - schemaVersion is WRITTEN on save (always stamps current version).
 * - Migration logic can be added later in SCHEMA_MIGRATIONS.
 * - This is additive and non-breaking: existing stored data without the
 *   field is read as-is and gets stamped on next save.
 *
 * The CURRENT_SCHEMA_VERSION represents the shape of objects written by
 * this version of the code. When the schema evolves (fields added to
 * persisted objects), bump this number and add a migration.
 */

/**
 * Current schema version. Bumped when the shape of any persisted object changes.
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Map of storage key → current schema version for that specific key.
 *
 * If different persisted objects evolve at different rates, each key can
 * have its own version. For now they share version 1 since none have
 * needed a migration yet.
 */
export const SCHEMA_VERSIONS = {
  ui_state: 1,
  session_events: 1,
  session_context: 1,
  session_steps: 1,
  generated_steps: 1,
  generated_playwright: 1,
  test_case_draft: 1,
  ai_config: 1,
  test_repository: 1,
  session_screenshots: 1,
} as const;

/**
 * Type for a versioned persisted object.
 *
 * Persisted objects gain an optional `schemaVersion` field.
 * On write, the Storage Service stamps it. On read, missing = version 1.
 */
export interface VersionedData {
  schemaVersion?: number;
}

/**
 * Read the schema version from a persisted object.
 * Returns 1 if the field is missing (backward compatibility).
 */
export function readSchemaVersion(data: unknown): number {
  if (
    data &&
    typeof data === 'object' &&
    'schemaVersion' in data &&
    typeof (data as Record<string, unknown>).schemaVersion === 'number'
  ) {
    return (data as { schemaVersion: number }).schemaVersion;
  }
  // Missing field = original schema (version 1)
  return 1;
}

/**
 * Stamp a persisted object with the current schema version.
 *
 * This should be called by StorageService before writing to chrome.storage.
 * It does NOT mutate the original object — it returns a shallow copy with
 * the version stamped. For nested arrays (events, steps), the version is
 * stamped on the wrapper object, not on individual items.
 *
 * For simple object payloads (UIState, AIConfig, etc.), stamps directly.
 * For array payloads (events, steps, screenshots), wraps in an envelope
 * only if the consumer expects it. Since the existing code reads arrays
 * directly, we DON'T wrap arrays — instead the version applies to the
 * individual objects within the array when they are composite objects
 * (TestStep, ScreenshotMetadata).
 *
 * For simplicity in v1:
 * - Composite objects (UIState, AIConfig, TestRepository, RecordingContext,
 *   TestCaseDraft, GeneratedPlaywright) get schemaVersion stamped directly.
 * - Array payloads keep their existing shape; individual composite items
 *   (TestStep, ScreenshotMetadata, SessionEvent) will carry schemaVersion
 *   when their interfaces add it.
 */
export function stampSchemaVersion<T extends Record<string, unknown>>(
  data: T,
  version: number = CURRENT_SCHEMA_VERSION,
): T & VersionedData {
  return { ...data, schemaVersion: version };
}

/**
 * Check if a persisted object needs migration.
 *
 * Returns true if the stored version is less than the current version.
 */
export function needsMigration(
  data: unknown,
  currentVersion: number = CURRENT_SCHEMA_VERSION,
): boolean {
  return readSchemaVersion(data) < currentVersion;
}
