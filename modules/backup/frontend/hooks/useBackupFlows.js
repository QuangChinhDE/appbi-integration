import { useState, useCallback } from 'react'
import api from '@shared/api/client'
import { message } from '@packages/ui/src/components/common/ui'

/**
 * Hook for CRUD operations on backup flows (list, fetch details, delete, publish, run).
 */
export default function useBackupFlows() {
  const [flows, setFlows] = useState([])
  const [loadingFlows, setLoadingFlows] = useState(false)

  // Detail state
  const [detailsFlow, setDetailsFlow] = useState(null)
  const [detailsRuns, setDetailsRuns] = useState([])
  const [loadingFlowDetails, setLoadingFlowDetails] = useState(false)

  // ── List ──────────────────────────────────────────────────────────────────
  const fetchFlows = useCallback(async () => {
    setLoadingFlows(true)
    try {
      const res = await api.get('/api/backup-flows')
      setFlows(res.data)
    } catch (err) {
      message.error('Failed to load backup flows')
      console.error(err)
    } finally {
      setLoadingFlows(false)
    }
  }, [])

  // ── Detail ────────────────────────────────────────────────────────────────
  const fetchFlowDetails = useCallback(async (flowId) => {
    setLoadingFlowDetails(true)
    try {
      const [flowResult, runsResult] = await Promise.allSettled([
        api.get(`/api/backup-flows/${flowId}`),
        api.get(`/api/backup-flows/${flowId}/runs`, { params: { limit: 20 } }),
      ])

      if (flowResult.status !== 'fulfilled') throw flowResult.reason

      setDetailsFlow(flowResult.value.data)

      if (runsResult.status === 'fulfilled' && Array.isArray(runsResult.value.data)) {
        setDetailsRuns(runsResult.value.data)
      } else {
        setDetailsRuns([])
        if (runsResult.status === 'rejected') {
          message.warning('Loaded flow details, but could not load run history')
        }
      }
    } catch (err) {
      message.error('Failed to load backup flow details')
      console.error(err)
      setDetailsFlow(null)
      setDetailsRuns([])
    } finally {
      setLoadingFlowDetails(false)
    }
  }, [])

  // ── Create draft ──────────────────────────────────────────────────────────
  const createDraft = useCallback(async () => {
    try {
      const res = await api.post('/api/backup-flows/draft', {})
      message.success('Draft created')
      return res.data.id
    } catch (err) {
      message.error('Failed to create draft. Is the backend running?')
      console.error(err)
      return null
    }
  }, [])

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteFlow = useCallback(async (record, options = {}) => {
    if (!window.confirm(`Delete "${record.name || 'Draft'}"?\n\nThis action cannot be undone.`)) return false
    try {
      await api.delete(`/api/backup-flows/${record.id}`)
      message.success('Backup flow deleted')
      fetchFlows()
      options.onDeleted?.()
      return true
    } catch {
      message.error('Failed to delete')
      return false
    }
  }, [fetchFlows])

  // ── Publish ───────────────────────────────────────────────────────────────
  const publishFlow = useCallback(async (record) => {
    try {
      await api.post(`/api/backup-flows/${record.id}/publish`)
      message.success('Flow published!')
      fetchFlows()
      return true
    } catch {
      message.error('Failed to publish')
      return false
    }
  }, [fetchFlows])

  // ── Run ───────────────────────────────────────────────────────────────────
  const runFlow = useCallback(async (record, options = {}) => {
    if (!['request', 'service'].includes(record.app)) {
      message.warning('Run is currently supported only for Request and Service flows')
      return false
    }
    if (record.run_blocked_reason) {
      message.error(record.run_blocked_reason)
      return false
    }
    try {
      await api.post(`/api/backup-flows/${record.id}/run`)
      message.success('Backup flow started')
      fetchFlows()
      if (typeof options.onStarted === 'function') await options.onStarted()
      return true
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to run flow')
      return false
    }
  }, [fetchFlows])

  return {
    // List
    flows, loadingFlows, fetchFlows,
    // Detail
    detailsFlow, setDetailsFlow, detailsRuns, setDetailsRuns, loadingFlowDetails,
    fetchFlowDetails,
    // Actions
    createDraft, deleteFlow, publishFlow, runFlow,
  }
}
