import React from 'react'

import { FilterTag } from './ui'


function getOwnerLabel(email) {
  const value = String(email || '').trim()
  if (!value) return ''

  const [localPart] = value.split('@')
  return localPart || value
}


function OwnerBadge({ email, active = false, onClick, className = '' }) {
  const label = getOwnerLabel(email)
  if (!label) return null

  const commonProps = {
    className: `max-w-[120px] truncate ${className}`.trim(),
    title: email,
  }

  if (onClick) {
    return (
      <FilterTag
        {...commonProps}
        tone={active ? 'brand' : 'neutral'}
        active={active}
        onClick={onClick}
      >
        {label}
      </FilterTag>
    )
  }

  return (
    <FilterTag
      {...commonProps}
      tone={active ? 'brand' : 'neutral'}
      active={active}
      as="span"
    >
      {label}
    </FilterTag>
  )
}

export default OwnerBadge
