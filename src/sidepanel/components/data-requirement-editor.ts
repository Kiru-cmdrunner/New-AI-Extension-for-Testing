/**
 * Data Requirement Editor — inline edit form for data requirements.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §9.1, Step 7
 *
 * Renders editable form fields for each DataRequirement in the review card.
 * The reviewer can adjust kind, inputMethod, required flag, and constraints.
 */

import type { DataRequirement, DataKind, InputMethod } from '../../domain/entities/data-requirement';

export interface DataRequirementEditorResult {
  dataRequirements: DataRequirement[];
}

export function renderDataRequirementEditor(
  container: HTMLElement,
  requirements: DataRequirement[],
  onChange: (result: DataRequirementEditorResult) => void,
): void {
  container.innerHTML = '';

  const title = document.createElement('h3');
  title.className = 'cap-review__section-title';
  title.textContent = 'Data Requirements (editing)';
  container.appendChild(title);

  const editableReqs = requirements.map(r => ({ ...r }));

  for (let i = 0; i < editableReqs.length; i++) {
    container.appendChild(buildEditableRow(i, editableReqs, onChange));
  }

  // Add Requirement button
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn--secondary btn--sm';
  addBtn.textContent = '+ Add Requirement';
  addBtn.addEventListener('click', () => {
    editableReqs.push({
      field: 'new-field',
      label: 'New Field',
      kind: 'text',
      inputMethod: null,
      required: false,
      defaultValue: null,
      constraints: { minLength: null, maxLength: null, pattern: null, min: null, max: null, step: null, options: null, formatDescription: null },
      source: 'manual',
    });
    container.insertBefore(buildEditableRow(editableReqs.length - 1, editableReqs, onChange), addBtn);
  });
  container.appendChild(addBtn);
}

function buildEditableRow(
  index: number,
  reqs: DataRequirement[],
  onChange: (result: DataRequirementEditorResult) => void,
): HTMLElement {
  const req = reqs[index];
  const row = document.createElement('div');
  row.className = 'cap-review__edit-row';

  // Field label (editable)
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'cap-review__edit-input';
  labelInput.value = req.label;
  labelInput.addEventListener('change', () => {
    reqs[index] = { ...reqs[index], label: labelInput.value, field: labelInput.value };
    onChange({ dataRequirements: [...reqs] });
  });
  row.appendChild(labelInput);

  // Kind dropdown
  const kindSelect = document.createElement('select');
  kindSelect.className = 'cap-review__edit-select';
  const kinds: DataKind[] = ['text', 'number', 'boolean', 'date', 'select', 'email'];
  for (const k of kinds) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k;
    if (req.kind === k) opt.selected = true;
    kindSelect.appendChild(opt);
  }
  kindSelect.addEventListener('change', () => {
    reqs[index] = { ...reqs[index], kind: kindSelect.value as DataKind };
    onChange({ dataRequirements: [...reqs] });
  });
  row.appendChild(kindSelect);

  // InputMethod dropdown
  const methodSelect = document.createElement('select');
  methodSelect.className = 'cap-review__edit-select';
  const nullOpt = document.createElement('option');
  nullOpt.value = '';
  nullOpt.textContent = '—';
  methodSelect.appendChild(nullOpt);
  const methods: InputMethod[] = ['dropdown', 'toggle', 'slider', 'text', 'datePicker', 'fileUpload'];
  for (const m of methods) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    if (req.inputMethod === m) opt.selected = true;
    methodSelect.appendChild(opt);
  }
  methodSelect.addEventListener('change', () => {
    const val = methodSelect.value || null;
    reqs[index] = { ...reqs[index], inputMethod: val as InputMethod | null };
    onChange({ dataRequirements: [...reqs] });
  });
  row.appendChild(methodSelect);

  // Required checkbox
  const reqCheck = document.createElement('input');
  reqCheck.type = 'checkbox';
  reqCheck.checked = req.required;
  reqCheck.id = `req-check-${index}`;
  reqCheck.addEventListener('change', () => {
    reqs[index] = { ...reqs[index], required: reqCheck.checked };
    onChange({ dataRequirements: [...reqs] });
  });
  const reqLabel = document.createElement('label');
  reqLabel.textContent = 'Required';
  reqLabel.htmlFor = `req-check-${index}`;
  row.append(reqCheck, reqLabel);

  return row;
}
