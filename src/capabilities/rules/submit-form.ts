/**
 * SubmitForm Capability Rule
 *
 * Classifies interactions where the user submitted form data to the application.
 *
 * Required (ALL must hold):
 *   1. Click interaction on a submit-type element:
 *        a. input[type=submit], button[type=submit], OR
 *        b. Keyword match for submit terms ("submit", "sign in", "login",
 *           "register", "save", "apply", "send", "confirm", "book",
 *           "checkout", "place order")
 *   2. Preceded by TextEntry on the same page (same-form detection).
 *      A submit button clicked without any preceding text entry is NOT a form
 *      submission — it's just a button click.
 *
 * Supporting:
 *   - Keyword: "submit", "sign in", "login", "register", "save", "apply"
 *     (keyword stream)
 *   - URL changed after submit (navigation follows form submission) (sequence stream)
 *   - isSubmitType from DOM properties (physical-type stream)
 *   - Error message appeared after submit (behavioral stream)
 *
 * Confidence:
 *   HIGH:   keyword + 1+ non-keyword supporting, OR 2+ non-keyword supporting
 *   MEDIUM: 1 non-keyword supporting, OR keyword only
 *   LOW:    unreachable (required signals provide at least 1 keyword or submit type)
 *
 * Amazon "Add to Cart": Click, no preceding TextEntry → null (correct)
 * Avis Ford "Search" button after form fields → SubmitForm HIGH
 * Login form "Sign In" button after username/password → SubmitForm HIGH
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 5)
 */

import type { CapabilityRule } from '../capability-rule';
import type { CapabilityClaim } from '../capability-types';
import type { ExtractedEvidence } from '../evidence-extractor';

export class SubmitFormRule implements CapabilityRule {
  readonly capability = 'SubmitForm' as const;
  readonly priority = 25; // specific: requires physical + sequence evidence

  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null {
    // ── Required 1: Click on submit-type element OR keyword match ─────
    const submitKeywordMatch = evidence.keywords.matches.find(
      (m) => m.capability === 'SubmitForm',
    );
    const hasSubmitEvidence = evidence.physical.isSubmitType || submitKeywordMatch !== undefined;

    if (!hasSubmitEvidence) {
      return null;
    }

    // Must be a Click interaction (not TextEntry, Slider, etc.)
    if (evidence.physical.interactionType !== 'Click') {
      return null;
    }

    // ── Required 2: preceded by any form interaction on same page ─────
    // F5 fix: was precededByTextEntryOnSameForm (only TextEntry counts).
    // Now uses precededByFormInteraction which includes TextEntry, Dropdown,
    // Checkbox, and Slider. This handles forms filled entirely with
    // dropdowns (Avis Ford Make/Model/Condition → Search).
    if (!evidence.sequence.precededByFormInteraction) {
      return null;
    }

    // ── Supporting signals ────────────────────────────────────────────
    const streams = new Set<'keyword' | 'physical-type' | 'behavioral' | 'structural' | 'sequence'>();
    let supportingCount = 0;
    let keywordCount = 0;

    // S1: Keyword match for submit-related terms
    if (submitKeywordMatch) {
      streams.add('keyword');
      supportingCount++;
      keywordCount++;
    }

    // S2: isSubmitType from DOM properties (physical-type stream)
    if (evidence.physical.isSubmitType) {
      streams.add('physical-type');
      supportingCount++;
    }

    // S3: URL changed after submission (sequence stream)
    if (evidence.sequence.urlChangedAfter) {
      streams.add('sequence');
      supportingCount++;
    }

    // S4: Behavioral evidence — error message or other content-change following submit
    if (evidence.behavioral.hasContentChange || evidence.behavioral.hasVisibilityChange) {
      streams.add('behavioral');
      supportingCount++;
    }

    // ── Confidence ────────────────────────────────────────────────────
    const nonKeywordSupporting = supportingCount - keywordCount;
    let confidence: CapabilityClaim['confidence'];

    if ((keywordCount >= 1 && nonKeywordSupporting >= 1) || nonKeywordSupporting >= 2) {
      confidence = 'high';
    } else {
      // Exactly 1 supporting signal
      confidence = 'medium';
    }

    return {
      capability: this.capability,
      confidence,
      priority: this.priority,
      supportingSignalCount: supportingCount,
      signalStreams: streams,
      hasDirectProperty: false,
      parameters: {
        target: evidence.physical.accessibleName || undefined,
      },
      reason: `form submission: submit-type element + preceded by TextEntry${submitKeywordMatch ? ` (keyword: ${submitKeywordMatch.matched.join(', ')})` : ''}${evidence.sequence.urlChangedAfter ? ' (navigation followed)' : ''}`,
    };
  }
}
