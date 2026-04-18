import React from 'react'
import * as LucideIcons from 'lucide-react'

/**
 * Resolve a kebab-case icon name (e.g. "folder-kanban") to a lucide-react component.
 * Returns a sized React element or a fallback <Box /> if not found.
 */

// kebab-case → PascalCase: "folder-kanban" → "FolderKanban"
function toPascal(name) {
  return name
    .split('-')
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('')
}

export function resolveIcon(iconName, className = 'w-5 h-5') {
  if (!iconName) return <LucideIcons.Box className={className} />
  const Component = LucideIcons[toPascal(iconName)]
  if (!Component) return <LucideIcons.Box className={className} />
  return <Component className={className} />
}
