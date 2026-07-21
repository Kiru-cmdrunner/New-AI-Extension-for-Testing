/**
 * Structural Recognizer — Tier 1 component recognition.
 *
 * Uses ARIA composite widget roles and native HTML semantics to identify
 * UI components. This is the strongest recognition signal because ARIA roles
 * are the page author's explicit declaration of semantic structure.
 *
 * Key design principle: the recognizer is COMPLETELY GENERIC. It contains
 * zero pattern-specific logic (no if/switch on pattern type). All pattern
 * knowledge comes from the declarative PatternCatalogue. Adding a new pattern
 * never requires touching this file.
 *
 * Algorithm:
 *   1. Build role chain from ancestorRoles + element's own role
 *   2. For each PatternDefinition (ordered by specificity):
 *      a. Check if any role in the chain matches the pattern's rootAriaRoles
 *      b. If match: assign constituent roles, check minConstituents, return result
 *   3. Return null result if no pattern matched
 *
 * Architecture: .drytis/ui-knowledge-model.md §4 (Tier 1 — Structural)
 * Reference:    .drytis/specs/ui-knowledge-model-phase2.md
 */

import { PatternType, ComponentRole, RecognitionSource } from '../../domain/enums';
import {
  getAllPatterns,
  buildRoleReverseLookup,
  type PatternDefinition,
} from './pattern-catalogue';

// ── Types ────────────────────────────────────────────────

/**
 * A single element's role information available to the recognizer.
 */
export interface ElementRoleInfo {
  /** Stable session element ID. */
  readonly elementId: string;
  /** The element's ARIA role (role attribute or implicit role). */
  readonly ariaRole: string | null;
  /** The element's HTML tag name. */
  readonly tag: string;
}

/**
 * Input to the structural recognizer.
 */
export interface RecognitionInput {
  /** The element that was interacted with (primary interaction target). */
  readonly element: ElementRoleInfo;

  /**
   * Ancestor chain from root to target (inclusive of the target's own role).
   * Each entry is { elementId, ariaRole } for an ancestor element.
   * Ordered outermost (document root direction) → innermost (target).
   *
   * Example for an option inside a combobox:
   *   [
   *     { elementId: 'elem-combobox', ariaRole: 'combobox' },
   *     { elementId: 'elem-listbox', ariaRole: 'listbox' },
   *     { elementId: 'elem-option', ariaRole: 'option' },
   *   ]
   *
   * If only the interacted element is known (no ancestor info), this contains
   * just the target element itself.
   */
  readonly ancestorRoles: ElementRoleInfo[];

  /**
   * Sibling elements within the same container, with their ARIA roles.
   * Used for multi-constituent patterns where the recognizer needs to identify
   * multiple options/tabs within a container.
   *
   * For Tier 1, this is populated by the ConstituentResolver (Phase 5).
   * When absent, the recognizer works with only the ancestorRoles chain and
   * the primary element.
   */
  readonly siblingElementRoles?: ElementRoleInfo[];
}

/**
 * Result of structural recognition.
 */
export interface RecognitionResult {
  /** null = no structural pattern matched. */
  readonly patternType: PatternType | null;
  /** The root element ID anchoring the component (the element with the root ARIA role). */
  readonly rootElementId: string | null;
  /** Assigned constituent roles. Empty if no match. */
  readonly constituents: ReadonlyArray<{ elementId: string; role: ComponentRole }>;
  /** Confidence for this recognition. 0.95 for Tier 1 structural matches. */
  readonly confidence: number;
  /** The source of this recognition — always STRUCTURAL for Tier 1. */
  readonly recognitionSource: RecognitionSource;
  /** Which root ARIA role triggered the match. null if no match. */
  readonly matchedRole: string | null;
  /** Human-readable explanation. null if no match. */
  readonly reason: string | null;
}

/** A null result returned when no pattern matches. */
const NULL_RESULT: RecognitionResult = {
  patternType: null,
  rootElementId: null,
  constituents: [],
  confidence: 0,
  recognitionSource: RecognitionSource.STRUCTURAL,
  matchedRole: null,
  reason: null,
};

/** Confidence for all Tier 1 structural recognitions. */
const TIER1_CONFIDENCE = 0.95;

// ── Recognizer ───────────────────────────────────────────

/**
 * Recognize a UI component from ARIA structural evidence.
 *
 * This function is purely declarative — it iterates the pattern catalogue
 * and checks each definition against the input. No pattern-specific code.
 *
 * @param input - The element and its ancestor/sibling role information.
 * @returns RecognitionResult — a match with constituents, or a null result.
 */
export function recognize(input: RecognitionInput): RecognitionResult {
  const patterns = getAllPatterns();

  // Build the full role chain: ancestors + the interacted element itself
  const roleChain = [...input.ancestorRoles];

  // Ensure the primary element is in the chain (it may already be the last entry)
  const elementAlreadyInChain = roleChain.some((e) => e.elementId === input.element.elementId);
  if (!elementAlreadyInChain) {
    roleChain.push(input.element);
  }

  // Build all available elements for constituent assignment:
  // role chain + siblings (if provided)
  const allElements: ElementRoleInfo[] = [...roleChain];
  if (input.siblingElementRoles) {
    for (const sibling of input.siblingElementRoles) {
      if (!allElements.some((e) => e.elementId === sibling.elementId)) {
        allElements.push(sibling);
      }
    }
  }

  // Try each pattern definition (ordered by specificity — most specific first)
  for (const def of patterns) {
    // Skip patterns that are not enabled for structural recognition
    // (e.g., accordion — recognized behaviorally only)
    if (def.structuralRecognition === false) continue;

    const match = tryPattern(def, roleChain, allElements);
    if (match) return match;
  }

  return NULL_RESULT;
}

/**
 * Try a single pattern definition against the role chain.
 *
 * @returns RecognitionResult if the pattern matches, null to continue trying.
 */
function tryPattern(
  def: PatternDefinition,
  roleChain: ElementRoleInfo[],
  allElements: ElementRoleInfo[],
): RecognitionResult | null {
  // Step 1: Find the root element — an element whose ARIA role matches rootAriaRoles
  const rootMatch = findRootElement(def, roleChain);
  if (!rootMatch) return null;

  // Step 2: Assign constituent roles to all known elements
  const reverseLookup = buildRoleReverseLookup(def);
  const constituents = assignConstituentRoles(reverseLookup, allElements);

  // Step 3: Ensure the root element is included in constituents
  const rootInConstituents = constituents.some(
    (c) => c.elementId === rootMatch.elementId,
  );
  const allConstituents = rootInConstituents
    ? constituents
    : [
        ...constituents,
        { elementId: rootMatch.elementId, role: inferRootComponentRole(def) },
      ];

  // Step 4: Check minimum constituents requirement
  if (allConstituents.length < def.minConstituents) {
    return null; // Pattern matched structurally but not enough constituents
  }

  return {
    patternType: def.patternType,
    rootElementId: rootMatch.elementId,
    constituents: allConstituents,
    confidence: TIER1_CONFIDENCE,
    recognitionSource: RecognitionSource.STRUCTURAL,
    matchedRole: rootMatch.ariaRole,
    reason: `Matched ${def.patternType} via ARIA role "${rootMatch.ariaRole}"`,
  };
}

/**
 * Find the root element for a pattern in the role chain.
 *
 * Iterates the role chain and returns the first element whose ARIA role
 * matches one of the pattern's rootAriaRoles.
 */
function findRootElement(
  def: PatternDefinition,
  roleChain: ElementRoleInfo[],
): ElementRoleInfo | null {
  for (const element of roleChain) {
    if (element.ariaRole && def.rootAriaRoles.includes(element.ariaRole)) {
      return element;
    }
  }
  return null;
}

/**
 * Assign component roles to elements based on the pattern's constituent role mapping.
 *
 * Uses the reverse lookup (ARIA role → ComponentRole) built from the pattern definition.
 * Each element with a matching ARIA role gets assigned the corresponding component role.
 */
function assignConstituentRoles(
  reverseLookup: Map<string, ComponentRole>,
  elements: ElementRoleInfo[],
): Array<{ elementId: string; role: ComponentRole }> {
  const assigned: Array<{ elementId: string; role: ComponentRole }> = [];

  for (const element of elements) {
    if (element.ariaRole && reverseLookup.has(element.ariaRole)) {
      const role = reverseLookup.get(element.ariaRole)!;
      // Avoid duplicate assignments for the same element
      if (!assigned.some((a) => a.elementId === element.elementId)) {
        assigned.push({ elementId: element.elementId, role });
      }
    }
  }

  return assigned;
}

/**
 * Infer the ComponentRole for the root element when it wasn't directly mapped.
 *
 * For most patterns, the root ARIA role maps to a component role via constituentRoles.
 * This handles the edge case where the root role itself isn't in the mapping but
 * the pattern still matched via that role.
 */
function inferRootComponentRole(def: PatternDefinition): ComponentRole {
  // Check if any constituent role mapping covers the root roles
  for (const [componentRole, ariaRoles] of Object.entries(def.constituentRoles)) {
    const role = componentRole as ComponentRole;
    if (ariaRoles?.some((ar) => def.rootAriaRoles.includes(ar))) {
      return role;
    }
  }
  // Fallback: the root is the container
  return ComponentRole.CONTAINER;
}
