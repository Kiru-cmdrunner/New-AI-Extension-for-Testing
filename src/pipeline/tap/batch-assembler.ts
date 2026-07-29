/**
 * Batch Assembler — Phase 3
 *
 * Assembles an EvidenceBatch (Phase 1 type) from a resolved DOM event,
 * its target identity, value snapshot, and collected evidence records.
 *
 * This is where the EventTap's collected data is structured into the
 * atomic unit of the pipeline.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceBatch } from '../../types/evidence';
import type { EvidenceRecord } from '../../types/foundation';
import type { TargetElementIdentity, TargetDomContext, SurfaceInfo } from '../../types/element';

/**
 * Input to the batch assembler.
 */
export interface BatchAssemblyInput {
  /** Sequential batch ID. */
  batchId: string;
  /** ISO timestamp of the event. */
  timestamp: string;
  /** The resolved target element identity. */
  target: TargetElementIdentity;
  /** The DOM event type (click, focus, input, etc.). */
  eventType: string;
  /** Evidence records collected from all channels. */
  evidence: EvidenceRecord[];
  /** Current page URL. */
  pageUrl: string;
  /** Whether element is in Shadow DOM. */
  inShadowDom: boolean;
  /** Whether element is in iframe. */
  inIframe: boolean;
  /** Value before the event (if tracked). */
  valueBefore: string | null;
  /** Value after the event (if tracked). */
  valueAfter: string | null;
  /** Checked state before the event (if tracked). */
  checkedBefore: boolean | null;
  /** Checked state after the event (if tracked). */
  checkedAfter: boolean | null;
  /** Detected surfaces (from Channel D). */
  surfaces?: SurfaceInfo[];
}

/**
 * Assemble an EvidenceBatch from collected data.
 *
 * Creates the TargetDomContext from the value snapshot and surfaces,
 * then combines everything into the EvidenceBatch structure.
 */
export function assembleBatch(input: BatchAssemblyInput): EvidenceBatch {
  // Build TargetDomContext
  const domContext = buildDomContext(input);

  return {
    id: input.batchId,
    startedAt: input.timestamp,
    endedAt: input.timestamp,
    target: input.target,
    domContext,
    evidence: input.evidence,
    eventSequence: [input.eventType],
    status: 'pending',
    correlationGroup: null,
    pageUrl: input.pageUrl,
  };
}

/**
 * Build a TargetDomContext from the assembly input.
 */
function buildDomContext(input: BatchAssemblyInput): TargetDomContext {
  // Value transition
  const valueTransition = (input.valueBefore !== null || input.valueAfter !== null)
    ? { before: input.valueBefore ?? '', after: input.valueAfter ?? '' }
    : null;

  // Checked transition
  let checkedTransition = null;
  if (input.checkedBefore !== null && input.checkedAfter !== null) {
    checkedTransition = {
      before: input.checkedBefore,
      after: input.checkedAfter,
      property: determineCheckedProperty(input.target) as 'checked' | 'aria-checked' | 'aria-pressed' | 'aria-selected',
    };
  }

  return {
    surfaces: input.surfaces ?? [],
    valueTransition,
    checkedTransition,
    ancestorChain: [], // populated by Channel B evidence
    datePicker: null,
    fileUpload: null,
    dialog: null,
    navigation: null,
  };
}

/**
 * Determine which checked property is relevant for the element.
 */
function determineCheckedProperty(target: TargetElementIdentity): string {
  if (target.ariaPressed !== null) return 'aria-pressed';
  if (target.ariaSelected !== null) return 'aria-selected';
  if (target.ariaChecked !== null) return 'aria-checked';
  return 'checked';
}

/**
 * Generate a sequential batch ID.
 */
let batchCounter = 0;
export function nextBatchId(): string {
  batchCounter++;
  return `batch-${String(batchCounter).padStart(4, '0')}`;
}

/**
 * Reset the batch counter (for testing).
 */
export function resetBatchCounter(): void {
  batchCounter = 0;
}
