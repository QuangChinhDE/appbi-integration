import React from 'react'

/**
 * Summary card used in detail views and review steps.
 * Coloured header bar + stacked label/value fields.
 */
export const SummaryCard = ({ title, icon: Icon, color = '#64748b', children }) => (
  <div className="bg-surface-1 border border-[rgb(var(--border-line))] rounded-xl overflow-hidden">
    <div className="px-4 py-2.5 border-b border-[rgb(var(--border-line))] flex items-center gap-2" style={{ background: `${color}0a` }}>
      {Icon && <Icon className="w-3.5 h-3.5" style={{ color }} />}
      <span className="text-[11px] font-strong uppercase tracking-wide" style={{ color }}>{title}</span>
    </div>
    <div className="px-4 py-0.5">{children}</div>
  </div>
)

/**
 * Single label + value field inside a SummaryCard.
 */
export const SummaryField = ({ label, children }) => (
  <div className="py-2.5 border-b border-[rgb(var(--border-line))] last:border-0">
    <div className="text-[10px] text-text-quaternary font-strong uppercase tracking-wider mb-0.5">{label}</div>
    <div className="text-caption text-text-primary break-words">{children ?? <span className="text-text-quaternary text-tiny">—</span>}</div>
  </div>
)

export default SummaryCard
