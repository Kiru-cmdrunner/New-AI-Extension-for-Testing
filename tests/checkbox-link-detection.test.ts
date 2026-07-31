/**
 * Tests for checkbox-link detection fix.
 *
 * Problem: Sites like Amazon render filter toggles as <a> tags (ariaRole='link').
 * Clicking them should be classified as Checkbox when:
 *   1. The <a> has aria-checked (getImplicitRole returns 'checkbox')
 *   2. The recorder captured a checked-state transition (checkedBefore/checkedAfter)
 *   3. The <a> wraps an inner checkbox element (captureCheckedState descendant walk)
 *
 * These tests verify the classifier safety-net (Layer 3):
 * If a link element has checkedBefore/checkedAfter on its click event,
 * classify as Checkbox instead of Link.
 */

import { describe, it, expect } from 'vitest';
import { detectInteractions } from '../src/classifier/interaction-detector';
import type { RecordedEvent, ElementRecordedEvent } from '../src/recorder/recorded-event';
import type { ElementIdentity } from '../src/shared/types';

// ── Helpers ─────────────────────────────────────────────────────────────

function identity(tag: string, name: string, extras: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: name,
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag,
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: tag.toLowerCase(),
    xPath: `//${tag.toLowerCase()}`,
    inIframe: false,
    shadowDom: false,
    elementId: '',
    ...extras,
  };
}

function elEvent(
  eventType: ElementRecordedEvent['eventType'],
  target: ElementIdentity,
  id: string,
  timestamp = '2026-07-18T08:00:00Z',
  extras: Partial<ElementRecordedEvent> = {},
): RecordedEvent {
  return {
    eventId: id,
    eventType,
    timestamp,
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...extras,
  };
}

// ── Checkbox-like Link tests ────────────────────────────────────────────

describe('Detection — Checkbox-like Link (Amazon filter pattern)', () => {
  it('classifies <a> with ariaRole=link + checked transition as Checkbox', () => {
    // Amazon filter link that has a checked state transition captured
    const filterLink = identity('A', 'Apply the filter vivo to narrow results', {
      ariaRole: 'link',
      stableId: 's-navigation-item-vivo',
      className: 'a-link-normal s-navigation-item',
    });
    const events = [
      elEvent('click', filterLink, 'evt-0001', '2026-07-18T08:00:00Z', {
        checkedBefore: false,
        checkedAfter: true,
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Checkbox');
    expect(interactions[0].metadata.checked).toBe(true);
    expect(interactions[0].confidence).toBeLessThanOrEqual(1.0);
  });

  it('classifies <a> with aria-checked=true → ariaRole=checkbox as Checkbox (Layer 1)', () => {
    // <a aria-checked="true"> — getImplicitRole returns 'checkbox' → standard Checkbox path
    const ariaCheckedLink = identity('A', 'Get It by Tomorrow', {
      ariaRole: 'checkbox',
      stableId: 'delivery-tomorrow',
      className: 's-navigation-item',
    });
    const events = [
      elEvent('click', ariaCheckedLink, 'evt-0001', '2026-07-18T08:00:00Z', {
        checkedBefore: false,
        checkedAfter: true,
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Checkbox');
    expect(interactions[0].metadata.checked).toBe(true);
    expect(interactions[0].confidence).toBe(1.0);
  });

  it('classifies link unchecking action as Checkbox with checked=false', () => {
    const filterLink = identity('A', 'Apply the filter Redmi to narrow results', {
      ariaRole: 'link',
      stableId: 'filter-redmi',
      className: 's-navigation-item',
    });
    const events = [
      elEvent('click', filterLink, 'evt-0001', '2026-07-18T08:00:00Z', {
        checkedBefore: true,
        checkedAfter: false,
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Checkbox');
    expect(interactions[0].metadata.checked).toBe(false);
  });

  it('classifies link with only checkedBefore (no checkedAfter) as Checkbox', () => {
    const filterLink = identity('A', 'Under 20000', {
      ariaRole: 'link',
      stableId: 'price-under-20000',
      className: 's-navigation-item',
    });
    const events = [
      elEvent('click', filterLink, 'evt-0001', '2026-07-18T08:00:00Z', {
        checkedBefore: false,
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Checkbox');
    expect(interactions[0].metadata.checked).toBe(false);
  });
});

// ── Regression: real navigation links must stay as Link ────────────────

describe('Detection — Link regression (no false positives)', () => {
  it('classifies plain <a> without checked transition as Link', () => {
    const link = identity('A', 'Today\'s Deals', {
      ariaRole: 'link',
      stableId: 'nav-todays-deals',
    });
    const events = [elEvent('click', link, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Link');
    // Evidence-based: confidence from tag-anchor signal alone (0.4)
    expect(interactions[0].confidence).toBe(0.4);
  });

  it('classifies <a> with null checkedBefore and null checkedAfter as Link', () => {
    const link = identity('A', 'Cart', {
      ariaRole: 'link',
      stableId: 'nav-cart',
    });
    const events = [
      elEvent('click', link, 'evt-0001', '2026-07-18T08:00:00Z', {
        checkedBefore: null,
        checkedAfter: null,
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Link');
  });

  it('classifies role=link without checked transition as Link', () => {
    const link = identity('SPAN', 'Click here', {
      ariaRole: 'link',
      stableId: 'cta-link',
    });
    const events = [elEvent('click', link, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Link');
  });
});
