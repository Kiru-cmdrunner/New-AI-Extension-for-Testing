/**
 * Meaning Resolver — Layer 3 Enrichment
 *
 * Generates human-readable business meaning from interaction type +
 * component type + metadata. Pure function, no DOM access.
 *
 * Architecture: .drytis/specs/three-layer-component-model.md §Layer 3
 */

import type { ComponentInteraction } from '../shared/component-types';
import type { ComponentDetectionResult } from './component-types';

/**
 * Resolve a human-readable business meaning from an interaction.
 *
 * Combines:
 *   - Interaction type (Click, TextEntry, Dropdown, etc.)
 *   - Component type (DataGrid, IconButton, SortButton, etc.)
 *   - Metadata (value, checked, selectedDate, iconName, etc.)
 *
 * Returns a string like "Sort by Name", "Close dialog", "Switch to Grid View".
 */
export function resolveMeaning(
  interaction: ComponentInteraction,
  detection: ComponentDetectionResult,
): string {
  const { type, metadata } = interaction;
  const { componentType, componentData } = detection;
  const targetName = String(metadata.targetName ?? 'element');

  // ── Component-type-specific meaning ──────────────────────────────

  switch (componentType) {
    case 'IconButton': {
      const iconName = componentData.iconName ?? targetName;
      return `Click ${iconName} button`;
    }

    case 'SortButton': {
      const column = componentData.columnName ?? targetName;
      return `Sort by ${column}`;
    }

    case 'GridToggle': {
      return `Switch to ${targetName}`;
    }

    case 'DataGrid': {
      const column = componentData.columnName ?? targetName;
      if (type === 'Click') return `Click ${column} in data grid`;
      return `${type} on ${column} in data grid`;
    }

    case 'TreeView': {
      return `${type} on "${targetName}" tree node`;
    }

    case 'Accordion': {
      return `${type} on "${targetName}" accordion section`;
    }

    case 'Carousel': {
      return `${type} on carousel (${targetName})`;
    }

    case 'Dialog': {
      if (componentData.iconName === 'Close') return `Close the "${targetName}" dialog`;
      return `${type} on "${targetName}" dialog`;
    }

    case 'Breadcrumb': {
      return `Navigate to ${targetName} via breadcrumb`;
    }

    case 'Stepper': {
      return `Go to ${targetName} step`;
    }

    case 'Rating': {
      const value = metadata.value ?? '';
      return `Rate ${value} stars for ${targetName}`;
    }

    case 'ToggleSwitch': {
      const checked = metadata.checked === true;
      return `${checked ? 'Enable' : 'Disable'} ${targetName}`;
    }

    case 'RichTextEditor': {
      const val = String(metadata.textValue ?? '');
      return val ? `Type "${val}" in rich text editor` : `Click in rich text editor`;
    }

    case 'ChipInput': {
      const val = String(metadata.textValue ?? '');
      return val ? `Add tag "${val}"` : `Click in tag input`;
    }

    case 'ProgressBar':
      return `Interact with progress bar (${targetName})`;

    case 'ContextMenu':
      return `Select "${targetName}" from context menu`;

    case 'Drawer':
      return `${type} on "${targetName}" drawer`;

    case 'SplitButton':
      return `${type} on "${targetName}" split button`;

    case 'Alert':
      return `${type} on alert (${targetName})`;

    case 'Tooltip':
      return `${type} on tooltip (${targetName})`;

    case 'Spinner':
      return `${type} on spinner (${targetName})`;

    default:
      break;
  }

  // ── Interaction-type-specific meaning (fallback) ─────────────────

  switch (type) {
    case 'Click':
      return `Click "${targetName}"`;

    case 'TextEntry': {
      const val = String(metadata.textValue ?? '');
      return val ? `Enter "${val}" in "${targetName}"` : `Click in "${targetName}"`;
    }

    case 'Dropdown': {
      const val = String(metadata.selectedValue ?? '');
      return val ? `Select "${val}" from "${targetName}"` : `Click "${targetName}" dropdown`;
    }

    case 'Checkbox': {
      const checked = metadata.checked === true;
      return `${checked ? 'Check' : 'Uncheck'} "${targetName}"`;
    }

    case 'RadioButton': {
      return `Select "${targetName}"`;
    }

    case 'DatePicker': {
      const date = String(metadata.dateValue ?? metadata.selectedDate ?? '');
      return date ? `Select date "${date}" (${targetName})` : `Click date picker "${targetName}"`;
    }

    case 'Slider': {
      const val = metadata.value != null ? String(metadata.value) : '';
      return val ? `Set "${targetName}" to ${val}` : `Click slider "${targetName}"`;
    }

    case 'FileUpload': {
      const fileName = metadata.fileName ? String(metadata.fileName) : '';
      return fileName ? `Upload file "${fileName}"` : `Click file upload "${targetName}"`;
    }

    case 'Tab':
      return `Click "${targetName}" tab`;

    case 'Hover':
      return `Hover over "${targetName}"`;

    case 'Link':
      return `Click "${targetName}" link`;

    case 'Scroll':
      return `Scroll page`;

    case 'Navigation': {
      const url = String(metadata.pageUrl ?? '');
      const title = String(metadata.pageTitle ?? '');
      if (title) return `Navigate to "${title}"`;
      return `Navigate to ${url}`;
    }

    default:
      return `${type} on "${targetName}"`;
  }
}
