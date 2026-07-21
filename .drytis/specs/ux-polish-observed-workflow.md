# UX Polish: Observed Workflow + Collapsible Raw Events

## Goal
Final UX pass before marking the Evidence Engine architecture phase complete. Polish interaction wording to read naturally for testers, rename the section, and reorganize the stopped view with Observed Workflow as the primary view and Raw Event Timeline as a collapsible developer section.

## Changes

### 1. Wording Polish (`timeline-renderer.ts` `actionDescription()`)

| Type | Current | New |
|---|---|---|
| Click | (falls through to default) | `Click "Continue"` |
| Link | `Click link "Schedule"` | `Click "Schedule"` |
| Hover | `Hover "SERVICE"` | `Hover over "SERVICE"` |
| TextEntry | `Enter "9894438714" in Enter your mobile phone number` | `Enter mobile phone number "9894438714"` |
| PageNavigation | `Navigate to "https://www.avisford.com/"` | `Navigate to www.avisford.com` |

TextEntry field-name cleaning: strip leading verbs like "Enter your ", "Enter ", "Please enter " from the target name so we don't get doubled "Enter".

PageNavigation: strip protocol + quotes, show hostname + path.

### 2. Section Rename + Reorder (`index.html`)

**Stopped view order (top → bottom):**
1. TC Badge (existing)
2. Status card (existing)
3. Recording Context (existing)
4. **Observed Workflow** (was "Detected Interactions", now PRIMARY — always visible when interactions exist)
5. **Raw Event Timeline** (collapsible — collapsed by default, toggle to expand)
6. Replay JSON (existing collapsible)
7. Actions (existing)

- Rename: "🎯 Detected Interactions" → "📋 Observed Workflow"
- Rename: "Event Timeline" → "Raw Event Timeline" (stopped view only — recording view keeps "Event Timeline")
- Add collapsible toggle button for Raw Event Timeline (same pattern as Replay JSON toggle)

### 3. Remove Redundant Metadata (`formatInteractionMetadata()`)

Remove `checked` and `scrollPosition` from metadata line — already conveyed by the action description ("Check/Uncheck", "Scroll to (x, y)"). Keep `hoverDuration` since it's not in the action text.

### 4. CSS (`sidepanel.css`)

Add `.collapsible-toggle` button styling matching the existing `.step-card__json-toggle` pattern.

### 5. Side Panel Logic (`sidepanel.ts`)

Add toggle handler for raw events collapsible. Collapse by default after stop.

## Acceptance Criteria

- [ ] "Detected Interactions" section renamed to "Observed Workflow"
- [ ] Observed Workflow appears ABOVE Raw Event Timeline in stopped view
- [ ] Raw Event Timeline is collapsible, collapsed by default after stop
- [ ] Hover reads "Hover over 'name'"
- [ ] Link reads "Click 'name'" (not "Click link 'name'")
- [ ] Click reads "Click 'name'"
- [ ] TextEntry reads "Enter {field} 'value'" with cleaned field name
- [ ] PageNavigation reads "Navigate to hostname" without quotes/protocol
- [ ] No redundant metadata (checked/scrollPosition already in action text)
- [ ] All existing tests pass
- [ ] Updated tests reflect new wording
