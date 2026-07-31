/**
 * Evidence generators for the intent classification engine.
 *
 * Each generator reads the FeatureViewInput and produces evidence votes.
 * Generators are independent — none reads another generator's output.
 * All generators are registered in the EVIDENCE_GENERATORS array.
 *
 * Weight calibration principles:
 *   - Standards-based signals (aria-checked, role=checkbox) are strong: 0.7–0.9
 *   - Behavioral signals (checked transition) are strong: 0.5–0.7
 *   - Structural signals (surface, className) are weak supplementary: 0.1–0.25
 *   - Negative evidence (suppressing an intent) caps at -0.3 — it shouldn't
 *     overwhelm a strong positive signal, but helps disambiguate when signals
 *     are evenly matched.
 */

import type { EvidenceGenerator, IntentVote, FeatureViewInput } from './types';

// ── ARIA Evidence ────────────────────────────────────────────────────────

/**
 * ARIA attributes are the strongest semantic signal. When present, they're
 * authoritative — the developer explicitly declared the element's semantics.
 */
export const ariaEvidence: EvidenceGenerator = {
  id: 'aria',
  generate(f: FeatureViewInput): IntentVote[] {
    const evidence: IntentVote[] = [];

    // aria-checked (or role=checkbox from the recorder's getImplicitRole)
    // strongly indicates toggle intent
    if (f.hasAriaChecked) {
      evidence.push({
        intent: 'toggle',
        weight: 0.8,
        source: 'aria-checked',
        reason: 'Element has checkbox role or aria-checked attribute',
      });
    }

    // aria-pressed on a button indicates toggle intent (toggle button)
    if (f.hasAriaPressed) {
      evidence.push({
        intent: 'toggle',
        weight: 0.7,
        source: 'aria-pressed',
        reason: 'Button element has pressed/checked state',
      });
    }

    return evidence;
  },
};

// ── Behavioral Evidence ──────────────────────────────────────────────────

/**
 * Behavioral signals come from what actually happened during the interaction.
 * A checked-state transition is strong evidence of toggle intent because it
 * means the element's state flipped — something that happens with checkboxes
 * and toggles, not with navigation links.
 */
export const behavioralEvidence: EvidenceGenerator = {
  id: 'behavioral',
  generate(f: FeatureViewInput): IntentVote[] {
    const evidence: IntentVote[] = [];

    // If the recorder captured a checked-state transition (checkedBefore or
    // checkedAfter non-null), the element has toggle semantics.
    if (f.hasCheckedTransition) {
      evidence.push({
        intent: 'toggle',
        weight: 0.6,
        source: 'checked-transition',
        reason: 'Click captured a checked-state change',
      });
    }

    return evidence;
  },
};

// ── Tag/Role Evidence ────────────────────────────────────────────────────

/**
 * Tag-based signals. These are necessary but NOT sufficient — an <a> tag
 * can be a filter toggle (Amazon) or a navigation link (most sites). The
 * weight is intentionally moderate so it can be overridden by stronger
 * semantic or behavioral signals.
 */
export const tagEvidence: EvidenceGenerator = {
  id: 'tag',
  generate(f: FeatureViewInput): IntentVote[] {
    const evidence: IntentVote[] = [];

    // <a> tags suggest navigation — but only moderately, since they can be
    // filter toggles, tabs, or other custom controls
    if (f.isLink) {
      evidence.push({
        intent: 'navigate',
        weight: 0.4,
        source: 'tag-anchor',
        reason: 'Element is an <a> tag or has link role',
      });
    }

    // Native checkbox/radio inputs are strong toggle/select signals
    if (f.tag === 'INPUT') {
      if (f.ariaRole === 'checkbox') {
        evidence.push({
          intent: 'toggle',
          weight: 0.9,
          source: 'native-checkbox',
          reason: 'Native <input type="checkbox">',
        });
      }
    }

    return evidence;
  },
};

// ── Structural Evidence ──────────────────────────────────────────────────

/**
 * Structural signals from DOM context. These are weak individually but help
 * disambiguate. A link in a sidebar/filter panel is more likely a toggle
 * than a navigation link.
 */
export const structuralEvidence: EvidenceGenerator = {
  id: 'structural',
  generate(f: FeatureViewInput): IntentVote[] {
    const evidence: IntentVote[] = [];

    // CSS class containing checkbox/filter/navigation-item patterns
    // These are weak signals — site-specific class names aren't reliable
    // on their own, but they supplement stronger signals
    if (f.classNameLower) {
      const cls = f.classNameLower;
      if (cls.includes('checkbox') || cls.includes('navigation-item') || cls.includes('filter-item')) {
        evidence.push({
          intent: 'toggle',
          weight: 0.2,
          source: 'class-checkbox',
          reason: 'Element CSS class suggests checkbox/filter pattern',
        });
        // Also suppress navigate — if it looks like a checkbox, navigation is less likely
        if (f.isLink) {
          evidence.push({
            intent: 'navigate',
            weight: -0.2,
            source: 'class-checkbox',
            reason: 'Checkbox-like CSS class suppresses navigation intent',
          });
        }
      }
    }

    // Ancestor roles: elements inside a group/list/region in a sidebar
    // context suggest form/filter interactions
    if (f.ancestorRoles.length > 0) {
      const ancestorStr = f.ancestorRoles.join(' ');
      // Check for list/region ancestors that commonly contain filter controls
      if (ancestorStr.includes('list') || ancestorStr.includes('group')) {
        // Very weak signal — just a nudge
        if (f.isLink && f.hasCheckedTransition) {
          evidence.push({
            intent: 'toggle',
            weight: 0.1,
            source: 'ancestor-list',
            reason: 'Element is inside a list/group (filter context)',
          });
        }
      }
    }

    return evidence;
  },
};

// ── Navigation Evidence ──────────────────────────────────────────────────

/**
 * Signals that indicate the element opens new tabs/windows. These are
 * definitive navigation signals.
 */
export const navigationEvidence: EvidenceGenerator = {
  id: 'navigation',
  generate(f: FeatureViewInput): IntentVote[] {
    const evidence: IntentVote[] = [];

    if (f.opensNewTab) {
      evidence.push({
        intent: 'navigate',
        weight: 0.7,
        source: 'opens-new-tab',
        reason: 'Element opens a new browser tab',
      });
    }

    if (f.opensNewWindow) {
      evidence.push({
        intent: 'navigate',
        weight: 0.7,
        source: 'opens-new-window',
        reason: 'Element opens a new browser window',
      });
    }

    return evidence;
  },
};

// ── Registry ─────────────────────────────────────────────────────────────

/**
 * Trigger evidence: votes for 'trigger' intent on elements that look like
 * action buttons. This gives triggers a baseline confidence and audit trail
 * instead of winning silently as a fallback with 0.0 confidence.
 *
 * The weight (+0.3) is deliberately weak — it's overridden by:
 *   - aria-checked (+0.8) for checkboxes
 *   - checked-transition (+0.6) for toggle interactions
 *   - tag-anchor (+0.4) for plain links
 * But it ensures that a plain button click has:
 *   - A non-empty evidence trail
 *   - A small but positive confidence (0.3)
 *   - A named intent (trigger) rather than a silent fallback
 */
export const triggerEvidence: EvidenceGenerator = {
  id: 'trigger',
  generate(f: FeatureViewInput): IntentVote[] {
    const evidence: IntentVote[] = [];

    // BUTTON tags, role=button, and INPUT[type=button/submit/reset/image]
    // are the canonical trigger elements
    const isButtonTag = f.tag === 'BUTTON';
    const isButtonRole = f.ariaRole === 'button';
    const isActionButtonInput = f.tag === 'INPUT' && (
      f.ariaRole === 'button'
    );

    if (isButtonTag || isButtonRole || isActionButtonInput) {
      evidence.push({
        intent: 'trigger',
        weight: 0.3,
        source: 'button-element',
        reason: 'Element has button semantics (tag, role, or input type)',
      });
    }

    return evidence;
  },
};

// ── Registry ─────────────────────────────────────────────────────────────

/**
 * All registered evidence generators. To add a new signal source:
 *   1. Implement an EvidenceGenerator (above)
 *   2. Add it to this array
 * No existing generator or other code needs to change.
 */
export const EVIDENCE_GENERATORS: EvidenceGenerator[] = [
  ariaEvidence,
  behavioralEvidence,
  tagEvidence,
  structuralEvidence,
  navigationEvidence,
  triggerEvidence,
];
