/**
 * Evidence generators for the intent classification engine.
 *
 * Each generator reads the FeatureViewInput and produces evidence votes.
 * Generators are independent — none reads another generator's output.
 * All generators are registered in the EVIDENCE_GENERATORS array.
 *
 * Weight calibration principles:
 *   - Standards-based signals (aria-checked, role=checkbox) are strong: 0.7–0.9
 *   - Behavioral signals (checked transition, value change, attr transition): 0.5–0.7
 *   - Structural signals (surface, className, ancestor context): 0.1–0.4
 *   - Class-name heuristics (semantic token matching): 0.4–0.5
 *   - Negative evidence (suppressing an intent) caps at -0.3 — it shouldn't
 *     overwhelm a strong positive signal, but helps disambiguate when signals
 *     are evenly matched.
 *
 * R3.3: Added 4 behavioral generators for select, input, and explore intents.
 * These read the expanded FeatureViewInput fields (R3.1) to reason about
 * behavioral effects observed after the page's click handler ran (R3.4).
 */

import type { EvidenceGenerator, IntentVote, FeatureViewInput } from './types';

// ── ARIA Evidence ────────────────────────────────────────────────────────

/**
 * ARIA attributes are the strongest semantic signal. When present, they're
 * authoritative — the developer explicitly declared the element's semantics.
 *
 * R3.4 calibration: also detects aria-checked attribute transitions from the
 * post-handler re-snapshot. This catches elements that set aria-checked=true
 * after a click (common in custom SPA toggles without explicit checkbox role).
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

    // R3.4 calibration: aria-checked attribute transition from post-handler
    // re-snapshot. Catches custom toggles that set aria-checked dynamically
    // (e.g. <a href="#" onclick="this.setAttribute('aria-checked','true')">)
    if (f.hasAttributeTransition) {
      const checkedTransition = f.attributeChanges.some(
        c => c.attribute === 'aria-checked' || c.attribute === 'aria-pressed',
      );
      if (checkedTransition) {
        evidence.push({
          intent: 'toggle',
          weight: 0.7,
          source: 'aria-checked-transition',
          reason: 'aria-checked/aria-pressed attribute changed after click (behavioral)',
        });
      }
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

// ── R3.3: Behavioral Evidence Generators ──────────────────────────────────

/**
 * R3.3 Value Change Evidence: detects when the clicked element's value
 * changed (valueBefore ≠ valueAfter) or the element is contentEditable.
 *
 * These are behavioral signals that the interaction provided a value —
 * the defining characteristic of 'input' intent. They fire AFTER the page's
 * click handler has run (via the Click lifecycle deferral, R3.4), so the
 * value transition reflects the handler's effect.
 */
export const valueChangeEvidence: EvidenceGenerator = {
  id: 'value-change',
  generate(f: FeatureViewInput): IntentVote[] {
    const evidence: IntentVote[] = [];

    // Value transition detected — strong behavioral signal for input intent
    if (f.valueBefore !== null && f.valueAfter !== null && f.valueBefore !== f.valueAfter) {
      evidence.push({
        intent: 'input',
        weight: 0.6,
        source: 'value-transition',
        reason: 'Element value changed after click (behavioral)',
      });
      // Suppress trigger — a value change means this isn't a pure action button
      evidence.push({
        intent: 'trigger',
        weight: -0.2,
        source: 'value-transition',
        reason: 'Value change suppresses trigger intent',
      });
    }

    // ContentEditable — structural-but-strong signal for input intent
    if (f.isContentEditable) {
      evidence.push({
        intent: 'input',
        weight: 0.5,
        source: 'content-editable',
        reason: 'Element is contentEditable (always input)',
      });
    }

    return evidence;
  },
};

/**
 * R3.3 Panel Emergence Evidence: detects when a click causes a panel/overlay
 * to appear or expand. This is the defining behavioral signal for 'select'
 * intent (dropdowns, comboboxes, menus, popovers).
 *
 * Signals (in order of strength):
 *   1. aria-expanded attribute transition (behavioral, post-handler): +0.6
 *   2. aria-expanded statically true (structural ARIA): +0.5
 *   3. aria-haspopup present (structural hint): +0.3
 */
export const panelEmergenceEvidence: EvidenceGenerator = {
  id: 'panel-emergence',
  generate(f: FeatureViewInput): IntentVote[] {
    const evidence: IntentVote[] = [];

    // Attribute transition on aria-expanded — definitive behavioral signal
    const hasExpandedTransition = f.hasAttributeTransition &&
      f.attributeChanges.some(c => c.attribute === 'aria-expanded');

    if (hasExpandedTransition) {
      evidence.push({
        intent: 'select',
        weight: 0.6,
        source: 'aria-expanded-transition',
        reason: 'aria-expanded attribute changed after click (behavioral)',
      });
    } else if (f.ariaExpanded === true) {
      // Statically expanded — structural ARIA signal
      evidence.push({
        intent: 'select',
        weight: 0.5,
        source: 'aria-expanded-static',
        reason: 'Element has aria-expanded=true (structural)',
      });
    }

    // aria-haspopup — structural hint (weaker, a declaration of intent)
    if (f.ariaHasPopup) {
      evidence.push({
        intent: 'select',
        weight: 0.3,
        source: 'aria-haspopup',
        reason: `Element has aria-haspopup="${f.ariaHasPopup}"`,
      });
    }

    // If we have any select evidence, suppress navigate
    if (evidence.length > 0) {
      evidence.push({
        intent: 'navigate',
        weight: -0.2,
        source: 'panel-emergence',
        reason: 'Panel/popup element suppresses navigation intent',
      });
    }

    return evidence;
  },
};

// Regex patterns for semantic class tokens in selection/toggle state changes
// "active" is classified as toggle because it's the most common SPA filter
// toggle state class (e.g., jQuery .active, CSS .toggle.active).
const SELECTION_CLASS_RE = /(?:^|\s)(?:select|chosen|current|picked|highlight)(?:ed|ed-item)?(?:\s|$)/i;
const TOGGLE_CLASS_RE = /(?:^|\s)(?:check|toggle|on|enabled|open|active)(?:ed)?(?:\s|$)/i;

/**
 * R3.3 Selection State Evidence: detects class attribute transitions that
 * indicate a selection or toggle state change. This is the key generator
 * for novel implementations (div-checkboxes, custom segmented controls)
 * where no ARIA or standard HTML signals exist.
 *
 * Fires only when the Click lifecycle's post-handler re-snapshot detected
 * a class attribute change. The generator examines the class token that was
 * added/removed and matches it against semantic patterns.
 *
 * Weight: +0.5 for behavioral class-state transitions. This is intentionally
 * above structural tag evidence (+0.4 for <a> tag) so behavioral signals
 * override misleading structural signals in the link-styled-toggle scenario.
 */
export const selectionStateEvidence: EvidenceGenerator = {
  id: 'selection-state',
  generate(f: FeatureViewInput): IntentVote[] {
    const evidence: IntentVote[] = [];

    if (!f.hasAttributeTransition) return evidence;

    // Find class attribute transitions
    for (const change of f.attributeChanges) {
      if (change.attribute !== 'class') continue;

      const beforeClasses = (change.before ?? '').toLowerCase();
      const afterClasses = (change.after ?? '').toLowerCase();

      // Determine which class tokens were added (after but not before)
      const beforeSet = new Set(beforeClasses.split(/\s+/).filter(Boolean));
      const afterSet = new Set(afterClasses.split(/\s+/).filter(Boolean));

      // Check for added tokens that match toggle patterns first
      // (toggle tokens like "on", "checked", "active" are stronger signals
      // than selection tokens because they imply boolean state)
      for (const token of afterSet) {
        if (beforeSet.has(token)) continue; // token was already present

        // Toggle-related token gained → toggle intent
        if (TOGGLE_CLASS_RE.test(token) || TOGGLE_CLASS_RE.test(` ${token} `)) {
          evidence.push({
            intent: 'toggle',
            weight: 0.5,
            source: 'class-toggle-transition',
            reason: `Class gained toggle token "${token}" (behavioral)`,
          });
          break;
        }

        // Selection-related token gained → select intent
        if (SELECTION_CLASS_RE.test(token) || SELECTION_CLASS_RE.test(` ${token} `)) {
          evidence.push({
            intent: 'select',
            weight: 0.5,
            source: 'class-selection-transition',
            reason: `Class gained selection token "${token}" (behavioral)`,
          });
          break; // one match is sufficient
        }
      }

      // If no added token matched, check removed tokens (de-selection)
      if (evidence.length === 0) {
        for (const token of beforeSet) {
          if (afterSet.has(token)) continue;

          if (SELECTION_CLASS_RE.test(token) || SELECTION_CLASS_RE.test(` ${token} `)) {
            // Selection token removed — still a selection interaction
            evidence.push({
              intent: 'select',
              weight: 0.4,
              source: 'class-deselection-transition',
              reason: `Class removed selection token "${token}" (behavioral)`,
            });
            break;
          }
        }
      }
    }

    return evidence;
  },
};

/**
 * R3.3 Slider Value Evidence: detects when the clicked element has an
 * aria-valuenow attribute, indicating it's a slider or progress indicator.
 * This is a structural ARIA signal that helps the select intent path
 * derive the Slider type.
 */
export const sliderValueEvidence: EvidenceGenerator = {
  id: 'slider-value',
  generate(f: FeatureViewInput): IntentVote[] {
    const evidence: IntentVote[] = [];

    if (f.ariaValueNow !== null) {
      evidence.push({
        intent: 'select',
        weight: 0.5,
        source: 'aria-valuenow',
        reason: 'Element has aria-valuenow (slider/progress)',
      });
    }

    return evidence;
  },
};

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
  // R3.3: Behavioral generators for select, input intents
  valueChangeEvidence,
  panelEmergenceEvidence,
  selectionStateEvidence,
  sliderValueEvidence,
];
