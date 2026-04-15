import React from 'react'

/**
 * Summary card used in detail views and review steps.
 * Coloured header bar + stacked label/value fields.
 */
export const SummaryCard = ({ title, icon: Icon, color = '#64748b', children }) => (
  <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
    <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2" style={{ background: `${color}0a` }}>
      {Icon && <Icon className="w-3.5 h-3.5" style={{ color }} />}
      <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>{title}</span>
    </div>
    <div className="px-4 py-0.5">{children}</div>
  </div>
)

/**
 * Single label + value field inside a SummaryCard.
 */
export const SummaryField = ({ label, children }) => (
  <div className="py-2.5 border-b border-gray-50 last:border-0">
    <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-0.5">{label}</div>
    <div className="text-sm text-gray-800 break-words">{children ?? <span className="text-gray-300 text-xs">—</span>}</div>
  </div>
)

export default SummaryCard
