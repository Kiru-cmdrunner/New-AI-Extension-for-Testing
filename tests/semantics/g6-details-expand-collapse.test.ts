/**
 * G6 Native <details> Expand/Collapse — M2 Semantic Effect Rule Tests
 *
 * Tests the checkExpandCollapse rule's <details open> attribute branch.
 * When a <details> element's `open` attribute is toggled, M2 should produce
 * a high-confidence expand-collapse effect.
 *
 * The `open` attribute is a boolean HTML attribute:
 *   - Absent (oldValue=null) = collapsed
 *   - Present (newValue='') = expanded
 *   - Or vice versa when closing
 *
 * Architecture: .drytis/specs/m0a-architecture-validation.md §2.3 (G6)
 */

import { describe, it, expect } from 'vitest';
import { checkExpandCollapse } from '../../src/semantics/effect-rules';
import type { ObservationResult, MutationRecord2 } from '../../src/shared/observation-types';
import type { InterpretationContext } from '../../src/semantics/interpretation-context';

// ── Helpers ───────────────────────────────────────────────────────────

function makeMutation(
  overrides: Partial<MutationRecord2> = {},
): MutationRecord2 {
  return {
    id: 1,
    type: 'attributes',
    targetPath: 'details.section-info',
    targetTag: 'DETAILS',
    attributeName: 'open',
    oldValue: null,
    newValue: '',
    addedNodesCount: 0,
    removedNodesCount: 0,
    timestamp: 1500,
    windowIds: ['obs-evt-1'],
    ...overrides,
  };
}

function makeResult(
  mutations: MutationRecord2[],
  overrides: Partial<ObservationResult> = {},
): ObservationResult {
  return {
    sourceEventId: 'evt-1',
    sourceEventType: 'click',
    windowId: 'obs-evt-1',
    openedAt: 1000,
    closedAt: 4000,
    durationMs: 3000,
    endReason: 'completed',
    beforeSnapshot: null,
    finalSnapshot: null,
    mutations,
    mutationCount: mutations.length,
    documentWideMutationTotal: mutations.length,
    ...overrides,
  };
}

function makeCtx(): InterpretationContext {
  return {
    interactionType: 'Click',
    triggerRole: 'button',
    triggerLabel: 'More Info',
    triggerCssPath: 'summary.section-info',
  };
}

// ── <details> open attribute mutations ────────────────────────────────

describe('G6 <details> open attribute — expand-collapse', () => {
  it('detects expand (null → empty string = attribute added)', () => {
    const result = makeResult([
      makeMutation({ oldValue: null, newValue: '' }),
    ]);
    const effects = checkExpandCollapse(result, makeCtx());
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('expand-collapse');
    expect(effects[0].confidence).toBe('high');
    expect(effects[0].confidenceBasis).toBe('direct-property');
    expect(effects[0].description).toContain('collapsed');
    expect(effects[0].description).toContain('expanded');
  });

  it('detects collapse (empty string → null = attribute removed)', () => {
    const result = makeResult([
      makeMutation({ oldValue: '', newValue: null }),
    ]);
    const effects = checkExpandCollapse(result, makeCtx());
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('expand-collapse');
    expect(effects[0].description).toContain('expanded');
    expect(effects[0].description).toContain('collapsed');
  });

  it('ignores open mutation on non-DETAILS element', () => {
    const result = makeResult([
      makeMutation({ targetTag: 'DIV', oldValue: null, newValue: '' }),
    ]);
    const effects = checkExpandCollapse(result, makeCtx());
    expect(effects).toHaveLength(0);
  });

  it('does NOT fire when old and new values are same', () => {
    const result = makeResult([
      makeMutation({ oldValue: '', newValue: '' }),
    ]);
    const effects = checkExpandCollapse(result, makeCtx());
    expect(effects).toHaveLength(0);
  });

  it('works alongside aria-expanded snapshot detection', () => {
    // Both <details open> mutation AND aria-expanded snapshot exist
    const result = makeResult([
      makeMutation({ oldValue: null, newValue: '' }),
    ], {
      beforeSnapshot: {
        value: null,
        checked: null,
        className: '',
        disabled: false,
        ariaExpanded: false,
        ariaChecked: null,
        ariaPressed: null,
        textContent: null,
        childCount: 0,
        capturedAt: 990,
      },
      finalSnapshot: {
        value: null,
        checked: null,
        className: '',
        disabled: false,
        ariaExpanded: true,
        ariaChecked: null,
        ariaPressed: null,
        textContent: null,
        childCount: 0,
        capturedAt: 3990,
      },
    });
    const effects = checkExpandCollapse(result, makeCtx());
    // Snapshot delta fires first and returns early
    expect(effects).toHaveLength(1);
    expect(effects[0].confidence).toBe('high');
  });

  it('fires even when aria-expanded is not on the element', () => {
    // Native <details> may not use aria-expanded — only the open attribute
    const result = makeResult([
      makeMutation({ oldValue: null, newValue: '' }),
    ]);
    const effects = checkExpandCollapse(result, makeCtx());
    expect(effects).toHaveLength(1);
    expect(effects[0].description).toContain('details:');
  });

  it('emits effect with correct targetPath from mutation', () => {
    const result = makeResult([
      makeMutation({ targetPath: 'body > main > details.accordion-item', oldValue: null, newValue: '' }),
    ]);
    const effects = checkExpandCollapse(result, makeCtx());
    expect(effects[0].affectedTarget.cssPath).toBe('body > main > details.accordion-item');
  });
});
