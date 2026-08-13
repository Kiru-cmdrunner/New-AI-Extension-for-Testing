/**
 * M9 — Application Understanding: Public API
 *
 * Barrel exports for the understanding layer.
 */

// Types
export type {
  Signal,
  SignalSource,
  ViewDescriptor,
  ViewPattern,
  ViewChangeSignal,
  ApiOperationType,
  ApiOperationSignal,
  OutcomeHint,
  SignalSet,
  SignalExtractionResult,
  SignalExtractor,
} from './types';

// Signal extraction pipeline
export { SignalExtractionCoordinator } from './signal-extractors/signal-extractor';
export { NavigationSignalExtractor } from './signal-extractors/navigation-signals';
export { NetworkSignalExtractor } from './signal-extractors/network-signals';
export {
  ViewRegistry,
  DEFAULT_VIEW_PATTERNS,
  createDefaultViewRegistry,
} from './signal-extractors/view-registry';
