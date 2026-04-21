import React, { useState } from 'react'
import { LayoutGrid, List as ListIcon, Loader2, Search } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Input } from './ui'

const PageListLayout = ({
  title,
  description,
  overview,
  action,
  isLoading = false,
  loadingText = 'Loading…',
  searchable = true,
  searchPlaceholder = 'Search',
  searchValue,
  onSearchValueChange,
  viewToggle = true,
  defaultView = 'grid',
  toolbarExtra,
  activeFilters,
  children,
}) => {
  const [viewMode, setViewMode] = useState(defaultView)
  const [internalFilterText, setInternalFilterText] = useState('')

  const filterText = searchValue ?? internalFilterText
  const setFilterText = onSearchValueChange ?? setInternalFilterText

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-brand" />
          <p className="text-caption text-text-tertiary">{loadingText}</p>
        </div>
      </div>
    )
  }

  const toolbarContext = { viewMode, filterText }
  const toolbarExtraContent = typeof toolbarExtra === 'function' ? toolbarExtra(toolbarContext) : toolbarExtra
  const activeFiltersContent = typeof activeFilters === 'function' ? activeFilters(toolbarContext) : activeFilters
  const showToolbar = searchable || viewToggle || Boolean(toolbarExtraContent) || Boolean(activeFiltersContent)

  return (
    <div className="px-4 py-6 sm:px-6 xl:px-8">
      <div className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-h1 text-text-primary font-emphasis">{title}</h1>
            {description && (
              <p className="mt-1 text-caption text-text-tertiary max-w-2xl">
                {description}
              </p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      </div>

      {overview && <div className="mb-4">{overview}</div>}

      {showToolbar && (
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {searchable && (
              <div className="min-w-[240px] max-w-xl flex-[0_1_320px]">
                <Input
                  size="sm"
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  placeholder={searchPlaceholder}
                  leadingIcon={<Search />}
                />
              </div>
            )}
            {activeFiltersContent && (
              <div
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap',
                  '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
                )}
              >
                {activeFiltersContent}
              </div>
            )}
          </div>
          {(toolbarExtraContent || viewToggle) && (
            <div className="ml-auto flex items-center gap-2">
              {toolbarExtraContent && (
                <div className="flex flex-wrap items-center gap-2">
                  {toolbarExtraContent}
                </div>
              )}
              {viewToggle && (
                <div className="inline-flex items-center overflow-hidden rounded-md border border-[rgb(var(--border-strong))] bg-surface-1 p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    className={cn(
                      'inline-flex items-center justify-center h-7 w-7 rounded-sm transition-colors',
                      viewMode === 'grid'
                        ? 'bg-surface-3 text-text-primary'
                        : 'text-text-tertiary hover:text-text-primary',
                    )}
                    title="Grid view"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className={cn(
                      'inline-flex items-center justify-center h-7 w-7 rounded-sm transition-colors',
                      viewMode === 'list'
                        ? 'bg-surface-3 text-text-primary'
                        : 'text-text-tertiary hover:text-text-primary',
                    )}
                    title="List view"
                  >
                    <ListIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {typeof children === 'function' ? children(toolbarContext) : children}
    </div>
  )
}

export default PageListLayout