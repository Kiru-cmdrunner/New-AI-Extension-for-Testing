/**
 * Frozen Semantic Interaction → Execution Verb mapping table.
 *
 * Phase 3 Task 4 (R4 / IMP-2 / G12).
 *
 * This is the single source of truth for how each semantic interaction type
 * maps to the B5.2 abstract execution verb and the Playwright execution verb.
 *
 * Frozen by:
 * - Semantic Interaction Language Design (L1–L14)
 * - Semantic Interaction Language Validation (all scenarios)
 * - Execution JSON Evolution Review (Option D Layered Plan)
 * - Phase 2 Engineering Specifications §11.1 Algorithm: Execution JSON Generation
 *
 * Versioning (additive only per §7.2):
 * - Adding a new interaction type: add a row here.
 * - Changing an existing verb: FORBIDDEN — create a new type instead.
 *
 * Current canonical types → execution verbs:
 *
 *   navigate   → navigate      → page.goto()
 *   click      → click         → locator.click()
 *   fill       → fill          → locator.fill(value)
 *   select     → select        → locator.selectOption(value) / locator.check() [radio]
 *   toggle     → check/uncheck → locator.check() / locator.uncheck()
 *   selectDate → fill          → locator.fill(isoValue)
 *   hover      → hover         → locator.hover()
 *   pressKey   → press         → locator.press(key)      [future]
 *   upload     → upload        → locator.setInputFiles()  [future]
 *   drag       → drag          → locator.dragAndDrop()    [future]
 *
 * The B5.2 action.type is framework-agnostic. The Playwright verb is
 * engine-specific and lives only in the Playwright generator.
 */

import type { CanonicalType } from '../shared/architecture-types';

/**
 * The B5.2 abstract execution verb.
 *
 * These are the framework-agnostic action types defined in the frozen B5.2
 * six-section Execution JSON contract. They are engine-independent.
 */
export type ExecutionVerb =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'hover'
  | 'press'
  | 'upload'
  | 'drag';

/**
 * A single entry in the frozen verb mapping table.
 */
export interface VerbMappingEntry {
  /** Canonical interaction type from the Semantic Interaction Language. */
  canonicalType: CanonicalType;
  /** B5.2 abstract execution verb. */
  executionVerb: ExecutionVerb;
  /** Playwright API method (for documentation). */
  playwrightVerb: string;
  /** Whether the verb requires a value parameter. */
  requiresValue: boolean;
  /** Human-readable note explaining the mapping. */
  note: string;
}

/**
 * The frozen verb mapping table.
 *
 * This table is APPEND-ONLY. Existing entries are immutable.
 * When a new canonical type is added to the Semantic Interaction Language,
 * add a new entry here.
 *
 * Special cases:
 * - toggle: maps to check OR uncheck based on the resulting checked state.
 *   The decision is made at execution-json generation time using the event's
 *   `checked` field. This is why toggle appears as two entries — the execution
 *   verb differs based on the target state.
 * - select: radio maps to .check() in Playwright (because radio buttons use
 *   .check(), not .selectOption()). Dropdown <select> uses .selectOption().
 *   The distinction is made by target.role in the Playwright generator.
 */
export const VERB_MAPPING_TABLE: Readonly<Record<CanonicalType, VerbMappingEntry>> = Object.freeze({
  navigate: {
    canonicalType: 'navigate',
    executionVerb: 'navigate',
    playwrightVerb: 'page.goto()',
    requiresValue: true,
    note: 'Navigation to a URL. Value is the destination URL.',
  },

  click: {
    canonicalType: 'click',
    executionVerb: 'click',
    playwrightVerb: 'locator.click()',
    requiresValue: false,
    note: 'Click on an interactive element (button, link, etc.).',
  },

  fill: {
    canonicalType: 'fill',
    executionVerb: 'fill',
    playwrightVerb: 'locator.fill(value)',
    requiresValue: true,
    note: 'Enter text into an input field. Value is the text content.',
  },

  select: {
    canonicalType: 'select',
    executionVerb: 'select',
    playwrightVerb: 'locator.selectOption(value) / locator.check() [radio]',
    requiresValue: true,
    note: 'Select an option from a dropdown or radio group. Radio buttons use .check() in Playwright.',
  },

  toggle: {
    canonicalType: 'toggle',
    executionVerb: 'check',
    playwrightVerb: 'locator.check() / locator.uncheck()',
    requiresValue: false,
    note: 'Toggle a checkbox. Maps to check or uncheck based on the resulting checked state.',
  },

  selectDate: {
    canonicalType: 'selectDate',
    executionVerb: 'fill',
    playwrightVerb: 'locator.fill(isoValue)',
    requiresValue: true,
    note: 'Select a date value. Maps to fill with the ISO date string (C6.1 §6).',
  },

  hover: {
    canonicalType: 'hover',
    executionVerb: 'hover',
    playwrightVerb: 'locator.hover()',
    requiresValue: false,
    note: 'Hover over an element to observe its visual response.',
  },

  pressKey: {
    canonicalType: 'pressKey',
    executionVerb: 'press',
    playwrightVerb: 'locator.press(key)',
    requiresValue: true,
    note: 'Press a keyboard key. Value is the key identifier (e.g. "Enter", "Escape"). [FUTURE]',
  },

  upload: {
    canonicalType: 'upload',
    executionVerb: 'upload',
    playwrightVerb: 'locator.setInputFiles(paths)',
    requiresValue: true,
    note: 'Upload a file. Value is the file path(s). [FUTURE]',
  },

  drag: {
    canonicalType: 'drag',
    executionVerb: 'drag',
    playwrightVerb: 'locator.dragAndDrop(target)',
    requiresValue: true,
    note: 'Drag an element to a target. Value includes source and target. [FUTURE]',
  },
});

/**
 * All 10 canonical types mapped — completeness guard.
 * If a new canonical type is added to CanonicalType but not to the table,
 * TypeScript will error here.
 */
const _COMPLETENESS_CHECK: Record<CanonicalType, true> = Object.fromEntries(
  Object.keys(VERB_MAPPING_TABLE).map((k) => [k, true]),
) as Record<CanonicalType, true>;
void _COMPLETENESS_CHECK;

/**
 * Lookup the execution verb for a canonical type.
 *
 * This function will eventually replace the inline if-chain in
 * execution-json-generator.ts::mapActionType(). For now it documents
 * the frozen mapping so that current and future code stay aligned.
 *
 * For toggle (checkbox), pass the checked state to resolve to check/uncheck.
 *
 * @param canonicalType - One of the 10 canonical interaction types.
 * @param checked - For toggle only: the resulting checked state.
 * @returns The B5.2 abstract execution verb.
 */
export function lookupExecutionVerb(
  canonicalType: CanonicalType,
  checked?: boolean,
): ExecutionVerb {
  const entry = VERB_MAPPING_TABLE[canonicalType];
  if (canonicalType === 'toggle') {
    // Toggle resolves to check or uncheck based on the resulting state.
    // Default to 'check' if checked is undefined (should not happen in practice).
    return checked === false ? 'uncheck' : 'check';
  }
  return entry.executionVerb;
}
