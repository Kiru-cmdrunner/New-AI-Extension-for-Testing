/**
 * Element Target Resolver — resolves session elements to IR targets using
 * full identity recovery from the source session's rawInteractions + R4 matching.
 *
 * Design: .drytis/specs/p2-capability-derived-ir-generation.md §4.2-4.3
 *
 * Pipeline:
 *   1. Recover full 18-field ElementIdentity from rawInteractions (or rawEvents).
 *   2. Build UiElement with full identity + ancestorRoles.
 *   3. Call matchElements() against stored Elements from the Repository.
 *   4. MATCHED → resolveElementTarget(element) → ElementTarget.
 *   5. AMBIGUOUS → NoTarget + warning. Never guesses.
 *   6. UNMATCHED → NoTarget + warning. Never assumes.
 *
 * INV-P2-1: Never calls createElement, healElement, or updateElement.
 * INV-P2-2: Never guesses AMBIGUOUS targets.
 * INV-P2-3: Never guesses UNMATCHED targets.
 * INV-P2-11: Never falls back to reduced-identity matching.
 * INV-P2-12: Never falls back to accessibleName-only matching.
 */

import type { RecordingSession } from '../entities/recording-session';
import type { UiElementSummary } from '../entities/application-knowledge';
import type { UiElement } from '../entities/ui-element';
import { createUiElement } from '../entities/ui-element';
import type { Element } from '../entities/element';
import type { ElementIdentity } from '../../shared/types';
import type { ComponentInteraction } from '../../shared/component-types';
import type { ResolvedTarget } from '../execution-ir/types';
import { resolveElementTarget } from '../execution-ir/generator';
import { matchElements } from '../../repository/services/element-matching-service';
import type { ResolutionWarning } from './p2-types';

// ── Indexed Lookup ───────────────────────────────────────────

/**
 * Build an index from session elementId → ComponentInteraction.
 *
 * This is built once per generation and reused for all field lookups,
 * avoiding repeated scans of rawInteractions.
 */
export function buildInteractionIndex(
  session: RecordingSession,
): Map<string, ComponentInteraction> {
  const index = new Map<string, ComponentInteraction>();
  for (const interaction of session.rawInteractions) {
    const elementId = interaction.trigger?.elementId;
    if (elementId && !index.has(elementId)) {
      // First occurrence wins (preserves temporal order)
      index.set(elementId, interaction);
    }
  }
  return index;
}

/**
 * Build a fallback index from session elementId → ElementIdentity (from rawEvents).
 * rawEvents carry full ElementIdentity but no domContext → no ancestorRoles.
 */
export function buildEventIdentityIndex(
  session: RecordingSession,
): Map<string, ElementIdentity> {
  const index = new Map<string, ElementIdentity>();
  for (const event of session.rawEvents ?? []) {
    if ('elementIdentity' in event && event.elementIdentity) {
      const elementId = event.elementIdentity.elementId;
      if (elementId && !index.has(elementId)) {
        index.set(elementId, event.elementIdentity);
      }
    }
  }
  return index;
}

// ── Identity Recovery ────────────────────────────────────────

export interface RecoveredIdentity {
  readonly identity: ElementIdentity;
  readonly ancestorRoles: string[] | null;
}

/**
 * Recover the full 18-field ElementIdentity for a session element.
 *
 * Primary: rawInteractions index → full ElementIdentity + domContext.ancestorRoles.
 * Fallback: rawEvents index → full ElementIdentity, ancestorRoles = null.
 *
 * Returns null if neither source contains the elementId.
 * Caller MUST treat null as unresolved — never fall back to reduced-identity matching.
 */
export function recoverFullIdentity(
  sessionElementId: string,
  interactionIndex: Map<string, ComponentInteraction>,
  eventIdentityIndex: Map<string, ElementIdentity>,
): RecoveredIdentity | null {
  // Primary: rawInteractions (richest source)
  const interaction = interactionIndex.get(sessionElementId);
  if (interaction?.trigger) {
    const ancestorRoles =
      interaction.triggerEvent?.domContext?.ancestorRoles ?? null;
    return {
      identity: interaction.trigger,
      ancestorRoles: ancestorRoles.length > 0 ? ancestorRoles : null,
    };
  }

  // Fallback: rawEvents (full identity, no ancestorRoles)
  const eventIdentity = eventIdentityIndex.get(sessionElementId);
  if (eventIdentity) {
    return {
      identity: eventIdentity,
      ancestorRoles: null,
    };
  }

  return null;
}

/**
 * Build a UiElement with full recovered identity for matchElements().
 *
 * Uses UiElementSummary only for sourceUrl — all identity fields come
 * from recoverFullIdentity().
 *
 * Returns null if full identity cannot be recovered.
 */
export function buildMatchableUiElement(
  sessionElementId: string,
  summary: UiElementSummary | null,
  recovered: RecoveredIdentity | null,
): UiElement | null {
  if (!recovered) return null;

  const sourceUrl = summary?.sourceUrl ?? '/unknown';

  return createUiElement({
    elementId: sessionElementId,
    identity: recovered.identity,
    sourceUrl,
    domTreePath: '',
    ancestorRoles: recovered.ancestorRoles ?? undefined,
  });
}

// ── Target Resolution ────────────────────────────────────────

export interface TargetResolutionResult {
  readonly targets: Map<string, ResolvedTarget>;
  readonly warnings: ResolutionWarning[];
  readonly resolvedFields: Array<{ field: string; elementId: string; matchScore: number }>;
}

/**
 * Resolve field bindings to IR targets using full identity recovery + R4 matching.
 *
 * @param bindings Map of field → { elementId, summary }
 * @param interactionIndex Pre-built index for O(1) identity lookup
 * @param eventIdentityIndex Pre-built fallback index
 * @param storedElements Elements from the Repository
 */
export function resolveTargets(
  bindings: Map<string, { elementId: string; summary: UiElementSummary | null }>,
  interactionIndex: Map<string, ComponentInteraction>,
  eventIdentityIndex: Map<string, ElementIdentity>,
  storedElements: readonly Element[],
): TargetResolutionResult {
  const targets = new Map<string, ResolvedTarget>();
  const warnings: ResolutionWarning[] = [];
  const resolvedFields: Array<{ field: string; elementId: string; matchScore: number }> = [];

  for (const [field, binding] of bindings) {
    const { elementId, summary } = binding;

    // Step 1: Recover full identity
    const recovered = recoverFullIdentity(elementId, interactionIndex, eventIdentityIndex);
    if (!recovered) {
      targets.set(field, { kind: 'none' });
      warnings.push({
        field,
        reason: 'no-originating-interaction',
        message: `Cannot recover identity for element "${elementId}" — not found in rawInteractions or rawEvents`,
      });
      continue;
    }

    // Step 2: Build matchable UiElement
    const freshUiElement = buildMatchableUiElement(elementId, summary, recovered);
    if (!freshUiElement) {
      targets.set(field, { kind: 'none' });
      warnings.push({
        field,
        reason: 'no-originating-interaction',
        message: `Failed to build UiElement for element "${elementId}"`,
      });
      continue;
    }

    // Step 3: R4 matching
    const matchResult = matchElements([freshUiElement], storedElements);

    // Step 4: Handle MATCHED
    if (matchResult.matched.length === 1) {
      const match = matchResult.matched[0];
      const elementTarget = resolveElementTarget(match.storedElement);
      targets.set(field, elementTarget);
      resolvedFields.push({
        field,
        elementId: match.storedElement.id,
        matchScore: match.matchScore,
      });
      continue;
    }

    // Step 5: Handle AMBIGUOUS — never guess
    if (matchResult.ambiguous.length === 1) {
      const amb = matchResult.ambiguous[0];
      targets.set(field, { kind: 'none' });
      warnings.push({
        field,
        reason: 'ambiguous',
        message: `Multiple Elements match "${field}" — cannot distinguish safely`,
        candidates: amb.candidates.map((c) => ({
          elementId: c.storedElement.id,
          matchScore: c.matchScore,
        })),
      });
      continue;
    }

    // Step 6: Handle UNMATCHED — never assume
    targets.set(field, { kind: 'none' });
    warnings.push({
      field,
      reason: 'unmatched',
      message: `No stored Element matches "${field}" above threshold`,
    });
  }

  return { targets, warnings, resolvedFields };
}

/**
 * Resolve a single target by accessibleName label (for success criteria).
 *
 * Uses the same full identity recovery + matchElements pipeline.
 */
export function resolveTargetByLabel(
  label: string,
  _sourceUrl: string | null,
  interactionIndex: Map<string, ComponentInteraction>,
  eventIdentityIndex: Map<string, ElementIdentity>,
  storedElements: readonly Element[],
): { target: ResolvedTarget; warning: ResolutionWarning | null; matchScore: number | null } {
  // Find the element in interaction index by accessibleName
  for (const [elementId, interaction] of interactionIndex) {
    if (interaction.trigger?.accessibleName === label) {
      const recovered = recoverFullIdentity(elementId, interactionIndex, eventIdentityIndex);
      // When resolving by label, we don't have a UiElementSummary; use a
      // placeholder sourceUrl. PAGE_SCOPE is only 5% weight; accessibleName +
      // other identity fields carry the matching signal.
      const placeholderSummary = { sourceUrl: '/unknown' } as UiElementSummary;
      const freshUiElement = buildMatchableUiElement(elementId, placeholderSummary, recovered);
      if (freshUiElement) {
        const result = matchElements([freshUiElement], storedElements);
        if (result.matched.length === 1) {
          return {
            target: resolveElementTarget(result.matched[0].storedElement),
            warning: null,
            matchScore: result.matched[0].matchScore,
          };
        }
        if (result.ambiguous.length === 1) {
          return {
            target: { kind: 'none' },
            warning: {
              field: label,
              reason: 'ambiguous',
              message: `Multiple Elements match "${label}" — ambiguous`,
            },
            matchScore: null,
          };
        }
      }
    }
  }

  return {
    target: { kind: 'none' },
    warning: {
      field: label,
      reason: 'unmatched',
      message: `No Element found for "${label}"`,
    },
    matchScore: null,
  };
}
