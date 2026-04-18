import React, { useEffect, useMemo, useState } from 'react'
import { Search, Trash2, Users } from 'lucide-react'

import { sharesApi, usersApi } from '@shared/api/client'
import { Button, IconButton, Input, Modal, Select, message } from '@packages/ui/src/components/common/ui'


function getInitials(user) {
  const label = user?.full_name || user?.email || '??'
  return label.slice(0, 2).toUpperCase()
}


function ShareDialog({ open, onClose, resourceType, resourceId, resourceName }) {
  const [shares, setShares] = useState([])
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [permission, setPermission] = useState('view')
  const [loading, setLoading] = useState(false)
  const [loadingShares, setLoadingShares] = useState(false)
  const [allTeamLoading, setAllTeamLoading] = useState(false)

  useEffect(() => {
    if (!open) return

    let active = true
    const load = async () => {
      setLoadingShares(true)
      try {
        const [shareRows, shareableUsers] = await Promise.all([
          sharesApi.getShares(resourceType, resourceId),
          usersApi.getShareable(),
        ])
        if (!active) return
        setShares(Array.isArray(shareRows) ? shareRows : [])
        setUsers(Array.isArray(shareableUsers) ? shareableUsers : [])
      } catch (error) {
        if (!active) return
        setShares([])
        setUsers([])
        message.error(error.response?.data?.detail || 'Failed to load sharing settings')
      } finally {
        if (active) setLoadingShares(false)
      }
    }

    void load()
    return () => { active = false }
  }, [open, resourceId, resourceType])

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) || null,
    [selectedUserId, users],
  )

  const availableUsers = useMemo(() => {
    const sharedIds = new Set(shares.map((share) => share.user_id))
    const needle = search.trim().toLowerCase()
    return users.filter((user) => {
      if (sharedIds.has(user.id)) return false
      if (!needle) return true
      return (
        String(user.full_name || '').toLowerCase().includes(needle)
        || String(user.email || '').toLowerCase().includes(needle)
      )
    })
  }, [search, shares, users])

  const refreshShares = async () => {
    const shareRows = await sharesApi.getShares(resourceType, resourceId)
    setShares(Array.isArray(shareRows) ? shareRows : [])
  }

  const handleShare = async () => {
    if (!selectedUser) return
    setLoading(true)
    try {
      await sharesApi.share(resourceType, resourceId, {
        user_id: selectedUser.id,
        permission,
      })
      await refreshShares()
      setSelectedUserId('')
      setSearch('')
      message.success(`Shared with ${selectedUser.full_name || selectedUser.email}`)
    } catch (error) {
      message.error(error.response?.data?.detail || 'Failed to share resource')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdatePermission = async (userId, nextPermission) => {
    try {
      await sharesApi.updateShare(resourceType, resourceId, userId, { permission: nextPermission })
      setShares((current) => current.map((share) => (
        share.user_id === userId ? { ...share, permission: nextPermission } : share
      )))
      message.success('Permission updated')
    } catch (error) {
      message.error(error.response?.data?.detail || 'Failed to update permission')
    }
  }

  const handleRevoke = async (userId) => {
    try {
      await sharesApi.revokeShare(resourceType, resourceId, userId)
      setShares((current) => current.filter((share) => share.user_id !== userId))
      message.success('Access removed')
    } catch (error) {
      message.error(error.response?.data?.detail || 'Failed to remove access')
    }
  }

  const handleShareAllTeam = async () => {
    setAllTeamLoading(true)
    try {
      await sharesApi.shareAllTeam(resourceType, resourceId, { permission })
      await refreshShares()
      message.success('Shared with team')
    } catch (error) {
      message.error(error.response?.data?.detail || 'Failed to share with team')
    } finally {
      setAllTeamLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`Share "${resourceName}"`}
      size="lg"
    >
      <div className="space-y-5">
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-label font-emphasis text-text-secondary">Add people</div>
            <div className="flex flex-col gap-2 md:flex-row">
              <div className="min-w-0 flex-1">
                <Input
                  size="sm"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name or email"
                  leadingIcon={<Search className="h-4 w-4" />}
                />
              </div>
              <Select
                size="sm"
                className="w-full md:w-40"
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
              >
                <option value="">Select user</option>
                {availableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name || user.email}
                  </option>
                ))}
              </Select>
              <Select
                size="sm"
                className="w-full md:w-32"
                value={permission}
                onChange={(event) => setPermission(event.target.value)}
              >
                <option value="view">Viewer</option>
                <option value="edit">Editor</option>
              </Select>
              <Button
                variant="primary"
                size="sm"
                onClick={handleShare}
                disabled={!selectedUser || loading}
                loading={loading}
              >
                Share
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/60 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-caption text-text-secondary">
                <Users className="h-4 w-4 text-text-quaternary" />
                <span>Share with entire team</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleShareAllTeam}
                disabled={allTeamLoading}
              >
                {allTeamLoading ? 'Sharing…' : `Share as ${permission}`}
              </Button>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-label font-emphasis text-text-secondary">
            People with access
            {shares.length > 0 && <span className="ml-1 text-text-quaternary">({shares.length})</span>}
          </div>

          {loadingShares ? (
            <div className="text-caption text-text-tertiary">Loading sharing settings…</div>
          ) : shares.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[rgb(var(--border-line))] bg-surface-1 px-4 py-8 text-center text-caption text-text-tertiary">
              This resource has not been shared yet.
            </div>
          ) : (
            <div className="space-y-2">
              {shares.map((share) => (
                <div
                  key={share.user_id}
                  className="flex items-center gap-3 rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 px-3 py-3"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/12 text-tiny font-emphasis text-brand">
                    {getInitials(share.user)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-caption font-emphasis text-text-primary">
                      {share.user?.full_name || share.user?.email || share.user_id}
                    </div>
                    <div className="truncate text-tiny text-text-tertiary">
                      {share.user?.email || share.user_id}
                    </div>
                  </div>
                  <Select
                    size="sm"
                    className="w-28"
                    value={share.permission}
                    onChange={(event) => handleUpdatePermission(share.user_id, event.target.value)}
                  >
                    <option value="view">Viewer</option>
                    <option value="edit">Editor</option>
                  </Select>
                  <IconButton
                    aria-label="Remove access"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevoke(share.user_id)}
                    className="text-danger hover:bg-danger/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default ShareDialog
