import React from 'react'
import { Folder } from 'lucide-react'

/**
 * Dark preview panel on surface-inverse for file-tree mockups.
 * `lines` = [{ indent, icon, text, color }]
 */
const FileTreePreview = ({ lines = [] }) => (
  <div className="flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-xl bg-surface-inverse border border-[rgb(var(--surface-inverse)/0.2)]">
    <div className="flex items-center gap-2 shrink-0 border-b border-white/10 px-4 py-3">
      <Folder className="h-3.5 w-3.5 text-success-soft" />
      <span className="text-tiny font-strong tracking-wide text-white">Example output folder structure</span>
    </div>
    <div className="space-y-0.5 overflow-auto px-4 py-4 font-mono text-tiny leading-relaxed text-white/60">
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
