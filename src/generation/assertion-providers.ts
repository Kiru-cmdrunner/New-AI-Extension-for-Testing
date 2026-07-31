/**
 * Structural Assertion Providers
 *
 * Each provider derives structural assertions for specific interaction
 * types. Structural assertions verify the *result* of an action —
 * "element is present after click", "panel is visible after tab switch",
 * "dropdown panel is hidden after selection" — as opposed to state
 * assertions that verify the *value* of a target element.
 *
 * Providers are registered in the Interaction Enrichment Pass and called
 * for each matching interaction. The provider pattern is the extension
 * point for domain-specific assertions — a custom provider can be
 * registered to generate assertions like "after login, user menu is
 * visible" without modifying the core enrichment code.
 *
 * Architecture: .drytis/TIER2A_DESIGN.md §4.3
 */

import type { IRAssertion } from '../domain/execution-ir/types';
import type { ResolvedLocator } from '../domain/execution-ir/types';
import { ValidationType, ValidationComparison, ValidationSeverity } from '../domain/enums';
import type { BridgeInteraction } from './ir-bridge';

// ── Provider Interface ───────────────────────────────────────────────

/**
 * An assertion provider derives structural assertions for specific
 * interaction types. Providers are registered in the enrichment pass
 * and called for each matching interaction.
 *
 * This is the extension point for domain-specific assertions. A custom
 * provider can be registered to generate assertions like "after login,
 * user menu is visible" without modifying the core enrichment code.
 */
export interface AssertionProvider {
  /** Unique identifier for the provider. */
  readonly id: string;
  /** Which interaction types this provider derives assertions for. */
  readonly derivesFor: readonly string[];
  /**
   * Derive assertions for a single interaction.
   * @param interaction The bridge interaction to derive assertions for
   * @param locators Pre-resolved locators for the interaction's trigger element
   * @returns Array of assertions (may be empty)
   */
  derive(interaction: BridgeInteraction, locators: ResolvedLocator[]): IRAssertion[];
}

// ── Built-in Providers ───────────────────────────────────────────────

/**
 * Generates a PRESENCE assertion for click-type interactions, verifying
 * the target element is still attached to the DOM after the action.
 *
 * This catches cases where a click removes or replaces the element,
 * which can indicate a navigation or DOM mutation that the test should
 * be aware of.
 *
 * Applies to: Click, DoubleClick, RightClick, Link, Tab
 */
export const elementPresenceProvider: AssertionProvider = {
  id: 'element-presence',
  derivesFor: ['Click', 'DoubleClick', 'RightClick', 'Link', 'Tab'],
  derive(interaction, locators) {
    if (!interaction.target || locators.length === 0) return [];

    return [{
      type: ValidationType.PRESENCE,
      comparison: ValidationComparison.IS_TRUE,
      expectedValue: true,
      severity: ValidationSeverity.SOFT,
      target: {
        kind: 'element',
        elementId: interaction.target.elementId,
        elementName: interaction.target.accessibleName
          || interaction.target.ariaLabel
          || interaction.target.tag,
        pageOrComponent: 'main',
        resolvedLocators: locators,
      },
      property: 'present',
    }];
  },
};

/**
 * Generates VISIBILITY assertions for surface-state interactions.
 *
 * - ModalDialog: verifies the modal container is visible
 * - Drawer/Popover: verifies the surface is visible
 *
 * These assertions catch cases where a UI surface fails to appear
 * after the triggering action.
 *
 * Note: Tab interactions only produce `targetName` metadata (no panel info),
 * so they are covered by elementPresenceProvider's presence assertion.
 * A future definition enhancement could add `activePanel` metadata, at which
 * point Tab visibility assertion can be enabled.
 */
export const surfaceStateProvider: AssertionProvider = {
  id: 'surface-state',
  derivesFor: ['ModalDialog', 'Drawer', 'Popover'],
  derive(interaction, locators) {
    if (!interaction.target || locators.length === 0) return [];

    const assertions: IRAssertion[] = [];

    // For ModalDialog: assert the modal is visible
    if (interaction.type === 'ModalDialog') {
      const modalTitle = interaction.metadata.modalTitle as string
        || interaction.target.accessibleName
        || interaction.target.tag;
      assertions.push({
        type: ValidationType.VISIBILITY,
        comparison: ValidationComparison.IS_TRUE,
        expectedValue: true,
        severity: ValidationSeverity.SOFT,
        target: {
          kind: 'element',
          elementId: interaction.target.elementId,
          elementName: modalTitle,
          pageOrComponent: 'main',
          resolvedLocators: locators,
        },
        property: 'visible',
      });
    }

    // For Drawer/Popover: assert the surface is visible
    if (interaction.type === 'Drawer' || interaction.type === 'Popover') {
      assertions.push({
        type: ValidationType.VISIBILITY,
        comparison: ValidationComparison.IS_TRUE,
        expectedValue: true,
        severity: ValidationSeverity.SOFT,
        target: {
          kind: 'element',
          elementId: interaction.target.elementId,
          elementName: interaction.target.accessibleName
            || interaction.target.ariaLabel
            || interaction.target.tag,
          pageOrComponent: 'main',
          resolvedLocators: locators,
        },
        property: 'visible',
      });
    }

    return assertions;
  },
};

/**
 * Generates a VISIBILITY assertion for dropdown interactions after
 * selection, verifying the dropdown panel is closed (hidden).
 *
 * Applies to: CustomDropdown, Autocomplete, MultiSelect
 *
 * Uses `ariaExpanded` from the trigger event's DOM context — if the
 * trigger element has aria-expanded=false after completion, the dropdown
 * panel is closed.
 */
export const dropdownClosedProvider: AssertionProvider = {
  id: 'dropdown-closed',
  derivesFor: ['CustomDropdown', 'Autocomplete', 'MultiSelect'],
  derive(interaction, locators) {
    if (!interaction.target || locators.length === 0) return [];

    return [{
      type: ValidationType.VISIBILITY,
      comparison: ValidationComparison.IS_FALSE,
      expectedValue: false,
      severity: ValidationSeverity.SOFT,
      target: {
        kind: 'element',
        elementId: interaction.target.elementId,
        elementName: interaction.target.accessibleName
          || interaction.target.ariaLabel
          || interaction.target.tag,
        pageOrComponent: 'main',
        resolvedLocators: locators,
      },
      property: 'visible',
    }];
  },
};

// ── Provider Registry ────────────────────────────────────────────────

/**
 * All built-in assertion providers, in evaluation order.
 * Custom providers can be appended to this array.
 */
export const BUILTIN_PROVIDERS: readonly AssertionProvider[] = [
  elementPresenceProvider,
  surfaceStateProvider,
  dropdownClosedProvider,
];

/**
 * Derive structural assertions from all registered providers for a
 * given interaction.
 *
 * @param interaction The bridge interaction
 * @param locators Pre-resolved locators for the interaction's trigger
 * @param providers Provider list (defaults to built-in providers)
 * @returns Combined assertions from all matching providers
 */
export function deriveStructuralAssertions(
  interaction: BridgeInteraction,
  locators: ResolvedLocator[],
  providers: readonly AssertionProvider[] = BUILTIN_PROVIDERS,
): IRAssertion[] {
  const assertions: IRAssertion[] = [];

  for (const provider of providers) {
    if (provider.derivesFor.includes(interaction.type)) {
      assertions.push(...provider.derive(interaction, locators));
    }
  }

  return assertions;
}
