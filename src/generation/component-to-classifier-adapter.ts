/**
 * Component-to-Classifier Adapter
 *
 * Bridges the Component Runtime's 13-type interaction model to the
 * Classifier Pipeline's 40-type vocabulary that the IR Bridge expects.
 *
 * This replaces the old flow where the service worker extracted raw
 * ObservedEvents from ComponentInteractions and re-classified them through
 * the V1/V2 detector pipeline. Instead, each ComponentInteraction is
 * directly adapted to a DetectedInteraction using its type, subtype,
 * metadata, and trigger identity.
 *
 * Architecture: §6 (Generation Layer — IR Bridge input)
 */

import type { ComponentInteraction } from '../shared/component-types';
import type {
  DetectedInteraction,
  InteractionType as ClassifierInteractionType,
  InteractionMetadata,
} from '../classifier/interaction-types';

/**
 * Map coarse component types to their default classifier subtypes.
 * Used when interactionSubtype is not explicitly set by the definition.
 */
const DEFAULT_SUBTYPE: Record<string, ClassifierInteractionType> = {
  Click: 'Click',
  TextEntry: 'TextEntry',
  Dropdown: 'CustomDropdown', // Most custom dropdowns; native SELECT → 'NativeDropdown' set by definition
  Checkbox: 'Checkbox',
  RadioButton: 'RadioButton',
  DatePicker: 'DatePicker',
  Hover: 'Hover',
  Link: 'Link',
  FileUpload: 'FileUpload',
  Slider: 'Slider',
  Tab: 'Tab',
  Scroll: 'PageScroll',
  Navigation: 'PageNavigation',
  DragDrop: 'DragDrop',
  KeyboardShortcut: 'KeyboardShortcut',
  ModalDialog: 'ModalDialog',
  Stepper: 'Stepper',
};

/**
 * Convert a ComponentInteraction to a DetectedInteraction.
 *
 * This is a pure, lossless transform — no re-classification, no heuristics.
 * The Component Runtime already classified the interaction; we just adapt
 * the shape for the IR Bridge consumer.
 */
export function adaptInteraction(ci: ComponentInteraction): DetectedInteraction {
  const subtype: ClassifierInteractionType =
    (ci.interactionSubtype as ClassifierInteractionType) ||
    DEFAULT_SUBTYPE[ci.type] ||
    'Unknown';

  return {
    interactionId: ci.interactionId,
    type: subtype,
    eventIds: ci.memberEvents.map((e) => e.eventId),
    rawEventTypes: [...new Set(ci.memberEvents.map((e) => e.eventType))],
    target: ci.trigger,
    metadata: adaptMetadata(ci),
    confidence: ci.endState === 'completed' ? 1.0 : 0.5,
    engine: 'component-runtime',
  };
}

/**
 * Convert an array of ComponentInteractions to DetectedInteractions.
 */
export function adaptInteractions(
  interactions: ComponentInteraction[],
): DetectedInteraction[] {
  return interactions.map(adaptInteraction);
}

/**
 * Map ComponentInteraction metadata to the classifier's InteractionMetadata.
 *
 * The Component Runtime produces type-specific metadata in buildResult.
 * We translate the known fields to the classifier's metadata schema so
 * the IR Bridge can consume them without changes.
 */
function adaptMetadata(ci: ComponentInteraction): InteractionMetadata {
  const meta = ci.metadata ?? {};
  const result: InteractionMetadata = {};

  // Common fields
  if (meta.targetName) result.accessibleName = meta.targetName as string;
  if (meta.selectedValue) result.selectedValue = meta.selectedValue as string;

  // TextEntry
  if (ci.type === 'TextEntry') {
    if (meta.textValue) result.textValue = meta.textValue as string;
    else if (meta.finalValue) result.textValue = meta.finalValue as string;
  }

  // Checkbox / Toggle
  if (ci.type === 'Checkbox') {
    if (meta.checked !== undefined) result.checked = meta.checked as boolean;
    // Map to ToggleSwitch subtype if the element had role=switch
    if (ci.interactionSubtype === 'ToggleSwitch' && meta.checked !== undefined) {
      result.checked = meta.checked as boolean;
    }
  }

  // DatePicker
  if (ci.type === 'DatePicker') {
    if (meta.selectedDate) result.dateValue = meta.selectedDate as string;
    if (meta.displayValue) result.displayValue = meta.displayValue as string;
    if (meta.dateAmbiguous) result.dateAmbiguous = meta.dateAmbiguous as boolean;
  }

  // FileUpload
  if (ci.type === 'FileUpload') {
    if (meta.fileName) result.files = [meta.fileName as string];
    if (meta.fileCount !== undefined) result.fileCount = meta.fileCount as number;
  }

  // Slider
  if (ci.type === 'Slider') {
    if (meta.value !== undefined) result.sliderValue = String(meta.value);
  }

  // Navigation
  if (ci.type === 'Navigation') {
    const navEvent = ci.triggerEvent;
    if (navEvent?.pageUrl) result.url = navEvent.pageUrl;
    if (navEvent?.pageTitle) result.title = navEvent.pageTitle;
  }

  // Hover
  if (ci.type === 'Hover') {
    if (meta.hoverDuration) result.hoverDuration = meta.hoverDuration as number;
  }

  // DragDrop
  if (ci.type === 'DragDrop') {
    if (meta.dropTarget) result.dropTarget = meta.dropTarget as string;
    if (meta.sourceElement) result.sourceElement = meta.sourceElement as string;
  }

  // KeyboardShortcut
  if (ci.type === 'KeyboardShortcut') {
    if (meta.shortcutKey) result.shortcutKey = meta.shortcutKey as string;
    if (meta.keyValue) result.keyValue = meta.keyValue as string;
    if (meta.keyCode) result.keyCode = meta.keyCode as string;
    if (meta.playwrightKey) result.playwrightKey = meta.playwrightKey as string;
    if (meta.hasCtrl !== undefined) result.hasCtrl = meta.hasCtrl as boolean;
    if (meta.hasShift !== undefined) result.hasShift = meta.hasShift as boolean;
    if (meta.hasAlt !== undefined) result.hasAlt = meta.hasAlt as boolean;
    if (meta.hasCmd !== undefined) result.hasCmd = meta.hasCmd as boolean;
  }

  // ModalDialog
  if (ci.type === 'ModalDialog') {
    if (meta.modalTitle) result.modalTitle = meta.modalTitle as string;
    if (meta.subActions) {
      result.modalSubActions = meta.subActions as typeof result.modalSubActions;
    }
    if (meta.hasSubActions !== undefined) result.hasSubActions = meta.hasSubActions as boolean;
  }

  // Stepper
  if (ci.type === 'Stepper') {
    if (meta.fieldName) result.targetName = meta.fieldName as string;
    if (meta.totalDelta !== undefined) result.stepperDelta = meta.totalDelta as number;
    if (meta.subActions) {
      result.stepperSubActions = meta.subActions as typeof result.stepperSubActions;
    }
  }

  // ConfigurationSession (from structural enrichment)
  if (meta.configurationSession) {
    const cs = meta.configurationSession as Record<string, unknown>;
    if (cs.fields) {
      // Build configuredFields from the session
      const fields = cs.fields as Array<{
        label: string;
        finalValue?: string;
        delta?: number;
      }>;
      const configured: Record<string, string> = {};
      for (const f of fields) {
        if (f.finalValue) {
          configured[f.label] = f.finalValue;
        } else if (f.delta !== undefined) {
          configured[f.label] = `${f.delta > 0 ? '+' : ''}${f.delta}`;
        }
      }
      if (Object.keys(configured).length > 0) {
        result.configuredFields = configured;
        result.semanticAction = 'configure';
      }
    }
    if (cs.triggerLabel) {
      result.panelLabel = cs.triggerLabel as string;
    }
  }

  return result;
}
