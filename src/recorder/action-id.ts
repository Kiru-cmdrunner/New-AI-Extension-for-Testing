/**
 * Action ID Generator — produces unique, sequential Action IDs
 * for recorded events.
 *
 * Format: "nav-0001", "nav-0002", "nav-0003", ...
 * Zero-padded to 4 digits for clean display.
 */
export class ActionIdGenerator {
  private counter: number;
  private readonly prefix: string;

  constructor(prefix = 'nav', start = 0) {
    this.prefix = prefix;
    this.counter = start;
  }

  /**
   * Generate the next sequential Action ID.
   */
  next(): string {
    this.counter += 1;
    return `${this.prefix}-${String(this.counter).padStart(4, '0')}`;
  }

  /**
   * Get the current counter value (for testing / reset).
   */
  get count(): number {
    return this.counter;
  }

  /**
   * Reset the counter back to zero.
   */
  reset(): void {
    this.counter = 0;
  }

  /**
   * Advance the counter to at least `num` so that the next `next()` call
   * returns `num + 1`. Used when restoring state from storage.
   */
  advanceTo(num: number): void {
    if (num > this.counter) {
      this.counter = num;
    }
  }
}
