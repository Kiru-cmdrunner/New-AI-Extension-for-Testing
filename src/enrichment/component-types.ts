/**
 * Component Types — Enrichment Layer Type Definitions
 *
 * The three-layer model:
 *   Layer 1: Interaction Type    → Click, TextEntry, Dropdown, etc.
 *   Layer 2: Component Type       → DataGrid, IconButton, SortButton, etc.
 *   Layer 3: Business Meaning     → "Sort by Name", "Close dialog"
 */

/** Framework/library that rendered the component. */
export type ComponentFramework =
  | 'MUI'
  | 'AntDesign'
  | 'PrimeReact'
  | 'AGGrid'
  | 'ChakraUI'
  | 'RadixUI'
  | 'OXD'
  | 'HeadlessUI'
  | 'Syncfusion'
  | 'DevExtreme'
  | 'Quill'
  | 'TinyMCE'
  | 'Generic';

/** Semantic component type — what the UI element IS, not how the user interacted. */
export type ComponentType =
  | 'DataGrid'
  | 'TreeView'
  | 'Accordion'
  | 'TabBar'
  | 'Dialog'
  | 'Drawer'
  | 'Carousel'
  | 'ContextMenu'
  | 'Breadcrumb'
  | 'Stepper'
  | 'IconButton'
  | 'SortButton'
  | 'GridToggle'
  | 'Autocomplete'
  | 'RichTextEditor'
  | 'ChipInput'
  | 'SplitButton'
  | 'Spinner'
  | 'Alert'
  | 'Tooltip'
  | 'ProgressBar'
  | 'Rating'
  | 'ToggleSwitch'
  | 'FileUpload'
  | 'Badge'
  | 'Generic';

/** Result of component detection. */
export interface ComponentDetectionResult {
  /** Semantic component type (e.g. 'IconButton', 'DataGrid'). */
  componentType: ComponentType;
  /** Framework that rendered it (e.g. 'MUI', 'AntDesign'). */
  componentFramework: ComponentFramework;
  /** Human-readable business meaning (e.g. 'Close dialog', 'Sort by Name'). */
  businessMeaning: string;
  /** Additional semantic data (e.g. column name, icon name). */
  componentData: Record<string, string>;
}

/** Icon semantic names — recognized from common icon patterns. */
export const ICON_SEMANTIC_NAMES: Record<string, string> = {
  close: 'Close',
  x: 'Close',
  cancel: 'Close',
  delete: 'Delete',
  trash: 'Delete',
  remove: 'Remove',
  edit: 'Edit',
  pencil: 'Edit',
  editpencil: 'Edit',
  add: 'Add',
  plus: 'Add',
  search: 'Search',
  magnifier: 'Search',
  filter: 'Filter',
  funnel: 'Filter',
  download: 'Download',
  upload: 'Upload',
  refresh: 'Refresh',
  reload: 'Refresh',
  sync: 'Refresh',
  settings: 'Settings',
  gear: 'Settings',
  cog: 'Settings',
  bell: 'Notifications',
  notification: 'Notifications',
  menu: 'Menu',
  hamburger: 'Menu',
  more: 'More options',
  overflow: 'More options',
  ellipsis: 'More options',
  chevrondown: 'Expand',
  chevronup: 'Collapse',
  chevronright: 'Expand',
  chevronleft: 'Back',
  arrowright: 'Next',
  arrowleft: 'Previous',
  arrowup: 'Up',
  arrowdown: 'Down',
  star: 'Favourite',
  heart: 'Favourite',
  favorite: 'Favourite',
  favourite: 'Favourite',
  bookmark: 'Bookmark',
  share: 'Share',
  copy: 'Copy',
  clipboard: 'Copy',
  print: 'Print',
  printer: 'Print',
  home: 'Home',
  user: 'User',
  person: 'User',
  account: 'Account',
  info: 'Info',
  help: 'Help',
  question: 'Help',
  warning: 'Warning',
  alert: 'Alert',
  check: 'Confirm',
  checkmark: 'Confirm',
  tick: 'Confirm',
  eye: 'Show',
  eyeoff: 'Hide',
  lock: 'Lock',
  unlock: 'Unlock',
  logout: 'Sign out',
  signin: 'Sign in',
  login: 'Sign in',
};
