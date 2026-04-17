import React from 'react'
import { Search } from 'lucide-react'
import { Spinner } from '@packages/ui/src/components/common/ui'

const SearchablePickerCard = ({
  icon,
  title,
  description,
  searchValue,
  onSearchChange,
  onSearchFocus,
  searchPlaceholder = 'Search…',
  action = null,
  summary = null,
  loading = false,
  loadingText = 'Loading…',
  isEmpty = false,
  emptyState = null,
  footer = null,
  children,
}) => {
  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          {icon && (
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            {description && <p className="mt-1 text-xs leading-6 text-gray-500">{description}</p>}
          </div>
        </div>

        {action && <div className="shrink-0">{action}</div>}
      </div>

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            onFocus={onSearchFocus}
            placeholder={searchPlaceholder}
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 shadow-sm transition-colors placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        {summary && (
          <div className="shrink-0 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500">
            {summary}
          </div>
        )}
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-500">
            <Spinner />
            <span>{loadingText}</span>
          </div>
        ) : isEmpty ? emptyState : children}
      </div>

      {footer && <div className="mt-4">{footer}</div>}
    </section>
  )
}

export default SearchablePickerCard