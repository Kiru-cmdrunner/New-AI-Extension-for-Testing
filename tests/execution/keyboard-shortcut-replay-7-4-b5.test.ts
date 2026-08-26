/**
 * 7.4-B5 B5-2c — keyboardShortcut executor pins (spec B5-2c-2, B5-2c-5).
 *
 * Red-first: fails until keyboardShortcut case exists in action-executor.ts
 * and executor-content-script.ts executeAction switches.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeAction } from '../../src/execution/action-executor';
import type { ActionExecutionResult } from '../../src/execution/action-executor';

// Helper: executeAction returns ActionExecutionResult | Promise<ActionExecutionResult>;
// our keyboardShortcut case is synchronous so the union always resolves here.
function run(action: string, element: Element | null, input: string): ActionExecutionResult {
  const r = executeAction(action as any, element, input);
  if (r instanceof Promise) throw new Error('Expected sync result for keyboardShortcut');
  return r;
}

// ── action-executor.ts: executeAction ──

describe('7.4-B5 B5-2c-2 — action-executor keyboardShortcut case', () => {
  it('dispatches a KeyboardEvent keydown+keyup on the element', () => {
    const el = document.createElement('input');
    document.body.appendChild(el);
    el.focus();

    const result = run('keyboardShortcut', el, 'Escape');
    expect(result.success).toBe(true);
  });

  it('handles null element by using document.activeElement', () => {
    const el = document.createElement('input');
    document.body.appendChild(el);
    el.focus();

    const result = run('keyboardShortcut', null, 'Escape');
    expect(result.success).toBe(true);
  });

  it('dispatches at least 2 events (keydown + keyup)', () => {
    const el = document.createElement('input');
    document.body.appendChild(el);
    el.focus();

    const spy = vi.spyOn(el, 'dispatchEvent');
    const result = run('keyboardShortcut', el, 'Escape');
    expect(result.success).toBe(true);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ── B5-2c-5: F3 regression — recorded Ctrl+S renders + executes ──

describe('7.4-B5 B5-2c-5 — F3 regression: recorded Ctrl-shortcut replays', () => {
  it('action-executor handles Ctrl+S (keyboardShortcut action)', () => {
    const el = document.createElement('input');
    document.body.appendChild(el);
    el.focus();

    const result = run('keyboardShortcut', el, 'Control+s');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('action-executor no longer returns UnknownAction for keyboardShortcut', () => {
    const result = run('keyboardShortcut', null, 'Escape');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });
});