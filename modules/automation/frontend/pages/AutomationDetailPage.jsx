import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Zap } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'

import api from '@shared/api/client'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import ModuleOverview from '@packages/ui/src/components/common/ModuleOverview'
import {
  Alert,
  Badge,
  Button,
  Empty,
  FilterTag,
  SpinCenter,
} from '@packages/ui/src/components/common/ui'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'


const STATUS_META = {
  ready: { label: 'Ready', tone: 'success' },
  planned: { label: 'Planned', tone: 'warning' },
}

const BINDING_META = {
  apps: { label: 'Apps registry', tone: 'brand' },
  planned: { label: 'Planned binding', tone: 'neutral' },
}

const TOKEN_LABELS = {
  apps: 'Apps registry',
  incoming_webhook: 'Incoming webhook',
}


function formatCount(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`
}


function formatToken(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  if (TOKEN_LABELS[normalized]) return TOKEN_LABELS[normalized]

  return normalized
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}


function SectionCard({ title, description, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 ${className}`}>
      <div className="border-b border-[rgb(var(--border-line))] px-5 py-4">
        <h2 className="text-caption font-strong text-text-primary">{title}</h2>
        {description && <p className="mt-1 text-tiny leading-6 text-text-tertiary">{description}</p>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}


function MetaField({ label, value, mono = false }) {
  return (
    <div>
      <div className="text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">{label}</div>
      <div className={`mt-1 text-caption text-text-secondary ${mono ? 'font-mono text-tiny' : ''}`}>{value}</div>
    </div>
  )
}


function TokenList({ values, empty = 'Not declared', tone = 'neutral' }) {
  const items = values.filter(Boolean)
  if (items.length === 0) {
    return <p className="text-tiny text-text-quaternary">{empty}</p>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <FilterTag key={`${tone}-${item}`} as="span" tone={tone}>
          {item}
        </FilterTag>
      ))}
    </div>
  )
}


function NotesList({ notes, empty = 'No implementation notes declared.' }) {
  if (notes.length === 0) {
    return <p className="text-tiny text-text-quaternary">{empty}</p>
  }

  return (
    <div className="space-y-2">
      {notes.map((note) => (
        <div key={note} className="rounded-lg bg-surface-2 px-3 py-2 text-caption leading-6 text-text-secondary">
          {note}
        </div>
      ))}
    </div>
  )
}


function AutomationDetailPage() {
  const navigate = useNavigate()
  const { connectorKey } = useParams()
  const [connector, setConnector] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const { data } = await api.get(`/api/automation/connectors/${encodeURIComponent(connectorKey || '')}`)
        if (cancelled) return
        setConnector(data)
      } catch (err) {
        if (cancelled) return
        setConnector(null)
        setError(err.response?.data?.detail || 'Failed to load automation connector details.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [connectorKey])

  const resources = useMemo(() => (
    Array.isArray(connector?.resources) ? connector.resources : []
  ), [connector])
  const operations = useMemo(() => (
    Array.isArray(connector?.operations) ? connector.operations : []
  ), [connector])
  const triggers = useMemo(() => (
    Array.isArray(connector?.triggers) ? connector.triggers.map(formatToken).filter(Boolean) : []
  ), [connector])
  const notes = useMemo(() => (
    Array.isArray(connector?.notes) ? connector.notes.filter(Boolean) : []
  ), [connector])

  const statusMeta = STATUS_META[connector?.status] || { label: formatToken(connector?.status), tone: 'neutral' }
  const bindingMeta = BINDING_META[connector?.binding_source] || {
    label: formatToken(connector?.binding_source),
    tone: 'neutral',
  }

  return (
    <AppLayout>
      <AppModalShell
        variant="page"
        onClose={() => navigate('/automation')}
        leadingAction={(
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/automation')}
            leadingIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Back
          </Button>
        )}
        title={connector?.app_name || 'Automation connector'}
        description={(
          <div className="flex flex-wrap items-center gap-2 text-caption text-text-tertiary">
            <span>{connector?.app_id || connectorKey || 'catalog-entry'}</span>
            <span>Catalog contract detail</span>
          </div>
        )}
        icon={<Zap className="h-5 w-5" />}
        iconClassName="bg-brand/10 text-brand"
        bodyClassName="px-4 py-6 sm:px-6 xl:px-8"
      >
        {loading ? (
          <SpinCenter text="Loading automation connector..." />
        ) : error ? (
          <div className="flex w-full flex-col gap-4">
            <Alert
              type="error"
              message="Automation connector unavailable"
              description={error}
            />
            <div>
              <Button variant="secondary" size="sm" onClick={() => navigate('/automation')}>
                Back to Automation
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-5">
            <ModuleOverview
              icon={Zap}
              title={`${connector.app_name} automation contract`}
              description={connector.summary || 'Reusable automation metadata published from the shared connector manifest.'}
              badges={[
                statusMeta.label,
                bindingMeta.label,
                connector.credential_count > 0 ? `${connector.credential_count} saved bindings` : 'Needs binding',
              ]}
              stats={[
                {
                  label: 'Resources',
                  value: String(resources.length),
                  helper: 'Resource groups published by this connector contract.',
                },
                {
                  label: 'Operations',
                  value: String(connector.operation_count || operations.length),
                  helper: 'Action definitions already described in the manifest.',
                },
                {
                  label: 'Triggers',
                  value: String(connector.trigger_count || triggers.length),
                  helper: 'Trigger hooks exposed for future automation runtime.',
                },
              ]}
            />

            <div className="flex flex-wrap gap-2">
              <Badge variant={statusMeta.tone} size="sm">{statusMeta.label}</Badge>
              <Badge variant={bindingMeta.tone} size="sm">{bindingMeta.label}</Badge>
              <Badge variant={connector.credential_count > 0 ? 'success' : 'warning'} size="sm">
                {formatCount(connector.credential_count || 0, 'saved binding')}
              </Badge>
              <Badge variant="neutral" size="sm">{connector.app_id}</Badge>
            </div>

            <Alert
              type="info"
              message="Catalog detail route is now dedicated to Automation"
              description="This page documents the connector contract and keeps the navigation stable. Builder, scheduling, and runtime actions can attach here later without routing back through Apps."
            />

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
              <SectionCard
                title="Selection Contract"
                description="How the automation catalog expects bindings to be resolved before a future builder or runtime uses this connector."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <MetaField label="Binding source" value={bindingMeta.label} />
                  <MetaField
                    label="Saved bindings"
                    value={formatCount(connector.credential_count || 0, 'binding')}
                  />
                  <MetaField label="Catalog key" value={connector.key} mono />
                  <MetaField label="App id" value={connector.app_id} mono />
                </div>
                <div className="mt-4 rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-3 py-3">
                  <div className="text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Selection label</div>
                  <p className="mt-1 text-caption leading-6 text-text-secondary">{connector.selection_label}</p>
                </div>
              </SectionCard>

              <SectionCard
                title="Implementation Notes"
                description="Current shell and known follow-up items published with the connector."
              >
                <NotesList notes={notes} />
              </SectionCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <SectionCard
                title="Registered Resources"
                description="Manifest resources and their declared action groups."
              >
                {resources.length === 0 ? (
                  <Empty description="No resources declared" />
                ) : (
                  <div className="space-y-3">
                    {resources.map((resource) => {
                      const actions = Array.isArray(resource.actions)
                        ? resource.actions.map(formatToken).filter(Boolean)
                        : []

                      return (
                        <div key={resource.key} className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-3 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-caption font-emphasis text-text-primary">{formatToken(resource.key)}</div>
                            <Badge variant="neutral" size="sm">{resource.key}</Badge>
                          </div>
                          <div className="mt-2">
                            <TokenList values={actions} empty="No actions declared" tone="info" />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title="Trigger Hooks"
                description="Event triggers available in the current manifest."
              >
                <TokenList values={triggers} empty="No triggers registered for this connector." tone="warning" />
              </SectionCard>
            </div>

            <SectionCard
              title="Operations"
              description="Detailed action definitions exported from the shared automation manifest."
            >
              {operations.length === 0 ? (
                <Empty description="No operations declared" />
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {operations.map((operation) => {
                    const requiredFields = Array.isArray(operation.required_fields)
                      ? operation.required_fields.map(formatToken).filter(Boolean)
                      : []
                    const optionalFields = Array.isArray(operation.optional_fields)
                      ? operation.optional_fields.map(formatToken).filter(Boolean)
                      : []
                    const apiCalls = Array.isArray(operation.api_calls)
                      ? operation.api_calls.map(formatToken).filter(Boolean)
                      : []
                    const operationNotes = Array.isArray(operation.notes)
                      ? operation.notes.filter(Boolean)
                      : []

                    return (
                      <div key={operation.key} className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-4 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-caption font-emphasis text-text-primary">{formatToken(operation.key)}</div>
                          <Badge variant="neutral" size="sm">{operation.key}</Badge>
                        </div>
                        <p className="mt-2 text-caption leading-6 text-text-secondary">
                          {operation.summary || 'No summary published for this operation.'}
                        </p>
                        <div className="mt-3 grid gap-3">
                          {operation.input_schema && (
                            <MetaField label="Input schema" value={operation.input_schema} mono />
                          )}
                          <div>
                            <div className="mb-1 text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                              Required fields
                            </div>
                            <TokenList values={requiredFields} empty="No required fields declared" tone="danger" />
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                              Optional fields
                            </div>
                            <TokenList values={optionalFields} empty="No optional fields declared" tone="neutral" />
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                              API calls
                            </div>
                            <TokenList values={apiCalls} empty="No API calls declared" tone="brand" />
                          </div>
                          {operationNotes.length > 0 && (
                            <div>
                              <div className="mb-1 text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                                Notes
                              </div>
                              <NotesList notes={operationNotes} empty="" />
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </SectionCard>
          </div>
        )}
      </AppModalShell>
    </AppLayout>
  )
}

export default AutomationDetailPage
