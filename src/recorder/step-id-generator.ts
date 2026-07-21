/**
 * Step ID Generator — produces unique, sequential Step IDs
 * for generated test steps.
 *
 * Format: "step-0001", "step-0002", "step-0003", ...
 * Zero-padded to 4 digits for clean display.
 */
export class StepIdGenerator {
  private counter: number;
  private readonly prefix: string;

  constructor(prefix = 'step', start = 0) {
    this.prefix = prefix;
    this.counter = start;
  }

  /**
   * Generate the next sequential Step ID.
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
