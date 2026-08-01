/**
 * Capability Inventory — list of approved capabilities and pending reviews.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §9.2, Step 8
 *
 * Shown in a new `capabilities` view accessible from the home screen.
 * Lists:
 *   - Pending reviews (click → opens review card)
 *   - Approved capabilities with version counts (click → detail view)
 */

import type { Capability } from '../../domain/entities/capability';
import { StorageService } from '../../storage/storage-service';
import { StorageKeys } from '../../shared/types';

export type InventoryCallbacks = {
  onOpenReview: (reviewId: string) => void;
  onOpenCapability: (capabilityId: string) => void;
};

// ── Render ────────────────────────────────────────────────

export async function renderCapabilityInventory(
  container: HTMLElement,
  callbacks: InventoryCallbacks,
): Promise<void> {
  container.innerHTML = '';

  // Fetch pending review from storage
  const rawReviewId = await StorageService.getRaw(StorageKeys.PENDING_CAPABILITY_REVIEW);
  const pendingReviewId: string | null = typeof rawReviewId === 'string' ? rawReviewId : null;

  // Fetch approved capabilities from storage
  const rawInventory = await StorageService.getRaw(StorageKeys.CAPABILITY_INVENTORY);
  const capabilities: Capability[] = Array.isArray(rawInventory) ? rawInventory as Capability[] : [];

  // ── Pending Reviews section ──

  if (pendingReviewId) {
    const pendingSection = document.createElement('div');
    pendingSection.className = 'cap-inventory__section';

    const pendingTitle = document.createElement('h3');
    pendingTitle.className = 'cap-inventory__title';
    pendingTitle.textContent = '⏳ Pending Reviews';
    pendingSection.appendChild(pendingTitle);

    const reviewItem = document.createElement('div');
    reviewItem.className = 'cap-inventory__item cap-inventory__item--pending';
    reviewItem.textContent = `Review: ${pendingReviewId.slice(0, 8)}…`;
    reviewItem.addEventListener('click', () => callbacks.onOpenReview(pendingReviewId));
    pendingSection.appendChild(reviewItem);

    container.appendChild(pendingSection);
  }

  // ── Approved Capabilities section ──

  const approvedSection = document.createElement('div');
  approvedSection.className = 'cap-inventory__section';

  const approvedTitle = document.createElement('h3');
  approvedTitle.className = 'cap-inventory__title';
  approvedTitle.textContent = '✓ Approved Capabilities';
  approvedSection.appendChild(approvedTitle);

  if (capabilities.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'cap-inventory__empty';
    empty.textContent = 'No approved capabilities yet. Record and review interactions to build your capability inventory.';
    approvedSection.appendChild(empty);
  } else {
    for (const cap of capabilities) {
      const item = document.createElement('div');
      item.className = 'cap-inventory__item';

      const name = document.createElement('span');
      name.className = 'cap-inventory__item-name';
      name.textContent = cap.name;
      item.appendChild(name);

      const versionBadge = document.createElement('span');
      versionBadge.className = 'cap-inventory__version-badge';
      versionBadge.textContent = `v${cap.currentVersion}`;
      item.appendChild(versionBadge);

      const reqCount = document.createElement('span');
      reqCount.className = 'cap-inventory__item-meta';
      reqCount.textContent = `${cap.dataRequirements.length} requirements`;
      item.appendChild(reqCount);

      item.addEventListener('click', () => callbacks.onOpenCapability(cap.id));
      approvedSection.appendChild(item);
    }
  }

  container.appendChild(approvedSection);
}
