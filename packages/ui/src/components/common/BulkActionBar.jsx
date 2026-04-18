import React from 'react'
import { Loader2, Trash2, X } from 'lucide-react'

import { Button } from './ui'


function BulkActionBar({ selectedCount, onDelete, onClear, isDeleting = false }) {
  if (!selectedCount) return null

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-in">
      <div className="flex items-center gap-3 rounded-xl border border-[rgb(var(--border-strong))] bg-surface-1 px-4 py-2.5 shadow-linear-lg">
        <span className="text-caption font-emphasis text-text-primary">
          {selectedCount} selected
        </span>
        <div className="h-4 w-px bg-[rgb(var(--border-line))]" />
        <Button
          variant="danger"
          size="sm"
          onClick={onDelete}
          disabled={isDeleting}
          leadingIcon={isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        >
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
        <button
          type="button"
          onClick={onClear}
          disabled={isDeleting}
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-3 hover:text-text-primary disabled:opacity-50"
          title="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

export default BulkActionBar
