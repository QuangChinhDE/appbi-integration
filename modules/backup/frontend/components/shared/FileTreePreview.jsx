import React from 'react'
import { Folder } from 'lucide-react'

/**
 * Dark preview panel on surface-inverse for file-tree mockups.
 * `lines` = [{ indent, icon, text, color }]
 */
const FileTreePreview = ({ lines = [] }) => (
  <div className="flex min-h-[392px] flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-surface-inverse">
    <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3.5">
      <Folder className="h-3.5 w-3.5 text-success-soft" />
      <span className="text-label font-emphasis uppercase tracking-[0.14em] text-white/80">Example output folder structure</span>
    </div>
    <div className="space-y-0.5 overflow-auto px-4 py-4 font-mono text-label leading-6 text-white/65">
      {lines.map((line, i) => (
        <div
          key={i}
          className="min-w-max whitespace-nowrap"
          style={{ color: line.color || undefined, paddingLeft: line.indent * 16 }}
        >
          {line.icon} {line.text}
        </div>
      ))}
    </div>
  </div>
)

export default FileTreePreview
