/**
 * Navigation Signal Extractor — extracts view-change signals from
 * NavigationEvidence URLs.
 *
 * Reads the `applicationEvidence.navigation[]` array from an interaction's
 * behavioral evidence and produces ViewChangeSignal entries for each
 * navigation event where the destination URL matches a known view pattern.
 *
 * M9.1: Uses ViewRegistry for URL→view classification.
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { SignalExtractor, Signal, ViewChangeSignal } from '../types';
import type { ViewRegistry } from './view-registry';

export class NavigationSignalExtractor implements SignalExtractor {
  readonly name = 'NavigationSignalExtractor';

  constructor(private readonly viewRegistry: ViewRegistry) {}

  extract(interaction: ComponentInteraction): Signal[] {
    const evidence = interaction.behavioralEvidence;
    if (!evidence) return [];

    const navEvents = evidence.applicationEvidence.navigation;
    if (!navEvents || navEvents.length === 0) return [];

    const signals: ViewChangeSignal[] = [];

    for (const nav of navEvents) {
      const toView = this.viewRegistry.match(nav.toUrl);
      if (!toView) continue; // Unknown URL — no signal (graceful degradation)

      // Try to identify the source view
      const fromView = this.viewRegistry.match(nav.fromUrl) ?? null;

      signals.push({
        type: 'view-change',
        interactionId: interaction.interactionId,
        source: 'navigation-url',
        confidence: toView.confidence,
        toView,
        fromView,
        toUrl: nav.toUrl,
        fromUrl: nav.fromUrl,
        navigationType: nav.type,
      });
    }

    return signals;
  }
}
