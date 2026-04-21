export const TREE_COLORS = {
  root: '#e2e8f0',
  app: '#10b981',
  section: '#60a5fa',
  entity: '#93c5fd',
  nested: '#bfdbfe',
  accent: '#a78bfa',
  sheet: '#4ade80',
  meta: '#94a3b8',
  note: '#64748b',
}

const buildLine = (indent, icon, text, color) => ({ indent, icon, text, color })

export const getPreviewRootName = (googleAuth) => googleAuth?.folder_name || 'My Drive'

export const rootLine = (rootName) => buildLine(0, '📁', rootName, TREE_COLORS.root)
export const appFolderLine = (indent, text) => buildLine(indent, '📁', text, TREE_COLORS.app)
export const sectionFolderLine = (indent, text) => buildLine(indent, '📁', text, TREE_COLORS.section)
export const entityFolderLine = (indent, text) => buildLine(indent, '📁', text, TREE_COLORS.entity)
export const nestedFolderLine = (indent, text) => buildLine(indent, '📁', text, TREE_COLORS.nested)
export const accentFolderLine = (indent, text) => buildLine(indent, '📁', text, TREE_COLORS.accent)

export const sheetLine = (indent, text) => buildLine(indent, '📊', text, TREE_COLORS.sheet)
export const jsonLine = (indent, text) => buildLine(indent, '📋', text, TREE_COLORS.meta)
export const textLine = (indent, text) => buildLine(indent, '📝', text, TREE_COLORS.meta)
export const noteLine = (indent, text) => buildLine(indent, '…', text, TREE_COLORS.note)