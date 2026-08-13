/**
 * Counter Tracker — tracks counter-like elements and their value history.
 *
 * When a CounterChangeSignal arrives, the tracker records the new value
 * and the delta from the previous observation.
 *
 * M9.2
 */

import type { CounterRecord, CounterValue } from './types';

export class CounterTracker {
  private counters = new Map<string, CounterRecord>();

  /**
   * Record a counter value change.
   * Creates the counter if it doesn't exist.
   */
  record(
    elementPath: string,
    newValue: string,
    interactionId: string,
    label: string | null = null,
  ): CounterRecord {
    const id = `counter:${elementPath}`;
    let counter = this.counters.get(id);

    if (!counter) {
      counter = {
        id,
        label: label ?? elementPath,
        elementPath,
        values: [],
      };
      this.counters.set(id, counter);
    }

    // Compute delta from last value
    const lastEntry = counter.values[counter.values.length - 1];
    let delta: number | null = null;
    if (lastEntry) {
      const lastNum = Number(lastEntry.value);
      const newNum = Number(newValue);
      if (Number.isFinite(lastNum) && Number.isFinite(newNum)) {
        delta = newNum - lastNum;
      }
    }

    const entry: CounterValue = {
      value: newValue,
      interactionId,
      delta,
    };

    counter.values.push(entry);
    return counter;
  }

  /**
   * Get the latest value of a counter.
   */
  getLatest(elementPath: string): string | null {
    const counter = this.counters.get(`counter:${elementPath}`);
    if (!counter || counter.values.length === 0) return null;
    return counter.values[counter.values.length - 1].value;
  }

  /**
   * Get a counter record by element path.
   */
  get(elementPath: string): CounterRecord | undefined {
    return this.counters.get(`counter:${elementPath}`);
  }

  /**
   * All counters as a map.
   */
  snapshot(): Map<string, CounterRecord> {
    return new Map(this.counters);
  }

  get size(): number {
    return this.counters.size;
  }

  clear(): void {
    this.counters.clear();
  }
}
