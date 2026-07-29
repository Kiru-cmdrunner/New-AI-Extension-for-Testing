/**
 * Lifecycle Engine Index — Phase 5
 */

export {
  type LifecycleDefinition,
  type LifecycleMatchRule,
  type LifecyclePhase,
  type ActiveLifecycle,
  type LifecycleProcessResult,
  type SemanticActionOutput,
} from './lifecycle-types';

export {
  TEXT_ENTRY_LIFECYCLE,
  DROPDOWN_LIFECYCLE,
  DATE_PICKER_LIFECYCLE,
  SLIDER_LIFECYCLE,
  LIFECYCLE_DEFINITIONS,
  getLifecycleDefinitions,
  findActivatingDefinition,
} from './lifecycle-definitions';

export {
  LifecycleEngine,
  processWithLifecycle,
} from './lifecycle-engine';

export {
  buildSemanticActions,
  processToSemanticActions,
  resetActionCounter,
} from './semantic-action-builder';
