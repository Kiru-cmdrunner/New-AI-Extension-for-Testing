/**
 * Generation Layer — IR Compiler
 *
 * Compiles ComponentInteraction[] (recording output) into ExecutionIRPlan
 * (execution representation). This is a permanent architectural layer.
 *
 * Architecture:
 *   ComponentInteraction[] + RecordingContext + GenerationEnrichment
 *     → compileToIR() → ExecutionIRPlan
 *
 * The compiler is a pure function: same inputs → same plan, every time.
 * No side effects, no storage reads/writes. The caller (service worker)
 * handles persistence.
 *
 * Contract invariants (see .drytis/ENGINEERING-HANDOVER.md):
 *   INV-GEN-1: Determinism — same input → same output
 *   INV-GEN-4: Order preservation — step order matches interaction order
 *   INV-GEN-7: Graceful degradation — enrichment absent → valid plan
 *   INV-GEN-8: No Understanding Layer imports
 *   INV-GEN-9: Service worker is sole adapter site
 *
 * Phase 1.3: Removed DetectedInteraction dependency, 40-type vocabulary,
 * SessionEvent correlation, and Understanding Layer integration.
 */

import {
  IRAction,
  DEFAULT_EXECUTION_PARAMETERS,
  type IRStep,
  type ExecutionIRPlan,
  type ResolvedLocator,
  type ResolvedTarget,
  type ElementTarget,
  type IRAssertion,
  type IREnvironment,
  type IRInput,
} from '../domain/execution-ir/types';
import type { ElementIdentity } from '../shared/types';
import type { ComponentInteraction, InteractionType } from '../shared/component-types';
import {
  extractCandidatesFromIdentity,
  rankLocatorCandidates,
} from '../domain/locator-ranking';
import { LocatorStrategyType, ValidationType, ValidationComparison, ValidationSeverity } from '../domain/enums';
import { isDropdownOption, formJoinKey } from '../definitions/patterns';
import type { ObservedEvent } from '../shared/component-types';
import type { GenerationInput, GenerationEnrichment, StepScopedAssertion } from './generation-types';

// ── Interaction Type → IRAction Mapping (14 types) ────────

/**
 * Maps ComponentInteraction types to IRAction.
 *
 * This is the single source of truth for "what kind of IR step does this
 * interaction produce?" Every adapter (Playwright, Cypress, etc.) reads
 * the IRAction, never the InteractionType.
 */
const INTERACTION_TO_IR_ACTION: Record<InteractionType, IRAction> = {
  Click: IRAction.CLICK,
  TextEntry: IRAction.FILL,
  Dropdown: IRAction.SELECT,
  Checkbox: IRAction.TOGGLE,
  RadioButton: IRAction.SELECT,
  DatePicker: IRAction.SELECT_DATE,
  Hover: IRAction.HOVER,
  Link: IRAction.CLICK,
  FileUpload: IRAction.FILL,
  Slider: IRAction.FILL,
  ColorInput: IRAction.FILL,
  Tab: IRAction.CLICK,
  Expander: IRAction.CLICK,   // 7.4-B1: replay parity — a human replays an
                              // expander by clicking it; TOGGLE sets
                              // .checked (checkbox-specific, no-op on
                              // div/button triggers). Direction lives on
                              // metadata + behavioral layer, never the input.
  Modal: IRAction.CLICK,     // 7.4-B5: open → CLICK (same replay as a human
                             // clicking the trigger); dismiss → overridden
                             // below to KEYBOARD_SHORTCUT with NoTarget.
  Scroll: IRAction.CLICK,      // filtered as noise below
  Navigation: IRAction.NAVIGATE,
  DragDrop: IRAction.DRAG_DROP,
  KeyboardShortcut: IRAction.KEYBOARD_SHORTCUT,
  CompoundInteraction: IRAction.DRAG_DROP, // compound actions typically resolve to drag-drop or click
  Unclassified: IRAction.CLICK, // unreachable — NOISE_TYPES drops Unclassified before the mapping table is consulted (D2 DROP, 7.4-B4)
};

// ── Noise Filtering ────────────────────────────────────────

/**
 * Interaction types that produce no meaningful test step.
 * Filtered out during IR plan construction.
 *
 * D2 DECISION (7.4-B4, 2026-08-26): Unclassified is DROPPED — the live
 * policy of the product since the first IR plan. Not exported; pinned
 * black-box via build() in tests/generation/ir-bridge-noise-drop-7-4-b4.test.ts.
 * Spec: .drytis/specs/phase-7-4-b4-unclassified-output-policy.md
 */
const NOISE_TYPES: Set<InteractionType> = new Set([
  'Scroll',
  'Unclassified',
]);

// ── D9: Deterministic IDs + Honest Environment ──────────────

/**
 * D9 invariant: the recorder runs exclusively in Chrome (MV3 extension
 * against the chrome.* API surface). IREnvironment.browser is therefore a
 * constant, not a guess — if this ever changes, this const moves to the
 * recording context capture in the service worker.
 */
const RECORDING_BROWSER: IREnvironment['browser'] = 'chrome';

/**
 * D9 fallback viewport when the recording context does not carry one
 * (e.g. legacy sessions captured before viewport recording, or a tab
 * whose width/height were unavailable at capture time).
 */
const FALLBACK_VIEWPORT = { width: 1280, height: 720 };

/**
 * Compute the origin to use as IREnvironment.baseUrl.
 *
 * D9: baseUrl is a URL-resolution base (adapters prepend it to relative
 * paths; Playwright config uses it as baseURL). The recorded startUrl is
 * preserved verbatim in IREnvironment.startUrl instead. Non-http(s)
 * schemes (e.g. about:blank) have no origin — the raw startUrl is the
 * honest fallback so replays still start where the recording started.
 */
function baseUrlFor(startUrl: string): string {
  try {
    const url = new URL(startUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.origin;
    }
  } catch {
    // unparseable — fall through to raw
  }
  return startUrl;
}

/**
 * Deterministic djb2 hash (same construction as D7's hashPattern) over
 * the plan's semantic identity: test-case name, recording startUrl, and
 * the ordered step fingerprint. INV-GEN-1: identical recording →
 * identical IDs, so ExecutionRun history can correlate replays.
 */
function hashIdentity(seed: string): string {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash) + seed.charCodeAt(i);
    hash = hash & 0xffffffff; // keep 32-bit
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Fingerprint the compiled steps for ID derivation: id, action, target
 * kind, and input. Deliberately excludes timestamps, event ids, and
 * transient metadata — only what the test case IS, not when it ran.
 */
function fingerprintSteps(steps: readonly IRStep[]): string {
  return steps
    .map((s) => `${s.id}:${s.action}:${s.target.kind}:${String(s.input ?? '')}`)
    .join('|');
}


// ── Locator Resolution (ElementIdentity → ResolvedLocator[]) ──

/**
 * Resolve locators from ElementIdentity using the shared ranking rules.
 *
 * Delegates to the shared rankLocatorCandidates() function so that
 * recording-time and execution-time locator resolution use the same
 * priority assignment, filtering, and confidence scoring.
 *
 * @see src/domain/locator-ranking.ts for the shared ranking logic.
 */
function resolveLocatorsForIR(identity: ElementIdentity): ResolvedLocator[] {
  const candidates = extractCandidatesFromIdentity(identity);
  const ranked = rankLocatorCandidates(candidates);
  return ranked as ResolvedLocator[];
}

// ── Target Resolution (ElementIdentity → ResolvedTarget) ───

function resolveElementTarget(
  identity: ElementIdentity,
  elementIdByKey?: ReadonlyMap<string, string>,
): ElementTarget {
  const locators = resolveLocatorsForIR(identity);
  // D3: prefer the session-assigned element ID (elem-NNNN) when the caller
  // harvested one for this identity. Falls back to the captured value —
  // pre-D3 callers (and unharvested identities) keep the old behavior.
  const key = elementIdentityKeyOf(identity);
  const harvestedId = elementIdByKey?.get(key) ?? '';
  return {
    kind: 'element',
    elementId: harvestedId || identity.elementId,
    elementName: identity.accessibleName || identity.ariaLabel || identity.tag,
    pageOrComponent: 'main',
    resolvedLocators: locators,
  };
}

// D3: import the shared harvest key — the single canonical join key between
// harvested session ids (service worker) and IR targets (this module).
// A duplicated local copy would silently drift and break linkage.
import { elementIdentityKey as elementIdentityKeyOf } from '../repository/services/session-element-harvest';

function resolveUrlTarget(url: string): ResolvedTarget {
  return { kind: 'url', url };
}

// ── Description Generation ─────────────────────────────────

/**
 * Generate a human-readable description for an IR step.
 *
 * Uses metadata produced by ComponentDefinition.buildResult().
 * When enrichment provides a business label, it replaces the
 * generic element name.
 */
function generateDescription(
  interaction: ComponentInteraction,
  businessLabel?: string,
): string {
  const name = businessLabel ?? getElementDisplayName(interaction);
  const md = interaction.metadata;

  switch (interaction.type) {
    case 'TextEntry': {
      // 6C: description reads typed intent (matches the fill input).
      const value = (md['typedValue'] as string) || (md['textValue'] as string) || '';
      return `Fill "${value}" in the ${name}`;
    }
    case 'Checkbox': {
      const checked = (md['checked'] as boolean) ?? false;
      return `${checked ? 'Check' : 'Uncheck'} the ${name}`;
    }
    case 'Dropdown':
    case 'RadioButton': {
      const value = (md['selectedValue'] as string) ?? '';
      return `Select "${value}" from the ${name}`;
    }
    case 'DatePicker': {
      const value = (md['dateValue'] as string) ?? (md['selectedDate'] as string) ?? '';
      return `Select ${value} in the ${name}`;
    }
    case 'Navigation': {
      const url = (md['pageUrl'] as string) ?? '';
      return `Navigate to ${url}`;
    }
    case 'Hover':
      return `Hover over the ${name}`;
    case 'Slider': {
      const value = (md['value'] as string) ?? '';
      return `Set the slider to ${value}`;
    }
    case 'ColorInput': {
      const value = (md['value'] as string) ?? '';
      return `Set the color to ${value}`;
    }
    case 'FileUpload': {
      const file = (md['fileName'] as string) ?? '';
      return `Upload ${file || 'a file'}`;
    }
    case 'Tab': {
      return `Click the "${name}" tab`;
    }
    case 'Expander': {
      // 7.4-B1: direction is post-event (behavioral layer owns it), so the
      // description is direction-neutral — "Expand or collapse" reads
      // correctly for both flips.
      return `Expand or collapse the ${name}`;
    }
    case 'Link':
      return `Click the "${name}" link`;
    case 'DragDrop': {
      const source = (md['sourceName'] as string) ?? name;
      const target = (md['dropTargetName'] as string) ?? 'target';
      return `Drag "${source}" to ${target}`;
    }
    case 'KeyboardShortcut': {
      const keys = (md['shortcut'] as string) ?? '';
      return `Press ${keys}`;
    }
    case 'Modal': {
      // 7.4-B5: open → "Click the X" (replay parity — a human clicks the
      // dialog trigger); dismiss → "Press Escape to dismiss the dialog"
      // (direction-neutral per B1's description discipline).
      const action = (md['action'] as string) ?? 'open';
      if (action === 'dismiss-escape') {
        return `Press Escape to dismiss the ${name}`;
      }
      return `Open the ${name} dialog`;
    }
    case 'CompoundInteraction': {
      const summary = (md['summary'] as string) ?? name;
      return summary;
    }
    default:
      return `Click the ${name}`;
  }
}

/**
 * Generate plain-English description (capitalized first letter).
 */
function generatePlainEnglish(
  interaction: ComponentInteraction,
  businessLabel?: string,
): string {
  const description = generateDescription(interaction, businessLabel);
  return description.charAt(0).toUpperCase() + description.slice(1);
}

/**
 * Get a human-readable name for the interaction's target element.
 */
function getElementDisplayName(interaction: ComponentInteraction): string {
  const trigger = interaction.trigger;
  return trigger.accessibleName
    || trigger.ariaLabel
    || trigger.tag;
}

// ── Input Value Extraction ─────────────────────────────────

/**
 * Extract the input value for an IR step from interaction metadata.
 *
 * In the old architecture, this tried SessionEvent first then metadata.
 * Now metadata is the sole source — buildResult already resolved
 * values at classification time.
 */
function extractInputValue(interaction: ComponentInteraction): IRInput {
  const md = interaction.metadata;

  switch (interaction.type) {
    case 'TextEntry':
      // 6C dual-sample contract (spec §3): IR fill input = user INTENT
      // (typedValue), falling back to committed textValue for
      // autofill/paste-without-input flows (backfilled typed := committed)
      // and for empty-string typed samples (user cleared the field —
      // intent degenerates to the committed state).
      return (md['typedValue'] as string) || (md['textValue'] as string) || null;

    case 'Checkbox':
      return (md['checked'] as boolean) ?? null;

    case 'Dropdown':
    case 'RadioButton':
      return (md['selectedValue'] as string) ?? null;

    case 'DatePicker':
      return (md['dateValue'] as string) ?? (md['selectedDate'] as string) ?? null;

    case 'Slider':
      return (md['value'] as string) ?? null;

    case 'ColorInput':
      return (md['value'] as string) ?? null;

    case 'Navigation':
      return (md['pageUrl'] as string) ?? null;

    case 'FileUpload':
      return (md['fileName'] as string) ?? null;

    case 'DragDrop': {
      const source = (md['sourceName'] as string) ?? '';
      const target = (md['dropTargetName'] as string) ?? '';
      return source || target || null;
    }

    case 'KeyboardShortcut':
      return (md['shortcut'] as string) ?? null;

    case 'Modal':
      // 7.4-B5: open → null (CLICK has no input); dismiss → the key string
      // (metadata.key, e.g. 'Escape'). The KEYBOARD_SHORTCUT executor and
      // renderer consume this as the press target.
      if (md['action'] === 'dismiss-escape') {
        return (md['key'] as string) ?? null;
      }
      return null;

    default:
      return null;
  }
}

// ── Assertion Derivation (from Enrichment) ─────────────────

/**
 * Map a StepScopedAssertion (generation-layer vocabulary, plain-string
 * grammar values) to an IRAssertion (domain enums + resolved target).
 *
 * The assertion's target is the OBSERVED element (its own locator), not
 * the step's target — that is the entire point of step-scoped assertions.
 * Casting the string grammar values to the enum types is safe because the
 * StepScopedAssertion contract documents them as ValidationType /
 * ValidationComparison / ValidationSeverity values.
 */
function toStepScopedIRAssertion(
  sa: StepScopedAssertion,
  stepIndex: number,
  assertionIndex: number,
): IRAssertion {
  return {
    type: sa.type as ValidationType,
    comparison: sa.comparison as ValidationComparison,
    severity: sa.severity as ValidationSeverity,
    expectedValue: sa.expectedValue,
    property: sa.property,
    target: {
      kind: 'element',
      // Observed elements are not repository-tracked. A stable synthetic id
      // (unique per step+slot) is REQUIRED, not cosmetic: POM registration
      // keys locator getters by elementId, and a shared '' would collide
      // when one step asserts multiple observed elements (first-wins
      // substitution would point later assertions at the WRONG getter).
      elementId: `obs-${stepIndex}-${assertionIndex}`,
      elementName: sa.targetName,
      pageOrComponent: 'main',
      resolvedLocators: [
        {
          type: LocatorStrategyType.CSS,
          value: sa.targetCss,
          priority: 1,
          confidence: 0.7, // generic-selector confidence (no per-locator ranking ran)
        },
      ],
    },
  };
}

/**
 * Derive IRAssertion[] for one step.
 *
 * Track 3 (step-scoped): joined by sourceEventId from
 * enrichment.stepAssertions — resulting-state evidence for elements that
 * CHANGED because of this step. All Track-3 v1 assertions are soft.
 *
 * elementAssertions (keyed by the step's own target elementId) remains
 * the future slot for element-targeted constraints; when it is populated,
 * its assertions follow the step-scoped ones.
 *
 * When enrichment is absent, returns empty array (INV-GEN-7).
 */
function deriveAssertions(
  elementId: string,
  sourceEventId: string | undefined,
  stepIndex: number,
  enrichment?: GenerationEnrichment,
): IRAssertion[] {
  const out: IRAssertion[] = [];

  const stepScoped = sourceEventId
    ? enrichment?.stepAssertions?.get(sourceEventId)
    : undefined;
  if (stepScoped) {
    for (let i = 0; i < stepScoped.length; i++) {
      out.push(toStepScopedIRAssertion(stepScoped[i], stepIndex, i));
    }
  }

  // Track 3 (element-targeted, keyed by element ID): not yet produced by
  // any adapter. Kept for the documented future slot.
  void elementId;

  return out;
}

// ── Readability Rules ──────────────────────────────────────

/**
 * Apply readability rules to IRStep[].
 *
 * OR-1: Merge GENUINELY REDUNDANT consecutive CLICKs on the same element.
 * (.drytis/specs/or1-repeated-clicks.md)
 *
 * Merge rule: a following same-element click is merged into the current
 * step ONLY when it carries no new resulting-state assertions — the
 * structurally provable duplicate case (double-fire, focus+click residue).
 * The duplicate asserts nothing, so collapsing it loses nothing.
 *
 * A following click WITH resulting-state assertions is a DISTINCT user
 * action whose observed consequence must survive: keeping it merged would
 * assert a state ("2 items") the remaining single click can never reach on
 * replay (A-Slice audit: 2 deliberate ATC clicks merged to one step, then
 * soft-failed permanently). Both steps keep their own sourceEventId and
 * assertions.
 *
 * Run-length correct: maximal runs of no-new-state duplicates collapse into
 * the first step (a, a*, a* → one step) — the old pairwise `i += 2` turned
 * three clicks into two steps.
 */
/**
 * 7.4-B6: Is this interaction's trigger a form submit control? Uses the
 * ground-truth DomContext flag captured at event time
 * (isFormSubmitControl — HTML semantics: input[type=submit|image],
 * button[type=submit or no type attr]) — never inferred from tag/role
 * heuristics downstream. Legacy events without the flag are NOT submit
 * controls (honest absence — no reorder fires).
 */
function isSubmitControlInteraction(interaction: ComponentInteraction): boolean {
  return interaction.triggerEvent.domContext?.isFormSubmitControl === true;
}

/**
 * 7.4-B6: FILL-before-submit-CLICK order restore.
 *
 * For every submit-completed TextEntry FILL step (commitSignal === 'submit')
 * that sits AFTER a CLICK step whose interaction is a submit control joined
 * to the SAME form, move the FILL to immediately before that CLICK.
 * Deterministic from recorded data (formJoinKey equality); no other steps
 * are reordered. Idempotent: a FILL already before its CLICK is untouched.
 *
 * Spec: .drytis/specs/phase-7-4-b6-enter-submit-commit.md §4.5
 */
function restoreSubmitFillOrder(steps: IRStep[], interactions: ComponentInteraction[]): void {
  if (steps.length < 2) return;

  // Map interactionId → interaction facts (recorded join/commit data).
  // The form join is derived from each interaction's OWN trigger-event
  // DomContext (captured at event time) — NOT from metadata, which only
  // TextEntry emits. The Click definition writes no form fields, but its
  // trigger event carries them; recorded data either way, no live DOM.
  const formKeyByInteraction = new Map<string, { formKey: string | null; commit: boolean; submitCtl: boolean }>();
  for (const it of interactions) {
    formKeyByInteraction.set(it.interactionId, {
      formKey: formJoinKey(it.trigger, it.triggerEvent?.domContext),
      commit: it.metadata['commitSignal'] === 'submit',
      submitCtl: isSubmitControlInteraction(it),
    });
  }

  // IRStep carries sourceEventId; find the interaction each step came from.
  // For TextEntry steps the sourceEventId is the trigger (focus) event id;
  // the mapping below uses the interaction lookup by step sourceEventId.
  const interactionBySourceEvent = new Map<string, ComponentInteraction>();
  for (const it of interactions) {
    interactionBySourceEvent.set(it.triggerEvent.eventId, it);
  }

  // Find fills needing reorder: fill with commit && an EARLIER same-form
  // submit-control click. Emission order is click-then-fill (the TextEntry
  // completes on the native submit event, which follows the click), so the
  // click to jump back over is at j < i. Iterate left→right and move each
  // committed FILL back before the LAST matching earlier click.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.action !== IRAction.FILL) continue;
    if (!step.sourceEventId) continue;
    const it = interactionBySourceEvent.get(step.sourceEventId);
    if (!it) continue;
    const meta = formKeyByInteraction.get(it.interactionId);
    if (!meta?.commit || !meta.formKey) continue;

    // Find the LATEST earlier CLICK joined to the same form + submit control
    let target = -1;
    for (let j = i - 1; j >= 0; j--) {
      const earlier = steps[j];
      if (earlier.action !== IRAction.CLICK) continue;
      if (!earlier.sourceEventId) continue;
      const earlierIt = interactionBySourceEvent.get(earlier.sourceEventId);
      if (!earlierIt) continue;
      const earlierMeta = formKeyByInteraction.get(earlierIt.interactionId);
      if (earlierMeta?.submitCtl && earlierMeta.formKey != null && earlierMeta.formKey === meta.formKey) {
        target = j;
        break;
      }
    }
    if (target < 0) continue;

    // Move the FILL to immediately before that CLICK
    const [moved] = steps.splice(i, 1);
    steps.splice(target, 0, moved);
  }
}

function applyReadabilityRules(steps: IRStep[]): IRStep[] {
  if (steps.length <= 1) return steps;

  const result: IRStep[] = [];
  let i = 0;

  while (i < steps.length) {
    const current = steps[i];
    const next = steps[i + 1];

    // OR-1: same-element consecutive clicks
    if (
      next &&
      current.action === IRAction.CLICK &&
      next.action === IRAction.CLICK &&
      current.target.kind === 'element' &&
      next.target.kind === 'element' &&
      current.target.elementId === next.target.elementId
    ) {
      // Collapse the maximal run of GENUINELY REDUNDANT duplicates that
      // follow: same element, no new resulting-state assertions. The FIRST
      // step of the run is kept (its identity, sourceEventId, and — when
      // present — its own assertions are the truthful record).
      result.push(current);
      i++;
      while (i < steps.length) {
        const dup = steps[i];
        const isRedundantDuplicate =
          dup.action === IRAction.CLICK &&
          dup.target.kind === 'element' &&
          current.target.kind === 'element' &&
          dup.target.elementId === current.target.elementId &&
          dup.assertions.length === 0; // no new state to preserve
        if (!isRedundantDuplicate) break;
        i++; // skip the redundant duplicate
      }
    } else {
      result.push(current);
      i++;
    }
  }

  // Re-number order after merging
  return result.map((step, idx) => ({ ...step, order: idx }));
}

// ── Tag Derivation ─────────────────────────────────────────

/**
 * Derive tags from recording context and enrichment.
 *
 * Uses the start URL's first path segment plus any surface tags
 * from enrichment. Max 5 tags.
 */
function deriveTags(
  recordingContext: GenerationInput['recordingContext'],
  enrichment?: GenerationEnrichment,
): string[] {
  const tags: string[] = [];

  // Add the start URL path segment as a tag
  try {
    const url = new URL(recordingContext.startUrl);
    const pathSegment = url.pathname.split('/').filter(Boolean)[0];
    if (pathSegment) tags.push(pathSegment);
  } catch {
    // Ignore invalid URLs
  }

  // Add surface tags from enrichment
  if (enrichment?.surfaceTags) {
    for (const tag of enrichment.surfaceTags) {
      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }
    }
  }

  return tags.slice(0, 5);
}

// ── Main Compile Function ──────────────────────────────────

/**
 * 7.4-B2b: find the completing option event for an INPUT-triggered Dropdown.
 *
 * The option is the last member event whose target is a dropdown option
 * (isDropdownOption on ariaRole + className). For INPUT-triggered
 * Dropdowns that completed with selectionConfirmed=true, this always
 * exists — the only completion path for that shape is the
 * containment-proven option click (dropdown.ts:170-213).
 *
 * Deterministic: reads only recorded data (memberEvents), no timing.
 */
function findCompletingOptionEvent(
  interaction: ComponentInteraction,
): ObservedEvent | undefined {
  const clickEvents = interaction.memberEvents.filter(
    (e) => e.eventType === 'click',
  );
  for (let i = clickEvents.length - 1; i >= 0; i--) {
    const e = clickEvents[i];
    if (isDropdownOption(e.target.ariaRole, e.target.className)) {
      return e;
    }
  }
  return undefined;
}

/**
 * Compile ComponentInteraction[] into an ExecutionIRPlan.
 *
 * This is the Generation Layer's entry point. It takes the recording
 * pipeline's output (ComponentInteraction[]) plus optional enrichment
 * and produces the framework-neutral execution representation consumed
 * by all downstream adapters (Playwright, Cypress, etc.).
 *
 * @param input Encapsulated generation inputs (see GenerationInput)
 * @returns ExecutionIRPlan — the unified execution representation
 */
export function build(input: GenerationInput): ExecutionIRPlan {
  const { interactions, recordingContext, testCaseName, enrichment, elementIdByKey } = input;

  const steps: IRStep[] = [];
  let stepCounter = 0;

  for (const interaction of interactions) {
    // Filter noise interactions
    if (NOISE_TYPES.has(interaction.type)) continue;

    // Look up business label for this interaction (if enriched)
    const businessLabel = enrichment?.businessLabels?.get(interaction.interactionId);

    // 7.4-B2b: IR honesty for INPUT-triggered Dropdowns (readonly combobox
    // family). A Dropdown completed on an INPUT trigger emits two CLICK
    // steps instead of a single non-replayable SELECT — the trigger opens
    // the list, the completing option click selects from it.
    //
    // Today this shape covers the OXD readonly display-input combobox and
    // any INPUT-triggered Dropdown whose completion is a containment-proven
    // option click (dropdown.ts:170-213). A native <select> keeps single
    // SELECT (trigger.tag === 'SELECT' — executeSelect handles it).
    //
    // The completing option event is identified deterministically from
    // recorded data: the last member event whose target is a dropdown
    // option (isDropdownOption on role+class). For INPUT-triggered
    // Dropdowns this always exists — the only completion path for that
    // shape is the containment-proven option click.
    if (
      interaction.type === 'Dropdown' &&
      interaction.trigger.tag === 'INPUT' &&
      interaction.metadata['selectionConfirmed'] === true
    ) {
      const triggerName = businessLabel ?? getElementDisplayName(interaction);

      // Step 1: click the trigger (open the list)
      const triggerTarget = resolveElementTarget(interaction.trigger, elementIdByKey);
      const triggerSourceEventId = interaction.triggerEvent.eventId;
      const triggerAssertions = deriveAssertions(
        triggerTarget.kind === 'element' ? triggerTarget.elementId : '',
        triggerSourceEventId,
        stepCounter,
        enrichment,
      );

      const triggerDesc = `Open the ${triggerName} list`;
      steps.push({
        id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
        order: stepCounter,
        action: IRAction.CLICK,
        description: triggerDesc,
        plainEnglish: triggerDesc.charAt(0).toUpperCase() + triggerDesc.slice(1),
        target: triggerTarget,
        input: null,
        assertions: triggerAssertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        sourceEventId: triggerSourceEventId,
      });
      stepCounter++;

      // Step 2: click the completing option (select the value).
      // The option is the last member event with a dropdown-option target.
      const optionEvent = findCompletingOptionEvent(interaction);
      const selectedValue = (interaction.metadata['selectedValue'] as string) ?? '';
      const optionName = businessLabel
        ? selectedValue
        : (optionEvent?.target.accessibleName
          || optionEvent?.target.ariaLabel
          || selectedValue
          || '');
      const optionTarget = optionEvent
        ? resolveElementTarget(optionEvent.target, elementIdByKey)
        : triggerTarget; // degenerate fallback — never expected in practice
      const optionSourceEventId = optionEvent?.eventId ?? triggerSourceEventId;
      const optionAssertions = deriveAssertions(
        optionTarget.kind === 'element' ? optionTarget.elementId : '',
        optionSourceEventId,
        stepCounter,
        enrichment,
      );

      const optionDesc = `Select ${selectedValue || optionName}`;
      steps.push({
        id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
        order: stepCounter,
        action: IRAction.CLICK,
        description: optionDesc,
        plainEnglish: optionDesc.charAt(0).toUpperCase() + optionDesc.slice(1),
        target: optionTarget,
        input: null,
        assertions: optionAssertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        sourceEventId: optionSourceEventId,
      });
      stepCounter++;
      continue;
    }

    // Determine action
    let action = INTERACTION_TO_IR_ACTION[interaction.type] ?? IRAction.CLICK;

    // 7.4-B5: Modal-dismiss → KEYBOARD_SHORTCUT with NoTarget (page-scoped
    // keypress, no element). Modal-open stays CLICK (replay parity — a
    // human clicks the trigger). The metadata.action distinguishes the two
    // branches within a single Modal type.
    if (interaction.type === 'Modal' && interaction.metadata['action'] === 'dismiss-escape') {
      action = IRAction.KEYBOARD_SHORTCUT;
    }

    // Resolve target
    let target: ResolvedTarget;
    if (action === IRAction.NAVIGATE) {
      const url = (interaction.metadata['pageUrl'] as string) ?? recordingContext.startUrl;
      target = resolveUrlTarget(url);
    } else if (action === IRAction.KEYBOARD_SHORTCUT) {
      // 7.4-B5 B5-2c-3: page-scoped keypress — no element target.
      // NoTarget {kind:'none'} is the domain type for non-element steps.
      // ir-executor-impl.ts skips locator resolution for non-element targets
      // (the navigate precedent at :294 shows the guard shape).
      // R12: this path applies ONLY to KEYBOARD_SHORTCUT steps.
      target = { kind: 'none' } as ResolvedTarget;
    } else {
      target = resolveElementTarget(interaction.trigger, elementIdByKey);
    }

    // Extract input value
    const inputValue = extractInputValue(interaction);

    // Generate description
    const description = generateDescription(interaction, businessLabel);
    const plainEnglish = generatePlainEnglish(interaction, businessLabel);

    // Source event ID
    const sourceEventId = interaction.triggerEvent.eventId;

    // Derive assertions from enrichment (step-scoped by sourceEventId)
    const elementId = target.kind === 'element' ? target.elementId : '';
    const assertions = deriveAssertions(elementId, sourceEventId, stepCounter, enrichment);

    steps.push({
      id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
      order: stepCounter,
      action,
      description,
      target,
      input: inputValue,
      assertions,
      executionParameters: DEFAULT_EXECUTION_PARAMETERS,
      sourceEventId,
      plainEnglish,
    });

    stepCounter++;
  }

  // 7.4-B6: submit-commit order restore — a submit-completed TextEntry is
  // emitted AFTER the submit-control click that caused the commit (the
  // synthetic implicit-submission click precedes the native submit event;
  // a real mouse submit has the same shape). Chronological replay needs
  // FILL before the CLICK that submits, else the fill lands on a page the
  // submission already destroyed. Purely recorded-data join (formJoinKey
  // metadata + submit-control shape); no clocks, no DOM.
  restoreSubmitFillOrder(steps, interactions);

  // Apply readability rules (merge duplicates, re-number)
  const finalSteps = applyReadabilityRules(steps);

  // Derive tags
  const tags = deriveTags(recordingContext, enrichment);

  // Build environment (D9: honest baseUrl origin, preserved startUrl,
  // captured viewport with documented fallback, browser invariant).
  const environment: IREnvironment = {
    baseUrl: baseUrlFor(recordingContext.startUrl),
    startUrl: recordingContext.startUrl,
    browser: RECORDING_BROWSER,
    viewport: recordingContext.viewport ?? FALLBACK_VIEWPORT,
  };

  // D9: deterministic IDs derived from the plan's semantic identity
  // (INV-GEN-1). Same recording → same tc-/tcv- pair, so replays
  // correlate in ExecutionRun history.
  const identity = `${testCaseName}|${recordingContext.startUrl}|${fingerprintSteps(finalSteps)}`;
  const identityHash = hashIdentity(identity);

  return {
    testCaseId: `tc-${identityHash}`,
    testCaseVersionId: `tcv-${identityHash}`,
    testCaseVersionNumber: 1,
    title: testCaseName,
    tags,
    environment,
    steps: finalSteps,
  };
}
