import { describe, it, expect, beforeEach } from 'vitest';
import { ActionIdGenerator } from '../src/recorder/action-id';

describe('ActionIdGenerator', () => {
  let gen: ActionIdGenerator;

  beforeEach(() => {
    gen = new ActionIdGenerator();
  });

  describe('next()', () => {
    it('generates sequential IDs starting from nav-0001', () => {
      expect(gen.next()).toBe('nav-0001');
      expect(gen.next()).toBe('nav-0002');
      expect(gen.next()).toBe('nav-0003');
    });

    it('zero-pads to 4 digits', () => {
      // Generate 9 more (already at 0, so 10 total)
      for (let i = 0; i < 10; i++) {
        gen.next();
      }
      expect(gen.count).toBe(10);
      // Next should be nav-0011
      expect(gen.next()).toBe('nav-0011');
    });

    it('zero-pads through hundreds', () => {
      const fastGen = new ActionIdGenerator('nav', 98);
      expect(fastGen.next()).toBe('nav-0099');
      expect(fastGen.next()).toBe('nav-0100');
      expect(fastGen.next()).toBe('nav-0101');
    });

    it('zero-pads through thousands', () => {
      const fastGen = new ActionIdGenerator('nav', 998);
      expect(fastGen.next()).toBe('nav-0999');
      expect(fastGen.next()).toBe('nav-1000');
      expect(fastGen.next()).toBe('nav-1001');
    });
  });

  describe('uniqueness', () => {
    it('never produces duplicate IDs within a session', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(gen.next());
      }
      expect(ids.size).toBe(1000);
    });

    it('different generators produce independent sequences', () => {
      const genA = new ActionIdGenerator();
      const genB = new ActionIdGenerator();
      expect(genA.next()).toBe('nav-0001');
      expect(genB.next()).toBe('nav-0001');
      expect(genA.next()).toBe('nav-0002');
    });
  });

  describe('reset()', () => {
    it('resets the counter to zero', () => {
      gen.next();
      gen.next();
      gen.next();
      expect(gen.count).toBe(3);
      gen.reset();
      expect(gen.count).toBe(0);
      expect(gen.next()).toBe('nav-0001');
    });
  });

  describe('custom prefix', () => {
    it('uses the custom prefix', () => {
      const clickGen = new ActionIdGenerator('click');
      expect(clickGen.next()).toBe('click-0001');
      expect(clickGen.next()).toBe('click-0002');
    });
  });

  describe('count getter', () => {
    it('reflects the current counter without incrementing', () => {
      expect(gen.count).toBe(0);
      gen.next();
      expect(gen.count).toBe(1);
      gen.next();
      expect(gen.count).toBe(2);
    });
  });

  describe('advanceTo()', () => {
    it('advances counter so next() continues from the correct number', () => {
      gen.advanceTo(5);
      expect(gen.next()).toBe('nav-0006');
    });

    it('does not decrease the counter when given a lower number', () => {
      gen.next(); // counter = 1
      gen.advanceTo(0); // should be a no-op
      expect(gen.next()).toBe('nav-0002');
    });

    it('handles zero (no-op on fresh generator)', () => {
      gen.advanceTo(0);
      expect(gen.next()).toBe('nav-0001');
    });
  });
});
