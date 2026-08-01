/**
 * Capability Review Card — the review UI component.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §9.1, Step 7
 *
 * Renders in the side panel `stopped` view when a pending capability review
 * exists. Shows the inferred capability name/purpose, data requirements,
 * success criteria, and recording evidence. Supports approve/reject/edit/override.
 *
 * Uses existing message infrastructure (AppMessage) to communicate decisions
 * to the service worker. Does NOT call repositories directly.
 */

import type { CapabilityCandidate } from '../../domain/entities/capability-candidate';
import type { CapabilityReview } from '../../domain/entities/capability-review';
import type { DataRequirement } from '../../domain/entities/data-requirement';
import type { SuccessCriterion } from '../../domain/entities/success-criterion';
import type { ComponentInteraction } from '../../shared/component-types';
import { candidateToDataRequirements, successIndicatorsToCriteria } from '../../domain/mappings/capability-mappers';
import type { SuccessIndicator } from '../../domain/entities/application-knowledge';

// ── Render types ──────────────────────────────────────────

export interface ReviewCardData {
  review: CapabilityReview;
  candidate: CapabilityCandidate;
  interactions: ComponentInteraction[];
  successIndicators: SuccessIndicator[];
}

export type ReviewCardCallbacks = {
  onApprove: (reviewId: string, note?: string) => void;
  onReject: (reviewId: string, note?: string) => void;
  onOverrideMatch: (reviewId: string) => void;
  onEditComplete: (
    reviewId: string,
    edits: {
      nameChanged: boolean;
      editedName: string | null;
      purposeChanged: boolean;
      editedPurpose: string | null;
      inputsEdited: boolean;
      editedDataRequirements: DataRequirement[] | null;
      successCriteriaEdited: boolean;
      editedSuccessCriteria: SuccessCriterion[] | null;
    },
  ) => void;
};

// ── State ─────────────────────────────────────────────────

let currentData: ReviewCardData | null = null;
let currentCallbacks: ReviewCardCallbacks | null = null;

// ── Render ────────────────────────────────────────────────

export function renderReviewCard(
  container: HTMLElement,
  data: ReviewCardData,
  callbacks: ReviewCardCallbacks,
): void {
  currentData = data;
  currentCallbacks = callbacks;
  container.innerHTML = '';
  container.appendChild(buildCard());
}

function buildCard(): HTMLElement {
  if (!currentData) throw new Error('No review data');
  const { review, candidate, interactions } = currentData;

  const card = document.createElement('div');
  card.className = 'capability-review-card';

  // Header
  card.appendChild(buildHeader(candidate, review));

  // Data Requirements
  card.appendChild(buildDataRequirements());

  // Success Criteria
  card.appendChild(buildSuccessCriteria());

  // Recording Evidence
  card.appendChild(buildRecordingEvidence(interactions));

  // Action buttons
  card.appendChild(buildActions(review));

  return card;
}

function buildHeader(candidate: CapabilityCandidate, review: CapabilityReview): HTMLElement {
  const header = document.createElement('div');
  header.className = 'cap-review__header';

  // Name
  const nameLabel = document.createElement('label');
  nameLabel.className = 'cap-review__label';
  nameLabel.textContent = 'Name:';
  const nameValue = document.createElement('span');
  nameValue.className = 'cap-review__value cap-review__name';
  nameValue.id = 'cap-review-name';
  nameValue.textContent = candidate.name;
  header.append(nameLabel, nameValue);

  // Purpose
  const purposeLabel = document.createElement('label');
  purposeLabel.className = 'cap-review__label';
  purposeLabel.textContent = 'Purpose:';
  const purposeValue = document.createElement('span');
  purposeValue.className = 'cap-review__value cap-review__purpose';
  purposeValue.id = 'cap-review-purpose';
  purposeValue.textContent = candidate.purpose;
  header.append(document.createElement('br'), purposeLabel, purposeValue);

  // Match suggestion
  const matchRow = document.createElement('div');
  matchRow.className = 'cap-review__match-row';
  const matchLabel = document.createElement('span');
  matchLabel.className = 'cap-review__label';
  matchLabel.textContent = 'Match:';
  const matchBadge = document.createElement('span');
  matchBadge.className = `cap-review__badge cap-review__badge--${review.matchSuggestion.decision}`;
  matchBadge.textContent = review.matchSuggestion.decision.replace(/-/g, ' ');
  matchRow.append(matchLabel, matchBadge);

  if (review.matchSuggestion.bestMatchScore !== null) {
    const score = document.createElement('span');
    score.className = 'cap-review__value';
    score.textContent = `score: ${review.matchSuggestion.bestMatchScore.toFixed(2)}`;
    matchRow.appendChild(score);
  }

  header.appendChild(matchRow);

  return header;
}

function buildDataRequirements(): HTMLElement {
  const section = document.createElement('div');
  section.className = 'cap-review__section';

  const title = document.createElement('h3');
  title.className = 'cap-review__section-title';
  title.textContent = 'Data Requirements (inferred)';
  section.appendChild(title);

  if (!currentData) return section;
  const reqs = candidateToDataRequirements(currentData.candidate.inputs);

  const table = document.createElement('div');
  table.className = 'cap-review__data-table';
  table.id = 'cap-review-data-reqs';

  // Header row
  const headerRow = document.createElement('div');
  headerRow.className = 'cap-review__data-row cap-review__data-row--header';
  for (const col of ['Field', 'Kind', 'Input Method', 'Required', 'Constraints']) {
    const cell = document.createElement('span');
    cell.className = 'cap-review__data-cell';
    cell.textContent = col;
    headerRow.appendChild(cell);
  }
  table.appendChild(headerRow);

  // Data rows
  for (const req of reqs) {
    const row = document.createElement('div');
    row.className = 'cap-review__data-row';

    const field = document.createElement('span');
    field.className = 'cap-review__data-cell';
    field.textContent = req.label;
    row.appendChild(field);

    const kind = document.createElement('span');
    kind.className = 'cap-review__data-cell';
    kind.textContent = req.kind;
    row.appendChild(kind);

    const method = document.createElement('span');
    method.className = 'cap-review__data-cell';
    method.textContent = req.inputMethod ?? '—';
    row.appendChild(method);

    const required = document.createElement('span');
    required.className = 'cap-review__data-cell';
    required.textContent = req.required ? '✓' : '';
    row.appendChild(required);

    const constraints = document.createElement('span');
    constraints.className = 'cap-review__data-cell';
    const parts: string[] = [];
    if (req.constraints.min !== null) parts.push(`min ${req.constraints.min}`);
    if (req.constraints.max !== null) parts.push(`max ${req.constraints.max}`);
    if (req.constraints.minLength !== null) parts.push(`≥${req.constraints.minLength} chars`);
    if (req.constraints.maxLength !== null) parts.push(`≤${req.constraints.maxLength} chars`);
    if (req.constraints.options) parts.push(`${req.constraints.options.length} options`);
    if (req.constraints.pattern) parts.push('regex');
    constraints.textContent = parts.join(', ') || '—';
    row.appendChild(constraints);

    table.appendChild(row);
  }

  section.appendChild(table);
  return section;
}

function buildSuccessCriteria(): HTMLElement {
  const section = document.createElement('div');
  section.className = 'cap-review__section';

  const title = document.createElement('h3');
  title.className = 'cap-review__section-title';
  title.textContent = 'Success Criteria (inferred)';
  section.appendChild(title);

  if (!currentData) return section;
  const criteria = successIndicatorsToCriteria(currentData.successIndicators);

  if (criteria.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'cap-review__empty';
    empty.textContent = 'No success criteria inferred.';
    section.appendChild(empty);
    return section;
  }

  for (const c of criteria) {
    const item = document.createElement('div');
    item.className = 'cap-review__criterion';

    const icon = document.createElement('span');
    icon.className = 'cap-review__icon';
    icon.textContent = '✓';
    item.appendChild(icon);

    const desc = document.createElement('span');
    desc.className = 'cap-review__value';
    desc.textContent = c.description;
    item.appendChild(desc);

    const timeout = document.createElement('span');
    timeout.className = 'cap-review__value cap-review__timeout';
    timeout.textContent = `(${c.timeout}ms)`;
    item.appendChild(timeout);

    section.appendChild(item);
  }

  return section;
}

function buildRecordingEvidence(interactions: ComponentInteraction[]): HTMLElement {
  const section = document.createElement('div');
  section.className = 'cap-review__section';

  const title = document.createElement('h3');
  title.className = 'cap-review__section-title';
  title.textContent = 'Recording Evidence';
  section.appendChild(title);

  const summary = document.createElement('p');
  summary.className = 'cap-review__value';
  summary.textContent = `${interactions.length} interaction${interactions.length !== 1 ? 's' : ''} recorded`;
  section.appendChild(summary);

  // Interaction list
  const list = document.createElement('div');
  list.className = 'cap-review__interaction-list';

  for (let i = 0; i < interactions.length; i++) {
    const int = interactions[i];
    const row = document.createElement('div');
    row.className = 'cap-review__interaction-row';

    // Highlight low-confidence
    if (int.confidence !== undefined && int.confidence < 0.5) {
      row.classList.add('cap-review__interaction-row--low-confidence');
    }

    const idx = document.createElement('span');
    idx.className = 'cap-review__interaction-index';
    idx.textContent = `#${i + 1}`;
    row.appendChild(idx);

    const type = document.createElement('span');
    type.className = 'cap-review__interaction-type';
    type.textContent = int.type;
    row.appendChild(type);

    // Description or value
    if (int.metadata?.description) {
      const desc = document.createElement('span');
      desc.className = 'cap-review__interaction-desc';
      desc.textContent = String(int.metadata.description);
      row.appendChild(desc);
    } else if (int.metadata?.value) {
      const val = document.createElement('span');
      val.className = 'cap-review__interaction-desc';
      val.textContent = `"${String(int.metadata.value).slice(0, 30)}"`;
      row.appendChild(val);
    }

    // Confidence
    if (int.confidence !== undefined) {
      const conf = document.createElement('span');
      conf.className = 'cap-review__interaction-confidence';
      conf.textContent = int.confidence.toFixed(1);
      row.appendChild(conf);
    }

    // Unrecognized flag
    if (int.metadata?.unrecognized) {
      const flag = document.createElement('span');
      flag.className = 'cap-review__interaction-flag';
      flag.textContent = '⚠ unrecognized';
      row.appendChild(flag);
    }

    list.appendChild(row);
  }

  section.appendChild(list);
  return section;
}

function buildActions(review: CapabilityReview): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'cap-review__actions';

  // Approve button
  const approveBtn = document.createElement('button');
  approveBtn.className = 'btn btn--primary btn--sm cap-review__btn-approve';
  approveBtn.textContent = 'Approve';
  approveBtn.addEventListener('click', () => {
    if (currentCallbacks) currentCallbacks.onApprove(review.reviewId);
  });
  actions.appendChild(approveBtn);

  // Reject button
  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'btn btn--secondary btn--sm cap-review__btn-reject';
  rejectBtn.textContent = 'Reject';
  rejectBtn.addEventListener('click', () => {
    if (currentCallbacks) currentCallbacks.onReject(review.reviewId);
  });
  actions.appendChild(rejectBtn);

  // Override Match button
  const overrideBtn = document.createElement('button');
  overrideBtn.className = 'btn btn--secondary btn--sm cap-review__btn-override';
  overrideBtn.textContent = 'Override Match';
  overrideBtn.addEventListener('click', () => {
    if (currentCallbacks) currentCallbacks.onOverrideMatch(review.reviewId);
  });
  actions.appendChild(overrideBtn);

  // Status message area
  const status = document.createElement('div');
  status.className = 'cap-review__status';
  status.id = 'cap-review-status';
  actions.appendChild(status);

  return actions;
}

// ── Public: show status after decision ────────────────────

export function showReviewStatus(container: HTMLElement, message: string, kind: 'info' | 'success' | 'error'): void {
  const status = container.querySelector('#cap-review-status') as HTMLElement;
  if (!status) return;
  status.textContent = message;
  status.className = `cap-review__status cap-review__status--${kind}`;
}
