/**
 * 6F-M1 A — doctrine pin (automated, review WARN-1)
 *
 * Spec: .drytis/specs/phase-6f-m1-gesture-ownership.md §2.1.A.4 / §3 AC-A5
 *   "The pairing predicate must contain NO timing fields: no Date.now(),
 *   no performance.now(), no timestamp deltas, no elapsed-ms, no captureSeq
 *   arithmetic against constants."
 *
 * The 2026-08-20 owner correction forbids timing rules; this test greps the
 * four gesture-ownership regions of component-runtime.ts so a regression
 * (e.g. reintroducing `captureSeq === mousedown + 1` or a ms window) fails
 * the suite instead of surviving as inspection-only doctrine.
 *
 * Regions are extracted by stable comment markers, so unrelated legit uses
 * of Date.now()/timestamps elsewhere in the runtime (flush, stale cleanup)
 * do not false-positive.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/runtime/component-runtime.ts'),
  'utf8',
);

function sliceBetween(startMarker: string, endMarker: string): string {
  const start = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, start);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  if (end === -1) throw new Error(`marker not found: ${endMarker}`);
  return SRC.slice(start, end);
}

const REGIONS: Array<[string, string, string]> = [
  ['field decl', 'private readonly MAX_GESTURE_RECORDS', 'constructor('],
  ['2c supersession', '2c. 6F-M1', '3. Offer to active stack'],
  ['3b absorption', '3b. 6F-M1', '4. Discovery'],
  ['record creation', '6F-M1 A: record mousedown-completed gestures', '// Emit'],
];

// Forbidden in every region: wall-clock reads, perf reads, timestamp fields,
// ms-window constants, and captureSeq arithmetic against numeric constants.
const FORBIDDEN: Array<[RegExp, string]> = [
  [/Date\.now/, 'Date.now'],
  [/performance\.now/, 'performance.now'],
  [/\btimestamp\b/i, 'timestamp field'],
  [/\bendTime\b/, 'endTime field'],
  [/_MS\b/, 'ms-window constant'],
  [/captureSeq\s*[+\-]\s*\d/, 'captureSeq + <const> arithmetic'],
  [/\d\s*[+\-]\s*\w*[Cc]aptureSeq/, '<const> + captureSeq arithmetic'],
];

describe('6F-M1 A — doctrine pin (no timing rules in the pairing predicate)', () => {
  it('all four gesture-ownership regions exist', () => {
    expect(REGIONS.length).toBe(4);
    for (const [name, start, end] of REGIONS) {
      const region = sliceBetween(start, end);
      expect(region.length, `${name} region must be non-empty`).toBeGreaterThan(20);
    }
  });

  it('no region contains a forbidden timing/arithmetic construct', () => {
    for (const [name, start, end] of REGIONS) {
      const region = sliceBetween(start, end);
      for (const [re, label] of FORBIDDEN) {
        expect(region.match(re), `${name}: forbidden ${label} in region`).toBeNull();
      }
    }
  });

  it('the absorption predicate is present in its structural form (pageId + elementKey + order)', () => {
    const region = sliceBetween('3b. 6F-M1', '4. Discovery');
    expect(region).toContain('elementKey(event.target)');
    expect(region).toContain('mousedownCaptureSeq');
    expect(region).toMatch(/event\.captureSeq\s*>\s*g\.mousedownCaptureSeq/);
  });
});
