/**
 * IR Action Mapper — maps InputMethod to IRAction.
 *
 * Design: .drytis/specs/p2-capability-derived-ir-generation.md §4.3
 */

import { IRAction } from '../execution-ir/types';
import type { InputMethod } from '../entities/data-requirement';

/**
 * Maps DataRequirement.inputMethod to the appropriate IRAction.
 *
 * Null inputMethod falls back to FILL (text input), which is the safest
 * default for unknown interaction types.
 */
export const INPUTMETHOD_TO_IRACTION: ReadonlyMap<InputMethod | null, IRAction> = new Map([
  ['dropdown', IRAction.SELECT],
  ['toggle', IRAction.TOGGLE],
  ['slider', IRAction.FILL],
  ['text', IRAction.FILL],
  ['datePicker', IRAction.SELECT_DATE],
  ['fileUpload', IRAction.FILL],
  [null, IRAction.FILL],
]);

/**
 * Resolve the IRAction for a DataRequirement's inputMethod.
 */
export function inputMethodToIRAction(inputMethod: InputMethod | null): IRAction {
  return INPUTMETHOD_TO_IRACTION.get(inputMethod) ?? IRAction.FILL;
}
