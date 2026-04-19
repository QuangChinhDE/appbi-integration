import { useState, useCallback } from 'react'
import api from '@shared/api/client'
import { message } from '@packages/ui/src/components/common/ui'


export default function usePipelines() {
  const [pipelines, setPipelines] = useState([])
  const [loadingPipelines, setLoadingPipelines] = useState(false)

  const [detailsPipeline, setDetailsPipeline] = useState(null)
  const [detailsRuns, setDetailsRuns] = useState([])
  const [loadingDetails, setLoadingDetails] = useState(false)

  // ── List ──────────────────────────────────────────────────────────────

  const fetchPipelines = useCallback(async () => {
    setLoadingPipelines(true)
    try {
      const { data } = await api.get('/api/pipeline/pipelines')
      setPipelines(Array.isArray(data) ? data : [])
    } catch {
      message.error('Failed to load pipelines')
    } finally {
      setLoadingPipelines(false)
    }
  }, [])

  // ── Detail ────────────────────────────────────────────────────────────

  const fetchPipelineDetails = useCallback(async (pipelineId) => {
    setLoadingDetails(true)
    try {
      const [pRes, rRes] = await Promise.all([
        api.get(`/api/pipeline/pipelines/${pipelineId}`),
        api.get(`/api/pipeline/pipelines/${pipelineId}/runs`),
      ])
      setDetailsPipeline(pRes.data)
      setDetailsRuns(Array.isArray(rRes.data) ? rRes.data : [])
    } catch {
      message.error('Failed to load pipeline details')
    } finally {
      setLoadingDetails(false)
    }
  }, [])

  // ── CRUD ──────────────────────────────────────────────────────────────

  const createPipeline = useCallback(async (payload) => {
    try {
      const { data } = await api.post('/api/pipeline/pipelines', payload)
      message.success('Pipeline created')
      return data
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to create pipeline')
      return null
    }
  }, [])

  const updatePipeline = useCallback(async (pipelineId, payload) => {
    try {
      const { data } = await api.put(`/api/pipeline/pipelines/${pipelineId}`, payload)
      setDetailsPipeline(data)
      return data
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to update pipeline')
      return null
    }
  }, [])

  const deletePipeline = useCallback(async (record, options = {}) => {
    try {
      await api.delete(`/api/pipeline/pipelines/${record.id}`)
      if (!options.silent) message.success('Pipeline deleted')
      if (!options.skipReload) await fetchPipelines()
      return true
    } catch {
      if (!options.silent) message.error('Failed to delete pipeline')
      return false
    }
  }, [fetchPipelines])

  return {
    pipelines, loadingPipelines, fetchPipelines,
    detailsPipeline, setDetailsPipeline, detailsRuns, setDetailsRuns, loadingDetails,
    fetchPipelineDetails,
    createPipeline, updatePipeline, deletePipeline,
  }
}
