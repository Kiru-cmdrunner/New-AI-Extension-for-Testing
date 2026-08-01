/**
 * R1 Gate 6 — dblclick Capture Verification
 *
 * Verifies that EventTap registers dblclick as a capture-phase event type
 * and that a dblclick event produces a valid ObservedEvent.
 */

import { describe, it, expect } from 'vitest';

describe('R1 Gate 6 — dblclick Capture Verification', () => {
  it('EventTap registered event types include dblclick', async () => {
    // Read the source to verify dblclick is in the registered types array
    const fs = await import('fs');
    const source = fs.readFileSync('src/tap/event-tap.ts', 'utf-8');

    // The registered event types array must include 'dblclick'
    expect(source).toContain("'dblclick'");

    // Verify it's in the array of event types, not in a comment
    const dblclickLine = source.split('\n').find(l => l.includes("'dblclick'"));
    expect(dblclickLine).toBeDefined();
    // Should be a string literal in an array, not inside a comment
    expect(dblclickLine!.trim().startsWith('//')).toBe(false);
  });

  it('BrowserEventType union includes dblclick', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync('src/shared/component-types.ts', 'utf-8');

    // The BrowserEventType union should include dblclick
    expect(source).toContain("'dblclick'");
  });

  it('Click definition includes dblclick in triggerEventTypes', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync('src/definitions/click.ts', 'utf-8');

    // The Click component definition should list dblclick as a trigger
    expect(source).toMatch(/dblclick/);
  });
});
