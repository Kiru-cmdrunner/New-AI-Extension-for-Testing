/**
 * Pattern Catalogue — declarative definitions of recognized UI patterns.
 *
 * The catalogue is the single source of truth for pattern recognition rules.
 * The StructuralRecognizer (Tier 1) and BehavioralRecognizer (Tier 2) consume
 * these definitions. Adding a new pattern = adding a catalogue entry — the
 * recognizers never need modification.
 *
 * Design principle: The recognizer is generic. All pattern-specific knowledge
 * lives here as declarative data, not as code branches.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase2.md (Tier 1)
 *            .drytis/specs/ui-knowledge-model-phase3.md (Tier 2)
 *            .drytis/ui-knowledge-model.md §4 (Component Recognition)
 */

import { PatternType, ComponentRole, TransitionOperation } from '../../domain/enums';
import { ValueObjectError } from '../../domain/errors/invariant-errors';

// ── Behavioral Signature Types (Tier 2) ──────────────────

/**
 * Evidence signals that the behavioral recognizer can detect from
 * ObservedTransition evidence fields. Each signal is evaluated generically
 * by checking transition evidence and cascade effects — no pattern-specific code.
 */
export enum EvidenceSignal {
  /** A child element appeared via DOM mutation (popup, panel, etc.). */
  CHILD_ELEMENT_BECAME_VISIBLE = 'childElementBecameVisible',
  /** The visible child contains elements that received CLICK operations. */
  CHILD_CONTAINS_CLICKABLE_ELEMENTS = 'childContainsClickableElements',
  /** The interacted element's value/text changed after an operation. */
  TRIGGER_VALUE_CHANGED = 'triggerValueChanged',
  /** The interacted element's state flipped (checked, expanded, selected). */
  TRIGGER_STATE_CHANGED = 'triggerStateChanged',
  /** A previously-visible element became hidden (popup closed, modal dismissed). */
  POPUP_CLOSED = 'popupClosed',
  /** Another element in the same parent changed value (e.g., price updated). */
  SIBLING_VALUE_CHANGED = 'siblingValueChanged',
  /** Element appeared with modal-like behavior (overlay, backdrop, focus trap). */
  ELEMENT_BECAME_MODAL = 'elementBecameModal',
  /** Selecting one element deselected a sibling (mutual exclusivity). */
  GROUP_MUTUAL_EXCLUSIVITY = 'groupMutualExclusivity',
}

/**
 * A single condition in a behavioral signature.
 *
 * Conditions are checked in order against the transition sequence.
 * The recognizer counts how many conditions are satisfied and uses the
 * match ratio to determine confidence.
 */
export interface SignatureCondition {
  /** Unique condition ID for tracking which matched. */
  readonly id: string;
  /** Human-readable description of what this condition checks. */
  readonly description: string;
  /** The evidence signal this condition requires. */
  readonly signal: EvidenceSignal;
  /**
   * Optional: which transition operation triggers this check.
   * If null/undefined, any operation can satisfy.
   */
  readonly expectedOperation?: string;
  /** Optional: minimum number of times this signal must be observed (default 1). */
  readonly minOccurrences?: number;
}

/**
 * A behavioral signature — declarative evidence conditions that, when met
 * across a sequence of interactions, indicate a recognized UI pattern.
 *
 * Each pattern optionally defines one signature. If no signature is present,
 * the pattern cannot be recognized behaviorally (Tier 1 only).
 */
export interface BehavioralSignature {
  /** Ordered evidence conditions that constitute the pattern's behavioral fingerprint. */
  readonly conditions: readonly SignatureCondition[];
  /**
   * How many conditions must match for partial recognition.
   * If omitted, floor(conditions.length / 2) + 1 is used (majority).
   */
  readonly minConditionsMet?: number;
  /** Confidence assigned when all conditions match. */
  readonly fullMatchConfidence: number;
  /** Confidence assigned when minConditionsMet (but not all) match. */
  readonly partialMatchConfidence: number;
}

// ── PatternDefinition ────────────────────────────────────

/**
 * Declarative definition of a recognized UI pattern.
 *
 * Each entry tells the recognizer:
 *   - Which ARIA roles identify this pattern's root container (Tier 1)
 *   - Which ARIA roles map to which component roles (Tier 1)
 *   - What behavioral evidence signals indicate this pattern (Tier 2)
 *   - What affordances (operations) the component supports
 *   - Whether the pattern has a selectable option set
 *   - How many constituents are required for confident recognition
 */
export interface PatternDefinition {
  /** The pattern type this definition applies to. */
  readonly patternType: PatternType;

  /**
   * ARIA roles that identify this pattern's root/container element.
   * If any role in the element's ancestor chain matches one of these,
   * the pattern is considered structurally present.
   *
   * Ordered by preference — if multiple match, the first is used.
   */
  readonly rootAriaRoles: readonly string[];

  /**
   * Maps ComponentRole → ARIA roles that indicate an element playing that part.
   *
   * The recognizer assigns component roles by checking each element's ARIA role
   * against these mappings. Every key in ComponentRole can appear, but most
   * patterns only use a subset.
   *
   * Example for dropdown:
   *   { TRIGGER: ['combobox'], OPTION: ['option'], CONTAINER: ['listbox'] }
   */
  readonly constituentRoles: Readonly<Partial<Record<ComponentRole, readonly string[]>>>;

  /**
   * Operations this component type supports.
   * Used by InteractionContract derivation during enrichment (Phase 7).
   */
  readonly affordances: readonly string[];

  /**
   * Whether this pattern type has a selectable option set.
   * true: dropdown, radioGroup, combobox → optionSet extracted at enrichment.
   * false: modal, tabs container → no option set.
   */
  readonly hasOptionSet: boolean;

  /**
   * Minimum number of constituents required for confident recognition.
   * e.g., dropdown needs at least: trigger + 1 option = 2.
   */
  readonly minConstituents: number;

  /**
   * Human-readable description for debugging and audit trails.
   */
  readonly description: string;

  /**
   * Behavioral signature for Tier 2 recognition (optional).
   *
   * If present, the behavioral recognizer can recognize this pattern from
   * observed interaction evidence when ARIA structure is absent.
   * If absent, this pattern is only recognized structurally (Tier 1).
   */
  readonly behavioralSignature?: BehavioralSignature;

  /**
   * Whether this pattern should be recognized structurally by Tier 1.
   *
   * Default: true. Set to false for patterns whose rootAriaRoles are not
   * distinctive enough for reliable structural recognition (e.g., accordion
   * shares "button" with countless other patterns). These patterns are
   * recognized primarily through behavioral signatures (Tier 2).
   *
   * The rootAriaRoles field is still required for catalogue registration
   * (it serves as documentation and may be used by AI Tier 3), but the
   * structural recognizer skips patterns where this is false.
   */
  readonly structuralRecognition?: boolean;

  /**
   * The set of TransitionOperations that constitute a complete interaction cycle.
   *
   * When ALL operations in this set have been observed on a component's
   * transitions, the orchestrator promotes the component to CONFIRMED.
   * The orchestrator checks set-containment generically — it never hardcodes
   * which operations mean "dropdown complete" vs "accordion complete."
   *
   * If omitted, the component is confirmed as soon as it has at least one
   * observed transition (single-interaction patterns like checkbox, modal open).
   */
  readonly expectedLifecycle?: readonly TransitionOperation[];
}

// ── V1 Behavioral Signatures ─────────────────────────────

/**
 * Dropdown behavioral signature — recognizes custom dropdowns (Bootstrap,
 * jQuery, Tailwind) that lack ARIA combobox/listbox roles.
 *
 * Lifecycle: click trigger → popup appears → click option → popup closes.
 * The trigger's value/text typically changes to reflect the selection.
 */
const DROPDOWN_BEHAVIORAL: BehavioralSignature = {
  conditions: [
    {
      id: 'popup-appeared',
      description: 'A child element became visible after clicking the trigger',
      signal: EvidenceSignal.CHILD_ELEMENT_BECAME_VISIBLE,
      expectedOperation: 'click',
    },
    {
      id: 'has-clickable-children',
      description: 'The popup contains clickable elements (options)',
      signal: EvidenceSignal.CHILD_CONTAINS_CLICKABLE_ELEMENTS,
    },
    {
      id: 'trigger-value-changed',
      description: "The trigger element's value or text changed after selection",
      signal: EvidenceSignal.TRIGGER_VALUE_CHANGED,
    },
    {
      id: 'popup-closed',
      description: 'The popup closed after selection or commit',
      signal: EvidenceSignal.POPUP_CLOSED,
    },
  ],
  minConditionsMet: 2,
  fullMatchConfidence: 0.75,
  partialMatchConfidence: 0.50,
};

/**
 * Checkbox behavioral signature — recognizes custom checkbox toggles
 * (div/span-based) that lack role="checkbox".
 *
 * Simplest pattern: click → checked state flips.
 */
const CHECKBOX_BEHAVIORAL: BehavioralSignature = {
  conditions: [
    {
      id: 'state-flipped',
      description: 'The element\'s checked/selected state changed after clicking',
      signal: EvidenceSignal.TRIGGER_STATE_CHANGED,
      expectedOperation: 'click',
    },
  ],
  fullMatchConfidence: 0.65,
  partialMatchConfidence: 0.40,
};

/**
 * Radio group behavioral signature — recognizes custom radio groups
 * that lack role="radiogroup" but exhibit mutual exclusivity.
 *
 * Key signal: selecting one element deselects a sibling.
 */
const RADIO_GROUP_BEHAVIORAL: BehavioralSignature = {
  conditions: [
    {
      id: 'mutual-exclusivity',
      description: 'Selecting one element deselected a sibling',
      signal: EvidenceSignal.GROUP_MUTUAL_EXCLUSIVITY,
      expectedOperation: 'click',
    },
    {
      id: 'state-changed',
      description: 'The clicked element\'s selected/checked state changed',
      signal: EvidenceSignal.TRIGGER_STATE_CHANGED,
      expectedOperation: 'click',
    },
  ],
  minConditionsMet: 1,
  fullMatchConfidence: 0.70,
  partialMatchConfidence: 0.45,
};

/**
 * Modal behavioral signature — recognizes custom modals/dialogs that
 * lack role="dialog" but exhibit modal-like behavior (overlay appearance).
 */
const MODAL_BEHAVIORAL: BehavioralSignature = {
  conditions: [
    {
      id: 'modal-appeared',
      description: 'An element appeared with modal-like behavior (overlay/backdrop)',
      signal: EvidenceSignal.ELEMENT_BECAME_MODAL,
      expectedOperation: 'click',
    },
    {
      id: 'content-visible',
      description: 'Modal content became visible',
      signal: EvidenceSignal.CHILD_ELEMENT_BECAME_VISIBLE,
    },
  ],
  minConditionsMet: 1,
  fullMatchConfidence: 0.70,
  partialMatchConfidence: 0.45,
};

/**
 * Accordion behavioral signature — recognizes collapsible sections
 * (Bootstrap collapse, jQuery accordion, custom implementations).
 *
 * Lifecycle: click header → section expands (class/visibility change).
 * Clicking again collapses it.
 */
const ACCORDION_BEHAVIORAL: BehavioralSignature = {
  conditions: [
    {
      id: 'state-toggled',
      description: 'The header element\'s expanded state or class changed after clicking',
      signal: EvidenceSignal.TRIGGER_STATE_CHANGED,
      expectedOperation: 'click',
    },
    {
      id: 'section-expanded',
      description: 'A child section became visible after expanding',
      signal: EvidenceSignal.CHILD_ELEMENT_BECAME_VISIBLE,
    },
    {
      id: 'section-collapsed',
      description: 'The section collapsed on a subsequent interaction',
      signal: EvidenceSignal.POPUP_CLOSED,
    },
  ],
  minConditionsMet: 2,
  fullMatchConfidence: 0.65,
  partialMatchConfidence: 0.45,
};

// ── V1 Pattern Definitions ───────────────────────────────

/**
 * Dropdown / Combobox — a trigger that opens a popup with selectable options.
 *
 * ARIA structure (WAI-ARIA APG):
 *   role="combobox" (trigger)
 *     └── role="listbox" (popup container)
 *           ├── role="option" (selectable item)
 *           ├── role="option"
 *           └── role="option"
 *
 * Also matches standalone listbox (Headless UI pattern):
 *   role="listbox" (container)
 *     ├── role="option"
 *     └── role="option"
 *
 * Behavioral recognition: custom dropdowns without ARIA (Bootstrap, jQuery).
 */
const DROPDOWN: PatternDefinition = {
  patternType: PatternType.DROPDOWN,
  rootAriaRoles: ['combobox', 'listbox'],
  constituentRoles: {
    [ComponentRole.TRIGGER]: ['combobox'],
    [ComponentRole.CONTAINER]: ['listbox'],
    [ComponentRole.OPTION]: ['option'],
  },
  affordances: ['open', 'select', 'search', 'commit', 'close'],
  hasOptionSet: true,
  minConstituents: 2, // trigger/container + at least 1 option
  description: 'Combobox or listbox with selectable options',
  behavioralSignature: DROPDOWN_BEHAVIORAL,
  expectedLifecycle: [TransitionOperation.CLICK, TransitionOperation.SELECT],
};

/**
 * Checkbox — a toggleable boolean control.
 *
 * Single-element pattern: role="checkbox" (no composite structure).
 * Also matches native <input type="checkbox">.
 *
 * Behavioral recognition: custom div/span-based toggles.
 */
const CHECKBOX: PatternDefinition = {
  patternType: PatternType.CHECKBOX,
  rootAriaRoles: ['checkbox'],
  constituentRoles: {
    [ComponentRole.TRIGGER]: ['checkbox'],
  },
  affordances: ['toggle'],
  hasOptionSet: false,
  minConstituents: 1,
  description: 'Checkbox toggle control',
  behavioralSignature: CHECKBOX_BEHAVIORAL,
  expectedLifecycle: [TransitionOperation.TOGGLE],
};

/**
 * Radio Group — a set of mutually exclusive options.
 *
 * ARIA structure:
 *   role="radiogroup" (container)
 *     ├── role="radio" (selectable option)
 *     ├── role="radio"
 *     └── role="radio"
 *
 * Behavioral recognition: custom radio groups exhibiting mutual exclusivity.
 */
const RADIO_GROUP: PatternDefinition = {
  patternType: PatternType.RADIO_GROUP,
  rootAriaRoles: ['radiogroup'],
  constituentRoles: {
    [ComponentRole.CONTAINER]: ['radiogroup'],
    [ComponentRole.OPTION]: ['radio', 'menuitemradio'],
  },
  affordances: ['select'],
  hasOptionSet: true,
  minConstituents: 2, // container + at least 1 radio
  description: 'Radio group with mutually exclusive options',
  behavioralSignature: RADIO_GROUP_BEHAVIORAL,
  expectedLifecycle: [TransitionOperation.SELECT],
};

/**
 * Modal / Dialog — an overlay window requiring user interaction.
 *
 * ARIA structure:
 *   role="dialog" or role="alertdialog" (container)
 *     ├── content elements
 *     ├── button (commit / close)
 *     └── button (cancel)
 *
 * Behavioral recognition: custom modals with overlay/backdrop appearance.
 */
const MODAL: PatternDefinition = {
  patternType: PatternType.MODAL,
  rootAriaRoles: ['dialog', 'alertdialog'],
  constituentRoles: {
    [ComponentRole.CONTAINER]: ['dialog', 'alertdialog'],
    [ComponentRole.COMMIT]: ['button'],
    [ComponentRole.CANCEL]: ['button'],
  },
  affordances: ['close', 'commit', 'cancel'],
  hasOptionSet: false,
  minConstituents: 1, // the dialog itself
  description: 'Modal dialog or alert dialog',
  behavioralSignature: MODAL_BEHAVIORAL,
  // Modal appears on a single click — confirmed when opened.
  expectedLifecycle: [TransitionOperation.CLICK],
};

/**
 * Tabs — a tab list with associated tab panels.
 *
 * ARIA structure:
 *   role="tablist" (container)
 *     ├── role="tab" (activatable tab)
 *     └── role="tab"
 *   role="tabpanel" (content panel, may be outside tablist in DOM)
 *
 * Behavioral: deferred to Phase 2 extension — tabs typically use ARIA reliably.
 */
const TABS: PatternDefinition = {
  patternType: PatternType.TABS,
  rootAriaRoles: ['tablist'],
  constituentRoles: {
    [ComponentRole.CONTAINER]: ['tablist'],
    [ComponentRole.TAB]: ['tab'],
    [ComponentRole.PANEL]: ['tabpanel'],
  },
  affordances: ['activate'],
  hasOptionSet: false,
  minConstituents: 2, // tablist + at least 1 tab
  description: 'Tab list with associated panels',
  // Activating a tab is a single click — confirmed immediately.
  expectedLifecycle: [TransitionOperation.CLICK],
};

/**
 * Accordion — collapsible content sections.
 *
 * ARIA structure:
 *   role="button" with aria-expanded (header)
 *     └── content region (section that shows/hides)
 *
 * Often implemented as custom div-based collapsibles (Bootstrap collapse,
 * jQuery accordion) without explicit ARIA → behavioral recognition is primary.
 */
const ACCORDION: PatternDefinition = {
  patternType: PatternType.ACCORDION,
  rootAriaRoles: ['button'],
  constituentRoles: {
    [ComponentRole.TRIGGER]: ['button'],
    [ComponentRole.CONTAINER]: ['region', 'group'],
  },
  affordances: ['expand', 'collapse'],
  hasOptionSet: false,
  minConstituents: 1,
  description: 'Collapsible accordion section',
  behavioralSignature: ACCORDION_BEHAVIORAL,
  structuralRecognition: false,
  expectedLifecycle: [TransitionOperation.CLICK, TransitionOperation.TOGGLE],
};

// ── Catalogue Registry ───────────────────────────────────

/**
 * Internal registry of pattern definitions.
 * Keyed by PatternType for O(1) lookup.
 */
const catalogue = new Map<PatternType, PatternDefinition>();

/**
 * Validate a PatternDefinition before registering it.
 *
 * @throws ValueObjectError if the definition is malformed.
 */
function validatePatternDefinition(def: PatternDefinition): void {
  if (!def.patternType) {
    throw new ValueObjectError('PatternDefinition', 'patternType is required');
  }
  if (!def.rootAriaRoles || def.rootAriaRoles.length === 0) {
    throw new ValueObjectError(
      `PatternDefinition[${def.patternType}]`,
      'rootAriaRoles must be non-empty',
    );
  }
  if (!def.constituentRoles || Object.keys(def.constituentRoles).length === 0) {
    throw new ValueObjectError(
      `PatternDefinition[${def.patternType}]`,
      'constituentRoles must be non-empty',
    );
  }
  if (typeof def.minConstituents !== 'number' || def.minConstituents < 1) {
    throw new ValueObjectError(
      `PatternDefinition[${def.patternType}]`,
      `minConstituents must be ≥ 1 (got ${def.minConstituents})`,
    );
  }
  // Validate behavioral signature if present
  if (def.behavioralSignature) {
    const sig = def.behavioralSignature;
    if (!sig.conditions || sig.conditions.length === 0) {
      throw new ValueObjectError(
        `PatternDefinition[${def.patternType}]`,
        'behavioralSignature.conditions must be non-empty',
      );
    }
    if (
      typeof sig.fullMatchConfidence !== 'number' ||
      sig.fullMatchConfidence < 0.05 ||
      sig.fullMatchConfidence > 0.95
    ) {
      throw new ValueObjectError(
        `PatternDefinition[${def.patternType}]`,
        `behavioralSignature.fullMatchConfidence must be in [0.05, 0.95]`,
      );
    }
    if (
      typeof sig.partialMatchConfidence !== 'number' ||
      sig.partialMatchConfidence < 0.05 ||
      sig.partialMatchConfidence > 0.95
    ) {
      throw new ValueObjectError(
        `PatternDefinition[${def.patternType}]`,
        `behavioralSignature.partialMatchConfidence must be in [0.05, 0.95]`,
      );
    }
    const ids = new Set<string>();
    for (const cond of sig.conditions) {
      if (!cond.id?.trim()) {
        throw new ValueObjectError(
          `PatternDefinition[${def.patternType}]`,
          'behavioralSignature condition missing id',
        );
      }
      if (ids.has(cond.id)) {
        throw new ValueObjectError(
          `PatternDefinition[${def.patternType}]`,
          `behavioralSignature condition id "${cond.id}" is duplicated`,
        );
      }
      ids.add(cond.id);
      if (!cond.signal) {
        throw new ValueObjectError(
          `PatternDefinition[${def.patternType}]`,
          `behavioralSignature condition "${cond.id}" missing signal`,
        );
      }
    }
  }
}

/**
 * Register a pattern definition in the catalogue.
 *
 * Adding a new pattern is a single call — no recognizer modification needed.
 * Overwrites existing entries for the same patternType (for testing/customization).
 */
export function registerPattern(def: PatternDefinition): void {
  validatePatternDefinition(def);
  catalogue.set(def.patternType, def);
}

/**
 * Get a pattern definition by type.
 * @returns the definition, or undefined if not registered.
 */
export function getPattern(type: PatternType): PatternDefinition | undefined {
  return catalogue.get(type);
}

/**
 * Get all registered pattern definitions.
 *
 * Returns patterns ordered by specificity: patterns with fewer rootAriaRoles
 * (more specific) come first. This ensures that e.g. `radiogroup` (1 root role)
 * is checked before `listbox` (could match broadly) during recognition.
 *
 * @returns array of definitions, most specific first.
 */
export function getAllPatterns(): PatternDefinition[] {
  return Array.from(catalogue.values()).sort(
    (a, b) => a.rootAriaRoles.length - b.rootAriaRoles.length,
  );
}

/**
 * Get all registered patterns that have behavioral signatures.
 * Used by the behavioral recognizer to iterate candidate patterns.
 *
 * @returns array of definitions with behavioralSignature present, most specific first.
 */
export function getBehavioralPatterns(): PatternDefinition[] {
  return getAllPatterns().filter((p) => p.behavioralSignature !== undefined);
}

/**
 * Clear all registered patterns.
 * Primarily for testing — allows resetting the catalogue between test suites.
 */
export function clearCatalogue(): void {
  catalogue.clear();
}

/**
 * Initialize the catalogue with V1 pattern definitions.
 * Called once at module load time.
 */
function initializeV1Patterns(): void {
  registerPattern(DROPDOWN);
  registerPattern(CHECKBOX);
  registerPattern(RADIO_GROUP);
  registerPattern(MODAL);
  registerPattern(TABS);
  registerPattern(ACCORDION);
}

// Auto-register V1 patterns on import
initializeV1Patterns();

// ── Helper: flatten constituent role mappings ─────────────

/**
 * Build a reverse lookup: ARIA role → ComponentRole.
 *
 * Used by the recognizer to assign component roles to elements.
 * If multiple ComponentRoles map to the same ARIA role, the first one
 * (in ComponentRole enum order) wins.
 */
export function buildRoleReverseLookup(
  def: PatternDefinition,
): Map<string, ComponentRole> {
  const reverse = new Map<string, ComponentRole>();
  for (const [componentRole, ariaRoles] of Object.entries(def.constituentRoles)) {
    const role = componentRole as ComponentRole;
    for (const ariaRole of ariaRoles ?? []) {
      if (!reverse.has(ariaRole)) {
        reverse.set(ariaRole, role);
      }
    }
  }
  return reverse;
}
