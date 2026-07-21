/**
 * Evidence-Based Interaction Detector (V2)
 *
 * Entry point for the evidence-based interaction detection system.
 * This runs in PARALLEL with the existing detectInteractions() — it does NOT
 * replace it. Both functions accept the same input (RecordedEvent[]) and
 * produce the same output type (DetectedInteraction[]).
 *
 * Usage:
 *   import { detectInteractionsV2 } from './evidence/detector';
 *   const interactions = detectInteractionsV2(events);
 *
 * Architecture:
 *   1. Four providers observe the event stream independently
 *   2. Evidence is buffered per-element
 *   3. Generic commit signals trigger evidence combination
 *   4. Weighted voting determines the final interaction type
 */

import type { DetectedInteraction } from '../interaction-types.ts';
import type { RecordedEvent } from '../../recorder/recorded-event.ts';
import { InteractionEngine } from './engine.ts';
import { DomProvider } from './providers/dom-provider.ts';
import { AriaProvider } from './providers/aria-provider.ts';
import { EventSequenceProvider } from './providers/event-sequence-provider.ts';
import { MutationProvider } from './providers/mutation-provider.ts';
import { CssClassnameProvider } from './providers/css-classname-provider.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Default provider set (5 providers)
// ─────────────────────────────────────────────────────────────────────────────

function createDefaultProviders() {
  return [
    new DomProvider(),
    new AriaProvider(),
    new EventSequenceProvider(),
    new MutationProvider(),
    new CssClassnameProvider(),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect interactions from a raw event stream using the evidence engine.
 *
 * This is the V2 detector — it runs in parallel with the existing
 * detectInteractions() for A/B comparison.
 *
 * @param events - Raw recorded events from the recording session
 * @returns Detected interactions with evidence-based confidence scores
 */
export function detectInteractionsV2(events: RecordedEvent[]): DetectedInteraction[] {
  const engine = new InteractionEngine(createDefaultProviders());
  return engine.detect(events);
}

/**
 * Create a custom engine with a custom provider set.
 * Useful for testing — inject mock providers or test specific combinations.
 */
export function createEngine(
  providers?: import('./types.ts').EvidenceProvider[],
): InteractionEngine {
  return new InteractionEngine(providers ?? createDefaultProviders());
}

// Re-export engine and types for consumers
export { InteractionEngine } from './engine.ts';
export type {
  Evidence,
  EvidenceProvider,
  InteractionBuffer,
  CombinationResult,
  InteractionHypothesis,
} from './types.ts';
export { combineEvidence, COMMIT_THRESHOLD } from './combination.ts';
