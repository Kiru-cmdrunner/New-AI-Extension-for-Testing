/**
 * Element ID Generator — produces unique, sequential Element IDs
 * for clicked elements.
 *
 * Format: "elem-0001", "elem-0002", "elem-0003", ...
 * Zero-padded to 4 digits for clean display.
 *
 * Used by the background service worker to assign Element IDs to
 * click events. Each Element ID is associated with an Action ID.
 */
export class ElementIdGenerator {
  private counter: number;
  private readonly prefix: string;

  constructor(prefix = 'elem', start = 0) {
    this.prefix = prefix;
    this.counter = start;
  }

  /**
   * Generate the next sequential Element ID.
   */
  next(): string {
    this.counter += 1;
    return `${this.prefix}-${String(this.counter).padStart(4, '0')}`;
  }

  /**
   * Get the current counter value.
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
