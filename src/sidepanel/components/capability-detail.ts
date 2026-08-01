/**
 * Capability Detail — detailed view of a single capability with version history.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §9.2, Step 8
 *
 * Shows the capability's full details: name, purpose, data requirements,
 * success criteria, and version history (via Dexie, accessed through the
 * service worker).
 */

import type { Capability } from '../../domain/entities/capability';
import { StorageService } from '../../storage/storage-service';
import { StorageKeys } from '../../shared/types';

export type DetailCallbacks = {
  onBack: () => void;
};

export async function renderCapabilityDetail(
  container: HTMLElement,
  capabilityId: string,
  callbacks: DetailCallbacks,
): Promise<void> {
  container.innerHTML = '';

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'btn btn--secondary btn--sm';
  backBtn.textContent = '← Back to Inventory';
  backBtn.addEventListener('click', () => callbacks.onBack());
  container.appendChild(backBtn);

  // Load capability from storage
  const rawInventory = await StorageService.getRaw(StorageKeys.CAPABILITY_INVENTORY);
  const capabilities: Capability[] = Array.isArray(rawInventory) ? rawInventory as Capability[] : [];
  const capability = capabilities.find((c: Capability) => c.id === capabilityId);

  if (!capability) {
    const notFound = document.createElement('p');
    notFound.className = 'cap-detail__not-found';
    notFound.textContent = `Capability ${capabilityId} not found.`;
    container.appendChild(notFound);
    return;
  }

  // Header
  const header = document.createElement('div');
  header.className = 'cap-detail__header';

  const title = document.createElement('h2');
  title.className = 'cap-detail__title';
  title.textContent = capability.name;
  header.appendChild(title);

  const purpose = document.createElement('p');
  purpose.className = 'cap-detail__purpose';
  purpose.textContent = capability.purpose;
  header.appendChild(purpose);

  const meta = document.createElement('div');
  meta.className = 'cap-detail__meta';
  meta.textContent = `Version ${capability.currentVersion} · ${capability.confidence} · ${capability.dataRequirements.length} requirements`;
  header.appendChild(meta);

  container.appendChild(header);

  // Data Requirements
  const reqSection = document.createElement('div');
  reqSection.className = 'cap-detail__section';

  const reqTitle = document.createElement('h3');
  reqTitle.className = 'cap-detail__section-title';
  reqTitle.textContent = 'Data Requirements';
  reqSection.appendChild(reqTitle);

  if (capability.dataRequirements.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'cap-detail__empty';
    empty.textContent = 'No data requirements.';
    reqSection.appendChild(empty);
  } else {
    for (const req of capability.dataRequirements) {
      const row = document.createElement('div');
      row.className = 'cap-detail__req-row';

      const name = document.createElement('span');
      name.className = 'cap-detail__req-name';
      name.textContent = req.label;
      row.appendChild(name);

      const badges = document.createElement('span');
      badges.className = 'cap-detail__req-badges';

      const kindBadge = document.createElement('span');
      kindBadge.className = 'cap-detail__badge';
      kindBadge.textContent = req.kind;
      badges.appendChild(kindBadge);

      if (req.inputMethod) {
        const methodBadge = document.createElement('span');
        methodBadge.className = 'cap-detail__badge cap-detail__badge--method';
        methodBadge.textContent = req.inputMethod;
        badges.appendChild(methodBadge);
      }

      if (req.required) {
        const reqBadge = document.createElement('span');
        reqBadge.className = 'cap-detail__badge cap-detail__badge--required';
        reqBadge.textContent = 'required';
        badges.appendChild(reqBadge);
      }

      row.appendChild(badges);
      reqSection.appendChild(row);
    }
  }

  container.appendChild(reqSection);

  // Success Criteria
  const critSection = document.createElement('div');
  critSection.className = 'cap-detail__section';

  const critTitle = document.createElement('h3');
  critTitle.className = 'cap-detail__section-title';
  critTitle.textContent = 'Success Criteria';
  critSection.appendChild(critTitle);

  if (capability.successCriteria.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'cap-detail__empty';
    empty.textContent = 'No success criteria defined.';
    critSection.appendChild(empty);
  } else {
    for (const criterion of capability.successCriteria) {
      const row = document.createElement('div');
      row.className = 'cap-detail__criterion-row';
      const desc = document.createElement('span');
      desc.className = 'cap-detail__criterion-desc';
      desc.textContent = `✓ ${criterion.description}`;
      row.appendChild(desc);
      critSection.appendChild(row);
    }
  }

  container.appendChild(critSection);

  // Version History placeholder
  // (Version details are loaded from Dexie via the service worker — for P1
  // we show provenance summary from the capability itself)
  const versionSection = document.createElement('div');
  versionSection.className = 'cap-detail__section';

  const versionTitle = document.createElement('h3');
  versionTitle.className = 'cap-detail__section-title';
  versionTitle.textContent = 'Version History';
  versionSection.appendChild(versionTitle);

  const versionInfo = document.createElement('p');
  versionInfo.className = 'cap-detail__version-info';
  versionInfo.textContent = `Current version: ${capability.currentVersion}. Created ${capability.createdAt}. Last enriched ${capability.lastEnrichedAt}.`;
  versionSection.appendChild(versionInfo);

  const provenance = document.createElement('p');
  provenance.className = 'cap-detail__provenance';
  provenance.textContent = `Recorded sessions: ${capability.sessionIds.length}`;
  versionSection.appendChild(provenance);

  container.appendChild(versionSection);
}
