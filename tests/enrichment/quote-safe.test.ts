/**
 * D10 (audit D11) — quote-safe title normalizer unit tests.
 *
 * The helper exists so navigation labels can never render nested or
 * double-wrapped quotes when a page title itself contains `"` characters.
 *
 * Architecture: .drytis/specs/d10-nav-label-quoting.md
 */

import { describe, it, expect } from 'vitest';
import { quoteSafeTitle } from '../../src/enrichment/quote-safe';

describe('D10: quoteSafeTitle', () => {
  it('replaces inner double quotes with single quotes', () => {
    expect(quoteSafeTitle('Results for "q"')).toBe("Results for 'q'");
  });

  it('strips one fully-wrapping quote pair (no double-wrap)', () => {
    expect(quoteSafeTitle('"Dashboard"')).toBe('Dashboard');
  });

  it('strips repeated wrapping pairs ("")Title""( -> Title)', () => {
    expect(quoteSafeTitle('""Title""')).toBe('Title');
  });

  it('leaves a plain title unchanged', () => {
    expect(quoteSafeTitle('Your Cart')).toBe('Your Cart');
  });

  it('returns empty string for empty input (URL fallback taken downstream)', () => {
    expect(quoteSafeTitle('')).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(quoteSafeTitle('  Trimmed  ')).toBe('Trimmed');
  });

  it('does not strip an unmatched leading quote alone', () => {
    // Only a matched pair is a wrap; a lone quote is content -> inner-replaced.
    expect(quoteSafeTitle('"quoted')).toBe("'quoted");
  });

  it('does not strip a wrap when quotes are the only content of different pairs', () => {
    // 'a"b"c' — leading/trailing are content, not a wrap; all inner become single.
    expect(quoteSafeTitle('a"b"c')).toBe("a'b'c");
  });

  it('collapses a title that becomes empty after stripping quotes', () => {
    expect(quoteSafeTitle('""')).toBe('');
  });

  it('preserves inner single quotes', () => {
    expect(quoteSafeTitle("Bob's page")).toBe("Bob's page");
  });
});
