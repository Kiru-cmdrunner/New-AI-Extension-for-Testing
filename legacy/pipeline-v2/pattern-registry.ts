/**
 * Pattern Registry — Pipeline V2 Layer 4
 *
 * A registry of ~12 GENERIC interaction behavior patterns. These represent
 * fundamental user intentions, NOT UI component types.
 *
 * DESIGN PRINCIPLE: Patterns are ACCELERATORS, not gatekeepers.
 * The Intent Resolver produces a business action from the StateDiff alone
 * even when no pattern matches. A pattern match increases confidence and
 * enables the fast path, but it is NOT required.
 *
 * FRAMEWORK AGNOSTICISM: 'single-selection-from-set' covers native <select>,
 * Material UI Select, Ant Design Select, Radix Select, radio button groups,
 * and custom div dropdowns — because they all produce the same observable
 * behavior: a surface opens, a value changes, the surface closes.
 *
 * PATTERN EVALUATION: Each pattern evaluates an interaction unit's state diff
 * and event sequence to determine if it matches. The registry returns the
 * BEST match (highest confidence). If no pattern matches above the minimum
 * threshold, it returns null and the Intent Resolver uses generic-fallback.
 */

import type {
  InteractionUnit,
  StateDiff,
  PatternMatch,
  InteractionBehavior,
  PatternMetadata,
  PipelineEvent,
} from './canonical-event-schema';
import { hasMeaningfulChanges, isValueSelection, isToggleChange, isRadioSelection } from './state-diff-engine';

// ── Pattern Interface ───────────────────────────────────────────────────

/**
 * A single pattern in the registry.
 *
 * Each pattern evaluates whether an interaction unit matches its behavior.
 * Patterns are pure functions — no side effects, no DOM access.
 */
export interface InteractionPattern {
  /** The generic behavior this pattern represents. */
  readonly behavior: InteractionBehavior;

  /** Human-readable name (for tracing). */
  readonly name: string;

  /**
   * Evaluate whether this pattern matches the interaction unit.
   *
   * @param unit   The interaction unit (events + boundary info)
   * @param diff   The state diff computed for this unit
   * @returns PatternMatch if the pattern matches, null otherwise
   */
  evaluate(unit: InteractionUnit, diff: StateDiff): PatternMatch | null;
}

// ── Pattern Implementation Helpers ──────────────────────────────────────

/**
 * Check if the interaction unit contains a specific event type.
 */
function hasEvent(unit: InteractionUnit, type: PipelineEvent['type']): boolean {
  return unit.events.some((e) => e.type === type);
}

/**
 * Get events of a specific type from the unit.
 */
function getEvents(unit: InteractionUnit, type: PipelineEvent['type']): PipelineEvent[] {
  return unit.events.filter((e) => e.type === type);
}

/**
 * Check if a surface opened and then closed during this interaction.
 */
function hasSurfaceLifecycle(unit: InteractionUnit): boolean {
  return hasEvent(unit, 'surface_open') || hasEvent(unit, 'surface_close');
}

/**
 * Check if the primary event is a click.
 * RC-1 FIX: Check ALL events for a click, not just primaryEvent (which may
 * be a blur from the previous interaction).
 *
 * RC-4 FIX: A click that merely focuses an input field (click on input/textarea
 * followed by input events) should NOT block text-entry classification.
 * We only consider a click "primary" if it's on a non-input element, or if
 * there are no input events in the unit.
 */
function isClickInitiated(unit: InteractionUnit): boolean {
  const hasClick = hasEvent(unit, 'click') || hasEvent(unit, 'dblclick');
  if (!hasClick) return false;

  // If there's also a submit event, form submit takes priority
  if (hasEvent(unit, 'submit')) return false;

  // RC-4 FIX: If there are input events (typing), the click was just to focus
  // the field — the real interaction is text entry, not a click.
  if (hasEvent(unit, 'input')) return false;

  return true;
}

/**
 * Create a PatternMatch with standard fields.
 */
function makeMatch(
  behavior: InteractionBehavior,
  confidence: number,
  rationale: string,
  metadata: PatternMetadata = {},
): PatternMatch {
  return { behavior, confidence, rationale, metadata };
}

// ── Pattern Definitions ─────────────────────────────────────────────────

/**
 * Pattern: Single selection from a set
 *
 * Matches: dropdown selection, radio group selection, segmented control,
 *          custom listbox selection, autocomplete selection.
 *
 * Observable behavior: a surface opens, user selects an option, value changes,
 * surface closes. OR: a radio button is clicked, radio selection changes.
 *
 * Frameworks covered: native <select>, Material UI Select, Ant Design Select,
 * Radix Select, custom div dropdown, radio groups.
 */
const singleSelectionFromSet: InteractionPattern = {
  behavior: 'single-selection-from-set',
  name: 'Single Selection From Set',

  evaluate(unit, diff): PatternMatch | null {
    // Path 1: Radio selection
    if (isRadioSelection(diff)) {
      const change = diff.radioChanges[0];
      return makeMatch(
        'single-selection-from-set',
        0.95,
        'Radio group selection changed',
        {
          selectedValue: change.after?.accessibleName || '',
          previousValue: change.before?.accessibleName || '',
          selectedOption: change.after || undefined,
        },
      );
    }

    // Path 1b: Radio-like interaction detected from event element identities
    // (when snapshot doesn't produce a radioChanges entry but the click was
    // on an input[type=radio] or role=radio element)
    const radioEvent = unit.events.find(
      (e) => (e.type === 'click' || e.type === 'change') && e.element &&
        ((e.element.tag || '').toLowerCase().includes('radio') ||
         e.element.ariaRole === 'radio')
    );
    if (radioEvent) {
      return makeMatch(
        'single-selection-from-set',
        0.93,
        'Radio element clicked',
        {
          selectedValue: radioEvent.element?.accessibleName || '',
        },
      );
    }

    // Path 2: Surface lifecycle with value change
    if (hasSurfaceLifecycle(unit) && isValueSelection(diff)) {
      const change = diff.valueChanges[0];
      return makeMatch(
        'single-selection-from-set',
        0.95,
        'Surface opened/closed with one value change',
        {
          selectedValue: change.after,
          previousValue: change.before,
          inputType: change.inputType,
        },
      );
    }

    // Path 3: Native select change event (no surface lifecycle events)
    if (hasEvent(unit, 'change') && isValueSelection(diff)) {
      const change = diff.valueChanges[0];
      if (change.inputType === 'select-one' || change.inputType === 'select-multiple') {
        return makeMatch(
          'single-selection-from-set',
          0.90,
          'Native select value changed',
          {
            selectedValue: change.after,
            previousValue: change.before,
          },
        );
      }
    }

    return null;
  },
};

/**
 * Pattern: Multi selection from a set
 *
 * Matches: checkbox group, token input, multi-select dropdown, tag selector.
 *
 * Observable behavior: multiple toggles change state within the same unit.
 */
const multiSelectionFromSet: InteractionPattern = {
  behavior: 'multi-selection-from-set',
  name: 'Multi Selection From Set',

  evaluate(unit, diff): PatternMatch | null {
    // RC FIX: Don't classify as multi-selection if there are radio changes —
    // radio groups produce 2 toggle changes (old deselected + new selected)
    // but should be classified as single-selection, not multi.
    if (diff.radioChanges.length > 0) return null;

    if (diff.toggleChanges.length >= 2) {
      return makeMatch(
        'multi-selection-from-set',
        0.85,
        `${diff.toggleChanges.length} toggles changed in one unit`,
      );
    }
    return null;
  },
};

/**
 * Pattern: Boolean toggle
 *
 * Matches: checkbox, toggle switch, aria-pressed button.
 *
 * Observable behavior: exactly one toggle state changes.
 */
const booleanToggle: InteractionPattern = {
  behavior: 'boolean-toggle',
  name: 'Boolean Toggle',

  evaluate(unit, diff): PatternMatch | null {
    // RC FIX: If there's a surface change (dialog/menu opened), this is NOT
    // a toggle — it's expand-collapse or simple-click. Don't match.
    if (diff.surfaceChanges.length > 0) return null;

    // Path 1: Snapshot-based toggle change (checkbox, toggle switch)
    if (isToggleChange(diff)) {
      const change = diff.toggleChanges[0];
      return makeMatch(
        'boolean-toggle',
        0.95,
        'One toggle state changed',
        { toggleState: change.after },
      );
    }

    // RC-3 FIX Path 2: ARIA toggle buttons (aria-pressed) detected from events
    // Custom toggle switches, segmented controls, and icon buttons often use
    // aria-pressed="true/false" instead of checkbox. The observer's deferred
    // mousedown handler captures these state changes and emits synthetic change
    // events with previousValue containing "aria-pressed=true|false".
    for (const event of unit.events) {
      if (event.type === 'change' && event.payload?.previousValue) {
        const prev = event.payload.previousValue as string;
        if (prev.includes('aria-pressed')) {
          const wasPressed = prev.includes('aria-pressed=true');
          return makeMatch(
            'boolean-toggle',
            0.90,
            'ARIA pressed state changed',
            { toggleState: !wasPressed },
          );
        }
        // Also check aria-checked on non-checkbox elements (custom switches)
        if (prev.includes('aria-checked') && !prev.includes('type=checkbox')) {
          const wasChecked = prev.includes('aria-checked=true');
          return makeMatch(
            'boolean-toggle',
            0.88,
            'ARIA checked state changed on custom element',
            { toggleState: !wasChecked },
          );
        }
      }
    }

    return null;
  },
};

/**
 * Pattern: Text entry commit
 *
 * Matches: text input, textarea, search box, autocomplete input.
 *
 * Observable behavior: focus → input events → blur/change, with a value change.
 */
const textEntryCommit: InteractionPattern = {
  behavior: 'text-entry-commit',
  name: 'Text Entry Commit',

  evaluate(unit, diff): PatternMatch | null {
    // Must have focus/blur lifecycle and a value change
    const hasInput = hasEvent(unit, 'input') || hasEvent(unit, 'change');
    const hasFocusLifecycle = hasEvent(unit, 'focus') || hasEvent(unit, 'blur');

    // CRITICAL: Do not classify as text entry if the primary event is a click.
    // This prevents a Search button click (grouped with a search field's input
    // events by the boundary detector) from being misclassified as text entry.
    // A click is never a text entry — it's a button/link/option interaction.
    if (isClickInitiated(unit)) return null;

    // RC-4 FIX: Exclude range sliders (input[type=range]) — they produce input
    // events but are slider adjustments, not text entry.
    if (diff.rangeChanges.length > 0 && diff.valueChanges.length === 0) return null;
    if (diff.valueChanges.length === 1 && diff.valueChanges[0].inputType === 'range') return null;

    if (hasInput && diff.valueChanges.length === 1) {
      const change = diff.valueChanges[0];
      // Text inputs (not selects — those are single-selection)
      if (change.inputType !== 'select-one' && change.inputType !== 'select-multiple') {
        return makeMatch(
          'text-entry-commit',
          hasFocusLifecycle ? 0.92 : 0.75,
          hasFocusLifecycle
            ? 'Focus → input → blur with value change'
            : 'Value change on text input',
          { textValue: change.after },
        );
      }
    }

    return null;
  },
};

/**
 * Pattern: Date/time selection
 *
 * Matches: native date input, calendar widget, Material UI DatePicker,
 * Ant Design DatePicker, custom calendar.
 *
 * Observable behavior: a value changes to a date-like string, possibly with
 * a surface lifecycle (calendar popup).
 *
 * Detection heuristic: the value matches date patterns OR the input type
 * is date/time/datetime-local/month/week.
 */
const dateTimeSelection: InteractionPattern = {
  behavior: 'date-time-selection',
  name: 'Date/Time Selection',

  evaluate(unit, diff): PatternMatch | null {
    // Path 1: Native date input type
    if (diff.valueChanges.length === 1) {
      const change = diff.valueChanges[0];
      const dateTypes = ['date', 'time', 'datetime-local', 'month', 'week'];
      if (dateTypes.includes(change.inputType)) {
        return makeMatch(
          'date-time-selection',
          0.95,
          `Date input type '${change.inputType}' changed`,
          {
            dateValue: change.after,
            dateIsoValue: change.after,
          },
        );
      }
    }

    // Path 2: Surface lifecycle with date-like value (custom calendars)
    if (hasSurfaceLifecycle(unit) && diff.valueChanges.length >= 1) {
      const change = diff.valueChanges[0];
      if (looksLikeDate(change.after)) {
        return makeMatch(
          'date-time-selection',
          0.96,
          'Surface lifecycle with date-like value change',
          { dateValue: change.after },
        );
      }
    }

    // RC-5 FIX Path 3: Click on a calendar cell detected via change event
    // The observer's extractValueFromClick emits synthetic change events when
    // the user clicks a calendar cell. Check if ANY change event in the unit
    // has a date-like value, even if it wasn't picked up by the snapshot diff.
    const changeEvents = getEvents(unit, 'change');
    for (const ce of changeEvents) {
      const val = ce.payload?.value as string | undefined;
      if (val && looksLikeDate(val)) {
        return makeMatch(
          'date-time-selection',
          0.88,
          'Calendar cell click with date-like value',
          { dateValue: val },
        );
      }
    }

    // Path 4: Field name suggests a date
    if (diff.valueChanges.length === 1) {
      const change = diff.valueChanges[0];
      const fieldLower = change.field.toLowerCase();
      if ((fieldLower.includes('date') || fieldLower.includes('calendar')) && change.after) {
        return makeMatch(
          'date-time-selection',
          0.75,
          'Date-named field value changed',
          { dateValue: change.after },
        );
      }
    }

    return null;
  },
};

/**
 * Pattern: Expand/collapse
 *
 * Matches: accordion, tree node, collapsible panel, expandable card.
 *
 * Observable behavior: a surface opens or closes without a value change.
 */
const expandCollapse: InteractionPattern = {
  behavior: 'expand-collapse',
  name: 'Expand/Collapse',

  evaluate(unit, diff): PatternMatch | null {
    // Surface changed but no value/toggle/radio change
    if (diff.surfaceChanges.length > 0 &&
        diff.valueChanges.length === 0 &&
        diff.toggleChanges.length === 0 &&
        diff.radioChanges.length === 0) {
      return makeMatch(
        'expand-collapse',
        0.80,
        'Surface opened/closed with no value change',
        {
          surfaceType: diff.surfaceChanges[0].type,
        },
      );
    }
    return null;
  },
};

/**
 * Pattern: Context switch (tabs)
 *
 * Matches: tab switching, carousel navigation, wizard steps.
 *
 * Observable behavior: active tab changes.
 */
const contextSwitch: InteractionPattern = {
  behavior: 'context-switch',
  name: 'Context Switch (Tabs)',

  evaluate(unit, diff): PatternMatch | null {
    if (diff.tabChange) {
      return makeMatch(
        'context-switch',
        0.90,
        `Tab changed from '${diff.tabChange.from.accessibleName}' to '${diff.tabChange.to.accessibleName}'`,
      );
    }
    return null;
  },
};

/**
 * Pattern: Navigation
 *
 * Matches: link click, redirect, SPA route change.
 *
 * Observable behavior: URL changes.
 */
const navigation: InteractionPattern = {
  behavior: 'navigation',
  name: 'Navigation',

  evaluate(unit, diff): PatternMatch | null {
    if (diff.urlChange) {
      return makeMatch(
        'navigation',
        1.0,
        `URL changed from ${diff.urlChange.from} to ${diff.urlChange.to}`,
      );
    }

    // Check for navigation event
    const navEvents = getEvents(unit, 'navigation');
    if (navEvents.length > 0) {
      const nav = navEvents[0];
      return makeMatch(
        'navigation',
        1.0,
        'Navigation event',
        {
          selectedValue: nav.payload.url,
        },
      );
    }

    return null;
  },
};

/**
 * Pattern: Hover intent
 *
 * Matches: tooltip reveal, hover menu, preview on hover.
 *
 * Observable behavior: mouseenter/mouseleave with surface change (content appeared).
 */
const hoverIntent: InteractionPattern = {
  behavior: 'hover-intent',
  name: 'Hover Intent',

  evaluate(unit, diff): PatternMatch | null {
    const hasMouseEnter = hasEvent(unit, 'mouseenter');
    const hasMouseLeave = hasEvent(unit, 'mouseleave');

    if (hasMouseEnter && diff.surfaceChanges.length > 0) {
      return makeMatch(
        'hover-intent',
        0.85,
        'Mouse enter with surface change',
      );
    }

    if (hasMouseEnter && hasMouseLeave && diff.structuralChangeDetected) {
      return makeMatch(
        'hover-intent',
        0.75,
        'Mouse enter/leave with structural change',
      );
    }

    return null;
  },
};

/**
 * Pattern: Simple click
 *
 * Matches: button click, link click, icon click — with no complex state change.
 *
 * Observable behavior: click event, no meaningful state diff.
 */
const simpleClick: InteractionPattern = {
  behavior: 'simple-click',
  name: 'Simple Click',

  evaluate(unit, diff): PatternMatch | null {
    if (!isClickInitiated(unit)) return null;

    // No meaningful state changes — just a click
    if (!hasMeaningfulChanges(diff)) {
      return makeMatch(
        'simple-click',
        0.85,
        'Click with no meaningful state change',
      );
    }

    // Click with surface change only (e.g. opening a menu but not selecting)
    if (diff.surfaceChanges.length > 0 && diff.valueChanges.length === 0 &&
        diff.toggleChanges.length === 0 && diff.radioChanges.length === 0) {
      // This is a click that opened/closed something — but it's still a click action
      return makeMatch(
        'simple-click',
        0.70,
        'Click that opened/closed a surface (no selection)',
      );
    }

    return null;
  },
};

/**
 * Pattern: Range adjustment
 *
 * Matches: range sliders, volume controls, price range filters.
 *
 * Observable behavior: a range value changes (min/max/step based input).
 */
const rangeAdjustment: InteractionPattern = {
  behavior: 'simple-click', // Maps to 'click' in session events — no dedicated range type
  name: 'Range Adjustment',

  evaluate(unit, diff): PatternMatch | null {
    if (diff.rangeChanges.length > 0) {
      const change = diff.rangeChanges[0];
      return makeMatch(
        'simple-click',
        0.85,
        `Range slider adjusted from ${change.before} to ${change.after}`,
        {},
      );
    }
    return null;
  },
};

/**
 * Pattern: Form submit
 *
 * Matches: form submission via button click or Enter key.
 *
 * Observable behavior: submit event.
 */
const formSubmit: InteractionPattern = {
  behavior: 'form-submit',
  name: 'Form Submit',

  evaluate(unit, diff): PatternMatch | null {
    if (hasEvent(unit, 'submit')) {
      return makeMatch(
        'form-submit',
        0.95,
        'Form submitted',
      );
    }

    // Enter key on a form input might submit
    const keydowns = getEvents(unit, 'keydown');
    if (keydowns.some((e) => e.payload.key === 'Enter') && isClickInitiated(unit) === false) {
      return makeMatch(
        'form-submit',
        0.60,
        'Enter key pressed (possible form submit)',
      );
    }

    return null;
  },
};

// ── Registry ────────────────────────────────────────────────────────────

/**
 * All registered patterns, ordered by evaluation priority.
 *
 * More specific patterns are evaluated first. If a specific pattern matches
 * with high confidence, the registry returns it immediately.
 */
const patterns: InteractionPattern[] = [
  navigation,              // Highest priority — URL change is unambiguous
  dateTimeSelection,       // Specific: date-like values
  singleSelectionFromSet,  // Specific: value change with surface/radio
  multiSelectionFromSet,   // Specific: multiple toggles
  booleanToggle,           // Specific: single toggle (incl. ARIA)
  textEntryCommit,         // Specific: text value change (excludes range)
  contextSwitch,           // Specific: tab change
  expandCollapse,          // Surface change only
  rangeAdjustment,         // Range slider adjustment
  formSubmit,              // Submit event
  hoverIntent,             // Hover with surface change
  simpleClick,             // Click with no state change
  // generic-fallback is NOT a pattern — it's the Intent Resolver's fallback
];

/**
 * Minimum confidence threshold for a pattern match.
 * Below this, the registry returns null and the Intent Resolver uses
 * generic-fallback.
 */
const MIN_CONFIDENCE = 0.50;

/**
 * Match an interaction unit against the pattern registry.
 *
 * Evaluates all patterns and returns the BEST match (highest confidence).
 * If no pattern matches above MIN_CONFIDENCE, returns null.
 *
 * @param unit   The interaction unit
 * @param diff   The state diff for this unit
 * @returns Best PatternMatch, or null if no pattern matched
 */
export function matchPattern(
  unit: InteractionUnit,
  diff: StateDiff,
): PatternMatch | null {
  let bestMatch: PatternMatch | null = null;

  for (const pattern of patterns) {
    const match = pattern.evaluate(unit, diff);
    if (match && match.confidence >= MIN_CONFIDENCE) {
      if (!bestMatch || match.confidence > bestMatch.confidence) {
        bestMatch = match;
      }
    }
  }

  return bestMatch;
}

/**
 * Get all registered patterns (for debugging/testing).
 */
export function getRegisteredPatterns(): readonly InteractionPattern[] {
  return patterns;
}

// ── Date Detection Helper ───────────────────────────────────────────────

/**
 * Check if a string looks like a date.
 * Matches common date formats and ISO date strings.
 */
function looksLikeDate(value: string): boolean {
  if (!value) return false;

  // ISO date: 2026-07-18
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return true;

  // Time: 14:30, 09:15 AM, 2:30 PM
  if (/^\d{1,2}:\d{2}(\s?[AP]M)?$/i.test(value)) return true;

  // Common formats: 18 Jul 2026, July 18 2026, 07/18/2026
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(value)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value)) return true;
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(value)) return true;

  return false;
}
