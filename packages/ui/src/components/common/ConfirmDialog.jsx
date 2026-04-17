import React from 'react'
import { AlertTriangle, Info, Trash2 } from 'lucide-react'
import AppModalShell from './AppModalShell'

const VARIANT_META = {
  danger: {
    icon: <Trash2 className="h-5 w-5" />,
    iconClassName: 'bg-red-50 text-red-600',
    confirmClassName: 'bg-red-600 text-white hover:bg-red-700',
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5" />,
    iconClassName: 'bg-amber-50 text-amber-600',
    confirmClassName: 'bg-amber-600 text-white hover:bg-amber-700',
  },
  info: {
    icon: <Info className="h-5 w-5" />,
    iconClassName: 'bg-blue-50 text-blue-600',
    confirmClassName: 'bg-blue-600 text-white hover:bg-blue-700',
  },
}

const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
}) => {
  if (!isOpen) return null

  const meta = VARIANT_META[variant] || VARIANT_META.danger

  return (
    <AppModalShell
      onClose={onClose}
      title={title}
      description={description}
      icon={meta.icon}
      iconClassName={meta.iconClassName}
      maxWidthClass="max-w-md"
      bodyClassName="px-6 py-2"
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${meta.confirmClassName}`}
          >
            {confirmLabel}
          </button>
        </>
      )}
    >
      <div className="pb-4 text-sm leading-6 text-gray-600">{description}</div>
    </AppModalShell>
  )
}

export default ConfirmDialog