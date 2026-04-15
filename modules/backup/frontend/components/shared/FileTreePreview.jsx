import React from 'react'
import { Folder } from 'lucide-react'

/**
 * Dark-themed file-tree preview panel.
 * `lines` = [{ indent, icon, text, color }]
 */
const FileTreePreview = ({ lines = [] }) => (
  <div className="rounded-2xl overflow-hidden flex-1 flex flex-col min-h-[360px]" style={{ background: '#0f172a', border: '1px solid #1e293b' }}>
    <div className="px-4 py-3 border-b flex items-center gap-2 shrink-0" style={{ borderColor: '#1e293b' }}>
      <Folder className="w-3.5 h-3.5 text-emerald-400" />
      <span className="text-xs font-bold text-white tracking-wide">Example output folder structure</span>
    </div>
    <div className="px-4 py-4 overflow-auto text-xs font-mono leading-relaxed space-y-0.5" style={{ color: '#94a3b8' }}>
      {lines.map((line, i) => (
        <div key={i} className="min-w-max whitespace-nowrap" style={{ color: line.color || '#94a3b8', paddingLeft: line.indent * 16 }}>
          {line.icon} {line.text}
        </div>
      ))}
    </div>
  </div>
)

export default FileTreePreview
