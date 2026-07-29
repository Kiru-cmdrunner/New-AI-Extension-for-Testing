/**
 * Lifecycle Engine — Phase 5
 *
 * Generic state machine interpreter for declarative LifecycleDefinitions.
 *
 * Processing order per recognition result:
 * 1. Navigation → flush all active lifecycles
 * 2. Stale cleanup → cancel expired lifecycles
 * 3. Process against active lifecycles (commit check)
 * 4. Outside-click cancellation for active lifecycles
 * 5. Activation check for new lifecycles
 * 6. Immediate pass-through for click/toggle/navigate/scroll
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { RecognitionResult, RecognisedInteraction } from '../../types/recognition';
import type { EvidenceBatch } from '../../types/evidence';
import type { InteractionVerb, ComponentType } from '../../types/foundation';
import type {
  LifecycleDefinition,
  ActiveLifecycle,
  LifecycleProcessResult,
  SemanticActionOutput,
} from './lifecycle-types';
import { findActivatingDefinition } from './lifecycle-definitions';

const IMMEDIATE_VERBS = new Set<string>([
  'click', 'toggle', 'navigate', 'hover', 'pressKey', 'unknown',
]);

const DROPDOWN_OPTION_ROLES = new Set(['option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem']);
const DROPDOWN_OPTION_TAGS = new Set(['OPTION', 'LI']);
const DATEPICKER_DAY_ROLES = new Set(['gridcell', 'cell']);
const DATEPICKER_TAGS = new Set(['TD']);

/**
 * Check if a click event targets a lifecycle-internal element (e.g. date picker
 * nav buttons: prev/next/switch/today). These should sustain the lifecycle
 * rather than committing or cancelling it.
 */
function isInternalClick(
  lifecycle: ActiveLifecycle,
  batch?: EvidenceBatch,
): boolean {
  if (!lifecycle.definition.internalVerbs || lifecycle.definition.internalVerbs.length === 0) {
    return false;
  }
  if (!batch) return false;
  const accessibleName = batch.target.accessibleName?.toLowerCase() ?? '';
  if (!accessibleName) return false;
  return lifecycle.definition.internalVerbs.some(pattern =>
    accessibleName.includes(pattern.toLowerCase()),
  );
}

function isWithinScope(lifecycle: ActiveLifecycle, batch?: EvidenceBatch): boolean {
  if (!batch) return false;
  const role = (batch.target as any)?.ariaRole as string | null;
  const tag = (batch.target as any)?.tag as string | null;

  switch (lifecycle.definition.id) {
    case 'dropdown-lifecycle':
      return (!!role && DROPDOWN_OPTION_ROLES.has(role)) ||
             (!!tag && DROPDOWN_OPTION_TAGS.has(tag));
    case 'date-picker-lifecycle':
      return (!!role && DATEPICKER_DAY_ROLES.has(role)) ||
             (!!tag && DATEPICKER_TAGS.has(tag));
    default:
      return true;
  }
}

export class LifecycleEngine {
  private active: ActiveLifecycle[] = [];
  private emitted: SemanticActionOutput[] = [];

  processResult(
    result: RecognitionResult,
    batch?: EvidenceBatch,
  ): LifecycleProcessResult {
    const emitted: SemanticActionOutput[] = [];
    const cancelled: string[] = [];

    // 1. Navigation flushes all active lifecycles
    if (result.kind === 'recognised' && result.verb === 'navigate') {
      const flushResult = this.flushAll();
      emitted.push(...flushResult.emitted);
      cancelled.push(...flushResult.cancelled);
      return { emitted, cancelled };
    }

    // 2. Stale cleanup
    this.cleanupStale(new Date(result.timestamp).getTime(), cancelled);

    if (result.kind === 'recognised') {
      const rec = result;

      if (this.active.length > 0) {
        // 2b. Escape key cancellation (before commit check)
        if (rec.verb === 'pressKey') {
          const escapeResult = this.checkEscapeCancellation(rec);
          if (escapeResult.anyCancelled) {
            emitted.push(...escapeResult.emitted);
            cancelled.push(...escapeResult.cancelledIds);
            return { emitted, cancelled };
          }
        }

        // 2c. Scroll burst coalescing — sustain or commit
        if (this.active.some(l => l.definition.id === 'scroll-lifecycle')) {
          const scrollResult = this.handleScrollLifecycle(rec, batch);
          // Always collect emitted/cancelled from scroll handling.
          // When handled=false (non-scroll event commits the scroll),
          // the scroll action is in scrollResult.emitted and the new
          // event must fall through to normal processing.
          emitted.push(...scrollResult.emitted);
          cancelled.push(...scrollResult.cancelled);
          if (scrollResult.handled) {
            return { emitted, cancelled };
          }
        }

        // 3. Check commit against active lifecycles (includes alternatives)
        const activeResult = this.processAgainstActive(rec, batch);
        if (activeResult.handled) {
          emitted.push(...activeResult.emitted);
          cancelled.push(...activeResult.cancelled);
          return { emitted, cancelled };
        }

        // 4. Outside-click cancellation
        if (rec.verb === 'click') {
          const cancelResult = this.checkOutsideClick(rec, batch);
          if (cancelResult.anyCancelled) {
            emitted.push(...cancelResult.emitted);
            cancelled.push(...cancelResult.cancelledIds);
            emitted.push(this.resultToAction(rec));
            return { emitted, cancelled };
          }
        }
      }

      // 5. Try to activate a new lifecycle
      const def = findActivatingDefinition(rec.verb, rec.componentType);
      if (def) {
        const activateResult = this.activateLifecycle(def, rec, batch);
        if (activateResult) emitted.push(activateResult);
        return { emitted, cancelled };
      }
    }

    // 6. Immediate pass-through
    if (result.kind === 'recognised' && IMMEDIATE_VERBS.has(result.verb)) {
      emitted.push(this.resultToAction(result));
    } else if (result.kind === 'unrecognised') {
      emitted.push(this.resultToAction(result));
    }

    return { emitted, cancelled };
  }

  flush(_timestamp: number): LifecycleProcessResult {
    return this.flushAll();
  }

  getEmittedActions(): SemanticActionOutput[] {
    return [...this.emitted];
  }

  getActiveLifecycles(): ActiveLifecycle[] {
    return [...this.active];
  }

  reset(): void {
    this.active = [];
    this.emitted = [];
  }

  // ── Internal ──────────────────────────────────────────────────────────

  /**
   * Handle scroll burst coalescing.
   *
   * If the scroll lifecycle is active:
   *   - Another scroll event within burstGap → sustain (extend timestamp)
   *   - Any non-scroll event → commit the scroll, then process the new event
   */
  private handleScrollLifecycle(
    rec: RecognisedInteraction,
    _batch?: EvidenceBatch,
  ): { handled: boolean; emitted: SemanticActionOutput[]; cancelled: string[] } {
    const emitted: SemanticActionOutput[] = [];
    const cancelled: string[] = [];

    const scrollIdx = this.active.findIndex(l => l.definition.id === 'scroll-lifecycle');
    if (scrollIdx === -1) return { handled: false, emitted, cancelled };

    const scrollLifecycle = this.active[scrollIdx]!;
    const burstGap = scrollLifecycle.definition.burstGapMs ?? 500;
    const timeSinceLast = new Date(rec.timestamp).getTime() - new Date(scrollLifecycle.lastEventAt).getTime();

    if (rec.verb === 'scroll') {
      if (timeSinceLast <= burstGap) {
        // Within burst gap — sustain the scroll lifecycle
        scrollLifecycle.sustainedBy.push(rec.id);
        scrollLifecycle.lastEventAt = rec.timestamp;
        return { handled: true, emitted, cancelled };
      }
      // Burst gap exceeded — commit the old scroll, activate a new one
      scrollLifecycle.phase = 'committed';
      scrollLifecycle.committedBy = rec.id;
      this.active.splice(scrollIdx, 1);
      this.emitAction(scrollLifecycle);
      emitted.push(this.activeToOutput(scrollLifecycle));

      // Activate a new scroll lifecycle
      const newDef = scrollLifecycle.definition;
      const newLifecycle: ActiveLifecycle = {
        definition: newDef,
        phase: 'active',
        activatedBy: rec.id,
        sustainedBy: [],
        committedBy: null,
        startedAt: rec.timestamp,
        lastEventAt: rec.timestamp,
        scopeElementKey: 'scroll',
        value: 'scrolled',
      };
      this.active.push(newLifecycle);
      return { handled: true, emitted, cancelled };
    }

    // Non-scroll event → commit the scroll lifecycle
    scrollLifecycle.phase = 'committed';
    scrollLifecycle.committedBy = rec.id;
    scrollLifecycle.lastEventAt = rec.timestamp;
    this.active.splice(scrollIdx, 1);
    this.emitAction(scrollLifecycle);
    emitted.push(this.activeToOutput(scrollLifecycle));

    // The non-scroll event is NOT handled — let it fall through to normal processing
    return { handled: false, emitted, cancelled };
  }

  private processAgainstActive(
    rec: RecognisedInteraction,
    batch?: EvidenceBatch,
  ): { handled: boolean; emitted: SemanticActionOutput[]; cancelled: string[] } {
    const emitted: SemanticActionOutput[] = [];
    const cancelled: string[] = [];

    for (let i = 0; i < this.active.length; i++) {
      const lifecycle = this.active[i]!;
      const def = lifecycle.definition;
      const commitRule = def.commitOn;

      // Phase 5b: Check for internal clicks (e.g. date picker nav buttons)
      // before checking commit rules. Internal elements sustain the lifecycle.
      if (rec.verb === 'click' && isInternalClick(lifecycle, batch)) {
        lifecycle.sustainedBy.push(rec.id);
        lifecycle.lastEventAt = rec.timestamp;
        return { handled: true, emitted, cancelled };
      }

      const matchesPrimary =
        rec.verb === commitRule.verb &&
        (!commitRule.componentType || rec.componentType === commitRule.componentType);

      // Check alternative commit rules (Phase 5b: date picker multi-mode)
      const matchesAlternative = def.commitOnAlternatives?.some(alt =>
        rec.verb === alt.verb &&
        (!alt.componentType || rec.componentType === alt.componentType),
      ) ?? false;

      if (matchesPrimary || matchesAlternative) {
        // Outside-click scope check applies ONLY to the primary commit
        // rule (e.g. a click on a calendar cell). Alternative commit modes
        // (fill, native select) should always commit regardless of scope —
        // the element is the input itself, not a scoped child.
        if (matchesPrimary && def.cancelOnOutsideClick && !isWithinScope(lifecycle, batch)) {
          // Click matches commit rule but is outside scope → cancel
          lifecycle.phase = 'cancelled';
          cancelled.push(lifecycle.activatedBy);
          if (!def.rejectIfNoProgress || lifecycle.sustainedBy.length > 0) {
            this.emitAction(lifecycle);
            emitted.push(this.activeToOutput(lifecycle));
          }
          this.active.splice(i, 1);
          emitted.push(this.resultToAction(rec));
          return { handled: true, emitted, cancelled };
        }

        // Within scope → commit
        const newValue = this.extractValue(batch);
        if (newValue) lifecycle.value = newValue;

        lifecycle.phase = 'committed';
        lifecycle.committedBy = rec.id;
        lifecycle.lastEventAt = rec.timestamp;
        this.active.splice(i, 1);
        this.emitAction(lifecycle);
        emitted.push(this.activeToOutput(lifecycle));
        return { handled: true, emitted, cancelled };
      }
    }

    return { handled: false, emitted, cancelled };
  }

  /**
   * Check if a pressKey (Escape) event should cancel any active lifecycles
   * that have cancelOnEscape=true.
   *
   * Escape is swallowed — it does not produce a SemanticAction itself.
   */
  private checkEscapeCancellation(
    _rec: RecognisedInteraction,
  ): { anyCancelled: boolean; emitted: SemanticActionOutput[]; cancelledIds: string[] } {
    const emitted: SemanticActionOutput[] = [];
    const cancelledIds: string[] = [];

    for (let i = this.active.length - 1; i >= 0; i--) {
      const lifecycle = this.active[i]!;
      if (!lifecycle.definition.cancelOnEscape) continue;

      lifecycle.phase = 'cancelled';
      cancelledIds.push(lifecycle.activatedBy);

      if (!lifecycle.definition.rejectIfNoProgress || lifecycle.sustainedBy.length > 0) {
        this.emitAction(lifecycle);
        emitted.push(this.activeToOutput(lifecycle));
      }

      this.active.splice(i, 1);
    }

    return { anyCancelled: cancelledIds.length > 0, emitted, cancelledIds };
  }

  private checkOutsideClick(
    rec: RecognisedInteraction,
    batch?: EvidenceBatch,
  ): { anyCancelled: boolean; emitted: SemanticActionOutput[]; cancelledIds: string[] } {
    const emitted: SemanticActionOutput[] = [];
    const cancelledIds: string[] = [];

    for (let i = this.active.length - 1; i >= 0; i--) {
      const lifecycle = this.active[i]!;
      if (!lifecycle.definition.cancelOnOutsideClick) continue;

      if (isWithinScope(lifecycle, batch) || isInternalClick(lifecycle, batch)) {
        // In-scope click that didn't match commitOn → sustain
        lifecycle.sustainedBy.push(rec.id);
        lifecycle.lastEventAt = rec.timestamp;
        continue;
      }

      lifecycle.phase = 'cancelled';
      cancelledIds.push(lifecycle.activatedBy);

      if (!lifecycle.definition.rejectIfNoProgress || lifecycle.sustainedBy.length > 0) {
        this.emitAction(lifecycle);
        emitted.push(this.activeToOutput(lifecycle));
      }

      this.active.splice(i, 1);
    }

    return { anyCancelled: cancelledIds.length > 0, emitted, cancelledIds };
  }

  private activateLifecycle(
    def: LifecycleDefinition,
    rec: RecognisedInteraction,
    batch?: EvidenceBatch,
  ): SemanticActionOutput | null {
    const scopeElementKey = batch?.target.primaryLocator?.value ?? 'unknown';
    const value = this.extractValue(batch);

    const lifecycle: ActiveLifecycle = {
      definition: def,
      phase: 'active',
      activatedBy: rec.id,
      sustainedBy: [],
      committedBy: null,
      startedAt: rec.timestamp,
      lastEventAt: rec.timestamp,
      scopeElementKey,
      value,
    };

    // Self-committing lifecycle (text entry / slider: activateOn === commitOn)
    if (
      def.activateOn.verb === def.commitOn.verb &&
      (!def.activateOn.componentType || !def.commitOn.componentType ||
        def.activateOn.componentType === def.commitOn.componentType)
    ) {
      if (def.rejectIfNoProgress && !value) return null;
      lifecycle.phase = 'committed';
      lifecycle.committedBy = rec.id;
      this.emitAction(lifecycle);
      return this.activeToOutput(lifecycle);
    }

    this.active.push(lifecycle);
    return null;
  }

  private cleanupStale(nowMs: number, cancelled: string[]): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const lifecycle = this.active[i]!;
      const age = nowMs - new Date(lifecycle.lastEventAt).getTime();
      if (age > lifecycle.definition.maxDurationMs) {
        lifecycle.phase = 'cancelled';
        cancelled.push(lifecycle.activatedBy);
        this.active.splice(i, 1);
      }
    }
  }

  private flushAll(): LifecycleProcessResult {
    const emitted: SemanticActionOutput[] = [];
    const cancelled: string[] = [];

    for (const lifecycle of this.active) {
      if (lifecycle.phase === 'committed') continue;

      if (lifecycle.value && lifecycle.value.length > 0) {
        lifecycle.phase = 'committed';
        this.emitAction(lifecycle);
        emitted.push(this.activeToOutput(lifecycle));
      } else if (
        !lifecycle.definition.rejectIfNoProgress ||
        lifecycle.sustainedBy.length > 0
      ) {
        this.emitAction(lifecycle);
        emitted.push(this.activeToOutput(lifecycle));
      } else {
        cancelled.push(lifecycle.activatedBy);
      }
    }

    this.active = [];
    return { emitted, cancelled };
  }

  private emitAction(lifecycle: ActiveLifecycle): void {
    this.emitted.push(this.activeToOutput(lifecycle));
  }

  private activeToOutput(lifecycle: ActiveLifecycle): SemanticActionOutput {
    return {
      definitionId: lifecycle.definition.id,
      verb: lifecycle.definition.actionVerb,
      componentType: lifecycle.definition.componentType,
      sourceResults: [
        lifecycle.activatedBy,
        ...lifecycle.sustainedBy,
        ...(lifecycle.committedBy ? [lifecycle.committedBy] : []),
      ],
      startedAt: lifecycle.startedAt,
      endedAt: lifecycle.lastEventAt,
      value: lifecycle.value,
      committed: lifecycle.phase === 'committed',
    };
  }

  private resultToAction(result: RecognitionResult): SemanticActionOutput {
    const verb: InteractionVerb =
      result.kind === 'recognised' ? result.verb : 'unknown';
    const componentType: ComponentType =
      result.kind === 'recognised' && result.componentType
        ? result.componentType
        : 'Generic';

    return {
      definitionId: 'immediate',
      verb,
      componentType,
      sourceResults: [result.id],
      startedAt: result.timestamp,
      endedAt: result.timestamp,
      value: null,
      committed: true,
    };
  }

  private extractValue(batch?: EvidenceBatch): string | null {
    if (!batch) return null;
    if (batch.domContext.valueTransition?.after) {
      return batch.domContext.valueTransition.after;
    }
    if (batch.target.accessibleName) {
      return batch.target.accessibleName;
    }
    return null;
  }
}

export function processWithLifecycle(
  results: RecognitionResult[],
  batches: Map<string, EvidenceBatch>,
): SemanticActionOutput[] {
  const engine = new LifecycleEngine();
  const allEmitted: SemanticActionOutput[] = [];

  for (const result of results) {
    const batch = batches.get(result.sourceBatches[0] ?? '');
    const pr = engine.processResult(result, batch);
    allEmitted.push(...pr.emitted);
  }

  const lastTs = results.length > 0
    ? new Date(results[results.length - 1]!.timestamp).getTime()
    : Date.now();
  const flushResult = engine.flush(lastTs);
  allEmitted.push(...flushResult.emitted);

  return allEmitted;
}
