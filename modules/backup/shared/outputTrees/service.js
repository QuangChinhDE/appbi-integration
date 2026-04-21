import {
  accentFolderLine,
  appFolderLine,
  entityFolderLine,
  getPreviewRootName,
  jsonLine,
  nestedFolderLine,
  noteLine,
  rootLine,
  sectionFolderLine,
  sheetLine,
} from './helpers'

export function buildServiceOutputTree({ googleAuth, backupType }) {
  const lines = [
    rootLine(getPreviewRootName(googleAuth)),
    appFolderLine(1, 'Base Service'),
    sectionFolderLine(2, 'Services'),
    sectionFolderLine(3, '[1001] Example Service'),
    nestedFolderLine(4, '1. Thông tin'),
    sheetLine(5, 'Thông tin service.xlsx'),
    sheetLine(5, 'Danh sách ticket.xlsx'),
    sheetLine(5, 'Danh sách stage.xlsx'),
  ]

  if (backupType === 'unstructured' || backupType === 'all') {
    lines.push(accentFolderLine(4, '2. Tickets'))
    lines.push(entityFolderLine(5, '[10001] Example Ticket'))
    lines.push(nestedFolderLine(6, '1. Thông tin'))
    lines.push(sheetLine(7, 'Thông tin ticket.xlsx'))
    lines.push(jsonLine(7, 'ticket.json'))
    lines.push(nestedFolderLine(6, '2. Tùy chỉnh'))
    lines.push(sheetLine(7, 'Thông tin trường tùy chỉnh.xlsx'))
    lines.push(nestedFolderLine(6, '3. Tệp đính kèm'))
    lines.push(sheetLine(7, 'Thông tin files.xlsx'))
    lines.push(noteLine(5, '(one folder per ticket)'))
  }

  lines.push(noteLine(3, '(one folder per selected service)'))
  lines.push(sectionFolderLine(2, '0. Danh mục chung'))
  lines.push(sheetLine(3, 'Danh sách service.xlsx'))
  lines.push(sheetLine(3, 'Danh sách compound.xlsx'))
  lines.push(sheetLine(3, 'Danh sách group.xlsx'))
  lines.push(jsonLine(3, 'backup_manifest.json'))

  return lines
}