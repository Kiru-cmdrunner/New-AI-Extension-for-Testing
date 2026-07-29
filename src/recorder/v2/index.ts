/**
 * Stage 1 — Control Model v2 Public API
 *
 * Barrel export for the production Control Model module.
 * Downstream stages (2+) import from here.
 */

// Types
export type { ControlNode, ControlState } from './types';
export {
  WIDGET_ROLES,
  COMPOSITE_ROLES,
  TRACKABLE_ROLES,
} from './types';

// Identity extraction
export {
  getRole,
  getAccessibleName,
  isPlaceholderText,
  IMPLICIT_ROLES,
  INPUT_TYPE_ROLES,
} from './identity-extractor';

// Framework adapters
export {
  oxdInferRole,
  isOxdWrapper,
  OXD_CLASS_ROLE_MAP,
  OXD_WRAPPER_CLASSES,
  OXD_CHECKED_CLASS,
} from './framework-adapters';

// Control Model
export { ControlModel } from './control-model';
