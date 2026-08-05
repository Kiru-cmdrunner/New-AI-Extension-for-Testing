/**
 * UploadFile Capability Rule
 *
 * Classifies interactions where the user provided a file to the application.
 *
 * Required: FileUpload physical type. This is definitive — the component runtime
 *           only recognizes <input type="file"> as FileUpload. No behavioral
 *           evidence is needed because the physical type itself is the signal.
 *
 * Supporting:
 *   - Keyword: "upload", "choose", "browse" in label/ancestors
 *   - Structural: ancestor is a form element
 *
 * Confidence: HIGH always — physical type is definitive. File inputs have
 *             no ambiguity in the HTML spec.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 2, §3)
 */

import type { CapabilityRule } from '../capability-rule';
import type { CapabilityClaim } from '../capability-types';
import type { ExtractedEvidence } from '../evidence-extractor';

export class UploadFileRule implements CapabilityRule {
  readonly capability = 'UploadFile' as const;
  readonly priority = 10; // most specific — definitive physical type

  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null {
    // ── Required: FileUpload physical type ────────────────────────────
    if (!evidence.physical.isFileInput) {
      return null;
    }

    // ── Supporting signals ────────────────────────────────────────────
    const streams = new Set<'keyword' | 'physical-type' | 'behavioral' | 'structural' | 'sequence'>();
    let supportingCount = 0;

    // S1: Keyword match for upload terms (keyword stream)
    const hasUploadKeyword = evidence.keywords.matches.some((m) =>
      m.matched.some((kw) =>
        ['upload', 'choose', 'browse', 'attach', 'file'].includes(kw.toLowerCase()),
      ),
    );
    if (hasUploadKeyword) {
      streams.add('keyword');
      supportingCount++;
    }

    // S2: Ancestor is a form element (structural stream)
    const hasFormAncestor =
      evidence.physical.ancestorRoles.includes('form') ||
      evidence.physical.ancestorRoles.includes('group');
    if (hasFormAncestor) {
      streams.add('structural');
      supportingCount++;
    }

    // S3: The physical type itself is the strongest signal
    streams.add('physical-type');
    supportingCount++;

    // ── Confidence: always HIGH — physical type is definitive ──────────
    return {
      capability: this.capability,
      confidence: 'high',
      priority: this.priority,
      supportingSignalCount: supportingCount,
      signalStreams: streams,
      hasDirectProperty: false, // no M2 direct property for file uploads
      parameters: {
        target: evidence.physical.accessibleName || undefined,
      },
      reason: 'FileUpload physical type (definitive)',
    };
  }
}
