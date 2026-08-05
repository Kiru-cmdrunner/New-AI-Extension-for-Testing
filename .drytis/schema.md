# Schema

**Not yet defined.**

Database schema, data models, and data structures are deferred until the
prior work has been reviewed and architectural decisions have been made.

## Conceptual Entities (from the vision — not a schema yet)

These are the *kinds* of information the system will eventually need to
represent. They are listed here to anchor discussion, not to prescribe a
design:

- **Interaction observation** — a single meaningful user event captured
  during a recording session
- **Element description** — semantic understanding of what an element
  represents, how it behaves, and its role
- **Behaviour delta** — what changed after an interaction (DOM, state,
  network)
- **Component model** — a composite control and the elements that belong
  to it
- **Values / options / constraints** — the possible values and rules for a
  control
- **Business purpose** — the intent or capability an interaction serves
- **Workflow** — a sequence of interactions forming a meaningful test flow
- **Semantic application model** — the evolving knowledge base of the
  application's capabilities and relationships
- **Generated test scenario** — positive/negative/boundary/validation test
  derived from the semantic model
- **Test data** — input data generated for test execution
- **Execution result** — outcome of running a generated test against the
  current UI

All schema decisions are pending the review of prior work.
