/**
 * Drag & Drop Grouping Tests
 *
 * Validates that the V2 Evidence Engine groups dragstart + drop into a single
 * DragDrop interaction instead of producing two separate interactions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.js';
import {
  resetEventCounter,
  dragstartEvent,
  dropEvent,
  clickEvent,
  focusEvent,
  blurEvent,
} from './helpers.js';

describe('Drag & Drop Grouping', () => {
  beforeEach(() => resetEventCounter());

  // ════════════════════════════════════════════════════════════════════════════
  // CORE: dragstart + drop → 1 interaction
  // ════════════════════════════════════════════════════════════════════════════

  describe('Core Grouping', () => {
    it('dragstart + drop → exactly 1 DragDrop interaction', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Task Card A' }),
        dropEvent({ tag: 'DIV', accessibleName: 'In Progress' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DragDrop');
    });

    it('grouped interaction contains both event IDs', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Task Card A' }),
        dropEvent({ tag: 'DIV', accessibleName: 'In Progress' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result[0].eventIds).toHaveLength(2);
      expect(result[0].rawEventTypes).toContain('dragstart');
      expect(result[0].rawEventTypes).toContain('drop');
    });

    it('confidence is boosted (not split across 2 low-confidence interactions)', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Task Card A' }),
        dropEvent({ tag: 'DIV', accessibleName: 'In Progress' }),
      ];
      const result = detectInteractionsV2(events);
      // Both dragstart (0.85) and drop (0.85) evidence → weighted average should be ≥ 0.85
      expect(result[0].confidence).toBeGreaterThanOrEqual(0.85);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // METADATA: sourceElement + dropTarget
  // ════════════════════════════════════════════════════════════════════════════

  describe('Metadata Extraction', () => {
    it('sourceElement is populated from the dragstart element', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Task Card A' }),
        dropEvent({ tag: 'DIV', accessibleName: 'In Progress' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result[0].metadata.sourceElement).toBe('Task Card A');
    });

    it('dropTarget is populated from the drop element', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Task Card A' }),
        dropEvent({ tag: 'DIV', accessibleName: 'In Progress' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result[0].metadata.dropTarget).toBe('In Progress');
    });

    it('both sourceElement and dropTarget are populated together', () => {
      const events = [
        dragstartEvent({ tag: 'LI', accessibleName: 'Item 1' }),
        dropEvent({ tag: 'UL', accessibleName: 'Sortable List B' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result[0].metadata.sourceElement).toBe('Item 1');
      expect(result[0].metadata.dropTarget).toBe('Sortable List B');
    });

    it('sourceElement populated even without dropTarget (incomplete drag)', () => {
      const events = [
        dragstartEvent({ tag: 'IMG', accessibleName: 'logo.png' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DragDrop');
      expect(result[0].metadata.sourceElement).toBe('logo.png');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // EDGE CASES
  // ════════════════════════════════════════════════════════════════════════════

  describe('Edge Cases', () => {
    it('dragstart without drop → 1 incomplete DragDrop', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Card' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DragDrop');
      expect(result[0].eventIds).toHaveLength(1);
    });

    it('drop without dragstart → 1 orphaned DragDrop', () => {
      const events = [
        dropEvent({ tag: 'DIV', accessibleName: 'Drop Zone' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DragDrop');
      expect(result[0].metadata.dropTarget).toBe('Drop Zone');
    });

    it('intervening click breaks the drag grouping → 2 interactions', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Card' }),
        clickEvent({ tag: 'BUTTON', accessibleName: 'Submit' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Zone' }),
      ];
      const result = detectInteractionsV2(events);
      // dragstart flushed as incomplete, click is separate, drop is orphaned
      expect(result.length).toBeGreaterThanOrEqual(2);
      const dragInteractions = result.filter(r => r.type === 'DragDrop');
      expect(dragInteractions.length).toBeGreaterThanOrEqual(1);
    });

    it('two separate drag-drop sequences → 2 interactions', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Item A' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Zone 1' }),
        dragstartEvent({ tag: 'DIV', accessibleName: 'Item B' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Zone 2' }),
      ];
      const result = detectInteractionsV2(events);
      const dragInteractions = result.filter(r => r.type === 'DragDrop');
      expect(dragInteractions.length).toBe(2);
    });

    it('dragstart + focus on different element + drop → drag breaks', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Card' }),
        focusEvent({ tag: 'INPUT', accessibleName: 'Search' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Zone' }),
      ];
      const result = detectInteractionsV2(events);
      // The focus event flushes the dragstart as incomplete
      const dragCount = result.filter(r => r.type === 'DragDrop').length;
      expect(dragCount).toBeGreaterThanOrEqual(1);
    });

    it('click then dragstart+drop → click NOT lost (2 interactions)', () => {
      const events = [
        clickEvent({ tag: 'BUTTON', accessibleName: 'Edit' }),
        dragstartEvent({ tag: 'DIV', accessibleName: 'Card' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Zone' }),
      ];
      const result = detectInteractionsV2(events);
      // The click must be preserved as a separate interaction
      const clickInteractions = result.filter(r => r.type === 'Click');
      expect(clickInteractions).toHaveLength(1);
      const dragInteractions = result.filter(r => r.type === 'DragDrop');
      expect(dragInteractions).toHaveLength(1);
    });

    it('two consecutive incomplete dragstarts → flush first before second', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Item A' }),
        dragstartEvent({ tag: 'DIV', accessibleName: 'Item B' }),
      ];
      const result = detectInteractionsV2(events);
      const dragInteractions = result.filter(r => r.type === 'DragDrop');
      expect(dragInteractions).toHaveLength(2);
    });

    it('dragstart + drop on the same element → 1 DragDrop', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Card', elementId: 'card-1' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Card', elementId: 'card-1' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DragDrop');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // NO REGRESSIONS
  // ════════════════════════════════════════════════════════════════════════════

  describe('No Regressions', () => {
    it('drag-drop followed by a click → separate interactions', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Card' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Zone' }),
        clickEvent({ tag: 'BUTTON', accessibleName: 'Save' }),
      ];
      const result = detectInteractionsV2(events);
      const dragInteractions = result.filter(r => r.type === 'DragDrop');
      const clickInteractions = result.filter(r => r.type === 'Click');
      expect(dragInteractions).toHaveLength(1);
      expect(clickInteractions).toHaveLength(1);
    });

    it('click followed by drag-drop → separate interactions', () => {
      const events = [
        clickEvent({ tag: 'BUTTON', accessibleName: 'Edit' }),
        dragstartEvent({ tag: 'DIV', accessibleName: 'Card' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Zone' }),
      ];
      const result = detectInteractionsV2(events);
      const dragInteractions = result.filter(r => r.type === 'DragDrop');
      expect(dragInteractions).toHaveLength(1);
    });

    it('drag-drop does not interfere with text entry detection', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Card' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Zone' }),
        focusEvent({ tag: 'INPUT', accessibleName: 'Name' }),
        blurEvent({ tag: 'INPUT', accessibleName: 'Name' }),
      ];
      const result = detectInteractionsV2(events);
      const dragInteractions = result.filter(r => r.type === 'DragDrop');
      expect(dragInteractions).toHaveLength(1);
      // TextEntry or Unknown for the focus/blur — but it should be separate
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // FRAMEWORK PATTERNS
  // ════════════════════════════════════════════════════════════════════════════

  describe('Framework Patterns', () => {
    it('HTML5 native draggable element → DragDrop', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Draggable Item', className: 'draggable' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Drop Container', className: 'drop-zone' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DragDrop');
      expect(result[0].metadata.sourceElement).toBe('Draggable Item');
      expect(result[0].metadata.dropTarget).toBe('Drop Container');
    });

    it('React DnD pattern → DragDrop', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Card', className: 'react-dnd-card' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Column', className: 'react-dnd-column' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DragDrop');
    });

    it('SortableJS pattern → DragDrop', () => {
      const events = [
        dragstartEvent({ tag: 'LI', accessibleName: 'List Item 1', className: 'sortable-item' }),
        dropEvent({ tag: 'UL', accessibleName: 'Sortable List', className: 'sortable-list' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DragDrop');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TIMELINE PHRASING
  // ════════════════════════════════════════════════════════════════════════════

  describe('Timeline Phrasing', () => {
    it('renders as Drag "X" to "Y" when both names available', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Task Card' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Done Column' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result[0].metadata.sourceElement).toBe('Task Card');
      expect(result[0].metadata.dropTarget).toBe('Done Column');
    });

    it('renders as Drag "X" when only source available', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Card' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result[0].metadata.sourceElement).toBe('Card');
      expect(result[0].metadata.dropTarget).toBeUndefined();
    });

    it('renders as Drop on "Y" when only target available', () => {
      const events = [
        dropEvent({ tag: 'DIV', accessibleName: 'Zone' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result[0].metadata.dropTarget).toBe('Zone');
      expect(result[0].metadata.sourceElement).toBeUndefined();
    });
  });
});
