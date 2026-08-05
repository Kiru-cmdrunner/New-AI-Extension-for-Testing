/**
 * ToggleControl Capability Rule
 *
 * Classifies interactions where the user toggled a binary on/off state.
 *
 * Required: state-toggle SemanticEffect present (aria-checked, aria-pressed,
 *           or .checked property changed). This is a direct-property M2 signal.
 *
 * Supporting:
 *   - Keyword: "enable", "disable", "on", "off", "toggle" in label/ancestors
 *   - Physical type: Checkbox or RadioButton
 *   - Direct property basis (noise-immune)
 *
 * Confidence:
 *   HIGH:   required met + 2+ supporting (≥1 non-keyword)
 *   MEDIUM: required met + 1 supporting, OR required from direct-property M2
 *   LOW:    required met + 0 supporting
 *
 * Counterexample: "Email notifications" checkbox with remote content-change
 *   → ToggleControl HIGH (direct property) beats FilterSelection LOW.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 2, §3)
 */

import type { CapabilityRule } from '../capability-rule';
import type { CapabilityClaim } from '../capability-types';
import type { ExtractedEvidence } from '../evidence-extractor';

export class ToggleControlRule implements CapabilityRule {
  readonly capability = 'ToggleControl' as const;
  readonly priority = 20; // specific — physical + behavioral evidence

  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null {
    // ── Required: state-toggle effect present ─────────────────────────
    if (!evidence.behavioral.hasStateToggle) {
      return null;
    }

    // ── Supporting signals ────────────────────────────────────────────
    const streams = new Set<CapabilityClaim['signalStreams'] extends Set<infer S> ? S : never>();
    let supportingCount = 0;

    // S1: Direct property evidence (behavioral stream)
    if (evidence.behavioral.hasDirectPropertyEvidence) {
      streams.add('behavioral');
      supportingCount++;
    }

    // S2: Checkbox/RadioButton physical type (physical-type stream)
    if (evidence.physical.isCheckboxLike) {
      streams.add('physical-type');
      supportingCount++;
    }

    // S3: Keyword match for toggle-related terms (keyword stream)
    const toggleKeywordMatch = evidence.keywords.matches.find(
      (m) => m.capability === 'ToggleControl',
    );
    // Note: ToggleControl isn't in the V1 keyword dictionary, so check
    // for toggle-related keywords in matched keywords generally.
    const hasToggleKeyword =
      toggleKeywordMatch !== undefined ||
      evidence.keywords.matches.some((m) =>
        m.matched.some((kw) =>
          ['enable', 'disable', 'on', 'off', 'toggle'].includes(kw.toLowerCase()),
        ),
      );
    if (hasToggleKeyword) {
      streams.add('keyword');
      supportingCount++;
    }

    // ── Confidence ────────────────────────────────────────────────────
    // state-toggle from M2 is always HIGH + direct-property. The capability
    // confidence follows:
    //   - direct-property present → starts at MEDIUM
    //   - + another non-keyword supporting (physical type) → HIGH
    //   - + only keyword → still MEDIUM (keyword never above supporting alone)
    const hasDirectProperty = evidence.behavioral.hasDirectPropertyEvidence;
    const nonKeywordSupporting = supportingCount - (hasToggleKeyword ? 1 : 0);

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
      reason: `state-toggle effect present (${evidence.behavioral.effects
        .filter((e) => e.category === 'state-toggle')
        .map((e) => e.description)
        .join('; ')})`,
    };
  }
}
