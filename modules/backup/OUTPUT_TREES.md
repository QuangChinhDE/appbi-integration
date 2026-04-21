# Backup Output Trees

This file audits the current backup output tree for the 4 app-specific backup extractors.

Source of truth:
- Runtime output: backend extractors under `modules/backup/backend/extractors/`
- FE preview contract: shared tree specs under `modules/backup/shared/outputTrees/`

## Service

Status: complete relative to the current extractor.

Conditions:
- `backup_type = structured`: only service-level spreadsheets are created.
- `backup_type in {unstructured, all}`: per-ticket folders are also created.

Current runtime tree:

```text
Base Service/
├── Services/
│   └── [ID] Service Name/
│       ├── 1. Thông tin/
│       │   ├── Thông tin service.xlsx
│       │   ├── Danh sách ticket.xlsx
│       │   └── Danh sách stage.xlsx
│       └── 2. Tickets/
│           └── [ID] Ticket Name/
│               ├── 1. Thông tin/
│               │   ├── Thông tin ticket.xlsx
│               │   └── ticket.json
│               ├── 2. Tùy chỉnh/
│               │   └── Thông tin trường tùy chỉnh.xlsx
│               └── 3. Tệp đính kèm/
│                   └── Thông tin files.xlsx
└── 0. Danh mục chung/
    ├── Danh sách service.xlsx
    ├── Danh sách compound.xlsx
    ├── Danh sách group.xlsx
    └── backup_manifest.json
```

## Request

Status: complete relative to the current extractor.

Conditions:
- If `request` is not selected in `objects`, only group-level `Danh sách request.xlsx` files are created.
- If group `0` is selected, direct requests are exported under `[direct] Đề xuất trực tiếp/`.
- `backup_type` is currently stored in the manifest only; it does not change the Request folder tree.

Current runtime tree:

```text
Base Request/
├── [ID] Group Name/
│   ├── Danh sách request.xlsx
│   └── [ID] Request Name/
│       ├── Thông tin request.xlsx
│       ├── request.json
│       ├── Thông tin trường tùy chỉnh.xlsx
│       ├── [table name].xlsx
│       ├── post_and_comment.txt
│       └── Tệp đính kèm/
│           └── Thông tin files.xlsx
├── [direct] Đề xuất trực tiếp/
│   ├── Danh sách request.xlsx
│   └── [ID] Request Name/
│       └── ... same structure as named-group requests
└── 0. Danh mục chung/
    ├── Danh sách group.xlsx
    └── backup_manifest.json
```

## Workflow

Status: complete relative to the current extractor.

Conditions:
- If `job` is not selected in `objects`, job list and per-job folders are skipped.
- `backup_type` is currently recorded in the manifest, but it does not change the Workflow folder tree.

Current runtime tree:

```text
Base Workflow/
├── Workflows/
│   └── [ID] Workflow Name/
│       ├── 0. Hướng dẫn/
│       │   └── README.txt
│       ├── 1. Cấu hình workflow/
│       │   ├── Thông tin workflow.xlsx
│       │   └── Danh sách stage.xlsx
│       ├── 2. Danh sách công việc/
│       │   └── Danh sách job.xlsx
│       └── 3. Jobs/
│           └── [ID] Job Name/
│               ├── 1. Thông tin/
│               │   ├── Thông tin job.xlsx
│               │   ├── Thông tin job log.xlsx
│               │   └── Thông tin job moves.xlsx
│               ├── 2. Dữ liệu nhập/
│               │   ├── custom_fields.xlsx
│               │   ├── input table.xlsx
│               │   ├── input table kèm base table.xlsx
│               │   └── select master.xlsx
│               ├── 3. Nội dung/
│               │   └── post_and_comment.txt
│               └── 4. Tệp đính kèm/
│                   └── Thông tin files.xlsx
└── 0. Danh mục chung/
    ├── Danh sách workflow.xlsx
    └── backup_manifest.json
```

## WeWork

Status: complete relative to the current extractor.

Conditions:
- `Departments/` is a dedicated root folder used for department-level metadata only.
- `Projects/` is a dedicated root folder used as the main backup unit.
- If `department` is not selected in `objects`, the `1. Departments/` branch is skipped.
- If neither `project` nor `task` is selected in `objects`, the `2. Projects/` branch is skipped.
- If `project` is selected, each project folder starts with `1. Thông tin project/`.
- If `project` or `task` is selected, each project folder writes `2. Danh sách dữ liệu/` with task, tasklist, and milestone spreadsheets.
- If `task` is selected, `3. Tasks/` creates one flat folder per task; child tasks are not nested recursively.
- `backup_type` is currently recorded in the manifest only; it does not reshape the WeWork folder tree.

Current runtime tree:

```text
Base WeWork/
├── 0. Danh mục chung/
│   ├── Danh sách phòng ban.xlsx
│   ├── Danh sách project.xlsx
│   └── backup_manifest.json
├── 1. Departments/
│   └── [ID] Department Name/
│       └── Thông tin phòng ban.xlsx
└── 2. Projects/
    └── [ID] Project Name/
        ├── 1. Thông tin project/
        │   ├── Thông tin project.xlsx
        │   ├── Thông tin trường tùy chỉnh.xlsx
        │   └── [table name].xlsx
        ├── 2. Danh sách dữ liệu/
        │   ├── Danh sách task.xlsx
        │   ├── Danh sách tasklist.xlsx
        │   └── Danh sách milestone.xlsx
        └── 3. Tasks/
            └── [ID] Task Name/
                ├── 1. Thông tin/
                │   ├── Thông tin task.xlsx
                │   └── task.json
                ├── 2. Tùy chỉnh/
                │   ├── Thông tin trường tùy chỉnh.xlsx
                │   └── [table name].xlsx
                └── 3. Tệp đính kèm/
                    ├── Thông tin files.xlsx
                    ├── Thông tin result files.xlsx
                    └── Thông tin review files.xlsx
```