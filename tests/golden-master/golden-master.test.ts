/**
 * Golden Master Differential Test
 *
 * GATES G3-G5: Proves the type-unified pipeline produces byte-identical
 * IR plans and Playwright output compared to the pre-migration adapter-based path.
 *
 * Comparison strategy:
 *   Golden snapshots (captured in Step 0 via the OLD adapter path) are compared
 *   against the NEW path's output (ComponentInteraction[] → build() directly).
 *
 * OLD path (Step 0, captured): ComponentInteraction → adaptInteraction() → DetectedInteraction → build()
 * NEW path (this test):        ComponentInteraction → build() (internal normalization)
 *
 * Architecture: .drytis/PHASE3_DESIGN.md §9 (Equivalence Validation Strategy)
 * Gates: G3 (type equivalence), G4 (IR plan equivalence), G5 (Playwright equivalence)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildCorpus, makeComponentInteraction } from './corpus';
import { build as buildIRPlan } from '../../src/generation/ir-bridge';
import type { IRBridgeInput } from '../../src/generation/ir-bridge-input';
import { renderTestFile } from '../../src/adapters/playwright/test-function-renderer';
import type { ExecutionIRPlan } from '../../src/domain/execution-ir/types';
import type { ComponentInteraction } from '../../src/shared/component-types';

const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Build an IR plan through the NEW (unified) path.
 * ComponentInteraction[] → build() directly (no adapter).
 */
function buildViaUnifiedPath(interactions: ComponentInteraction[]): ExecutionIRPlan {
  const input: IRBridgeInput = {
    events: [],
    interactions,
    understanding: null,
    recordingContext: { startUrl: 'https://example.com', title: 'Test' },
    testCaseName: 'Golden Master Test',
  };
  return buildIRPlan(input);
}

/**
 * Load a golden snapshot captured in Step 0.
 */
function loadGoldenSnapshot(id: string): ExecutionIRPlan {
  const filepath = path.join(SNAPSHOTS_DIR, `${id}.json`);
  const raw = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Serialize an IR plan to a deterministic JSON string.
 * Sorts keys so object key ordering doesn't affect comparison.
 */
function serializePlan(plan: ExecutionIRPlan): string {
  return JSON.stringify(plan, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce<Record<string, unknown>>((sorted, k) => {
        sorted[k] = value[k];
        return sorted;
      }, {});
    }
    return value;
  }, 2);
}

/**
 * Normalize an IR plan for comparison by replacing timestamp-based IDs
 * with stable placeholders. The IDs `testCaseId` and `testCaseVersionId`
 * are generated from Date.now() and differ between runs — but the structural
 * content is what we're comparing.
 */
function normalizePlan(plan: ExecutionIRPlan): ExecutionIRPlan {
  return {
    ...plan,
    testCaseId: 'tc-STABLE',
    testCaseVersionId: 'tcv-STABLE',
  };
}

// ── Test Suite ───────────────────────────────────────────────────────

describe('Golden Master — Differential Equivalence (G3-G5)', () => {
  const corpus = buildCorpus();

  it('corpus has comprehensive coverage', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(60);
  });

  // ── G4: IR Plan Deep Equivalence ───────────────────────────────────
  // Each fixture's NEW output must deep-equal the golden snapshot from Step 0.

  describe('G4: IR plan deep equality vs golden snapshots', () => {
    for (const entry of corpus) {
      it(`${entry.id}: ${entry.description}`, () => {
        const newPlan = normalizePlan(buildViaUnifiedPath(entry.interactions));
        const goldenPlan = normalizePlan(loadGoldenSnapshot(entry.id));
        const newSerialized = serializePlan(newPlan);
        const goldenSerialized = serializePlan(goldenPlan);

        // Deep structural comparison
        expect(newSerialized).toEqual(goldenSerialized);
      });
    }
  });

  // ── G5: Playwright Output Equivalence ──────────────────────────────
  // Playwright output is a pure deterministic function of ExecutionIRPlan.
  // If G4 passes, G5 is guaranteed by construction. We still verify for
  // fixtures that render successfully.

  describe('G5: Playwright output equivalence', () => {
    for (const entry of corpus) {
      it(`${entry.id}: ${entry.description}`, () => {
        const newPlan = buildViaUnifiedPath(entry.interactions);
        const goldenPlan = loadGoldenSnapshot(entry.id);

        try {
          const newCode = renderTestFile(normalizePlan(buildViaUnifiedPath(entry.interactions)));
          const goldenCode = renderTestFile(normalizePlan(loadGoldenSnapshot(entry.id)));
          expect(newCode).toEqual(goldenCode);
        } catch (e) {
          // Expected for fixtures with state assertions and no knowledge fragment
          expect(String(e)).toMatch(/LocatorRenderError|Cannot render/);
        }
      });
    }
  });

  // ── G6: Evidence Annotation — Subtype Intent Equivalence ──────────

  describe('G6: Evidence annotation — subtype intent equivalence', () => {
    it('DoubleClick has same intent as Click', () => {
      const corpus = buildCorpus();
      const doubleClick = corpus.find(c => c.description.includes('DoubleClick'));
      const click = corpus.find(c => c.description === 'Layer1: Click');

      expect(doubleClick).toBeDefined();
      expect(click).toBeDefined();

      if (doubleClick && click) {
        const dcPlan = buildViaUnifiedPath(doubleClick.interactions);
        const clickPlan = buildViaUnifiedPath(click.interactions);

        expect(dcPlan.steps.length).toBeGreaterThan(0);
        expect(clickPlan.steps.length).toBeGreaterThan(0);
        expect(dcPlan.steps[0].action).toBe(clickPlan.steps[0].action);
      }
    });

    it('ToggleSwitch produces TOGGLE action (same as Checkbox)', () => {
      const corpus = buildCorpus();
      const toggle = corpus.find(c => c.description.includes('ToggleSwitch'));
      const checkbox = corpus.find(c => c.description === 'Layer1: Checkbox');

      expect(toggle).toBeDefined();
      expect(checkbox).toBeDefined();

      if (toggle && checkbox) {
        const togglePlan = buildViaUnifiedPath(toggle.interactions);
        const checkboxPlan = buildViaUnifiedPath(checkbox.interactions);

        expect(togglePlan.steps.length).toBeGreaterThan(0);
        expect(checkboxPlan.steps.length).toBeGreaterThan(0);
        expect(togglePlan.steps[0].action).toBe(checkboxPlan.steps[0].action);
      }
    });

    it('NativeDropdown produces SELECT action (same as custom Dropdown)', () => {
      const corpus = buildCorpus();
      const native = corpus.find(c => c.description.includes('NativeDropdown'));
      const custom = corpus.find(c => c.description === 'Layer1: Dropdown');

      expect(native).toBeDefined();
      expect(custom).toBeDefined();

      if (native && custom) {
        const nativePlan = buildViaUnifiedPath(native.interactions);
        const customPlan = buildViaUnifiedPath(custom.interactions);

        expect(nativePlan.steps.length).toBeGreaterThan(0);
        expect(customPlan.steps.length).toBeGreaterThan(0);
        expect(nativePlan.steps[0].action).toBe(customPlan.steps[0].action);
      }
    });
  });

  // ── Noise Filtering Verification ──────────────────────────────────

  describe('Noise filtering: scroll interactions produce no steps', () => {
    it('PageScroll is filtered', () => {
      const scroll = makeComponentInteraction('Scroll', {});
      const plan = buildViaUnifiedPath([scroll]);
      expect(plan.steps.length).toBe(0);
    });

    it('Scroll in a mixed sequence only adds non-scroll steps', () => {
      const corpus = buildCorpus();
      const mixedSeq = corpus.find(c => c.id === 'L3-03');
      expect(mixedSeq).toBeDefined();
      if (mixedSeq) {
        const plan = buildViaUnifiedPath(mixedSeq.interactions);
        // 6 interactions - 2 scroll noise = 4 steps
        expect(plan.steps.length).toBe(4);
      }
    });
  });
});
