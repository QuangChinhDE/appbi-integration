import { useCallback, useEffect, useRef, useState } from 'react'

import api from '@shared/api/client'
import { resolveIcon } from '@modules/apps/frontend/lib/iconResolver'


/**
 * Fetches the connector catalog from the backend once and caches it.
 *
 * Returns:
 *   connectors  — array in the same shape as APP_CATALOG (id, title, description, icon, color, role, connectionConfig)
 *   loading     — true while the initial fetch is in-flight
 *   error       — error string if the fetch failed
 *   getConnector(id) — lookup helper
 *   refresh()   — force re-fetch
 */
export default function useConnectorCatalog() {
  const [connectors, setConnectors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fetched = useRef(false)

  const fetchCatalog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/api/connectors/catalog')
      const data = Array.isArray(res.data) ? res.data : res.data?.connectors || []
      const mapped = data.map((c) => ({
        id: c.connector_key,
        title: c.display_name,
        description: c.summary || '',
        icon: resolveIcon(c.icon),
        iconName: c.icon,
        color: c.color || '#6b7280',
        bgColor: c.bg_color || '#f9fafb',
        role: inferRole(c),
        connectionConfig: mapConnectionConfig(c.connection_config),
        authType: c.auth_spec?.auth_type,
        authFields: c.auth_spec?.fields,
        streams: c.streams,
        raw: c,
      }))
      setConnectors(mapped)
      fetched.current = true
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to load catalog')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!fetched.current) fetchCatalog()
  }, [fetchCatalog])

  const getConnector = useCallback(
    (id) => connectors.find((c) => c.id === id) || null,
    [connectors],
  )

  return { connectors, loading, error, getConnector, refresh: fetchCatalog }
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function inferRole(connector) {
  const authType = connector.auth_spec?.auth_type
  if (authType === 'google_oauth' || authType === 'service_account') return 'destination'
  // If the connector has multiple auth types that include google, treat as destination
  const authTypes = connector.auth_spec?.auth_types || []
  if (authTypes.some((t) => t === 'google_oauth' || t === 'service_account')) return 'destination'
  return 'source'
}

function mapConnectionConfig(cfg) {
  if (!cfg) return null
  // Map snake_case backend keys to camelCase for frontend consistency
  return {
    stepTitle: cfg.step_title,
    stepDescription: cfg.step_description,
    domainLabel: cfg.domain_label,
    domainPlaceholder: cfg.domain_placeholder,
    domainHelp: cfg.domain_help,
    tokenLabel: cfg.token_label,
    tokenPlaceholder: cfg.token_placeholder,
    tokenHelp: cfg.token_help,
    authModeLabel: cfg.auth_mode_label,
    authModeHelp: cfg.auth_mode_help,
  }
}
