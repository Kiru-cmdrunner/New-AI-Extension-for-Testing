/**
 * M9.11 — DevTools Domain Pack (GitHub-style)
 *
 * Configuration for developer tools and code-hosting platforms:
 * issue tracking, pull requests, code review, CI/CD builds.
 *
 * Architecture: .drytis/specs/m9-11-multi-domain-config.md
 */

import type { DomainPack } from '../domain-pack-types';
import type { IntentVocabEntry } from '../../enrichment/intent-vocabulary';
import type { SemanticSelector } from '../../page-content/page-content-types';

const DEVTOOLS_INTENT_VOCABULARY: IntentVocabEntry[] = [
  {
    intent: 'Create issue',
    matchers: [
      { field: 'label', pattern: 'new\\s*issue' },
      { field: 'label', pattern: 'create\\s*issue' },
    ],
    baseConfidence: 0.85,
  },
  {
    intent: 'Close issue',
    matchers: [
      { field: 'label', pattern: 'close\\s*(issue|ticket)' },
      { field: 'label', pattern: '\\bclose\\b' },
    ],
    baseConfidence: 0.8,
  },
  {
    intent: 'Comment on issue',
    matchers: [
      { field: 'label', pattern: 'comment' },
      { field: 'className', pattern: 'comment' },
    ],
    baseConfidence: 0.75,
  },
  {
    intent: 'Merge pull request',
    matchers: [
      { field: 'label', pattern: 'merge' },
      { field: 'label', pattern: 'merge\\s*pull\\s*request' },
    ],
    baseConfidence: 0.85,
  },
  {
    intent: 'Approve pull request',
    matchers: [
      { field: 'label', pattern: 'approve' },
      { field: 'label', pattern: 'approve\\s*(changes|pr)' },
    ],
    baseConfidence: 0.85,
  },
  {
    intent: 'Request changes',
    matchers: [
      { field: 'label', pattern: 'request\\s*changes' },
      { field: 'label', pattern: 'changes\\s*requested' },
    ],
    baseConfidence: 0.85,
  },
  {
    intent: 'Assign reviewer',
    matchers: [
      { field: 'label', pattern: 'assign.*review' },
      { field: 'label', pattern: 'request\\s*review' },
    ],
    baseConfidence: 0.8,
  },
  {
    intent: 'Trigger build',
    matchers: [
      { field: 'label', pattern: '(run|trigger|start)\\s*(build|pipeline|workflow)' },
    ],
    baseConfidence: 0.8,
  },
  {
    intent: 'Clone repository',
    matchers: [
      { field: 'label', pattern: 'clone' },
      { field: 'label', pattern: 'clone\\s*repo' },
    ],
    baseConfidence: 0.8,
  },
];

const DEVTOOLS_PAGE_CONTENT_SELECTORS: SemanticSelector[] = [
  // Issue/PR entities
  {
    selector: '[data-issue-id], [data-pull-request-id]',
    kind: 'entity',
    entityType: 'issue',
    idAttribute: 'data-issue-id',
    extractAttributes: ['data-issue-id', 'aria-label'],
  },
  // Status badges (GitHub uses .State and .Label classes)
  {
    selector: '[class*="State"][class*="state"], [class*="status-badge"], [data-testid*="status"]',
    kind: 'status-badge',
    extractAttributes: ['aria-label', 'data-testid'],
  },
  // Build/CI status
  {
    selector: '[class*="workflow-status"], [class*="build-status"], [data-testid*="build"]',
    kind: 'status-badge',
    extractAttributes: ['aria-label', 'data-testid'],
  },
  // Code diff lines (collection)
  {
    selector: '[class*="diff-view"] tr, [class*="diff-table"] tr',
    kind: 'collection',
    extractNumeric: true,
  },
];

export const DEVTOOLS_PACK: DomainPack = {
  id: 'devtools',
  label: 'Developer Tools',
  domainType: 'content',

  signatures: [{
    domain: 'content',
    viewWeights: {
      'issue-list': 3,
      'issue-detail': 3,
      'pr-list': 3,
      'pr-detail': 3,
      'repository': 2,
      'commit': 2,
      'actions': 2,
    },
    entityWeights: {
      'issue': 3,
      'pull-request': 3,
      'commit': 2,
      'comment': 1,
      'build': 2,
    },
    apiOperationWeights: {
      'create-issue': 3,
      'close-issue': 3,
      'merge-pr': 3,
      'comment': 2,
      'trigger-build': 2,
    },
    notificationKeywords: {
      'merged': 3,
      'closed': 2,
      'approved': 2,
      'failed': 2,
      'passed': 2,
      'deployed': 2,
    },
    urlFragments: {
      '/issues': 3,
      '/pulls': 3,
      '/pull/': 3,
      '/commit': 2,
      '/repos': 2,
      '/actions': 2,
      '/compare': 2,
    },
  }],

  entityTypes: [
    {
      entityType: 'issue',
      viewId: 'issue-detail',
      urlPattern: '/issues/\\d+',
    },
    {
      entityType: 'pull-request',
      viewId: 'pr-detail',
      urlPattern: '/pull/\\d+',
    },
    {
      entityType: 'commit',
      viewId: 'commit-detail',
      urlPattern: '/commit/[a-f0-9]+',
    },
    {
      entityType: 'build',
      viewId: 'build-detail',
      urlPattern: '/actions/runs/\\d+',
    },
  ],

  stateVocabulary: [
    { keywords: ['open'], canonical: 'open' },
    { keywords: ['closed'], canonical: 'closed' },
    { keywords: ['merged'], canonical: 'merged' },
    { keywords: ['in review', 'in-review'], canonical: 'in-review' },
    { keywords: ['changes requested', 'changes-requested'], canonical: 'changes-requested' },
    { keywords: ['in progress', 'in-progress'], canonical: 'in-progress' },
    { keywords: ['draft'], canonical: 'draft' },
    { keywords: ['todo'], canonical: 'todo' },
    { keywords: ['blocked'], canonical: 'blocked' },
    { keywords: ['archived'], canonical: 'archived' },
    { keywords: ['passed'], canonical: 'passed' },
    { keywords: ['failed'], canonical: 'failed' },
    { keywords: ['pending'], canonical: 'pending' },
    { keywords: ['queued'], canonical: 'queued' },
    { keywords: ['running'], canonical: 'running' },
    { keywords: ['cancelled', 'canceled'], canonical: 'cancelled' },
  ],

  viewPatterns: [
    { pattern: '/issues$', label: 'Issues', viewId: 'issue-list' },
    { pattern: '/issues/\\d+', label: 'Issue Detail', viewId: 'issue-detail' },
    { pattern: '/issues/new', label: 'New Issue', viewId: 'issue-new' },
    { pattern: '/pulls$', label: 'Pull Requests', viewId: 'pr-list' },
    { pattern: '/pull/\\d+', label: 'PR Detail', viewId: 'pr-detail' },
    { pattern: '/compare', label: 'Compare', viewId: 'pr-compare' },
    { pattern: '/commit/[a-f0-9]', label: 'Commit', viewId: 'commit-detail' },
    { pattern: '/commits', label: 'Commits', viewId: 'commit-list' },
    { pattern: '/actions', label: 'Actions/CI', viewId: 'actions' },
    { pattern: '/actions/runs', label: 'Build Detail', viewId: 'build-detail' },
    { pattern: '/tree/', label: 'Repository', viewId: 'repository' },
    { pattern: '/blob/', label: 'File Viewer', viewId: 'file-viewer' },
  ],

  intentVocabulary: DEVTOOLS_INTENT_VOCABULARY,

  networkPatterns: [
    { operation: 'create-issue', pattern: '/repos/.*/issues$' },
    { operation: 'close-issue', pattern: '/repos/.*/issues/.*\\?(state|status)' },
    { operation: 'merge-pr', pattern: '/repos/.*/pulls/\\d+/merge' },
    { operation: 'comment', pattern: '/repos/.*/(issues|pulls)/\\d+/comments' },
    { operation: 'trigger-build', pattern: '/repos/.*/actions/workflows' },
    { operation: 'review-pr', pattern: '/repos/.*/pulls/\\d+/reviews' },
  ],

  confirmationViews: [
    'issue-detail',
    'pr-detail',
    'build-detail',
  ],

  pageContentSelectors: DEVTOOLS_PAGE_CONTENT_SELECTORS,
};
