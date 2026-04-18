export const EFFECTIVE_PERMISSION_LEVEL = {
  none: 0,
  view: 1,
  edit: 2,
  full: 3,
}

export function getResourcePermissions(userPermission = 'none') {
  const level = EFFECTIVE_PERMISSION_LEVEL[userPermission] ?? 0
  return {
    level: userPermission,
    canView: level >= EFFECTIVE_PERMISSION_LEVEL.view,
    canEdit: level >= EFFECTIVE_PERMISSION_LEVEL.edit,
    canDelete: level >= EFFECTIVE_PERMISSION_LEVEL.full,
    canShare: level >= EFFECTIVE_PERMISSION_LEVEL.full,
  }
}

export function getAccessMeta(userPermission = 'none') {
  switch (userPermission) {
    case 'full':
      return { label: 'Owner', tone: 'brand' }
    case 'edit':
      return { label: 'Can edit', tone: 'info' }
    case 'view':
      return { label: 'Can view', tone: 'neutral' }
    default:
      return { label: 'No access', tone: 'neutral' }
  }
}

export function getListAccessMeta(userPermission = 'none') {
  switch (userPermission) {
    case 'full':
      return { label: 'Full access', tone: 'brand', value: 'full' }
    case 'edit':
      return { label: 'Editable', tone: 'info', value: 'edit' }
    case 'view':
      return { label: 'View only', tone: 'neutral', value: 'view' }
    default:
      return { label: 'Restricted', tone: 'neutral', value: 'none' }
  }
}
