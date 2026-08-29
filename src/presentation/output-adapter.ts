/**
 * Presentation Layer — Interaction Filtering & IR Mapping
 *
 * This module has two responsibilities:
 * 1. isProductionInteraction: filter out no-ops and noise
 * 2. toIRAction: convert a ComponentInteraction to an IR action
 *
 * No-op filtering rules:
 * - endState must be 'completed' (abandoned/interrupted are filtered)
 * - TextEntry: userTyped must be true AND textValue non-empty
 * - Dropdown: noOpSelection must be false
 * - RadioButton: noOpSelection must be false
 * - DatePicker: selectedDate must be non-empty
 * - Scroll: hasDelta must be true (non-zero delta)
 *
 * D2 DECISION — Unclassified IR policy is DROP (7.4-B4, 2026-08-26):
 * toIRAction returns null for EVERY Unclassified interaction regardless
 * of physical type. This aligns this (currently dead — SW imports only
 * filterProductionInteractions) path with the LIVE bridge policy
 * (ir-bridge.ts NOISE_TYPES drops Unclassified before mapping). The old
 * EMIT branch (click/mousedown → CLICK {unclassified:true},
 * contextmenu → RIGHT_CLICK) was never reachable in production and is
 * removed. Unclassified interactions stay in the panel/storage via
 * isProductionInteraction (capture guarantee v2) — preservation happens
 * there, never in IR generation.
 *
 * Decision record: .drytis/notes/phase-7-4-b3-d1-d2-decision-record.md
 * Spec: .drytis/specs/phase-7-4-b4-unclassified-output-policy.md
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.2 Stage 6
 */

import type { ComponentInteraction, InteractionType } from '../shared/component-types';
import { joinsRecordedSurface } from '../shared/surface-join';

// ── B7-P2 §5.2.7: Hover admission — the single semantic gate ────────

/**
 * Consequence classes admitted for Hover (DC-3 replacement). Each class is
 * a RECORDED FACT in the hover's own evidence — never a gesture judgment.
 * The list is the tuning lever (add/remove classes), never a threshold.
 */
const HOVER_CONSEQUENCE_CLASSES = [
  'reveal',
  'insertion',
  'removal',
  'stamped-fetch',
  'nav',
  'revert',
  'pointer-reach',
] as const;

export type HoverConsequenceClass = (typeof HOVER_CONSEQUENCE_CLASSES)[number];

/**
 * Derive the hover's consequence classes from its recorded evidence —
 * B7-P2 §5.2.7 COMPAT BRIDGE. Pure: same evidence, same classes. The
 * classes are written to metadata.consequenceClasses and drive the derived
 * metadata.meaningful projection until P4 deletes it.
 */
export function deriveConsequenceClasses(
  interaction: ComponentInteraction,
): HoverConsequenceClass[] {
  const ev = interaction.behavioralEvidence;
  if (!ev) return [];
  const app = ev.applicationEvidence ?? {
    newSurfaces: [],
    domChanges: [],
    visibilityChanges: [],
    networkActivity: [],
    navigation: [],
  };
  const classes: HoverConsequenceClass[] = [];

  // reveal — surface emergence 'revealed' OR attribute-driven reveal fact
  // in this window (§5.2.7). The attribute-driven fact: a state attribute
  // flipped open on an element — aria-expanded/aria-selected/aria-checked
  // false→true, aria-hidden true→false, hidden→removed. Recorded shape:
  // domChanges[].attributeDeltas. A transient flip that reverts before the
  // window closes (old===new) is NOT a reveal fact — it left no state.
  const attrReveal = (app.domChanges ?? []).some((c) => {
    const d = c.attributeDeltas as Record<string, { old: string | null; new: string | null }> | undefined;
    if (!d) return false;
    return (
      (d['aria-expanded']?.old === 'false' && d['aria-expanded']?.new === 'true') ||
      (d['aria-selected']?.old === 'false' && d['aria-selected']?.new === 'true') ||
      (d['aria-checked']?.old === 'false' && d['aria-checked']?.new === 'true') ||
      (d['aria-hidden']?.old === 'true' && (d['aria-hidden']?.new === 'false' || d['aria-hidden']?.new === null)) ||
      (d['hidden']?.old != null && d['hidden']?.new == null) ||
      (d['open']?.old === 'false' && d['open']?.new === 'true')
    );
  });
  const reveal = (app.newSurfaces ?? []).some(
    (s) => s.emergence === 'revealed',
  ) || attrReveal;
  if (reveal) classes.push('reveal');

  // insertion / removal — domChange childList counts
  const insertion = (app.domChanges ?? []).some(
    (c) => c.addedNodesCount > 0,
  );
  if (insertion) classes.push('insertion');
  const removal = (app.domChanges ?? []).some(
    (c) => c.removedNodesCount > 0,
  );
  if (removal) classes.push('removal');

  // stamped-fetch — network row stamped (T1 secondary) or attributed (T4)
  // to this lifecycle: a row whose sourceEventId joins the hover's own
  // events (trigger enter + member enters) is stamped attribution; a row
  // present in the hover's window with no competing source is attributed.
  const ownEventIds = new Set<string>();
  if (interaction.triggerEvent?.eventId) {
    ownEventIds.add(interaction.triggerEvent.eventId);
  }
  for (const m of interaction.memberEvents ?? []) ownEventIds.add(m.eventId);
  const stampedFetch = (app.networkActivity ?? []).some(
    (r) => r.sourceEventId != null && ownEventIds.has(r.sourceEventId),
  );
  if (stampedFetch) classes.push('stamped-fetch');

  // nav — navigation event recorded in this window
  const nav = (app.navigation ?? []).length > 0;
  if (nav) classes.push('nav');

  // revert — settle-mode revert fact after leave: a visibility change
  // flipping a revealed surface back to hidden is the DOM fact of "the
  // surface closed". Recorded shape: VisibilityChange { property,
  // oldValue, newValue }.
  const revert = (app.visibilityChanges ?? []).some(
    (v) => {
      const oldV = v.oldValue;
      const newV = v.newValue;
      if (oldV == null || newV == null) return false;
      return (
        (v.property === 'display' && oldV !== 'none' && newV === 'none') ||
        (v.property === 'visibility' && oldV === 'visible' && newV === 'hidden') ||
        (v.property === 'aria-hidden' && oldV === 'false' && newV === 'true')
      );
    },
  );
  if (revert) classes.push('revert');

  // pointer-reach — trusted enter on element E where E's identity matches
  // an insertion/reveal fact recorded in this SAME window (B-3 degraded
  // join). A raw enter on a pre-existing unrelated element is movement,
  // not consequence — the false-positive boundary. Join sources: childList
  // insertions, newSurfaces records, AND attribute-driven reveal facts
  // (the element that revealed a surface — aria-expanded flip etc).
  const enters = (interaction.metadata?.pointerPathEnters as
    | Array<{ target: { cssSelector?: string; xPath?: string; ariaRole?: string } }>
    | undefined) ?? [];
  if (enters.length > 0) {
    const joinTargets = [
      ...(app.domChanges ?? [])
        .filter((c) => c.addedNodesCount > 0)
        .map((c) => ({ path: c.targetPath, ariaRole: null })),
      ...(app.newSurfaces ?? []).map((s) => ({ path: s.path, ariaRole: s.ariaRole })),
      ...(app.domChanges ?? [])
        .filter((c) =>
          (c.changedAttributes ?? []).includes('aria-expanded') &&
          (c.attributeDeltas?.['aria-expanded'] as { old?: string; new?: string } | undefined)
            ?.new === 'true')
        .map((c) => ({ path: c.targetPath, ariaRole: null })),
    ];
    if (joinTargets.length > 0) {
      // B7-P3 B-3 parity: the join consumes the shared surface-join module
      // (identity form ↔ DOM-path form). The pre-P3 exact-equality matcher
      // compared incompatible locator grammars and could never fire in real
      // Chrome (css `#mega-products` vs path `body > div > div#mega-products`).
      const reach = enters.some((e) =>
        joinTargets.some((s) => joinsRecordedSurface(s, e.target).joined),
      );
      if (reach) classes.push('pointer-reach');
    }
  }

  return classes;
}

// ── Production Interaction Filter ────────────────────────────────────

/**
 * Check if a ComponentInteraction should appear in the final output.
 * Filters out no-ops, abandoned, and interrupted interactions.
 *
 * Architecture: §2.2 Stage 6, §4.2/4.4/4.5 (OrangeHRM bug fixes)
 */
export function isProductionInteraction(
  interaction: ComponentInteraction,
): boolean {
  // Only completed interactions pass
  if (interaction.endState !== 'completed') return false;

  const { type, metadata } = interaction;

  switch (type as InteractionType) {
    case 'TextEntry':
      // Bug 4 fix: must have actually typed
      if (metadata.userTyped !== true) return false;
      if (!metadata.textValue || String(metadata.textValue).trim() === '') {
        return false;
      }
      return true;

    case 'Dropdown':
      // Bug 2 fix: must not be a no-op selection
      if (metadata.noOpSelection === true) return false;
      return true;

    case 'RadioButton':
      // Bug 4 fix: must not be a re-selection of already-selected radio
      if (metadata.noOpSelection === true) return false;
      return true;

    case 'DatePicker':
      // Empty date selection must be filtered
      if (
        !metadata.selectedDate ||
        String(metadata.selectedDate).trim() === ''
      ) {
        return false;
      }
      return true;

    case 'Scroll':
      // Bug 5 fix: 0px scroll must be filtered
      if (metadata.hasDelta !== true) return false;
      return true;

    case 'Slider':
      // M0.5 Fix G7: filter out focus-only traversal (userAdjusted=false).
      // Slider triggers on focus but should only appear in output if the
      // user actually adjusted the value (mouse drag, click-to-set, keyboard).
      if (metadata.userAdjusted !== true) return false;
      return true;

    case 'ColorInput':
      // G8: filter out focus-only traversal and same-color re-selection.
      // ColorInput triggers on focus but should only appear if user
      // actually changed the color (userAdjusted=true).
      if (metadata.userAdjusted !== true) return false;
      return true;

    case 'Click':
    case 'Link':
    case 'Checkbox':
    case 'Navigation':
      return true;

    case 'Hover':
      // B7-P2 §5.2.7: evidence-keyed admission — the single semantic gate.
      // admit ⇔ endState === 'completed' (checked above) ∧ consequence-
      // bearing (≥1 recorded fact of class reveal | insertion | removal |
      // stamped-fetch | nav | revert | pointer-reach). The old stored
      // metadata.meaningful judgment is DEAD — never gates again.
      return deriveConsequenceClasses(interaction).length > 0;

    case 'Unclassified':
      // Capture-guarantee v2: every deliberate physical action preserved.
      // Unclassified interactions represent a real user action that no
      // definition recognized — they must always appear in output so no
      // deliberate click is silently lost.
      return true;

    default:
      return true;
  }
}

/**
 * Filter an array of interactions, keeping only production-worthy ones.
 *
 * B7-P4: the compat bridge is DELETED. The filter no longer writes
 * `metadata.consequenceClasses` or `metadata.meaningful` — it is a pure
 * filter again. Every consumer (ledger anchor gate, panel renderer)
 * derives admission from the recorded evidence via
 * `deriveConsequenceClasses` at read time; stored P2/P3-era
 * `consequenceClasses`/`meaningful` values are inert history.
 */
export function filterProductionInteractions(
  interactions: ComponentInteraction[],
): ComponentInteraction[] {
  return interactions.filter((i) => isProductionInteraction(i));
}

// ── IR Action Mapping ────────────────────────────────────────────────

/**
 * IR Action types — what the generation pipeline expects.
 * These map to Playwright actions in the code generator.
 *
 * NOTE: this is a LOCAL, presentation-layer shape. The DOMAIN IRAction
 * enum lives in src/domain/execution-ir/types.ts (lowercase values,
 * 'click' etc.) — the two vocabularies are intentionally distinct. Per
 * the 7.4-B4 scope audit, the local union is REDUCED to exactly the
 * members this adapter can produce post-D2; importing the domain enum is
 * deliberately NOT done (would rewrite every emitted literal).
 */
export interface IRAction {
  type:
    | 'CLICK'
    | 'FILL'
    | 'SELECT'
    | 'TOGGLE'
    | 'SELECT_DATE'
    | 'NAVIGATE'
    | 'HOVER'
    | 'WAIT';
  target: {
    name: string;
    tag?: string;
    role?: string | null;
  };
  value?: string;
  metadata?: Record<string, unknown>;
  /** Layer 2: Semantic component type (DataGrid, IconButton, SortButton, etc.). */
  componentType?: string;
  /** Layer 2: Framework that rendered the component (MUI, AntDesign, etc.). */
  componentFramework?: string;
  /** Layer 3: Human-readable business meaning. */
  businessMeaning?: string;
}

/**
 * Convert a ComponentInteraction to an IR Action.
 *
 * Architecture: §3.3 IR Action mapping table
 */
export function toIRAction(interaction: ComponentInteraction): IRAction | null {
  const { type, metadata } = interaction;
  const targetName = String(metadata.targetName ?? 'element');
  const target = {
    name: targetName,
    tag: interaction.trigger.tag,
    role: interaction.trigger.ariaRole,
  };

  // Three-layer enrichment fields
  const enrichment = {
    componentType: interaction.componentType,
    componentFramework: interaction.componentFramework,
    businessMeaning: interaction.businessMeaning,
  };

  switch (type as InteractionType) {
    case 'Click':
    case 'Link':
      return {
        type: 'CLICK',
        target,
        metadata: {
          clientX: metadata.clientX,
          clientY: metadata.clientY,
        },
        ...enrichment,
      };

    case 'TextEntry':
      return {
        type: 'FILL',
        target,
        value: String(metadata.textValue ?? ''),
        metadata: {
          userTyped: metadata.userTyped,
        },
        ...enrichment,
      };

    case 'Dropdown':
      return {
        type: 'SELECT',
        target,
        value: String(metadata.selectedValue ?? ''),
        metadata: {
          noOpSelection: metadata.noOpSelection,
        },
        ...enrichment,
      };

    case 'Checkbox':
      return {
        type: 'TOGGLE',
        target,
        value: metadata.checked ? 'check' : 'uncheck',
        metadata: {
          checked: metadata.checked,
        },
        ...enrichment,
      };

    case 'RadioButton':
      return {
        type: 'CLICK',
        target,
        metadata: {
          noOpSelection: metadata.noOpSelection,
        },
        ...enrichment,
      };

    case 'DatePicker':
      return {
        type: 'SELECT_DATE',
        target,
        value: String(metadata.dateValue ?? metadata.selectedDate ?? ''),
        metadata: {
          selectedDate: metadata.selectedDate,
        },
        ...enrichment,
      };

    case 'Navigation':
      return {
        type: 'NAVIGATE',
        target: { name: String(metadata.pageTitle ?? metadata.pageUrl ?? 'page') },
        value: String(metadata.pageUrl ?? ''),
        ...enrichment,
      };

    case 'Hover':
      return {
        type: 'HOVER',
        target,
        metadata: {
          dwellMs: metadata.dwellMs,
        },
        ...enrichment,
      };

    case 'Scroll':
      return {
        type: 'WAIT',
        target: { name: 'scroll' },
        metadata: {
          scrollDeltaY: metadata.scrollDeltaY,
          scrollDeltaX: metadata.scrollDeltaX,
        },
        ...enrichment,
      };

    case 'Slider':
      return {
        type: 'FILL',
        target,
        value: String(metadata.value ?? ''),
        metadata: {
          userAdjusted: metadata.userAdjusted,
        },
        ...enrichment,
      };

    case 'ColorInput':
      return {
        type: 'FILL',
        target,
        value: String(metadata.value ?? ''),
        metadata: {
          userAdjusted: metadata.userAdjusted,
        },
        ...enrichment,
      };

    case 'Unclassified':
      // D2 DROP (7.4-B4, 2026-08-26): Unclassified interactions never
      // become IR steps — for ANY physical type. The live bridge's
      // NOISE_TYPES filter drops them first (see ir-bridge.ts); this
      // dead-path alignment removes the accidental EMIT branch
      // (click/mousedown → CLICK {unclassified:true}, contextmenu →
      // RIGHT_CLICK) that no production call site ever exercised.
      // Preservation is isProductionInteraction's job (capture guarantee
      // v2: every deliberate physical action stays in the panel and
      // stored interactions list), NOT IR generation's.
      return null;

    default:
      return null;
  }
}

/**
 * Convert an array of interactions to IR actions (with production filter).
 */
export function toIRActions(
  interactions: ComponentInteraction[],
): IRAction[] {
  return filterProductionInteractions(interactions)
    .map(toIRAction)
    .filter((a): a is IRAction => a !== null);
}
