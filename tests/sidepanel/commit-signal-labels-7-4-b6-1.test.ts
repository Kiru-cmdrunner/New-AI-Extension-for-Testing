/**
 * 7.4-B6.1 — side panel commit provenance labels
 *
 * Spec: .drytis/specs/phase-7-4-b6-1-formless-spa-enter-commit.md §7
 * ("render commitSignal 'navigation' | 'network' labels alongside B6's
 * 'submit'"). formatMetadata is the single metadata-detail formatter the
 * interaction renderer uses — this suite pins its three commit labels and
 * the no-fabrication default (blur completions render nothing).
 */
import { describe, it, expect } from 'vitest';
import type { ComponentInteraction } from '../../src/shared/component-types';

// formatMetadata is module-private; exercise it through the exported render
// path used by the panel. Import the renderer's public entry.
import { renderInteractions } from '../../src/sidepanel/interaction-renderer';

function te(commitSignal?: string): ComponentInteraction {
  return {
    interactionId: 'int-1',
    type: 'TextEntry',
    trigger: {} as never,
    triggerEvent: {} as never,
    memberEvents: [],
    startTime: 1,
    endTime: 2,
    endState: 'completed',
    metadata: {
      targetName: 'Search',
      textValue: 'wireless earbuds',
      typedValue: 'wireless earbuds',
      userTyped: true,
      ...(commitSignal ? { commitSignal } : {}),
    },
  } as unknown as ComponentInteraction;
}

function renderedText(interaction: ComponentInteraction): string {
  const host = document.createElement('div');
  renderInteractions(host, [interaction]);
  return host.textContent ?? '';
}

describe('side panel — TextEntry commit labels (7.4-B6.1)', () => {
  it('submit commit renders the form-submit label', () => {
    const txt = renderedText(te('submit'));
    expect(txt).toContain('committed via form submit');
  });

  it('navigation commit renders the route-change label', () => {
    const txt = renderedText(te('navigation'));
    expect(txt).toContain('committed via Enter (route change)');
  });

  it('network commit renders the app-request label', () => {
    const txt = renderedText(te('network'));
    expect(txt).toContain('committed via Enter (app request)');
  });

  it('blur completion (no commitSignal) renders NO commit label — no fabrication', () => {
    const txt = renderedText(te(undefined));
    expect(txt).not.toContain('committed');
  });
});
