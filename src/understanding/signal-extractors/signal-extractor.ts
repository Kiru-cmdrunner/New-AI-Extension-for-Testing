/**
 * Signal Extraction Coordinator — runs all registered extractors
 * and produces a SignalSet per interaction.
 *
 * This is the top-level entry point for M9.1 signal extraction.
 * Higher layers (M9.2+) consume the SignalExtractionResult.
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { SignalExtractor, SignalSet, SignalExtractionResult } from '../types';

export class SignalExtractionCoordinator {
  private extractors: SignalExtractor[] = [];

  /**
   * Register a signal extractor. Extractors run in registration order.
   */
  register(extractor: SignalExtractor): void {
    this.extractors.push(extractor);
  }

  /**
   * Extract all signals from a single interaction.
   * Returns an empty SignalSet if the interaction has no behavioral evidence.
   */
  extractFromInteraction(interaction: ComponentInteraction): SignalSet {
    const result: SignalSet = {
      interactionId: interaction.interactionId,
      viewChanges: [],
      apiOperations: [],
    };

    if (!interaction.behavioralEvidence) return result;

    for (const extractor of this.extractors) {
      const signals = extractor.extract(interaction);
      for (const signal of signals) {
        switch (signal.type) {
          case 'view-change':
            result.viewChanges.push(signal as any);
            break;
          case 'api-operation':
            result.apiOperations.push(signal as any);
            break;
          // Future signal types: notifications, counterChanges, etc.
          default:
            // Unknown signal type — ignore gracefully
            break;
        }
      }
    }

    return result;
  }

  /**
   * Extract signals from a batch of interactions.
   * Skips interactions without behavioral evidence (counted in skippedCount).
   */
  extract(interactions: ComponentInteraction[]): SignalExtractionResult {
    const signals = new Map<string, SignalSet>();
    let skippedCount = 0;

    for (const interaction of interactions) {
      if (!interaction.behavioralEvidence) {
        skippedCount++;
        continue;
      }
      signals.set(interaction.interactionId, this.extractFromInteraction(interaction));
    }

    return {
      signals,
      interactionCount: interactions.length,
      skippedCount,
    };
  }
}
