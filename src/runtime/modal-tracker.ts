/**
 * Modal Tracker — Open Dialog/Menu Tracking (Layer 2 helper)
 *
 * Tracks currently open dialogs, menus, and popovers so that definitions
 * can make scope decisions based on "is there a modal open right now?"
 *
 * The tracker is NOT a component definition — it's a utility used by
 * definitions like Dropdown and DatePicker to determine scope.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §3.4
 * Created component: src/runtime/modal-tracker.ts
 */

import type { ObservedEvent } from '../shared/component-types';

/**
 * A tracked open modal/dialog/menu/popover.
 */
export interface TrackedModal {
  /** Element key of the modal's root element. */
  elementKey: string;
  /** Role: dialog, menu, listbox, grid, etc. */
  role: string;
  /** Whether this is a nested modal (inside another modal). */
  nested: boolean;
  /** Timestamp when opened. */
  openedAt: number;
}

/**
 * Modal Tracker — tracks open dialogs, menus, listboxes.
 *
 * State is updated by observing events as they flow through the runtime.
 * The tracker detects modals by checking for aria-expanded="true" on
 * triggers and looking for related popup elements.
 */
export class ModalTracker {
  private openModals: TrackedModal[] = [];

  /**
   * Observe an event and update modal state.
   * Called by the runtime before offering the event to definitions.
   */
  observe(event: ObservedEvent): void {
    const ctx = event.domContext;

    // Detect modal opening: aria-expanded changes to true
    if (ctx.ariaExpanded === true) {
      this.openModal(event);
    }

    // Detect modal closing: aria-expanded changes to false
    if (ctx.ariaExpanded === false) {
      this.closeModal(event);
    }

    // Detect clicking inside an open modal — keep it open
    // (no action needed, the modal stays tracked)
  }

  /**
   * Get all currently open modals.
   */
  getOpenModals(): readonly TrackedModal[] {
    return this.openModals;
  }

  /**
   * Check if any modal is currently open.
   */
  hasOpenModal(): boolean {
    return this.openModals.length > 0;
  }

  /**
   * Check if a specific modal (by element key) is open.
   */
  isModalOpen(elementKey: string): boolean {
    return this.openModals.some((m) => m.elementKey === elementKey);
  }

  /**
   * Clear all tracked modals (e.g., on navigation).
   */
  clear(): void {
    this.openModals = [];
  }

  // ── Internal ─────────────────────────────────────────────────────

  private openModal(event: ObservedEvent): void {
    // Don't add duplicates
    const key = this.makeKey(event.target);
    if (this.isModalOpen(key)) return;

    const role = event.domContext.ariaHasPopup || event.target.ariaRole || 'dialog';

    this.openModals.push({
      elementKey: key,
      role,
      nested: this.openModals.length > 0,
      openedAt: event.timestamp,
    });
  }

  private closeModal(event: ObservedEvent): void {
    const key = this.makeKey(event.target);
    this.openModals = this.openModals.filter((m) => m.elementKey !== key);
  }

  private makeKey(target: { tag: string; stableId: string | null; cssSelector: string }): string {
    return target.stableId ?? target.cssSelector ?? target.tag;
  }
}
