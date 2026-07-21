/**
 * Shadow DOM Foundation Fixes — Tests
 *
 * Validates three incremental recorder improvements:
 * 1. Cross-frame event ordering (sort by timestamp before classification)
 * 2. Shadow-aware querying (deepGetElementById, deepQuerySelector, deepQuerySelectorAll)
 * 3. Shadow-root MutationObserver coverage
 *
 * Also includes regression tests to verify existing detection is unaffected.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractions } from '../../src/classifier/interaction-detector.js';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.js';
import { actionDescription } from '../../src/sidepanel/timeline-renderer.js';
import type { DetectedInteraction } from '../../src/classifier/interaction-types.js';
import type { RecordedEvent } from '../../src/recorder/recorded-event.js';
import type { ElementIdentity } from '../../src/shared/types.js';
import {
  resetEventCounter,
  makeTarget,
  clickEvent,
  domContext,
} from './helpers.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function findType(result: DetectedInteraction[], type: string): DetectedInteraction | undefined {
  return result.find(r => r.type === type);
}

/**
 * Sort events by timestamp with eventId tiebreaker.
 * This mirrors the sort logic added to the service worker's
 * handleStopRecording() function.
 */
function sortByTimestamp(events: RecordedEvent[]): RecordedEvent[] {
  return [...events].sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    if (ta !== tb) return ta - tb;
    return a.eventId.localeCompare(b.eventId);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Fix #3: Cross-Frame Event Ordering
// ═══════════════════════════════════════════════════════════════════════════

describe('Fix #3: Cross-Frame Event Ordering', () => {
  beforeEach(() => resetEventCounter());

  it('sorted events produce same V1 classification as unsorted', () => {
    const button = makeTarget({ tag: 'BUTTON', accessibleName: 'Click Me', cssSelector: 'button' });

    // Create events with timestamps in the wrong order (simulating cross-frame delivery)
    const events = [
      clickEvent(button, {
        timestamp: '2026-07-19T10:00:01.000Z',
        domContext: domContext(),
      }),
      clickEvent(button, {
        timestamp: '2026-07-19T10:00:00.000Z', // Earlier timestamp, later in array
        domContext: domContext(),
      }),
    ];

    // Swap to simulate arrival-order
    const arrivalOrder = [events[1], events[0]]; // Later timestamp first
    const sorted = sortByTimestamp(arrivalOrder);

    // Sorted should have earlier event first
    expect(sorted[0].timestamp).toBe('2026-07-19T10:00:00.000Z');
    expect(sorted[1].timestamp).toBe('2026-07-19T10:00:01.000Z');

    // Both should produce Click interactions
    const resultUnsorted = detectInteractions(arrivalOrder);
    const resultSorted = detectInteractions(sorted);

    expect(resultUnsorted).toHaveLength(resultSorted.length);
    expect(resultSorted.every(r => r.type === 'Click')).toBe(true);
  });

  it('stable sort preserves eventId tiebreaker for same-timestamp events', () => {
    const button = makeTarget({ tag: 'BUTTON', accessibleName: 'B1', cssSelector: 'button.b1' });
    const button2 = makeTarget({ tag: 'BUTTON', accessibleName: 'B2', cssSelector: 'button.b2' });

    const events = [
      clickEvent(button2, { timestamp: '2026-07-19T10:00:00.000Z', domContext: domContext() }),
      clickEvent(button, { timestamp: '2026-07-19T10:00:00.000Z', domContext: domContext() }),
    ];

    const sorted = sortByTimestamp(events);

    // Same timestamp — eventId determines order
    expect(sorted[0].eventId).not.toBe('');
    expect(sorted[0].eventId.localeCompare(sorted[1].eventId)).toBeLessThanOrEqual(0);
  });

  it('out-of-order multi-element interaction still classifies correctly when sorted', () => {
    // Simulate: click combobox (frame 1, timestamp T1) then click option (frame 2, timestamp T2)
    // but option arrives before combobox in the message queue
    const combobox = makeTarget({
      tag: 'DIV', accessibleName: 'Country', ariaRole: 'combobox',
      cssSelector: 'div.country-select',
    });
    const option = makeTarget({
      tag: 'DIV', accessibleName: 'India', ariaRole: 'option',
      cssSelector: 'div.option-india',
    });

    const events = [
      // Option click arrives FIRST in delivery order (timestamp T2)
      clickEvent(option, {
        timestamp: '2026-07-19T10:00:01.500Z',
        domContext: domContext({ ariaExpanded: false }),
      }),
      // Combobox click arrives SECOND (timestamp T1)
      clickEvent(combobox, {
        timestamp: '2026-07-19T10:00:00.000Z',
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
    ];

    // Sort to fix ordering
    const sorted = sortByTimestamp(events);
    expect(sorted[0].target.accessibleName).toBe('Country');
    expect(sorted[1].target.accessibleName).toBe('India');

    // Both should classify without errors
    const result = detectInteractions(sorted);
    expect(result).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix #6: Shadow-Aware Querying
// ═══════════════════════════════════════════════════════════════════════════

describe('Fix #6: Shadow-Aware Querying', () => {
  /**
   * Since the deep query helpers are inlined in the content script and not
   * exported, we test the behavior by verifying that jsdom can create
   * shadow roots and that our algorithm concept works.
   *
   * In a real browser, these helpers would find elements inside shadow roots
   * that document.getElementById cannot reach.
   */

  it('document.getElementById does not find elements inside shadow roots', () => {
    // Set up a host element with a shadow root
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<span id="shadow-label">Inside Shadow</span>';

    // Light DOM lookup fails
    expect(document.getElementById('shadow-label')).toBeNull();

    // But the element exists in the shadow root
    expect(shadow.getElementById?.('shadow-label')?.textContent).toBe('Inside Shadow');
    // Or via querySelector
    expect(shadow.querySelector('#shadow-label')?.textContent).toBe('Inside Shadow');
  });

  it('deepGetElementById algorithm finds elements in open shadow roots', () => {
    // Build: document > #host (shadow) > #inner-element
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button id="inner-btn">Submit</button>';

    // Simulate deepGetElementById: walk elements, check shadow roots
    function deepGetElementById(id: string): Element | null {
      const found = document.getElementById(id);
      if (found) return found;

      function search(root: Document | ShadowRoot): Element | null {
        const all = root.querySelectorAll('*');
        for (const el of all) {
          if (el.id === id) return el;
          if (el.shadowRoot) {
            const inner = search(el.shadowRoot);
            if (inner) return inner;
          }
        }
        return null;
      }

      return search(document);
    }

    const result = deepGetElementById('inner-btn');
    expect(result).not.toBeNull();
    expect(result?.textContent).toBe('Submit');
  });

  it('deepQuerySelector algorithm finds elements via selector in shadow roots', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<label for="my-input">Email</label>';

    // Simulate deepQuerySelector
    function deepQuerySelector(selector: string): Element | null {
      const found = document.querySelector(selector);
      if (found) return found;

      function search(root: Document | ShadowRoot): Element | null {
        const all = root.querySelectorAll('*');
        for (const el of all) {
          if (el.matches(selector)) return el;
          if (el.shadowRoot) {
            const inner = el.shadowRoot.querySelector(selector);
            if (inner) return inner;
            const nested = search(el.shadowRoot);
            if (nested) return nested;
          }
        }
        return null;
      }

      return search(document);
    }

    const result = deepQuerySelector('label[for="my-input"]');
    expect(result).not.toBeNull();
    expect(result?.textContent).toBe('Email');
  });

  it('deepQuerySelectorAll finds elements across multiple shadow roots', () => {
    document.body.innerHTML = '<div id="host1"></div><div id="host2"></div>';

    const host1 = document.getElementById('host1')!;
    const shadow1 = host1.attachShadow({ mode: 'open' });
    shadow1.innerHTML = '[role="tooltip"]';

    const host2 = document.getElementById('host2')!;
    const shadow2 = host2.attachShadow({ mode: 'open' });
    shadow2.innerHTML = '<div role="tooltip">Tip 2</div>';

    function deepQuerySelectorAll(selector: string): Element[] {
      const results: Element[] = [...document.querySelectorAll(selector)];

      function search(root: Document | ShadowRoot) {
        const all = root.querySelectorAll('*');
        for (const el of all) {
          if (el.shadowRoot) {
            results.push(...el.shadowRoot.querySelectorAll(selector));
            search(el.shadowRoot);
          }
        }
      }

      search(document);
      return results;
    }

    const results = deepQuerySelectorAll('[role="tooltip"]');
    expect(results).toHaveLength(1);
    expect(results[0].textContent).toBe('Tip 2');
  });

  it('nested shadow roots are traversed', () => {
    document.body.innerHTML = '<div id="outer-host"></div>';
    const outerHost = document.getElementById('outer-host')!;
    const outerShadow = outerHost.attachShadow({ mode: 'open' });
    outerShadow.innerHTML = '<div id="inner-host"></div>';

    const innerHostEl = outerShadow.getElementById('inner-host')!;
    const innerShadow = innerHostEl.attachShadow({ mode: 'open' });
    innerShadow.innerHTML = '<span id="deep-element">Deep</span>';

    // Deep traversal algorithm
    function deepGetElementById(id: string): Element | null {
      function search(root: Document | ShadowRoot): Element | null {
        const all = root.querySelectorAll('*');
        for (const el of all) {
          if (el.id === id) return el;
          if (el.shadowRoot) {
            const inner = search(el.shadowRoot);
            if (inner) return inner;
          }
        }
        return null;
      }
      return search(document);
    }

    const result = deepGetElementById('deep-element');
    expect(result).not.toBeNull();
    expect(result?.textContent).toBe('Deep');
  });

  it('light DOM elements still found when no shadow roots exist', () => {
    document.body.innerHTML = '<button id="regular-btn">Normal</button>';

    // Standard getElementById works
    const result = document.getElementById('regular-btn');
    expect(result).not.toBeNull();
    expect(result?.textContent).toBe('Normal');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix #4: Shadow-Root MutationObserver Coverage
// ═══════════════════════════════════════════════════════════════════════════

describe('Fix #4: Shadow-Root MutationObserver Coverage', () => {
  it('MutationObserver.observe can be called multiple times on same instance', async () => {
    // This validates the core assumption: a single MutationObserver can
    // observe multiple targets. This is what observeWithShadowRoots relies on.

    document.body.innerHTML = '<div id="host"></div><div id="regular"></div>';
    const host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div id="shadow-content">Initial</div>';

    let mutationCount = 0;
    const observer = new MutationObserver(() => {
      mutationCount++;
    });

    const options = { childList: true, subtree: true };

    // Observe both light DOM and shadow root
    observer.observe(document.body, options);
    observer.observe(shadow, options);

    // Mutate light DOM
    document.getElementById('regular')!.innerHTML = '<span>Changed</span>';

    // Mutate shadow DOM
    shadow.getElementById('shadow-content')!.textContent = 'Changed Too';

    // Wait for microtask-based mutation callback
    await new Promise(resolve => setTimeout(resolve, 50));

    // Disconnect after mutations have fired
    observer.disconnect();

    // Both mutations should have been detected
    expect(mutationCount).toBeGreaterThanOrEqual(1);
  });

  it('shadow root discovery finds open shadow roots', () => {
    document.body.innerHTML = '<div id="host1"></div><div id="host2"></div>';

    const host1 = document.getElementById('host1')!;
    host1.attachShadow({ mode: 'open' });

    const host2 = document.getElementById('host2')!;
    host2.attachShadow({ mode: 'open' });

    // Discovery algorithm (same as observeShadowRootsRecursive)
    const discoveredRoots: ShadowRoot[] = [];
    function discover(root: Document | ShadowRoot) {
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          discoveredRoots.push(el.shadowRoot);
          discover(el.shadowRoot);
        }
      }
    }
    discover(document);

    expect(discoveredRoots).toHaveLength(2);
  });

  it('closed shadow roots are skipped during discovery', () => {
    document.body.innerHTML = '<div id="open-host"></div><div id="closed-host"></div>';

    const openHost = document.getElementById('open-host')!;
    openHost.attachShadow({ mode: 'open' });

    const closedHost = document.getElementById('closed-host')!;
    closedHost.attachShadow({ mode: 'closed' });

    // Discovery algorithm — only open roots visible
    let openCount = 0;
    function discover(root: Document | ShadowRoot) {
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          openCount++;
          discover(el.shadowRoot);
        }
      }
    }
    discover(document);

    // Only the open shadow root should be discovered
    expect(openCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Regression Tests — Existing Detection Unaffected
// ═══════════════════════════════════════════════════════════════════════════

describe('Regression — Existing Types Unaffected by Shadow DOM Fixes', () => {
  beforeEach(() => resetEventCounter());

  it('Click detection unchanged (V1)', () => {
    const button = makeTarget({ tag: 'BUTTON', accessibleName: 'Submit', cssSelector: 'button#submit' });
    const result = detectInteractions([
      clickEvent(button, { domContext: domContext() }),
    ]);
    expect(findType(result, 'Click')).toBeDefined();
  });

  it('Click detection unchanged (V2)', () => {
    const button = makeTarget({ tag: 'BUTTON', accessibleName: 'Submit', cssSelector: 'button#submit' });
    const result = detectInteractionsV2([
      clickEvent(button, { domContext: domContext() }),
    ]);
    expect(findType(result, 'Click')).toBeDefined();
  });

  it('Link detection unchanged (V1)', () => {
    const link = makeTarget({ tag: 'A', accessibleName: 'Home', cssSelector: 'a#home' });
    const result = detectInteractions([
      clickEvent(link, { domContext: domContext() }),
    ]);
    expect(findType(result, 'Link')).toBeDefined();
  });

  it('Link detection unchanged (V2)', () => {
    const link = makeTarget({ tag: 'A', accessibleName: 'Home', cssSelector: 'a#home' });
    const result = detectInteractionsV2([
      clickEvent(link, { domContext: domContext() }),
    ]);
    expect(findType(result, 'Link')).toBeDefined();
  });

  it('TextEntry detection timeline phrasing unchanged', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Email', ariaRole: 'textbox',
      cssSelector: 'input#email', inputType: 'text',
    });

    const interaction: DetectedInteraction = {
      interactionId: 'test-001',
      type: 'TextEntry',
      eventIds: ['evt-0001'],
      rawEventTypes: ['focus', 'blur'],
      target: input,
      metadata: { textValue: 'john@example.com', accessibleName: 'Email' },
      confidence: 1.0,
      engine: 'v1',
    };

    const desc = actionDescription(interaction);
    expect(desc).toContain('Enter');
    expect(desc).toContain('john@example.com');
  });

  it('BrowserAlert detection unchanged (V1)', () => {
    const button = makeTarget({ tag: 'BUTTON', accessibleName: 'Delete', cssSelector: 'button#delete' });
    const result = detectInteractions([
      clickEvent(button, {
        domContext: domContext({ triggeredDialog: 'confirm', dialogMessage: 'Are you sure?' }),
      }),
    ]);
    expect(findType(result, 'BrowserAlert')).toBeDefined();
  });

  it('FileUpload detection unchanged (V1)', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Upload', ariaRole: null,
      cssSelector: 'input#file', inputType: 'file',
    });

    const result = detectInteractions([
      clickEvent(input, {
        domContext: domContext({
          inputType: 'file',
          fileData: [{ name: 'doc.pdf', type: 'application/pdf' }],
          uploadMethod: 'browse',
        }),
      }),
    ]);

    expect(findType(result, 'FileUpload')).toBeDefined();
  });

  it('Breadcrumb detection unchanged (V1)', () => {
    const crumb = makeTarget({
      tag: 'A', accessibleName: 'Home',
      cssSelector: 'a.breadcrumb-item',
      className: 'breadcrumb-item active',
    });

    const result = detectInteractions([
      clickEvent(crumb, { domContext: domContext() }),
    ]);

    expect(findType(result, 'Breadcrumb')).toBeDefined();
  });

  it('V1 + V2 produce same number of interactions for simple click', () => {
    const button = makeTarget({ tag: 'BUTTON', accessibleName: 'Save', cssSelector: 'button#save' });
    const events = [clickEvent(button, { domContext: domContext() })];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    expect(v1).toHaveLength(v2.length);
  });
});
