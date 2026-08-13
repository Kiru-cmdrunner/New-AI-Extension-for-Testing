/**
 * Counter Signal Extractor — extracts counter-change signals from
 * DomChangeSummary characterData deltas.
 *
 * A "counter" is a short text element whose value changes between two
 * numeric (or numeric-like) values — e.g., a cart badge "0" → "1",
 * a results count "23" → "45", a quantity "2" → "3".
 *
 * Heuristic: characterData delta where BOTH old and new values are
 * short (≤8 chars) and parseable as numbers after trimming common
 * decorations (parentheses, whitespace, commas).
 *
 * M9.2
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { SignalExtractor, Signal, CounterChangeSignal } from '../types';

/** Max length for counter-like text. */
const MAX_COUNTER_TEXT_LEN = 8;

/**
 * Parse a string into a number if it looks like a counter value.
 * Handles: "0", "1", "23", " 5 ", "(3)", "1,234".
 * Returns null if not counter-like.
 */
export function parseCounterValue(text: string | null): number | null {
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_COUNTER_TEXT_LEN) return null;

  // Strip common decorations
  const cleaned = trimmed.replace(/^[(\[]|[\])]$/g, '').replace(/,/g, '').trim();
  if (cleaned.length === 0) return null;

  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;

  return n;
}

/** Path segments that suggest counter semantics. */
const COUNTER_PATH_HINTS = /cart|count|badge|total|qty|quantity|items?|results?|notification/i;

export class CounterSignalExtractor implements SignalExtractor {
  readonly name = 'CounterSignalExtractor';

  extract(interaction: ComponentInteraction): Signal[] {
    const evidence = interaction.behavioralEvidence;
    if (!evidence) return [];

    const domChanges = evidence.applicationEvidence.domChanges;
    if (!domChanges || domChanges.length === 0) return [];

    const signals: CounterChangeSignal[] = [];

    for (const change of domChanges) {
      // Counters change via characterData or attribute mutations on their text
      const cdd = change.characterDataDelta;
      if (!cdd) continue;

      const oldNum = parseCounterValue(cdd.old);
      const newNum = parseCounterValue(cdd.new);

      // Only emit counter signals when old value exists and both are numeric
      if (oldNum === null || newNum === null) continue;

      const label = COUNTER_PATH_HINTS.test(change.targetPath)
        ? change.targetPath.split('/').pop() ?? null
        : null;

      signals.push({
        type: 'counter-change',
        interactionId: interaction.interactionId,
        source: 'dom-mutation',
        confidence: COUNTER_PATH_HINTS.test(change.targetPath) ? 0.8 : 0.5,
        elementPath: change.targetPath,
        oldValue: cdd.old,
        newValue: cdd.new!,
        numericDelta: newNum - oldNum,
        label,
      });
    }

    return signals;
  }
}
