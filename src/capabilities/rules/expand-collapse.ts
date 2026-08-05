/**
 * ExpandCollapse Capability Rule
 *
 * Classifies interactions where the user expanded or collapsed content in place.
 *
 * Required: expand-collapse SemanticEffect present (aria-expanded or
 *           details open attribute changed). Direct-property M2 signal.
 *
 * Supporting:
 *   - Keyword: "show", "hide", "more", "less", "details", "expand", "collapse"
 *   - Physical type: Click or Link (most expand/collapse are buttons or links)
 *   - Direct property basis (noise-immune)
 *
 * Confidence:
 *   HIGH:   required met + 2+ supporting (≥1 non-keyword)
 *   MEDIUM: required met + 1 supporting, OR direct-property only
 *   LOW:    required met + 0 supporting
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 2, §3)
 */

import type { CapabilityRule } from '../capability-rule';
import type { CapabilityClaim } from '../capability-types';
import type { ExtractedEvidence } from '../evidence-extractor';

export class ExpandCollapseRule implements CapabilityRule {
  readonly capability = 'ExpandCollapse' as const;
  readonly priority = 20; // specific — physical + behavioral evidence

  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null {
    // ── Required: expand-collapse effect present ──────────────────────
    if (!evidence.behavioral.hasExpandCollapse) {
      return null;
    }

    // ── Supporting signals ────────────────────────────────────────────
    const streams = new Set<'keyword' | 'physical-type' | 'behavioral' | 'structural' | 'sequence'>();
    let supportingCount = 0;

    // S1: Direct property evidence (behavioral stream)
    if (evidence.behavioral.hasDirectPropertyEvidence) {
      streams.add('behavioral');
      supportingCount++;
    }

    // S2: Keyword match for expand/collapse terms (keyword stream)
    const hasExpandKeyword = evidence.keywords.matches.some((m) =>
      m.matched.some((kw) =>
        ['show', 'hide', 'more', 'less', 'details', 'expand', 'collapse'].includes(
          kw.toLowerCase(),
        ),
      ),
    );
    if (hasExpandKeyword) {
      streams.add('keyword');
      supportingCount++;
    }

    // S3: Physical type Click or Link (common for accordion/button triggers)
    if (
      evidence.physical.interactionType === 'Click' ||
      evidence.physical.interactionType === 'Link'
    ) {
      streams.add('physical-type');
      supportingCount++;
    }

    // ── Confidence ────────────────────────────────────────────────────
    const hasDirectProperty = evidence.behavioral.hasDirectPropertyEvidence;
    const nonKeywordSupporting = supportingCount - (hasExpandKeyword ? 1 : 0);

    let confidence: CapabilityClaim['confidence'];
    if (nonKeywordSupporting >= 2) {
      confidence = 'high';
    } else if (nonKeywordSupporting >= 1) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return {
      capability: this.capability,
      confidence,
      priority: this.priority,
      supportingSignalCount: supportingCount,
      signalStreams: streams,
      hasDirectProperty,
      parameters: {
        target: evidence.physical.accessibleName || undefined,
      },
      reason: `expand-collapse effect present (${evidence.behavioral.effects
        .filter((e) => e.category === 'expand-collapse')
        .map((e) => e.description)
        .join('; ')})`,
    };
  }
}
