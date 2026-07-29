/**
 * Pattern Registry — Phase 4
 *
 * Catalogue of declarative PatternDefinitions for interaction recognition.
 *
 * Patterns are pure data — they describe WHAT signals to look for, not HOW
 * to find them. The PatternEvaluator is the generic engine that matches them.
 *
 * Adding a new interaction type = adding a new pattern here. No engine changes.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { PatternDefinition } from '../../types/foundation';
import { CLICK_PATTERNS } from './patterns/click-patterns';
import { TEXT_ENTRY_PATTERN } from './patterns/text-entry-pattern';
import { DROPDOWN_PATTERN } from './patterns/dropdown-pattern';
import { DATE_PICKER_PATTERN } from './patterns/date-picker-pattern';
import { SCROLL_PATTERN } from './patterns/scroll-pattern';
import { HOVER_PATTERN } from './patterns/hover-pattern';
import { NAVIGATION_PATTERN } from './patterns/navigation-pattern';
import { SLIDER_PATTERN } from './patterns/slider-pattern';

// ── Registry ─────────────────────────────────────────────────────────────

/**
 * All registered patterns.
 *
 * Phase 5b: Patterns now have a `priority` field (higher = tried first).
 * The array is sorted by priority descending on first access.
 *
 * Priority guide:
 *   150  Date picker (most specific — needs date input/calendar detection)
 *   140  Radio select (specific input type)
 *   130  Checkbox toggle (specific input type + checked transition)
 *   120  Slider (specific input type)
 *   110  Button click (role/tag specific)
 *   100  Dropdown, Text entry, Navigation (standard interactions)
 *   90   Hover (lower priority — ambiguous)
 *   80   Scroll (coalesced into lifecycle)
 *   10   Generic click (fallback — interactive elements only)
 */
const RAW_PATTERNS: PatternDefinition[] = [
  DATE_PICKER_PATTERN,
  DROPDOWN_PATTERN,
  ...CLICK_PATTERNS,   // checkbox(130), radio(140), link(120), button(110), generic(10)
  SLIDER_PATTERN,
  TEXT_ENTRY_PATTERN,
  HOVER_PATTERN,
  SCROLL_PATTERN,
  NAVIGATION_PATTERN,
];

/**
 * Patterns sorted by priority (descending). Higher priority = evaluated first.
 */
const ALL_PATTERNS: PatternDefinition[] = [...RAW_PATTERNS].sort(
  (a, b) => (b.priority ?? 100) - (a.priority ?? 100),
);

/**
 * Get all registered patterns (defensive copy).
 */
export function getAllPatterns(): PatternDefinition[] {
  return [...ALL_PATTERNS];
}

/**
 * Get patterns that can match a given event type.
 *
 * This is a hint for the pipeline — it doesn't need to evaluate every
 * pattern against every candidate.
 */
export function getPatternsForEvent(eventType: string): PatternDefinition[] {
  return ALL_PATTERNS.filter((p) =>
    p.conditions.some(
      (c) =>
        c.signalType === 'eventSequence' &&
        c.operator === 'contains' &&
        c.expected === eventType,
    ),
  );
}

/**
 * Get a pattern by ID.
 */
export function getPatternById(id: string): PatternDefinition | undefined {
  return ALL_PATTERNS.find((p) => p.id === id);
}

export { ALL_PATTERNS };
