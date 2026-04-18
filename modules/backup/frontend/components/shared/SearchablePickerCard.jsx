import React from 'react'
import { Search } from 'lucide-react'
import { Input, Spinner } from '@packages/ui/src/components/common/ui'

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
    <section className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          {icon && (
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-caption font-strong text-text-primary">{title}</h3>
            {description && <p className="mt-1 text-tiny leading-6 text-text-tertiary">{description}</p>}
          </div>
        </div>

        {action && <div className="shrink-0">{action}</div>}
      </div>

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex-1">
          <Input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            onFocus={onSearchFocus}
            placeholder={searchPlaceholder}
            leadingIcon={<Search />}
          />
        </div>

        {summary && (
          <div className="shrink-0 rounded-full bg-surface-2 px-3 py-1.5 text-tiny font-emphasis text-text-tertiary">
            {summary}
          </div>
        )}
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-[rgb(var(--border-line))] bg-surface-2 px-4 py-4 text-caption text-text-tertiary">
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