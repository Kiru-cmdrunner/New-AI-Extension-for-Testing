/**
 * Domain Error Classes — typed errors for invariant violations.
 *
 * Each error class maps to a specific invariant from domain-schema.md.
 * Callers can catch by error type to handle specific violations.
 */

/** Base class for all domain invariant violations. */
export class InvariantError extends Error {
  /** The invariant ID from domain-schema.md (e.g., 'INV-EL3'). */
  readonly invariant: string;
  /** The entity type involved (e.g., 'Element', 'ApprovedTestCase'). */
  readonly entityType: string;

  constructor(invariant: string, entityType: string, message: string) {
    super(message);
    this.name = 'InvariantError';
    this.invariant = invariant;
    this.entityType = entityType;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A required field is missing or empty. */
export class MissingFieldError extends InvariantError {
  readonly fieldName: string;

  constructor(entityType: string, fieldName: string) {
    const message = `${entityType}: required field "${fieldName}" is missing or empty`;
    super('MISSING_FIELD', entityType, message);
    this.name = 'MissingFieldError';
    this.fieldName = fieldName;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** An element referenced by a step or validation does not exist. */
export class ElementNotFoundError extends InvariantError {
  readonly elementId: string;

  constructor(elementId: string) {
    const message = `Element not found: ${elementId}`;
    super('INV-ATCV3', 'Element', message);
    this.name = 'ElementNotFoundError';
    this.elementId = elementId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Attempted to delete an element that is still referenced (INV-EL3). */
export class ElementReferencedError extends InvariantError {
  readonly elementId: string;
  readonly referencedBy: string[];

  constructor(elementId: string, referencedBy: string[]) {
    const message =
      `Element ${elementId} cannot be deleted because it is referenced by ` +
      `${referencedBy.length} test case version(s): ${referencedBy.join(', ')}`;
    super('INV-EL3', 'Element', message);
    this.name = 'ElementReferencedError';
    this.elementId = elementId;
    this.referencedBy = referencedBy;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** An invariant on a value object (Step, Validation, LocatorStrategy) was violated. */
export class ValueObjectError extends InvariantError {
  constructor(entityType: string, message: string) {
    super('INVALID_VALUE_OBJECT', entityType, message);
    this.name = 'ValueObjectError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A version operation violated versioning invariants (INV-ATCV1, INV-ATCV2). */
export class VersionError extends InvariantError {
  constructor(invariant: string, message: string) {
    super(invariant, 'ATCVersion', message);
    this.name = 'VersionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** An invalid status transition was attempted (INV-ATC2). */
export class InvalidStatusTransitionError extends InvariantError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    const message = `Invalid status transition: ${from} → ${to}`;
    super('INV-ATC2', 'ApprovedTestCase', message);
    this.name = 'InvalidStatusTransitionError';
    this.from = from;
    this.to = to;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
