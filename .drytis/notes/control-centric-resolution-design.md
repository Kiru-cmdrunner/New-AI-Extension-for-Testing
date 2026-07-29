# Control-Centric Target Resolution Design — Key Decisions

## Core Principle
EventTap must answer "which logical UI control did the user intend to interact with?" — NOT "which DOM element received the browser event?"

## The Algorithm (5 Phases)
A. Path Capture — composedPath() (W3C standard, works across Shadow DOM)
B. Candidate Collection — score every element by ARIA roles, native tags, wrapper classes, interactive attributes, decorative penalties
C. Composite Control Detection — W3C ownership table maps composite→child (combobox→listbox→option)
D. Framework Adapter Consultation — pluggable, optional, enhances scoring
E. Scoring & Selection — primary candidate + alternatives + full evidence

## Multi-Candidate (the fundamental departure)
All three reference implementations return ONE element and discard composedPath.
New design: preserve full path, score all candidates, output primary + alternatives.
Recognition classifies from rich evidence — never needs to "repair" wrong capture.

## Scoring Weights
- ARIA atomic widget role: +100
- Native interactive tag: +80
- ARIA composite widget boundary: +60
- Framework wrapper class: +40
- Interactive attribute (tabindex, onclick): +20
- Cursor pointer: +10
- Decorative element (i, svg, span without role): −50
- Proximity bonus: +5 per level closer to click target

## W3C Ownership Table (composite → child)
combobox → listbox → option
menu/menubar → menuitem/menuitemcheckbox/menuitemradio
radiogroup → radio
tablist → tab
tree → treeitem
grid/treegrid → row → gridcell/rowheader

## Framework-Independent vs Adapter
Core works on ANY web app using W3C ARIA semantics.
Adapters (OXD, MUI, Ant Design, PrimeReact, AG Grid, Salesforce, SAP/Fiori) enhance scoring for non-ARIA-compliant components.
Adapters are optional — core algorithm doesn't require any.

## Cross-Platform
- Shadow DOM (open+closed): composedPath() traverses both ✅
- Nested Shadow DOM: works ✅
- Same-origin iframes: inject EventTap per iframe ✅
- Cross-origin iframes: detect boundary, partial capture (acceptable limitation) ⚠️
- Portal-rendered overlays: portals render into real DOM, path reflects actual position ✅
- Virtualised components: only visible elements exist, target resolution works normally ✅

## 20 Interaction Types Covered
Button Click, Text Entry, Dropdown/Combobox, Searchable Dropdown, Date Picker, Radio, Checkbox, Toggle Switch, Hover, Scroll, Navigation, Dialog/Modal, File Upload, Drag & Drop, Multi-select, Tree View, Context Menu, Tabs, Tables/Grids, Rich Text Editor

## What Must Change
target-resolver.ts: replace resolveTarget() with collectCandidates() + scoreCandidates() + selectPrimary()
New: framework adapter system, composite context detection
Update: EvidenceBatch carries ResolvedTarget, Recognition consults compositeContext

## Implementation Phases (Phase 3b)
3b-1: Multi-candidate path collection
3b-2: Composite control detection
3b-3: Framework adapter system (OXD + MUI + AntD first)
3b-4: Evidence integration (update EvidenceBatch, Channels, Recognition)
3b-5: Validation against acceptance test suite
