/**
 * Semantic Interaction Language — Frozen Plain-English Templates.
 *
 * Phase 3 Integration Step 3.
 *
 * This module is the SINGLE SOURCE OF TRUTH for plain-English test step
 * generation within the production generation pipeline (Stage 3b).
 *
 * Templates are frozen per the Semantic Interaction Language specification
 * (§8.2). They MUST NOT be modified. All CanonicalStep plainEnglish strings
 * are derived from these templates, not from the legacy interaction-type
 * registry.
 *
 * CanonicalType is assigned at Stage 3a and is immutable thereafter (L6).
 * This module consumes the canonical type read-only and renders the
 * corresponding frozen template.
 */

import type { CanonicalType } from '../../shared/architecture-types';
import type { ElementIdentity, AIUnderstanding } from '../../shared/types';

// ── Constants ─────────────────────────────────────────────

/** Maximum length for display names in plain English (prevents wall-of-text). */
const MAX_DISPLAY_LENGTH = 100;

// ── Element Name Resolution ───────────────────────────────

/**
 * Resolve the display name for an element.
 *
 * Per §8.2, the elementName resolution priority is:
 *   1. AI businessName (if present)
 *   2. accessibleName
 *   3. tag (lowercased)
 *
 * @param identity     Element identity from the interaction event.
 * @param understanding AI enrichment (may be null if AI failed).
 * @returns The resolved display name string.
 */
export function resolveElementName(
  identity: ElementIdentity,
  understanding: AIUnderstanding | null | undefined,
): string {
  const name =
    understanding?.businessName ||
    identity.accessibleName ||
    identity.tag.toLowerCase();
  return truncate(name);
}

// ── Template Rendering ────────────────────────────────────

/**
 * Parameters for rendering a frozen plain-English template.
 */
export interface SemanticTemplateParams {
  /** The canonical interaction type (from Stage 3a classification). */
  canonicalType: CanonicalType;
  /** Element identity from the source interaction. */
  identity: ElementIdentity;
  /** AI enrichment, null if AI failed. */
  understanding: AIUnderstanding | null | undefined;
  /** Text value (fill, select, selectDate). Null for non-value types. */
  value: string | null;
  /** Checkbox/radio checked state. Null for non-toggle types. */
  checked: boolean | null;
  /** Navigation URL. Only for navigate type. */
  url?: string;
  /** Date display value. Used for selectDate when value isn't directly available. */
  dateDisplayValue?: string | null;
}

/**
 * Render the frozen plain-English template for a canonical interaction type.
 *
 * §8.2 Frozen Templates:
 *
 *   navigate    → "Navigate to {url}"
 *   click       → "Click the {elementName}"
 *   fill        → "Enter '{value}' in the {elementName}"
 *   select      → "Select '{value}' from {elementName}"
 *   toggle      → "{verb} the {elementName}"  (verb = Check | Uncheck)
 *   selectDate  → "Select {value} as the {elementName}"
 *   hover       → "Hover over the {elementName}"
 *   pressKey    → "Press {key}"
 *   upload      → "Upload {files}"
 *   drag        → "Drag {source} to {target}"
 *
 * Unknown types default to the click template (L5: click is always valid).
 *
 * @param params Template rendering parameters.
 * @returns The plain-English string.
 */
export function renderSemanticPlainEnglish(params: SemanticTemplateParams): string {
  const { canonicalType, identity, understanding, value, checked } = params;
  const elementName = resolveElementName(identity, understanding);

  switch (canonicalType) {
    case 'navigate':
      // §8.2: "Navigate to {url}" — no quotes around URL
      return `Navigate to ${params.url ?? identity.accessibleName}`;

    case 'click':
      // §8.2: "Click the {elementName}"
      return `Click the ${elementName}`;

    case 'fill':
      // §8.2: "Enter '{value}' in the {elementName}"
      if (value) {
        return `Enter '${truncate(value)}' in the ${elementName}`;
      }
      return `Enter text in the ${elementName}`;

    case 'select':
      // §8.2: "Select '{value}' from {elementName}"
      // Radio buttons carry no separate value — the element name IS the
      // selected option. When value is absent, render as "Select '{name}'".
      if (value) {
        return `Select '${truncate(value)}' from ${elementName}`;
      }
      return `Select '${elementName}'`;

    case 'toggle':
      // §8.2: "{checked ? 'Check' : 'Uncheck'} the {elementName}"
      return `${checked ? 'Check' : 'Uncheck'} the ${elementName}`;

    case 'selectDate': {
      // §8.2: "Select {value} as the {elementName}"
      const dateValue = params.dateDisplayValue ?? value ?? '';
      return `Select ${truncate(dateValue) || 'date'} as the ${elementName}`;
    }

    case 'hover':
      // §8.2: "Hover over the {elementName}"
      return `Hover over the ${elementName}`;

    case 'pressKey':
      // §8.2: "Press {key}"
      return `Press ${truncate(value ?? 'key')}`;

    case 'upload':
      // §8.2: "Upload {files}"
      return `Upload ${truncate(value ?? 'files')}`;

    case 'drag':
      // §8.2: "Drag {source} to {target}"
      // Source is the element; target would be in metadata (not yet recorded).
      return `Drag ${elementName}`;

    default:
      // L5: click is always valid fallback
      return `Click the ${elementName}`;
  }
}

// ── Shared Helper ─────────────────────────────────────────

/**
 * Truncate a string to the maximum display length.
 */
function truncate(str: string, max = MAX_DISPLAY_LENGTH): string {
  return str.length > max ? str.substring(0, max) : str;
}
