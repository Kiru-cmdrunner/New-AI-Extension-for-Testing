# Foundation Validation — Phase B Issues Log (Tier 2: Public Web Applications)

## Sites Analyzed

### 1. Hacker News (news.ycombinator.com)
- **DOM structure:** Table-based layout (non-semantic HTML)
- **Element identification:** Zero data-testid, minimal ARIA, text-only accessible names
- **Unique patterns:**
  - Vote links with dynamic IDs (up_48997548)
  - Story links with no stable ID (class-based CSS only)
  - Search input with no ID, no label, no placeholder
  - External links to different domains
  - Pagination links (More)

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| B-001 | P3 | Upvote `<a>` classified as Link not Click | **Expected** — `<a>` with role=link → Link is correct |
| B-002 | P3 | Search input with no label/placeholder | **Works** — recorder captures accessibleName from text, CSS selector used |

### 2. Wikipedia (en.wikipedia.org)
- **DOM structure:** Heavy link density (1500+ links), ARIA-enabled search, collapsible sections
- **Element identification:** ID-based (#searchInput, #ca-edit), class-based (.vector-tab, .toclevel-1)
- **Unique patterns:**
  - Search input with type=search + aria-label
  - Table of contents with nested class-based links
  - Collapsible sections (vector-pinnable-header-toggle-button)
  - Internal vs external link distinction

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| B-003 | — | No issues found | All patterns handled correctly |

### 3. The-Internet (the-internet.herokuapp.com)
- **DOM structure:** 44 test scenarios covering edge cases
- **Unique patterns tested:**
  - Same-origin iframe with contenteditable (TinyMCE WYSIWYG editor)
  - Custom element shadow DOM (<my-paragraph>)
  - Drag-and-drop (draggable divs with IDs)
  - Login form (username + password + submit)

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| B-004 | — | No issues found | All patterns handled correctly |

### 4. TodoMVC React (todomvc.com/examples/react)
- **DOM structure:** React controlled inputs, class-based selectors
- **Unique patterns:**
  - React controlled input (synthetic event handling)
  - Class-based selectors only (no data-testid)
  - Toggle-all checkbox (ID-based)
  - Todo item checkbox (class-based, no ID)
  - Filter links (hash-based routing)

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| B-005 | P3 | Two text entries on same element merge into 1 interaction | **Expected** — V1 grouper merges events on same element within time window |
| B-006 | P3 | TodoMVC React page has sidebar that can capture clicks | **Not an issue** — recorder captures correct element identity |

## Pattern Coverage Summary

| Pattern | HN | Wiki | The-Internet | TodoMVC | Test Pages |
|---------|----|----|--------------|---------|------------|
| Table-based layout | ✓ | | | | |
| Zero data-testid | ✓ | ✓ | ✓ | ✓ | |
| Heavy link density | ✓ | ✓ | | | |
| Search with aria-label | | ✓ | | | ✓ |
| Search without label | ✓ | | | | |
| Same-origin iframe | | | ✓ | | ✓ |
| Shadow DOM | | | ✓ | | ✓ |
| Drag-and-drop | | | ✓ | | ✓ |
| Login form | | | ✓ | | |
| React controlled input | | | | ✓ | |
| Collapsible sections | | ✓ | | | |
| TOC navigation | | ✓ | | | |
| Dynamic IDs | ✓ | | | | |
| Class-based selectors | ✓ | ✓ | ✓ | ✓ | |

## New Tests Added

- tests/phase-b-realworld-validation.test.ts: 25 tests across 6 describe blocks
  - Hacker News: 6 tests (upvote, story link, search, user link, pagination, full workflow)
  - Wikipedia: 5 tests (search, TOC, collapsible, internal link, full workflow)
  - The-Internet: 5 tests (iframe editor, shadow DOM, drag-drop, login form, pipeline)
  - TodoMVC React: 5 tests (new todo, toggle-all, todo checkbox, filter, full workflow)
  - Cross-site comparison: 3 tests (login form equivalence, V2 consistency, nested table)
  - Pattern coverage summary: 1 test

## Phase B Exit Assessment

### Criteria Met
- ✓ 3+ public web apps analyzed (HN, Wikipedia, The-Internet, TodoMVC)
- ✓ Real-world patterns that differ from test pages identified
- ✓ All patterns handled correctly by the pipeline
- ✓ Integration tests cover all unique patterns
- ✓ Zero P0/P1 issues found
- ✓ Full test suite passes (2936/2936)
- ✓ Build succeeds

### Recommendation
**Ready to proceed to Phase C (Tier 3 — Framework-specific apps)**
No P0 or P1 issues discovered. All P3 observations are expected behavior.
The pipeline handles real-world DOM patterns correctly, including table-based layouts,
zero-testid pages, heavy link density, iframes, shadow DOM, and React controlled inputs.
