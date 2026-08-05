/**
 * Capability Bridge — the single integration point between the recording
 * pipeline and the Capability Engine.
 *
 * Responsibilities:
 *   1. Build the EffectsMap from finalized ComponentInteractions.
 *   2. Instantiate the CapabilityEngine with all registered rules.
 *   3. Run inference and return CapabilityRecord[].
 *   4. Provide a serializable representation for storage / side-panel display.
 *
 * This module is called from the service worker's handleStopRecording()
 * AFTER all behavioral observations are finalized and effects are interpreted.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 6)
 */

import type { ComponentInteraction } from '../shared/component-types';
import type { SemanticEffect } from '../semantics/effect-types';
import type { CapabilityRecord } from './capability-types';
import type { EffectsMap } from './capability-engine';
import { CapabilityEngine } from './capability-engine';

// ── Rule imports ──────────────────────────────────────────────────────
import { ToggleControlRule } from './rules/toggle-control';
import { ExpandCollapseRule } from './rules/expand-collapse';
import { UploadFileRule } from './rules/upload-file';
import { NavigateRule } from './rules/navigate';
import { OpenDetailRule } from './rules/open-detail';
import { PaginateRule } from './rules/paginate';
import { FilterSelectionRule } from './rules/filter-selection';
import { SortSelectionRule } from './rules/sort-selection';
import { SearchRule } from './rules/search';
import { SubmitFormRule } from './rules/submit-form';
import { SelectOptionRule } from './rules/select-option';
import { AdjustValueRule } from './rules/adjust-value';

// ── Factory: create a fully-configured engine ─────────────────────────

/**
 * Create a CapabilityEngine with all 12 capability rules registered.
 * Exported for testing — production code uses runCapabilityInference().
 */
export function createCapabilityEngine(): CapabilityEngine {
  const engine = new CapabilityEngine();

  // Physical-evidence rules (Phase 2)
  engine.registerRule(new ToggleControlRule());
  engine.registerRule(new ExpandCollapseRule());
  engine.registerRule(new UploadFileRule());

  // Navigation rules (Phase 3)
  engine.registerRule(new NavigateRule());
  engine.registerRule(new OpenDetailRule());
  engine.registerRule(new PaginateRule());

  // Content-change rules (Phase 4)
  engine.registerRule(new FilterSelectionRule());
  engine.registerRule(new SortSelectionRule());
  engine.registerRule(new SearchRule());

  // Form/value rules (Phase 5)
  engine.registerRule(new SubmitFormRule());
  engine.registerRule(new SelectOptionRule());
  engine.registerRule(new AdjustValueRule());

  return engine;
}

// ── EffectsMap builder ────────────────────────────────────────────────

/**
 * Build the EffectsMap from finalized ComponentInteractions.
 *
 * For each interaction, collect all SemanticEffects from its
 * behavioralObservations[].semanticEffects[].
 *
 * This runs AFTER stopRecording() finalizes all observations and
 * interpretBehavioralObservations() has populated semanticEffects.
 */
export function buildEffectsMap(interactions: ComponentInteraction[]): EffectsMap {
  const effectsMap: EffectsMap = new Map();

  for (const interaction of interactions) {
    const effects: SemanticEffect[] = [];

    if (interaction.behavioralObservations) {
      for (const obs of interaction.behavioralObservations) {
        if (obs.semanticEffects) {
          effects.push(...obs.semanticEffects);
        }
      }
    }

    effectsMap.set(interaction.interactionId, effects);
  }

  return effectsMap;
}

// ── Main entry point ─────────────────────────────────────────────────

/**
 * Run capability inference on a finalized recording.
 *
 * Called from the service worker's handleStopRecording() after:
 *   1. stopRecording() returns the final ComponentInteraction[]
 *   2. All behavioral observations are attached and interpreted
 *
 * Navigation interactions are excluded as standalone capability targets.
 * They are browser-emitted consequence events (URL change following a Click
 * or Link), not deliberate user actions. However, they remain in the
 * interaction array so they contribute sequence evidence (urlChangedAfter,
 * urlPathChangedAfter) to the preceding user action that caused them.
 *
 * @param interactions - The finalized ComponentInteraction[] from stopRecording()
 * @returns CapabilityRecord[] — one record per non-Navigation interaction, in order
 */
export function runCapabilityInference(
  interactions: ComponentInteraction[],
): CapabilityRecord[] {
  if (interactions.length === 0) {
    return [];
  }

  const effectsMap = buildEffectsMap(interactions);
  const engine = createCapabilityEngine();

  // Run inference on all interactions so sequence context includes Navigation events.
  // Then filter out Navigation records — they are consequence events, not user actions.
  const allRecords = engine.inferCapabilities(interactions, effectsMap);

  // Navigation interactions produce tautological classifications
  // ("a navigation event is Navigate"). Exclude them from capability output.
  // The Navigation interaction still served its purpose: it provided
  // urlChangedAfter / urlPathChangedAfter evidence to the preceding interaction.
  const navigationIds = new Set(
    interactions
      .filter((i) => i.type === 'Navigation')
      .map((i) => i.interactionId),
  );

  return allRecords.filter((r) => !navigationIds.has(r.interactionId));
}

// ── Serialization helper for storage / side panel ─────────────────────

/**
 * A capability record prepared for JSON serialization (storage, side panel).
 * Sets are converted to arrays for JSON compatibility.
 */
export interface SerializableCapabilityRecord {
  capabilityId: string;
  interactionId: string;
  capability: string;
  confidence: string;
  parameters: Record<string, unknown> | undefined;
  evidence: {
    physicalType: string;
    targetLabel: string;
    semanticEffects: string[];
    matchedKeywords: string[];
    structuralContext: string[];
    sequenceNotes: string[];
  };
  alternatives: Array<{
    capability: string;
    confidence: string;
    reason: string;
  }>;
  unclassifiedReason: string | undefined;
}

/**
 * Convert CapabilityRecord[] (which contains Sets) into a JSON-serializable
 * form suitable for chrome.storage.local and side-panel rendering.
 */
export function serializeCapabilityRecords(
  records: CapabilityRecord[],
): SerializableCapabilityRecord[] {
  return records.map((r) => ({
    capabilityId: r.capabilityId,
    interactionId: r.interactionId,
    capability: r.capability,
    confidence: r.confidence,
    parameters: r.parameters,
    evidence: {
      physicalType: r.evidence.physicalType,
      targetLabel: r.evidence.targetLabel,
      semanticEffects: r.evidence.semanticEffects,
      matchedKeywords: r.evidence.matchedKeywords,
      structuralContext: r.evidence.structuralContext,
      sequenceNotes: r.evidence.sequenceNotes,
    },
    alternatives: r.alternatives.map((a) => ({
      capability: a.capability,
      confidence: a.confidence,
      reason: a.reason,
    })),
    unclassifiedReason: r.unclassifiedReason,
  }));
}
