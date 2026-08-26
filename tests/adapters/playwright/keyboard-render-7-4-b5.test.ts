/**
 * 7.4-B5 B5-2c-1 — Playwright action renderer KEYBOARD_SHORTCUT case (spec B5-2c-1).
 *
 * Red-first: fails until the renderer has a KEYBOARD_SHORTCUT case producing
 * `page.keyboard.press('<input>')`.
 */
import { describe, it, expect } from 'vitest';
import { renderAction } from '../../../src/adapters/playwright/action-renderer';
import { IRAction, DEFAULT_EXECUTION_PARAMETERS } from '../../../src/domain/execution-ir/types';
import type { IRStep, NoTarget } from '../../../src/domain/execution-ir/types';

function makeNoTargetStep(
  action: IRAction,
  input: string | null,
): IRStep {
  const target: NoTarget = { kind: 'none' };
  return {
    id: 'step-kb-1',
    order: 0,
    action,
    description: 'Press Escape',
    target,
    input,
    assertions: [],
    executionParameters: DEFAULT_EXECUTION_PARAMETERS,
  };
}

describe('7.4-B5 B5-2c-1 — renderer KEYBOARD_SHORTCUT case', () => {
  it('renders page.keyboard.press("Escape") from input', () => {
    const step = makeNoTargetStep(IRAction.KEYBOARD_SHORTCUT, 'Escape');
    const code = renderAction(step, 'page', { indent: '  ' });
    expect(code).toContain('page.keyboard.press');
    expect(code).toContain('Escape');
  });

  it('renders page.keyboard.press("Control+s") from input', () => {
    const step = makeNoTargetStep(IRAction.KEYBOARD_SHORTCUT, 'Control+s');
    const code = renderAction(step, 'page', { indent: '  ' });
    expect(code).toContain('page.keyboard.press');
    expect(code).toContain('Control+s');
  });

  it('does NOT render a locator for NoTarget steps', () => {
    const step = makeNoTargetStep(IRAction.KEYBOARD_SHORTCUT, 'Escape');
    const code = renderAction(step, 'page', { indent: '  ' });
    // No locator() or getBy* calls — NoTarget is page-scoped
    expect(code).not.toContain('page.locator');
    expect(code).not.toContain('page.getByRole');
    expect(code).not.toContain('page.getByTestId');
  });

  it('no longer throws "Unsupported IRAction" for KEYBOARD_SHORTCUT', () => {
    const step = makeNoTargetStep(IRAction.KEYBOARD_SHORTCUT, 'Escape');
    expect(() => renderAction(step, 'page', { indent: '  ' })).not.toThrow();
  });
});