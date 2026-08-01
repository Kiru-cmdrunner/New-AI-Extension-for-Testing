/**
 * Success Criterion Editor — inline edit form for success criteria.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §9.1, Step 7
 *
 * Renders editable form fields for each SuccessCriterion in the review card.
 * The reviewer can add/remove/edit criteria.
 */

import type { SuccessCriterion, SuccessType } from '../../domain/entities/success-criterion';

export interface SuccessCriterionEditorResult {
  successCriteria: SuccessCriterion[];
}

export function renderSuccessCriterionEditor(
  container: HTMLElement,
  criteria: SuccessCriterion[],
  onChange: (result: SuccessCriterionEditorResult) => void,
): void {
  container.innerHTML = '';

  const title = document.createElement('h3');
  title.className = 'cap-review__section-title';
  title.textContent = 'Success Criteria (editing)';
  container.appendChild(title);

  const editableCriteria = criteria.map(c => ({ ...c }));

  for (let i = 0; i < editableCriteria.length; i++) {
    container.appendChild(buildEditableCriterion(i, editableCriteria, onChange));
  }

  // Add Criterion button
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn--secondary btn--sm';
  addBtn.textContent = '+ Add Criterion';
  addBtn.addEventListener('click', () => {
    editableCriteria.push({
      id: `criterion-manual-${editableCriteria.length}`,
      description: 'New criterion',
      type: 'custom',
      target: { kind: 'page', urlPattern: null, elementLocator: null },
      expectedValue: null,
      timeout: 5000,
      source: 'manual',
    });
    container.insertBefore(buildEditableCriterion(editableCriteria.length - 1, editableCriteria, onChange), addBtn);
    onChange({ successCriteria: [...editableCriteria] });
  });
  container.appendChild(addBtn);
}

function buildEditableCriterion(
  index: number,
  criteria: SuccessCriterion[],
  onChange: (result: SuccessCriterionEditorResult) => void,
): HTMLElement {
  const criterion = criteria[index];
  const row = document.createElement('div');
  row.className = 'cap-review__edit-row cap-review__edit-row--criterion';

  // Description (editable)
  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.className = 'cap-review__edit-input';
  descInput.value = criterion.description;
  descInput.addEventListener('change', () => {
    criteria[index] = { ...criteria[index], description: descInput.value };
    onChange({ successCriteria: [...criteria] });
  });
  row.appendChild(descInput);

  // Type dropdown
  const typeSelect = document.createElement('select');
  typeSelect.className = 'cap-review__edit-select';
  const types: SuccessType[] = ['navigation', 'elementVisible', 'elementAbsent', 'valueEquals', 'textPresent', 'custom'];
  for (const t of types) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (criterion.type === t) opt.selected = true;
    typeSelect.appendChild(opt);
  }
  typeSelect.addEventListener('change', () => {
    criteria[index] = { ...criteria[index], type: typeSelect.value as SuccessType };
    onChange({ successCriteria: [...criteria] });
  });
  row.appendChild(typeSelect);

  // Timeout
  const timeoutInput = document.createElement('input');
  timeoutInput.type = 'number';
  timeoutInput.className = 'cap-review__edit-input cap-review__edit-input--small';
  timeoutInput.value = String(criterion.timeout);
  timeoutInput.addEventListener('change', () => {
    criteria[index] = { ...criteria[index], timeout: parseInt(timeoutInput.value, 10) || 5000 };
    onChange({ successCriteria: [...criteria] });
  });
  row.appendChild(timeoutInput);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn--secondary btn--sm';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => {
    criteria.splice(index, 1);
    onChange({ successCriteria: [...criteria] });
    row.remove();
  });
  row.appendChild(removeBtn);

  return row;
}
