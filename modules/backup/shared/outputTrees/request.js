import {
  appFolderLine,
  entityFolderLine,
  getPreviewRootName,
  jsonLine,
  noteLine,
  rootLine,
  sectionFolderLine,
  sheetLine,
  textLine,
} from './helpers'

export function buildRequestOutputTree({ googleAuth, selectedObjects, selectedGroupIds }) {
  const hasGroupScope = !selectedObjects.length || selectedObjects.includes('group') || selectedObjects.includes('request')
  const hasRequestScope = !selectedObjects.length || selectedObjects.includes('request')
  const hasExplicitGroupSelection = selectedGroupIds.length > 0
  const hasNamedGroupSelection = !hasExplicitGroupSelection || selectedGroupIds.some((groupId) => groupId !== '0')
  const hasDirectSelection = !hasExplicitGroupSelection || selectedGroupIds.includes('0')

  const lines = [
    rootLine(getPreviewRootName(googleAuth)),
    appFolderLine(1, 'Base Request'),
  ]

  if (!hasGroupScope) {
    lines.push(noteLine(2, '(select at least one Request data type)'))
    return lines
  }

  if (hasNamedGroupSelection) {
    lines.push(sectionFolderLine(2, '[001] Request Group A'))
    lines.push(sheetLine(3, 'Danh sách request.xlsx'))

    if (hasRequestScope) {
      lines.push(sectionFolderLine(3, '[1234] Request name 1'))
      lines.push(sheetLine(4, 'Thông tin request.xlsx'))
      lines.push(jsonLine(4, 'request.json'))
      lines.push(sheetLine(4, 'Thông tin trường tùy chỉnh.xlsx'))
      lines.push(sheetLine(4, '[table name].xlsx'))
      lines.push(textLine(4, 'post_and_comment.txt'))
      lines.push(entityFolderLine(4, 'Tệp đính kèm'))
      lines.push(sheetLine(5, 'Thông tin files.xlsx'))
      lines.push(sectionFolderLine(3, '[1235] Request name 2'))
      lines.push(noteLine(4, '(similar)'))
    } else {
      lines.push(noteLine(3, '(request folders are skipped when Request is not selected)'))
    }

    lines.push(sectionFolderLine(2, '[002] Request Group B'))
    lines.push(noteLine(3, '(similar)'))
  } else {
    lines.push(noteLine(2, '(named group folders are skipped when only direct requests are selected)'))
  }

  if (hasDirectSelection) {
    lines.push(sectionFolderLine(2, '[direct] Đề xuất trực tiếp'))
    lines.push(sheetLine(3, 'Danh sách request.xlsx'))
    if (hasRequestScope) {
      lines.push(noteLine(3, '(requests not in any group)'))
    }
  } else {
    lines.push(noteLine(2, '(direct requests are excluded by the current group selection)'))
  }

  lines.push(sectionFolderLine(2, '0. Danh mục chung'))
  lines.push(sheetLine(3, 'Danh sách group.xlsx'))
  lines.push(jsonLine(3, 'backup_manifest.json'))

  return lines
}