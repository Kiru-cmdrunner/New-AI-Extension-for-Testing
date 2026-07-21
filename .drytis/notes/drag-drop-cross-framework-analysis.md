# Drag & Drop Cross-Framework Analysis

## HTML5 Native DnD
- Events: dragstart → drag → dragenter/dragover → drop → dragend
- dataTransfer only readable during drop (must store source in variable)
- preventDefault() in dragover needed for drop to fire
- File drags from OS: no dragstart/dragend, only dragenter/drop
- Used by: Trello, Google Drive, SharePoint

## Framework-Based (No Native Events)
- **dnd-kit**: PointerSensor (mousedown→mousemove→mouseup), CSS transforms, aria-grabbed
- **react-beautiful-dnd**: deprecated, pointer-based
- **Pragmatic DnD** (Atlassian): pointer-based, monitor for mousedown on [data-dnd] or role="button" draggable elements
- These do NOT fire dragstart/drop — must detect via pointer events

## Detection Strategy: Dual Path
1. HTML5: dragstart stores source ref → drop identifies destination → single event
2. Pointer: mousedown on draggable element → mousemove tracking → mouseup finds drop target → single event
3. Guard: if HTML5 path fires, suppress pointer path for same interaction

## Draggable Element Detection
- `draggable="true"` attribute
- `[role="option"]`, `[role="treeitem"]`, `[role="listitem"]`
- `.dragging`, `.is-dragging`, `[data-dnd-source]` classes (dnd-kit adds these)
- Framework-specific: `.Mui-selected`, `.ant-tree-treenode-draggable`
