import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Database, Workflow } from 'lucide-react'
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

const KIND_META = {
  source: { label: 'Source reader', tone: 'info' },
  destination: { label: 'Destination writer', tone: 'brand' },
}

const BINDING_META = {
  apps: { label: 'Apps registry', tone: 'brand' },
  planned: { label: 'Planned binding', tone: 'neutral' },
}

const TOKEN_LABELS = {
  apps: 'Apps registry',
  google_oauth: 'Sign in',
  service_account: 'Service account',
  full_refresh: 'Full refresh',
  catalog_preview: 'Catalog preview',
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


function PipelineDetailPage() {
  const navigate = useNavigate()
  const { kind, capabilityKey } = useParams()
  const [capability, setCapability] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const normalizedKind = String(kind || '').trim().toLowerCase()

    if (!['source', 'destination'].includes(normalizedKind)) {
      setCapability(null)
      setError('Invalid pipeline capability route.')
      setLoading(false)
      return undefined
    }

    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const { data } = await api.get(
          `/api/pipeline/capabilities/${normalizedKind}/${encodeURIComponent(capabilityKey || '')}`,
        )
        if (cancelled) return
        setCapability(data)
      } catch (err) {
        if (cancelled) return
        setCapability(null)
        setError(err.response?.data?.detail || 'Failed to load pipeline capability details.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [capabilityKey, kind])

  const normalizedKind = String(kind || '').trim().toLowerCase()
  const kindMeta = KIND_META[normalizedKind] || { label: 'Capability', tone: 'neutral' }
  const statusMeta = STATUS_META[capability?.status] || { label: formatToken(capability?.status), tone: 'neutral' }
  const bindingMeta = BINDING_META[capability?.binding_source] || {
    label: formatToken(capability?.binding_source),
    tone: 'neutral',
  }
  const modeValues = useMemo(() => {
    const rawValues = normalizedKind === 'source' ? capability?.sync_modes : capability?.auth_modes
    return Array.isArray(rawValues) ? rawValues.map(formatToken).filter(Boolean) : []
  }, [capability, normalizedKind])
  const bindingFields = useMemo(() => (
    Array.isArray(capability?.binding_fields) ? capability.binding_fields.map(formatToken).filter(Boolean) : []
  ), [capability])
  const notes = useMemo(() => (
    Array.isArray(capability?.notes) ? capability.notes.filter(Boolean) : []
  ), [capability])
  const discovery = capability?.discovery || null
  const Icon = normalizedKind === 'source' ? Workflow : Database
  const iconClassName = normalizedKind === 'source' ? 'bg-info/10 text-info' : 'bg-brand/10 text-brand'

  return (
    <AppLayout>
      <AppModalShell
        variant="page"
        onClose={() => navigate('/pipeline')}
        leadingAction={(
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/pipeline')}
            leadingIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Back
          </Button>
        )}
        title={capability?.app_name || 'Pipeline capability'}
        description={(
          <div className="flex flex-wrap items-center gap-2 text-caption text-text-tertiary">
            <span>{capability?.app_id || capabilityKey || 'catalog-entry'}</span>
            <span>{kindMeta.label}</span>
          </div>
        )}
        icon={<Icon className="h-5 w-5" />}
        iconClassName={iconClassName}
        bodyClassName="px-4 py-6 sm:px-6 xl:px-8"
      >
        {loading ? (
          <SpinCenter text="Loading pipeline capability..." />
        ) : error ? (
          <div className="flex w-full flex-col gap-4">
            <Alert
              type="error"
              message="Pipeline capability unavailable"
              description={error}
            />
            <div>
              <Button variant="secondary" size="sm" onClick={() => navigate('/pipeline')}>
                Back to Pipeline
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-5">
            <ModuleOverview
              icon={Icon}
              title={`${capability.app_name} ${kindMeta.label.toLowerCase()}`}
              description={capability.summary || 'Reusable pipeline contract published from the shared connector catalog.'}
              badges={[
                kindMeta.label,
                statusMeta.label,
                bindingMeta.label,
              ]}
              stats={[
                {
                  label: 'Saved bindings',
                  value: String(capability.credential_count || 0),
                  helper: 'Bindings already available from Apps for this capability.',
                },
                {
                  label: normalizedKind === 'source' ? 'Sync modes' : 'Auth modes',
                  value: String(modeValues.length),
                  helper: normalizedKind === 'source'
                    ? 'Reader execution modes described in the catalog.'
                    : 'Authentication modes planned or supported for this writer.',
                },
                {
                  label: normalizedKind === 'source' ? 'Binding fields' : 'Selection',
                  value: normalizedKind === 'source'
                    ? String(bindingFields.length)
                    : (capability.binding_source === 'apps' ? 'Apps' : 'Planned'),
                  helper: normalizedKind === 'source'
                    ? 'Fields resolved from a saved source binding.'
                    : 'Where destination binding is expected to come from.',
                },
              ]}
            />

            <div className="flex flex-wrap gap-2">
              <Badge variant={kindMeta.tone} size="sm">{kindMeta.label}</Badge>
              <Badge variant={statusMeta.tone} size="sm">{statusMeta.label}</Badge>
              <Badge variant={bindingMeta.tone} size="sm">{bindingMeta.label}</Badge>
              <Badge variant={capability.credential_count > 0 ? 'success' : 'warning'} size="sm">
                {formatCount(capability.credential_count || 0, 'saved binding')}
              </Badge>
            </div>

            <Alert
              type="info"
              message="Catalog detail route is now dedicated to Pipeline"
              description="This page is a stable contract destination for each reader and writer. Builder, execution, and deeper configuration can land here later without detouring back to Apps."
            />

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <SectionCard
                title="Selection Contract"
                description="How the pipeline shell expects this capability to be selected and bound."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <MetaField label="Catalog key" value={capability.key} mono />
                  <MetaField label="App id" value={capability.app_id} mono />
                  <MetaField label="Capability type" value={kindMeta.label} />
                  <MetaField label="Binding source" value={bindingMeta.label} />
                </div>
                <div className="mt-4 rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-3 py-3">
                  <div className="text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Selection label</div>
                  <p className="mt-1 text-caption leading-6 text-text-secondary">{capability.selection_label}</p>
                </div>
              </SectionCard>

              <SectionCard
                title={normalizedKind === 'source' ? 'Binding Contract' : 'Authentication Contract'}
                description={
                  normalizedKind === 'source'
                    ? 'Fields and discovery metadata resolved from the saved Apps credential.'
                    : 'Declared auth modes and readiness for this destination writer.'
                }
              >
                {normalizedKind === 'source' ? (
                  <div className="space-y-4">
                    <div>
                      <div className="mb-1 text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                        Binding fields
                      </div>
                      <TokenList values={bindingFields} empty="No binding fields declared." tone="info" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <MetaField label="Discovery mode" value={formatToken(discovery?.mode) || 'Not declared'} />
                      <MetaField label="Discovery status" value={formatToken(discovery?.status) || 'Not declared'} />
                    </div>
                    <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-3 py-3">
                      <div className="text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Discovery summary</div>
                      <p className="mt-1 text-caption leading-6 text-text-secondary">
                        {discovery?.summary || 'No discovery summary published for this source reader.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <div className="mb-1 text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                        Authentication modes
                      </div>
                      <TokenList values={modeValues} empty="No auth modes declared." tone="brand" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <MetaField label="Binding source" value={bindingMeta.label} />
                      <MetaField label="Saved bindings" value={formatCount(capability.credential_count || 0, 'binding')} />
                    </div>
                  </div>
                )}
              </SectionCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <SectionCard
                title={normalizedKind === 'source' ? 'Sync Modes' : 'Auth Modes'}
                description={
                  normalizedKind === 'source'
                    ? 'Execution strategies currently published for this source reader.'
                    : 'Credential models this destination writer expects.'
                }
              >
                <TokenList
                  values={modeValues}
                  empty={normalizedKind === 'source' ? 'No sync modes declared.' : 'No auth modes declared.'}
                  tone={normalizedKind === 'source' ? 'warning' : 'brand'}
                />
              </SectionCard>

              <SectionCard
                title="Implementation Notes"
                description="Current shell notes and future delivery guidance from the catalog."
              >
                <NotesList notes={notes} />
              </SectionCard>
            </div>

            {normalizedKind === 'source' && (
              <SectionCard
                title="Discovery Detail"
                description="Reader discovery readiness and the current shared-catalog behavior."
              >
                {discovery ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <MetaField label="Mode" value={formatToken(discovery.mode) || 'Not declared'} />
                    <MetaField label="Status" value={formatToken(discovery.status) || 'Not declared'} />
                    <div className="sm:col-span-2 rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-3 py-3">
                      <div className="text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Selection label</div>
                      <p className="mt-1 text-caption leading-6 text-text-secondary">
                        {discovery.selection_label || capability.selection_label}
                      </p>
                    </div>
                  </div>
                ) : (
                  <Empty description="No discovery contract declared" />
                )}
              </SectionCard>
            )}
          </div>
        )}
      </AppModalShell>
    </AppLayout>
  )
}

export default PipelineDetailPage
