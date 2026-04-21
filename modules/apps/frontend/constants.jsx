import React from 'react'

import {
  Briefcase, Building2, CalendarClock, Clock, Database, DollarSign,
  FileSpreadsheet, Folder, FolderKanban, Headphones, Inbox,
  LayoutGrid, Target, Users, Wallet,
} from 'lucide-react'

/** Catalog of every app the Apps module can hold a credential for.
 * Both the in-modal picker and any list/filter UIs should read from here. */
export const APP_CATALOG = [
  // ── Source apps (Base platform) ──────────────────────────────────────
  {
    id: 'request',
    title: 'Request',
    description: 'Base Request — save multiple token credentials for reuse.',
    icon: <Inbox className="w-5 h-5" />,
    color: '#ea580c',
    role: 'source',
  },
  {
    id: 'service',
    title: 'Service',
    description: 'Base Service — save multiple token credentials for reuse.',
    icon: <Headphones className="w-5 h-5" />,
    color: '#059669',
    role: 'source',
  },
  {
    id: 'workflow',
    title: 'Workflow',
    description: 'Base Workflow — save multiple token credentials for reuse.',
    icon: <FolderKanban className="w-5 h-5" />,
    color: '#7c3aed',
    role: 'source',
  },
  {
    id: 'wework',
    title: 'WeWork',
    description: 'Base WeWork — save multiple token credentials for reuse.',
    icon: <Building2 className="w-5 h-5" />,
    color: '#2563eb',
    role: 'source',
  },
  {
    id: 'crm',
    title: 'CRM',
    description: 'Base CRM — leads, deals, accounts, contacts and pipelines.',
    icon: <Briefcase className="w-5 h-5" />,
    color: '#dc2626',
    role: 'source',
  },
  {
    id: 'hrm',
    title: 'HRM',
    description: 'Base HRM — employees, departments, payroll and checkin data.',
    icon: <Users className="w-5 h-5" />,
    color: '#0891b2',
    role: 'source',
  },
  {
    id: 'table',
    title: 'Table',
    description: 'Base Table — read and write records in Table databases.',
    icon: <LayoutGrid className="w-5 h-5" />,
    color: '#4f46e5',
    role: 'source',
  },
  {
    id: 'goal',
    title: 'Goal',
    description: 'Base Goal — cycles, goals, key results and targets.',
    icon: <Target className="w-5 h-5" />,
    color: '#ca8a04',
    role: 'source',
  },
  {
    id: 'income',
    title: 'Income',
    description: 'Base Income — incomes and inflows.',
    icon: <DollarSign className="w-5 h-5" />,
    color: '#16a34a',
    role: 'source',
  },
  {
    id: 'meeting',
    title: 'Meeting',
    description: 'Base Meeting — groups and meeting schedules.',
    icon: <CalendarClock className="w-5 h-5" />,
    color: '#9333ea',
    role: 'source',
  },
  {
    id: 'payroll',
    title: 'Payroll',
    description: 'Base Payroll — payroll cycles and records.',
    icon: <Wallet className="w-5 h-5" />,
    color: '#0d9488',
    role: 'source',
  },
  {
    id: 'timeoff',
    title: 'Timeoff',
    description: 'Base Timeoff — time-off requests and groups.',
    icon: <Clock className="w-5 h-5" />,
    color: '#f59e0b',
    role: 'source',
  },

  // ── Destination apps (Google) ────────────────────────────────────────
  {
    id: 'gdrive',
    title: 'Google Drive',
    description: 'Save to a Drive folder — supports all file formats.',
    icon: <Folder className="w-5 h-5" />,
    color: '#1a73e8',
    role: 'destination',
  },
  {
    id: 'gsheets',
    title: 'Google Sheets',
    description: 'Create spreadsheets directly in Google Sheets.',
    icon: <FileSpreadsheet className="w-5 h-5" />,
    color: '#0f9d58',
    role: 'destination',
  },
  {
    id: 'bigquery',
    title: 'BigQuery',
    description: 'Warehouse destination for structured sync jobs.',
    icon: <Database className="w-5 h-5" />,
    color: '#4285f4',
    role: 'destination',
  },
]

export const SOURCE_APP_IDS = new Set(APP_CATALOG.filter((app) => app.role === 'source').map((app) => app.id))
export const DESTINATION_APP_IDS = new Set(APP_CATALOG.filter((app) => app.role === 'destination').map((app) => app.id))

export function getAppMeta(appId) {
  return APP_CATALOG.find((app) => app.id === appId)
}

// ── Connection config per app (form labels / help text) ─────────────────────

export const APP_CONNECTION_CONFIG = {
  request: {
    stepTitle: 'Request Connection',
    stepDescription: 'Provide the Request domain and Base Account token.',
    requiresDomain: true,
    domainLabel: 'Base Domain',
    domainPlaceholder: 'base.com.vn',
    domainHelp: 'Enter base.com.vn, request.base.com.vn, or a full Request URL. The backend will normalize it.',
    tokenLabel: 'Access Token V2',
    tokenPlaceholder: 'Paste your Base Account access_token_v2 here…',
    tokenHelp: 'Get this value from Request → Settings → API Keys. Use the Base Account access_token_v2 token.',
  },
  workflow: {
    stepTitle: 'Workflow Connection',
    stepDescription: 'Provide the Workflow domain and API token.',
    requiresDomain: true,
    domainLabel: 'Base Domain',
    domainPlaceholder: 'company.base.com.vn',
    domainHelp: 'Enter your Workflow domain, for example company.base.com.vn.',
    tokenLabel: 'API Access Token',
    tokenPlaceholder: 'Paste your Workflow access token here…',
    tokenHelp: 'Get this value from Workflow → Settings → API Keys.',
  },
  wework: {
    stepTitle: 'WeWork Connection',
    stepDescription: 'Provide the WeWork domain and Base Account token.',
    requiresDomain: true,
    domainLabel: 'Base Domain',
    domainPlaceholder: 'base.com.vn',
    domainHelp: 'Enter base.com.vn, wework.base.com.vn, or a full WeWork URL. The backend will normalize it.',
    tokenLabel: 'Access Token V2',
    tokenPlaceholder: 'Paste your Base Account access_token_v2 here…',
    tokenHelp: 'Get this value from WeWork → Settings → API Keys. Use the Base Account access_token_v2 token.',
  },
  service: {
    stepTitle: 'Service Connection',
    stepDescription: 'Provide the Service domain and Base Account token.',
    requiresDomain: true,
    domainLabel: 'Base Domain',
    domainPlaceholder: 'base.com.vn',
    domainHelp: 'Enter base.com.vn, service.base.com.vn, or a full Service URL. The backend will normalize it.',
    tokenLabel: 'Access Token V2',
    tokenPlaceholder: 'Paste your Base Account access_token_v2 here…',
    tokenHelp: 'Get this value from Service → Settings → API Keys. Use the Base Account access_token_v2 token.',
  },
}

// ── Google OAuth ────────────────────────────────────────────────────────────

export const DEFAULT_GOOGLE_REDIRECT = `${window.location.origin}/api/v1/auth/google/data-access/callback`
