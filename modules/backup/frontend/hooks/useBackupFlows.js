import { useState, useCallback } from 'react'
import api from '@shared/api/client'
import { message } from '@packages/ui/src/components/common/ui'

import { supportsBackupFlowRun } from '../runSupport'

/**
 * Hook for CRUD operations on backup flows (list, fetch details, delete, publish, run).
 */
export default function useBackupFlows() {
  const [flows, setFlows] = useState([])
  const [loadingFlows, setLoadingFlows] = useState(false)
  const [stoppingFlowId, setStoppingFlowId] = useState(null)

  // Detail state
  const [detailsFlow, setDetailsFlow] = useState(null)
  const [detailsRuns, setDetailsRuns] = useState([])
  const [loadingFlowDetails, setLoadingFlowDetails] = useState(false)

  // ── List ──────────────────────────────────────────────────────────────────
  const fetchFlows = useCallback(async (options = {}) => {
    const silent = options.silent === true
    if (!silent) {
      setLoadingFlows(true)
    }
    try {
      const res = await api.get('/api/backup-flows')
      setFlows(res.data)
      return res.data
    } catch (err) {
      if (!silent) {
        message.error('Failed to load backup flows')
      }
      console.error(err)
      return null
    } finally {
      if (!silent) {
        setLoadingFlows(false)
      }
    }
  }, [])

  // ── Detail ────────────────────────────────────────────────────────────────
  const fetchFlowDetails = useCallback(async (flowId, options = {}) => {
    const silent = options.silent === true
    if (!silent) {
      setLoadingFlowDetails(true)
    }
    try {
      const [flowResult, runsResult] = await Promise.allSettled([
        api.get(`/api/backup-flows/${flowId}`),
        api.get(`/api/backup-flows/${flowId}/runs`, { params: { limit: 20 } }),
      ])

      if (flowResult.status !== 'fulfilled') throw flowResult.reason

      setDetailsFlow(flowResult.value.data)

      if (runsResult.status === 'fulfilled' && Array.isArray(runsResult.value.data)) {
        setDetailsRuns(runsResult.value.data)
      } else if (!silent) {
        setDetailsRuns([])
        if (runsResult.status === 'rejected') {
          message.warning('Loaded flow details, but could not load run history')
        }
      }
      return flowResult.value.data
    } catch (err) {
      if (!silent) {
        message.error('Failed to load backup flow details')
      }
      console.error(err)
      if (!silent) {
        setDetailsFlow(null)
        setDetailsRuns([])
      }
      return null
    } finally {
      if (!silent) {
        setLoadingFlowDetails(false)
      }
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
    if (!record?.id) return false
    try {
      await api.delete(`/api/backup-flows/${record.id}`)
      if (!options.silent) {
        message.success('Backup flow deleted')
      }
      if (!options.skipReload) {
        fetchFlows()
      }
      options.onDeleted?.()
      return true
    } catch {
      if (!options.silent) {
        message.error('Failed to delete')
      }
      return false
    }
  }, [fetchFlows])

  // ── Publish ───────────────────────────────────────────────────────────────
  const publishFlow = useCallback(async (record) => {
    try {
      await api.post(`/api/backup-flows/${record.id}/publish`)
      message.success('Flow published!')
      await fetchFlows({ silent: true })
      return true
    } catch {
      message.error('Failed to publish')
      return false
    }
  }, [fetchFlows])

  // ── Run ───────────────────────────────────────────────────────────────────
  const runFlow = useCallback(async (record, options = {}) => {
    const appId = record?.app || record?.source?.app_id || null
    if (!supportsBackupFlowRun(appId)) {
      message.warning('Run is not configured for this app yet')
      return false
    }
    if (record.run_blocked_reason) {
      message.error(record.run_blocked_reason)
      return false
    }
    try {
      const res = await api.post(`/api/backup-flows/${record.id}/run`)
      message.success('Backup flow started')
      await fetchFlows({ silent: true })
      if (typeof options.onStarted === 'function') await options.onStarted(res.data)
      return true
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to run flow')
      return false
    }
  }, [fetchFlows])

  const stopFlow = useCallback(async (record, options = {}) => {
    if (!record?.id) return false

    setStoppingFlowId(record.id)
    try {
      const res = await api.post(`/api/backup-flows/${record.id}/stop`)
      const cancelledCount = Number(res.data?.cancelled_task_count || 0)
      const interruptedCount = Number(res.data?.interrupted_run_count || 0)

      if (cancelledCount > 0 || interruptedCount > 0) {
        message.success('Backup flow stopped')
      } else {
        message.info('No running backup found for this flow')
      }

      await fetchFlows({ silent: true })
      if (typeof options.onStopped === 'function') await options.onStopped()
      return true
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to stop flow')
      return false
    } finally {
      setStoppingFlowId(null)
    }
  }, [fetchFlows])

  return {
    // List
    flows, loadingFlows, fetchFlows, stoppingFlowId,
    // Detail
    detailsFlow, setDetailsFlow, detailsRuns, setDetailsRuns, loadingFlowDetails,
    fetchFlowDetails,
    // Actions
    createDraft, deleteFlow, publishFlow, runFlow, stopFlow,
  }
}
