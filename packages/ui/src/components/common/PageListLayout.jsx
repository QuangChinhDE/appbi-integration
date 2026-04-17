import React, { useState } from 'react'
import { LayoutGrid, List as ListIcon, Loader2, Search } from 'lucide-react'

const PageListLayout = ({
  title,
  description,
  overview,
  action,
  isLoading = false,
  loadingText = 'Loading…',
  searchable = true,
  searchPlaceholder = 'Search',
  viewToggle = true,
  defaultView = 'grid',
  children,
}) => {
  const [viewMode, setViewMode] = useState(defaultView)
  const [filterText, setFilterText] = useState('')

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm text-gray-600">{loadingText}</p>
        </div>
      </div>
    )
  }

  const showToolbar = searchable || viewToggle
  const toolbarContext = { viewMode, filterText }

  return (
    <div className="px-6 py-6 lg:px-8 xl:px-10">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {overview && <div className="mb-6">{overview}</div>}

      {showToolbar && (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          {searchable && (
            <div className="relative max-w-xl flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 shadow-sm transition-colors placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {viewToggle && (
            <div className="inline-flex items-center overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm sm:ml-auto">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-2.5 transition-colors ${
                  viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
                title="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`p-2.5 transition-colors ${
                  viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
                title="List view"
              >
                <ListIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {typeof children === 'function' ? children(toolbarContext) : children}
    </div>
  )
}

export default PageListLayout