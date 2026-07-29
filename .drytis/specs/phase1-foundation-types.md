"autocomplete-input"
           role="combobox" aria-expanded="false" aria-controls="autocomplete-list">
    <div class="autocomplete-list" id="autocomplete-list" role="listbox"></div>
  </div>
</div>

<!-- 8: Tree View -->
<h2>8. Tree View</h2>
<div class="section">
  <div role="tree" data-testid="tree-view">
    <div class="tree-item">
      <div class="tree-node" role="treeitem" aria-expanded="true" aria-selected="false" tabindex="0" data-testid="tree-1">
        <span class="tree-expand">&#9660;</span><span class="tree-label">Documents</span>
      </div>
      <div class="tree-item">
        <div class="tree-node" role="treeitem" aria-expanded="false" aria-selected="false" tabindex="-1" data-testid="tree-1-1">
          <span class="tree-expand">&#9654;</span><span class="tree-label">Reports</span>
        </div>
      </div>
      <div class="tree-item">
        <div class="tree-node" role="treeitem" aria-selected="false" tabindex="-1" data-testid="tree-1-2">
          <span class="tree-expand">&nbsp;</span><span class="tree-label">Resume.pdf</span>
        </div>
      </div>
    </div>
    <div class="tree-item">
      <div class="tree-node" role="treeitem" aria-expanded="false" aria-selected="false" tabindex="-1" data-testid="tree-2">
        <span class="tree-expand">&#9654;</span><span class="tree-label">Images</span>
      </div>
    </div>
  </div>
</div>

<!-- 9: Interactive Table -->
<h2>9. Interactive Table</h2>
<div class="section">
  <table data-testid="interactive-table">
    <thead><tr>
      <th class="sortable" data-column="name" data-testid="th-name">Name &#9660;</th>
      <th class="sortable" data-column="age" data-testid="th-age">Age</th>
      <th><input type="checkbox" id="select-all" data-testid="select-all"></th>
    </tr></thead>
    <tbody id="table-body">
      <tr data-testid="row-1"><td>Alice</td><td>30</td><td><input type="checkbox" checked data-testid="row-1-cb"></td></tr>
      <tr data-testid="row-2"><td>Bob</td><td>25</td><td><input type="checkbox" data-testid="row-2-cb"></td></tr>
      <tr data-testid="row-3"><td>Charlie</td><td>35</td><td><input type="checkbox" data-testid="row-3-cb"></td></tr>
    </tbody>
  </table>
</div>

<!-- 10: Dialogs -->
<h2>10. Dialogs &amp; Modals</h2>
<div class="section">
  <button id="open-modal-btn" data-testid="open-modal-btn">Open Modal</button>
  <button id="open-dialog-btn" data-testid="open-dialog-btn">Open Native Dialog</button>
</div>

<!-- 11: Drag & Drop -->
<h2>11. Drag &amp; Drop</h2>
<div class="section">
  <div class="dnd-container" data-testid="dnd-container">
    <div class="dnd-column" id="dnd-col-1">
      <div class="dnd-item" draggable="true" data-testid="dnd-item-1">Item A</div>
      <div class="dnd-item" draggable="true" data-testid="dnd-item-2">Item B</div>
    </div>
    <div class="dnd-column" id="dnd-col-2">
      <div class="dnd-item" draggable="true" data-testid="dnd-item-3">Item C</div>
    </div>
  </div>
</div>

<!-- 12: Rich Text Editor -->
<h2>12. Rich Text Editor</h2>
<div class="section">
  <div class="rte-toolbar">
    <button id="rte-bold" data-testid="rte-bold"><b>B</b></button>
    <button id="rte-italic" data-testid="rte-italic"><i>I</i></button>
    <button id="rte-underline" data-testid="rte-underline"><u>U</u></button>
  </div>
  <div class="rte-content" id="rte-editor" contenteditable="true" data-testid="rte-editor" role="textbox" aria-multiline="true" aria-label="Rich text editor"><p>Start typing...</p></div>
</div>

<!-- 13: Shadow DOM -->
<h2>13. Shadow DOM Component</h2>
<div class="sectio