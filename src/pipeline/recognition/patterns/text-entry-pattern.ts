/**
 * Text Entry Pattern — Phase 4 (revised)
 *
 * working-better isTextEntry():
 *   tag=TEXTAREA, OR tag=INPUT with type in {text,email,password,search,tel,url,number,null},
 *   OR role=textbox, OR isContentEditable=true
 *
 * No-op detection (from presentation layer):
 *   userTyped must be true AND textValue must be non-empty
 *
 * Our pipeline: requires input event + valueTransition (non-empty change)
 */

import type { PatternDefinition } from '../../../types/foundation';

export const TEXT_ENTRY_PATTERN: PatternDefinition = {
  id: 'text-entry-v1',
  verb: 'fill',
  componentType: 'TextInput',
  priority: 100,
  confidenceThreshold: 0.6,
  description: 'User enters text into an input or textarea',
  conditions: [
    {
      signalType: 'eventSequence',
      operator: 'contains',
      expected: 'input',
      weight: 2,
      description: 'Must have at least one input event',
    },
    {
      signalType: 'valueTransition',
      operator: 'exists',
      expected: null,
      weight: 3,
      description: 'Text value must have changed',
    },
  ],
};
