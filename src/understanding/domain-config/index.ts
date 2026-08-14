/**
 * M9.11 — Domain Configuration barrel export
 */

export type {
  DomainPack,
  ViewPatternSpec,
  NetworkPatternSpec,
  StateVocabEntry,
} from './domain-pack-types';

export { DomainPackRegistry } from './domain-pack-registry';
export { StateVocabularyRegistry } from './state-vocabulary-registry';
export { IntentVocabularyRegistry } from './intent-vocabulary-registry';
export { NetworkPatternRegistry } from './network-pattern-registry';

export { ECOMMERCE_PACK } from './packs/ecommerce-pack';
export { HR_PACK } from './packs/hr-pack';
export { DEVTOOLS_PACK } from './packs/devtools-pack';
