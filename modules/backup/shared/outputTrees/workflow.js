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
  textLine,
} from './helpers'

export function buildWorkflowOutputTree({ googleAuth, selectedObjects }) {
  const hasWorkflowScope = selectedObjects.some((objectId) => ['workflow', 'job'].includes(objectId))
  const hasJobScope = selectedObjects.includes('job')

  const lines = [
    rootLine(getPreviewRootName(googleAuth)),
    appFolderLine(1, 'Base Workflow'),
  ]

  if (!selectedObjects.length) {
    lines.push(noteLine(2, '(select at least one Workflow data type)'))
    return lines
  }

  lines.push(sectionFolderLine(2, 'Workflows'))

  if (!hasWorkflowScope) {
    lines.push(noteLine(3, '(workflow folders are created when Workflow or Job is selected)'))
    lines.push(sectionFolderLine(2, '0. Danh mục chung'))
    lines.push(sheetLine(3, 'Danh sách workflow.xlsx'))
    lines.push(jsonLine(3, 'backup_manifest.json'))
    return lines
  }

  lines.push(sectionFolderLine(3, '[8899] Example Workflow'))
  lines.push(entityFolderLine(4, '0. Hướng dẫn'))
  lines.push(textLine(5, 'README.txt'))
  lines.push(entityFolderLine(4, '1. Cấu hình workflow'))
  lines.push(sheetLine(5, 'Thông tin workflow.xlsx'))
  lines.push(sheetLine(5, 'Danh sách stage.xlsx'))

  if (hasJobScope) {
    lines.push(entityFolderLine(4, '2. Danh sách công việc'))
    lines.push(sheetLine(5, 'Danh sách job.xlsx'))
    lines.push(accentFolderLine(4, '3. Jobs'))
    lines.push(entityFolderLine(5, '[73301] Example Job'))
    lines.push(nestedFolderLine(6, '1. Thông tin'))
    lines.push(sheetLine(7, 'Thông tin job.xlsx'))
    lines.push(sheetLine(7, 'Thông tin job log.xlsx'))
    lines.push(sheetLine(7, 'Thông tin job moves.xlsx'))
    lines.push(nestedFolderLine(6, '2. Dữ liệu nhập'))
    lines.push(sheetLine(7, 'custom_fields.xlsx'))
    lines.push(sheetLine(7, 'input table.xlsx'))
    lines.push(sheetLine(7, 'input table kèm base table.xlsx'))
    lines.push(sheetLine(7, 'select master.xlsx'))
    lines.push(nestedFolderLine(6, '3. Nội dung'))
    lines.push(textLine(7, 'post_and_comment.txt'))
    lines.push(nestedFolderLine(6, '4. Tệp đính kèm'))
    lines.push(sheetLine(7, 'Thông tin files.xlsx'))
    lines.push(noteLine(5, '(one folder per job)'))
  } else {
    lines.push(noteLine(4, '(job list and job folders are skipped when Job is not selected)'))
  }

  lines.push(noteLine(3, '(one folder per selected workflow)'))
  lines.push(sectionFolderLine(2, '0. Danh mục chung'))
  lines.push(sheetLine(3, 'Danh sách workflow.xlsx'))
  lines.push(jsonLine(3, 'backup_manifest.json'))

  return lines
}