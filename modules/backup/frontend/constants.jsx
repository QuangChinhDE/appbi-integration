import React from 'react'
import {
  Inbox, FolderKanban, Building2, Headphones,
  FileSpreadsheet, Folder, Database,
} from 'lucide-react'

// ── App definitions ─────────────────────────────────────────────────────────
export const APPS = {
  request: {
    id: 'request',
    name: 'Request',
    icon: <Inbox className="w-5 h-5" />,
    color: '#ea580c',
    bg: '#fff7ed',
    description: 'Manage and backup request data',
    objects: ['group', 'request'],
    objectLabels: { group: 'Group', request: 'Request' },
    isSpecial: true,
  },
  workflow: {
    id: 'workflow',
    name: 'Workflow',
    icon: <FolderKanban className="w-5 h-5" />,
    color: '#7c3aed',
    bg: '#f5f3ff',
    description: 'Backup workflow configurations',
    objects: ['workflow', 'job', 'todo'],
    objectLabels: { workflow: 'Workflow', job: 'Job', todo: 'Todo' },
    isSpecial: false,
  },
  wework: {
    id: 'wework',
    name: 'WeWork',
    icon: <Building2 className="w-5 h-5" />,
    color: '#2563eb',
    bg: '#eff6ff',
    description: 'Backup organizational data',
    objects: ['department', 'project', 'task'],
    objectLabels: { department: 'Department', project: 'Project', task: 'Task' },
    isSpecial: false,
  },
  service: {
    id: 'service',
    name: 'Service',
    icon: <Headphones className="w-5 h-5" />,
    color: '#059669',
    bg: '#f0fdf4',
    description: 'Service desk and ticket backup',
    objects: ['service', 'ticket'],
    objectLabels: { service: 'Service', ticket: 'Ticket' },
    isSpecial: false,
  },
}

// ── App meta for list/detail views (compact) ────────────────────────────────
export const APP_META = {
  request:  { color: '#ea580c', icon: <Inbox className="w-4 h-4" /> },
  workflow: { color: '#7c3aed', icon: <FolderKanban className="w-4 h-4" /> },
  wework:   { color: '#2563eb', icon: <Building2 className="w-4 h-4" /> },
  service:  { color: '#059669', icon: <Headphones className="w-4 h-4" /> },
}

// ── Connection config per app ───────────────────────────────────────────────
export const APP_CONNECTION_CONFIG = {
  service: {
    stepTitle: 'Connection Information',
    stepDescription: 'Provide the Service domain and Base Account token used for backup access.',
    requiresDomain: true,
    domainLabel: 'Base Domain',
    domainPlaceholder: 'base.com.vn',
    domainHelp: 'Enter base.com.vn, service.base.com.vn, or a full Service URL. The backend will normalize it.',
    tokenLabel: 'Access Token V2',
    tokenPlaceholder: 'Paste your Base Account access_token_v2 here…',
    tokenHelp: 'Get this value from Service → Settings → API Keys. Use the Base Account access_token_v2 token.',
  },
}

// ── Mock custom fields (demo) ───────────────────────────────────────────────
export const MOCK_FIELDS = {
  workflow: [
    { id: 'wf1', object: 'workflow', name: 'Priority Level', type: 'select', desc: 'Workflow priority classification' },
    { id: 'wf2', object: 'workflow', name: 'Approval Matrix', type: 'input-table', desc: 'Approval routing table' },
    { id: 'wf3', object: 'job', name: 'Estimated Hours', type: 'number', desc: 'Time estimation for job' },
    { id: 'wf4', object: 'job', name: 'Skills Required', type: 'select-master', desc: 'Required skills list' },
  ],
  wework: [
    { id: 'ww1', object: 'department', name: 'Budget', type: 'number', desc: 'Department budget allocation' },
    { id: 'ww2', object: 'project', name: 'Milestones', type: 'input-table', desc: 'Project milestone tracking' },
    { id: 'ww3', object: 'project', name: 'Status', type: 'select', desc: 'Project status' },
    { id: 'ww4', object: 'task', name: 'Priority', type: 'select', desc: 'Task priority level' },
  ],
  service: [
    { id: 'sv1', object: 'service', name: 'SLA Hours', type: 'number', desc: 'Service level agreement time' },
    { id: 'sv2', object: 'ticket', name: 'Resolution Steps', type: 'input-table', desc: 'Resolution procedure steps' },
    { id: 'sv3', object: 'ticket', name: 'Severity', type: 'select', desc: 'Ticket severity level' },
  ],
}

// ── Backup type options ─────────────────────────────────────────────────────
export const BACKUP_TYPE_OPTIONS = [
  {
    id: 'structured',
    title: 'Spreadsheet (Structured Data)',
    desc: 'Export data as Excel/Spreadsheet — great for viewing and analysis',
    color: '#0284c7',
    icon: <FileSpreadsheet className="w-5 h-5" />,
    badge: 'Popular',
  },
  {
    id: 'unstructured',
    title: 'Files & Attachments',
    desc: 'Backup files, images, and documents attached to tickets and requests',
    color: '#d97706',
    icon: <Folder className="w-5 h-5" />,
    badge: null,
  },
  {
    id: 'all',
    title: 'Complete (Recommended)',
    desc: 'Includes both spreadsheets and all file attachments — the most complete backup',
    color: '#7c3aed',
    icon: <Database className="w-5 h-5" />,
    badge: 'Most complete',
  },
]

// ── Tag / status maps ───────────────────────────────────────────────────────
export const BACKUP_TYPE_TAG = {
  structured:   { color: 'blue',   label: 'Structured' },
  unstructured: { color: 'orange', label: 'Unstructured' },
  all:          { color: 'purple', label: 'Complete' },
}

export const RUN_STATUS_TAG = {
  pending:   { color: 'gold',       label: 'Pending' },
  running:   { color: 'processing', label: 'Running' },
  completed: { color: 'success',    label: 'Completed' },
  failed:    { color: 'error',      label: 'Failed' },
}

export const RUN_STATUS_COLORS = {
  completed: '#16a34a',
  failed:    '#dc2626',
  running:   '#2563eb',
  pending:   '#d97706',
}

export const RUN_STATUS_BG = {
  completed: '#f0fdf4',
  failed:    '#fef2f2',
  running:   '#eff6ff',
  pending:   '#fffbeb',
}

export const RUN_STATUS_LABELS = {
  completed: 'Completed',
  failed:    'Failed',
  running:   'Running',
  pending:   'Pending',
}

// ── Destination options ─────────────────────────────────────────────────────
export const DESTINATION_OPTIONS = [
  {
    id: 'gdrive',
    title: 'Google Drive',
    desc: 'Save to a Drive folder — supports all file formats',
    icon: <Folder className="w-5 h-5" />,
    color: '#1a73e8',
  },
  {
    id: 'gsheets',
    title: 'Google Sheets',
    desc: 'Create spreadsheets directly in Google Sheets',
    icon: <FileSpreadsheet className="w-5 h-5" />,
    color: '#0f9d58',
  },
]

// ── Google ───────────────────────────────────────────────────────────────────
export const DEFAULT_GOOGLE_REDIRECT = `${window.location.protocol}//${window.location.hostname}:8010/api/google/callback`

export const SERVICE_ACCOUNT_SHARED_DRIVE_MESSAGE =
  'This folder is shared with the service account, but it still belongs to regular My Drive, not a Shared Drive. Google service accounts can browse directly shared My Drive folders, but they cannot upload backup files there because they have no storage quota. Choose a folder inside a Shared Drive or switch this destination to OAuth User authentication.'

// ── Helpers ─────────────────────────────────────────────────────────────────
export const formatDateTime = (value) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}
