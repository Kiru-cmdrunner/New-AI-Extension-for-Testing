/**
 * Data Requirement — formal specification of test data a capability needs.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §3.1
 *
 * A DataRequirement is derived from a CapabilityInput + the originating
 * LogicalAction's sourceInteractionType. It tells P2 (capability-derived IR)
 * and P3 (AI test generation) both WHAT data a field needs (`kind`) and HOW
 * that field is operated (`inputMethod`).
 *
 * Design principles:
 *   - `kind` and `inputMethod` are orthogonal: kind = "what data?",
 *     inputMethod = "how is it operated?"
 *   - `inputMethod` is a platform-level categorization, coarser than
 *     InteractionType. It abstracts away implementation details (native vs
 *     custom, ARIA vs CSS) while preserving operational semantics.
 *   - Inferred values are editable by the reviewer during capability review.
 */

/**
 * What kind of DATA a field requires.
 * Orthogonal to InputMethod (which describes HOW the field is operated).
 */
export type DataKind = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'email';

/**
 * How the user OPERATES this field. Derived from the originating
 * InteractionType at the enrichment boundary. This is a platform-level
 * categorization — it tells P2 what interaction strategy to use without
 * coupling capability management to recorder-specific types.
 *
 * The taxonomy is intentionally coarser than InteractionType: it abstracts
 * away implementation details (native vs custom, ARIA vs CSS) while
 * preserving operational semantics (dropdown vs toggle vs slider).
 *
 * Forward-compatible: new InteractionTypes added by future recorder work
 * extend the mapping function without changing existing capability contracts.
 */
export type InputMethod =
  | 'dropdown'   // select from a list: Dropdown, NativeDropdown, CustomDropdown, Autocomplete, RadioButton
  | 'toggle'     // flip a boolean state: Checkbox
  | 'slider'     // drag a handle to set a value: Slider, NativeSlider, AriaSlider, CustomSlider, RangeSlider
  | 'text'       // type into a field: TextEntry, RichTextEditor
  | 'datePicker' // select a date from a calendar: DatePicker, DateRangePicker
  | 'fileUpload'; // provide a file: FileUpload

/**
 * Constraint rules governing valid input for a data requirement.
 * Each field is null if no constraint was observed or specified.
 */
export interface DataConstraint {
  readonly minLength: number | null;
  readonly maxLength: number | null;
  readonly pattern: string | null;        // regex
  readonly min: number | null;
  readonly max: number | null;
  readonly step: number | null;
  readonly options: string[] | null;      // for select kind
  readonly formatDescription: string | null;
}

/**
 * A formal specification of test data that a capability requires.
 *
 * Derived from CapabilityInput + sourceInteractionType during the P1
 * candidate-to-review mapping. Editable by the reviewer.
 */
export interface DataRequirement {
  /** Machine-readable field identifier (from CapabilityInput.label). */
  readonly field: string;
  /** Human-readable label for UI display. */
  readonly label: string;
  /** What kind of DATA this field requires. */
  readonly kind: DataKind;
  /** How this field is operated (platform-level interaction strategy hint). */
  readonly inputMethod: InputMethod | null;
  /** Whether this field must be provided. */
  readonly required: boolean;
  /** Suggested default value for test generation. */
  readonly defaultValue: string | null;
  /** Validation constraints. */
  readonly constraints: DataConstraint;
  /** Whether this was auto-derived or manually added by a reviewer. */
  readonly source: 'inferred' | 'manual';
}
