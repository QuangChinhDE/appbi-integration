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

export function buildWeworkOutputTree({ googleAuth, selectedObjects, selectedProjectIds }) {
  const hasDepartmentScope = selectedObjects.includes('department')
  const hasProjectScope = selectedObjects.includes('project')
  const hasTaskScope = selectedObjects.includes('task')
  const hasProjectContainers = hasProjectScope || hasTaskScope

  const lines = [
    rootLine(getPreviewRootName(googleAuth)),
    appFolderLine(1, 'Base WeWork'),
    sectionFolderLine(2, '0. Danh mục chung'),
    sheetLine(3, 'Danh sách phòng ban.xlsx'),
    sheetLine(3, 'Danh sách project.xlsx'),
    jsonLine(3, 'backup_manifest.json'),
  ]

  if (!selectedObjects.length) {
    lines.push(noteLine(2, '(select at least one WeWork data type)'))
    return lines
  }

  if (hasDepartmentScope) {
    lines.push(sectionFolderLine(2, '1. Departments'))
    lines.push(entityFolderLine(3, '[301] Product Department'))
    lines.push(sheetLine(4, 'Thông tin phòng ban.xlsx'))
  } else {
    lines.push(noteLine(2, '(department folders are skipped when Department is not selected)'))
  }

  if (hasProjectContainers) {
    lines.push(sectionFolderLine(2, '2. Projects'))
    lines.push(entityFolderLine(3, '[771] Project Apollo'))
    if (hasProjectScope) {
      lines.push(nestedFolderLine(4, '1. Thông tin project'))
      lines.push(sheetLine(5, 'Thông tin project.xlsx'))
      lines.push(sheetLine(5, 'Thông tin trường tùy chỉnh.xlsx'))
      lines.push(sheetLine(5, '[table name].xlsx'))
    } else {
      lines.push(noteLine(4, '(project detail folder is skipped when Project is not selected)'))
    }

    lines.push(nestedFolderLine(4, '2. Danh sách dữ liệu'))
    lines.push(sheetLine(5, 'Danh sách task.xlsx'))
    lines.push(sheetLine(5, 'Danh sách tasklist.xlsx'))
    lines.push(sheetLine(5, 'Danh sách milestone.xlsx'))

    if (hasTaskScope) {
      lines.push(accentFolderLine(4, '3. Tasks'))
      lines.push(entityFolderLine(5, '[5001] Launch Plan'))
      lines.push(nestedFolderLine(6, '1. Thông tin'))
      lines.push(sheetLine(7, 'Thông tin task.xlsx'))
      lines.push(jsonLine(7, 'task.json'))
      lines.push(nestedFolderLine(6, '2. Tùy chỉnh'))
      lines.push(sheetLine(7, 'Thông tin trường tùy chỉnh.xlsx'))
      lines.push(sheetLine(7, '[table name].xlsx'))
      lines.push(nestedFolderLine(6, '3. Tệp đính kèm'))
      lines.push(sheetLine(7, 'Thông tin files.xlsx'))
      lines.push(sheetLine(7, 'Thông tin result files.xlsx'))
      lines.push(sheetLine(7, 'Thông tin review files.xlsx'))
      lines.push(noteLine(5, '(one flat task folder per task inside the selected project)'))
    } else {
      lines.push(noteLine(4, '(task detail folders are skipped when Task is not selected)'))
    }
  } else {
    lines.push(noteLine(2, '(project folders are created when Project or Task is selected)'))
  }

  if (selectedProjectIds.length > 1) {
    lines.push(noteLine(3, '(one project folder per selected project)'))
  }

  return lines
}