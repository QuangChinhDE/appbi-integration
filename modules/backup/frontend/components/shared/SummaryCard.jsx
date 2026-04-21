import React from 'react'

/**
 * Summary card used in detail views and review steps.
 * Coloured header bar + stacked label/value fields.
 */
export const SummaryCard = ({ title, icon: Icon, color = '#64748b', children }) => (
  <div className="bg-surface-1 border border-[rgb(var(--border-line))] rounded-xl overflow-hidden">
    <div className="px-4 py-3 border-b border-[rgb(var(--border-line))] flex items-center gap-2" style={{ background: `${color}0a` }}>
      {Icon && <Icon className="w-3.5 h-3.5" style={{ color }} />}
      <span className="text-label font-strong uppercase tracking-[0.14em]" style={{ color }}>{title}</span>
    </div>
    <div className="px-4 py-1">{children}</div>
  </div>
)

/**
 * Single label + value field inside a SummaryCard.
 */
export const SummaryField = ({ label, children }) => (
  <div className="border-b border-[rgb(var(--border-line))] py-3 last:border-0">
    <div className="mb-1 text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">{label}</div>
    <div className="break-words text-small leading-6 text-text-primary">{children ?? <span className="text-caption text-text-quaternary">—</span>}</div>
  </div>
)

export default SummaryCard
