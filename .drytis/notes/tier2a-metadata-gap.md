# Tier 2A — Metadata Gap Finding

**Date:** 2026-07-31
**Context:** Step 4 (structural assertion providers) implementation

## Finding

The structural assertion providers in `assertion-providers.ts` initially checked for metadata fields that component definitions don't currently produce:

| Provider | Expected Field | Actual Definition Output |
|----------|---------------|------------------------|
| surfaceStateProvider (Tab) | `metadata.activePanel` | Only `metadata.targetName` |
| dropdownClosedProvider | `metadata.isOpen` | Not produced (Dropdown stores `selectedValue`, `interactionSubtype`) |

## Decision

Adjust providers to generate assertions based on what definitions actually produce, not aspirational fields. The provider pattern itself is sound — the issue is that the field names must match real definition output.

Specifically:
- **ElementPresenceProvider**: No change needed — uses `interaction.target`, always available
- **SurfaceStateProvider**: For ModalDialog, uses `metadata.modalTitle` (produced by modal-dialog.ts:394). For Tab, generate presence assertion instead (panel info not available per-interaction)
- **DropdownClosedProvider**: Check `ariaExpanded` in triggerEvent.domContext instead of `isOpen` metadata

This is the correct approach for this step. Enriching definitions to produce richer metadata (like `activePanel`) belongs in future definition enhancement work, not in the enrichment pass.
