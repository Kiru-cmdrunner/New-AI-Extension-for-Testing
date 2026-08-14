/**
 * M9.11 — HR Domain Pack (OrangeHRM-style)
 *
 * Configuration for Human Resources applications: employee management,
 * leave requests, recruitment, time tracking, performance reviews.
 *
 * Architecture: .drytis/specs/m9-11-multi-domain-config.md
 */

import type { DomainPack } from '../domain-pack-types';
import type { IntentVocabEntry } from '../../enrichment/intent-vocabulary';
import type { SemanticSelector } from '../../page-content/page-content-types';

const HR_INTENT_VOCABULARY: IntentVocabEntry[] = [
  {
    intent: 'Apply for leave',
    matchers: [
      { field: 'label', pattern: 'apply\\s*(leave|for leave)' },
      { field: 'label', pattern: 'request\\s*leave' },
    ],
    baseConfidence: 0.85,
  },
  {
    intent: 'Approve leave',
    matchers: [
      { field: 'label', pattern: 'approve' },
      { field: 'label', pattern: 'accept\\s*(request|leave)' },
    ],
    baseConfidence: 0.85,
  },
  {
    intent: 'Reject leave',
    matchers: [
      { field: 'label', pattern: 'reject' },
      { field: 'label', pattern: 'decline' },
    ],
    baseConfidence: 0.85,
  },
  {
    intent: 'Add employee',
    matchers: [
      { field: 'label', pattern: 'add\\s*(employee|member|staff)' },
      { field: 'label', pattern: 'create\\s*(employee|staff)' },
    ],
    baseConfidence: 0.85,
  },
  {
    intent: 'Save record',
    matchers: [
      { field: 'label', pattern: '\\bsave\\b' },
      { field: 'label', pattern: 'update\\s*(record|info|details)' },
    ],
    baseConfidence: 0.8,
  },
  {
    intent: 'Assign task',
    matchers: [
      { field: 'label', pattern: 'assign' },
    ],
    baseConfidence: 0.75,
  },
  {
    intent: 'Shortlist candidate',
    matchers: [
      { field: 'label', pattern: 'shortlist' },
    ],
    baseConfidence: 0.8,
  },
  {
    intent: 'Schedule interview',
    matchers: [
      { field: 'label', pattern: 'schedule\\s*interview' },
      { field: 'label', pattern: 'book\\s*interview' },
    ],
    baseConfidence: 0.8,
  },
];

const HR_PAGE_CONTENT_SELECTORS: SemanticSelector[] = [
  // Employee / record entities
  {
    selector: '[data-record-id], [data-employee-id]',
    kind: 'entity',
    entityType: 'employee',
    idAttribute: 'data-record-id',
    extractAttributes: ['data-record-id', 'data-employee-id', 'aria-label'],
  },
  // HR status badges (OrangeHRM uses .oxd-table-cell and badge classes)
  {
    selector: '[class*="badge"][class*="status"], [class*="oxd-badge"], [data-testid*="status"]',
    kind: 'status-badge',
    extractAttributes: ['aria-label', 'data-testid'],
  },
  // HR notification toasts
  {
    selector: '[class*="oxd-toast"], [class*="toast-content"], [role="alert"]',
    kind: 'notification',
    extractAttributes: ['aria-label'],
  },
  // Employee directory tables
  {
    selector: 'table[data-testid], [class*="oxd-table"]',
    kind: 'collection',
    extractNumeric: true,
  },
];

export const HR_PACK: DomainPack = {
  id: 'hr',
  label: 'Human Resources',
  domainType: 'admin-crm',

  signatures: [{
    domain: 'admin-crm',
    viewWeights: {
      'employee-list': 3,
      'leave-list': 3,
      'leave-detail': 3,
      'candidate-list': 2,
      'time-sheet': 2,
      'performance': 2,
    },
    entityWeights: {
      'employee': 3,
      'leave-request': 3,
      'candidate': 2,
      'timesheet': 2,
    },
    apiOperationWeights: {
      'apply-leave': 3,
      'approve-leave': 3,
      'add-employee': 3,
      'save-record': 2,
    },
    notificationKeywords: {
      'saved': 2,
      'approved': 3,
      'rejected': 3,
      'submitted': 2,
      'updated': 2,
    },
    urlFragments: {
      '/pim': 3,
      '/leave': 3,
      '/admin': 2,
      '/recruitment': 3,
      '/time': 2,
      '/performance': 2,
      '/directory': 2,
    },
  }],

  entityTypes: [
    // Employee
    {
      entityType: 'employee',
      viewId: 'employee-detail',
      urlPattern: '/pim/viewEmployeeDetails|/pim/viewEmployees|/directory',
    },
    // Leave request
    {
      entityType: 'leave-request',
      viewId: 'leave-detail',
      urlPattern: '/leave/(?:assign|view)LeaveRequest',
    },
    // Candidate
    {
      entityType: 'candidate',
      viewId: 'candidate-add',
      urlPattern: '/recruitment/addCandidate|/recruitment/viewCandidates',
    },
    // Timesheet
    {
      entityType: 'timesheet',
      viewId: 'time-sheet',
      urlPattern: '/time/viewTimesheet',
    },
  ],

  stateVocabulary: [
    { keywords: ['pending', 'awaiting approval', 'awaiting review'], canonical: 'pending' },
    { keywords: ['approved'], canonical: 'approved' },
    { keywords: ['rejected', 'declined'], canonical: 'rejected' },
    { keywords: ['cancelled', 'canceled'], canonical: 'cancelled' },
    { keywords: ['submitted'], canonical: 'submitted' },
    { keywords: ['shortlisted'], canonical: 'shortlisted' },
    { keywords: ['interviewed'], canonical: 'interviewed' },
    { keywords: ['hired'], canonical: 'hired' },
    { keywords: ['on hold'], canonical: 'on-hold' },
    { keywords: ['active', 'enabled'], canonical: 'active' },
    { keywords: ['inactive', 'disabled'], canonical: 'inactive' },
  ],

  viewPatterns: [
    { pattern: '/pim/viewEmployees', label: 'Employee List', viewId: 'employee-list' },
    { pattern: '/pim/viewPersonalDetails', label: 'Employee Detail', viewId: 'employee-detail' },
    { pattern: '/pim/addEmployee', label: 'Add Employee', viewId: 'employee-add' },
    { pattern: '/leave/viewLeaveList', label: 'Leave List', viewId: 'leave-list' },
    { pattern: '/leave/assignLeave', label: 'Assign Leave', viewId: 'leave-assign' },
    { pattern: '/leave/applyLeave', label: 'Apply Leave', viewId: 'leave-apply' },
    { pattern: '/leave/viewLeaveRequest', label: 'Leave Detail', viewId: 'leave-detail' },
    { pattern: '/recruitment/viewCandidates', label: 'Candidate List', viewId: 'candidate-list' },
    { pattern: '/recruitment/addCandidate', label: 'Add Candidate', viewId: 'candidate-add' },
    { pattern: '/time/viewTimesheet', label: 'Timesheet', viewId: 'time-sheet' },
    { pattern: '/performance', label: 'Performance Review', viewId: 'performance' },
    { pattern: '/directory', label: 'Directory', viewId: 'directory' },
    { pattern: '/admin', label: 'Admin', viewId: 'admin' },
    { pattern: '/dashboard', label: 'Dashboard', viewId: 'dashboard' },
  ],

  intentVocabulary: HR_INTENT_VOCABULARY,

  networkPatterns: [
    { operation: 'apply-leave', pattern: '/leave.*apply|/api/v2/leave/employees/apply' },
    { operation: 'approve-leave', pattern: '/leave.*approve|/api/v2/leave.*action' },
    { operation: 'add-employee', pattern: '/pim.*add|/api/v2/pim/employees' },
    { operation: 'save-record', pattern: '/api/v2/.*/save' },
    { operation: 'upload-resume', pattern: '/recruitment.*upload|/file.*resume' },
  ],

  confirmationViews: [
    'leave-detail',
    'employee-detail',
    'candidate-detail',
  ],

  pageContentSelectors: HR_PAGE_CONTENT_SELECTORS,
};
