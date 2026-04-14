integration-platform/
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ main.py
│  │  │  ├─ bootstrap.py
│  │  │  ├─ app.py
│  │  │  ├─ lifecycle.py
│  │  │  └─ dependencies.py
│  │  ├─ tests/
│  │  └─ Dockerfile
│  │
│  ├─ worker/
│  │  ├─ src/
│  │  │  ├─ main.py
│  │  │  ├─ consumer.py
│  │  │  ├─ job_router.py
│  │  │  └─ heartbeat.py
│  │  ├─ tests/
│  │  └─ Dockerfile
│  │
│  ├─ scheduler/
│  │  ├─ src/
│  │  │  ├─ main.py
│  │  │  ├─ poller.py
│  │  │  ├─ trigger_dispatcher.py
│  │  │  └─ lock_manager.py
│  │  ├─ tests/
│  │  └─ Dockerfile
│  │
│  └─ web/
│     ├─ src/
│     │  ├─ main.jsx
│     │  ├─ app/
│     │  │  ├─ router.jsx
│     │  │  ├─ providers.jsx
│     │  │  ├─ layout/
│     │  │  └─ guards/
│     │  └─ shared/
│     ├─ public/
│     ├─ tests/
│     └─ Dockerfile
│
├─ modules/
│  ├─ backup/
│  │  ├─ backend/
│  │  │  ├─ api/
│  │  │  │  ├─ routes.py
│  │  │  │  ├─ flow_routes.py
│  │  │  │  ├─ run_routes.py
│  │  │  │  └─ artifact_routes.py
│  │  │  ├─ services/
│  │  │  │  ├─ backup_flow_service.py
│  │  │  │  ├─ backup_run_service.py
│  │  │  │  ├─ backup_plan_service.py
│  │  │  │  └─ backup_artifact_service.py
│  │  │  ├─ domain/
│  │  │  │  ├─ entities/
│  │  │  │  ├─ policies/
│  │  │  │  ├─ value_objects/
│  │  │  │  └─ exceptions.py
│  │  │  ├─ planners/
│  │  │  │  ├─ full_backup_planner.py
│  │  │  │  ├─ incremental_backup_planner.py
│  │  │  │  └─ retention_planner.py
│  │  │  ├─ executors/
│  │  │  │  ├─ backup_executor.py
│  │  │  │  └─ restore_executor.py
│  │  │  ├─ presenters/
│  │  │  └─ validators/
│  │  ├─ frontend/
│  │  │  ├─ pages/
│  │  │  │  ├─ BackupFlowListPage.jsx
│  │  │  │  ├─ BackupFlowCreatePage.jsx
│  │  │  │  ├─ BackupFlowEditPage.jsx
│  │  │  │  ├─ BackupRunListPage.jsx
│  │  │  │  └─ BackupRunDetailPage.jsx
│  │  │  ├─ components/
│  │  │  ├─ hooks/
│  │  │  ├─ api/
│  │  │  └─ forms/
│  │  └─ shared/
│  │     ├─ types/
│  │     ├─ constants/
│  │     └─ manifests/
│  │
│  ├─ automation/
│  │  ├─ backend/
│  │  │  ├─ api/
│  │  │  │  ├─ routes.py
│  │  │  │  ├─ workflow_routes.py
│  │  │  │  ├─ execution_routes.py
│  │  │  │  └─ template_routes.py
│  │  │  ├─ services/
│  │  │  │  ├─ workflow_service.py
│  │  │  │  ├─ workflow_version_service.py
│  │  │  │  ├─ automation_execution_service.py
│  │  │  │  └─ template_service.py
│  │  │  ├─ engine/
│  │  │  │  ├─ graph_compiler.py
│  │  │  │  ├─ node_executor.py
│  │  │  │  ├─ edge_resolver.py
│  │  │  │  ├─ expression_runtime.py
│  │  │  │  └─ state_store.py
│  │  │  ├─ node_registry/
│  │  │  ├─ validators/
│  │  │  ├─ presenters/
│  │  │  └─ templates/
│  │  ├─ frontend/
│  │  │  ├─ pages/
│  │  │  │  ├─ WorkflowListPage.jsx
│  │  │  │  ├─ WorkflowBuilderPage.jsx
│  │  │  │  ├─ WorkflowExecutionListPage.jsx
│  │  │  │  └─ WorkflowExecutionDetailPage.jsx
│  │  │  ├─ builder/
│  │  │  │  ├─ canvas/
│  │  │  │  ├─ inspector/
│  │  │  │  ├─ node_palette/
│  │  │  │  ├─ edge_layer/
│  │  │  │  └─ validation/
│  │  │  ├─ components/
│  │  │  ├─ hooks/
│  │  │  └─ api/
│  │  └─ shared/
│  │     ├─ types/
│  │     ├─ constants/
│  │     └─ templates/
│  │
│  ├─ credentials/
│  │  ├─ backend/
│  │  │  ├─ api/
│  │  │  │  ├─ routes.py
│  │  │  │  ├─ credential_routes.py
│  │  │  │  └─ oauth_routes.py
│  │  │  ├─ services/
│  │  │  │  ├─ credential_service.py
│  │  │  │  ├─ oauth_service.py
│  │  │  │  ├─ secret_service.py
│  │  │  │  └─ credential_test_service.py
│  │  │  ├─ vault/
│  │  │  ├─ providers/
│  │  │  └─ validators/
│  │  ├─ frontend/
│  │  │  ├─ pages/
│  │  │  ├─ components/
│  │  │  ├─ modals/
│  │  │  ├─ hooks/
│  │  │  └─ api/
│  │  └─ shared/
│  │     ├─ types/
│  │     └─ constants/
│  │
│  ├─ execution/
│  │  ├─ backend/
│  │  │  ├─ engine/
│  │  │  │  ├─ orchestrator.py
│  │  │  │  ├─ run_context.py
│  │  │  │  ├─ run_state_machine.py
│  │  │  │  ├─ artifact_registry.py
│  │  │  │  └─ capability_dispatcher.py
│  │  │  ├─ queue/
│  │  │  │  ├─ enqueue.py
│  │  │  │  ├─ dequeue.py
│  │  │  │  ├─ job_types.py
│  │  │  │  └─ dedup.py
│  │  │  ├─ retries/
│  │  │  │  ├─ retry_policy.py
│  │  │  │  ├─ backoff.py
│  │  │  │  └─ dead_letter.py
│  │  │  ├─ logs/
│  │  │  │  ├─ run_logger.py
│  │  │  │  ├─ event_logger.py
│  │  │  │  └─ metrics_logger.py
│  │  │  ├─ scheduler/
│  │  │  │  ├─ cron_trigger.py
│  │  │  │  ├─ interval_trigger.py
│  │  │  │  └─ calendar_trigger.py
│  │  │  └─ api/
│  │  │     ├─ routes.py
│  │  │     └─ run_routes.py
│  │  └─ shared/
│  │     ├─ types/
│  │     ├─ enums/
│  │     └─ contracts/
│  │
│  ├─ connectors/
│  │  ├─ shared/
│  │  │  ├─ base/
│  │  │  │  ├─ source_connector.py
│  │  │  │  ├─ destination_connector.py
│  │  │  │  ├─ trigger_connector.py
│  │  │  │  ├─ action_connector.py
│  │  │  │  ├─ auth_provider.py
│  │  │  │  └─ manifest.py
│  │  │  ├─ registry/
│  │  │  │  ├─ connector_registry.py
│  │  │  │  ├─ capability_registry.py
│  │  │  │  └─ manifest_loader.py
│  │  │  ├─ runtime/
│  │  │  │  ├─ connector_loader.py
│  │  │  │  ├─ credential_binding.py
│  │  │  │  └─ test_connection.py
│  │  │  └─ ui/
│  │  │     ├─ form_schema.py
│  │  │     └─ node_schema.py
│  │  │
│  │  └─ apps/
│  │     ├─ request/
│  │     │  ├─ common/
│  │     │  │  ├─ manifest.py
│  │     │  │  ├─ auth.py
│  │     │  │  ├─ client.py
│  │     │  │  ├─ schemas.py
│  │     │  │  └─ constants.py
│  │     │  ├─ backup/
│  │     │  │  ├─ extractor.py
│  │     │  │  ├─ mapper.py
│  │     │  │  ├─ artifact_builder.py
│  │     │  │  └─ object_handlers/
│  │     │  ├─ automation/
│  │     │  │  ├─ triggers.py
│  │     │  │  ├─ actions.py
│  │     │  │  └─ samples.py
│  │     │  └─ tests/
│  │     │
│  │     ├─ workflow/
│  │     │  ├─ common/
│  │     │  ├─ backup/
│  │     │  ├─ automation/
│  │     │  └─ tests/
│  │     │
│  │     ├─ wework/
│  │     │  ├─ common/
│  │     │  ├─ backup/
│  │     │  ├─ automation/
│  │     │  └─ tests/
│  │     │
│  │     ├─ service/
│  │     │  ├─ common/
│  │     │  ├─ backup/
│  │     │  ├─ automation/
│  │     │  └─ tests/
│  │     │
│  │     ├─ google_drive/
│  │     │  ├─ common/
│  │     │  │  ├─ manifest.py
│  │     │  │  ├─ auth.py
│  │     │  │  ├─ client.py
│  │     │  │  ├─ schemas.py
│  │     │  │  └─ constants.py
│  │     │  ├─ backup/
│  │     │  │  ├─ writer.py
│  │     │  │  ├─ folder_strategy.py
│  │     │  │  ├─ file_strategy.py
│  │     │  │  └─ permissions.py
│  │     │  ├─ automation/
│  │     │  │  ├─ triggers.py
│  │     │  │  ├─ actions.py
│  │     │  │  └─ search.py
│  │     │  └─ tests/
│  │     │
│  │     ├─ google_sheets/
│  │     │  ├─ common/
│  │     │  ├─ backup/
│  │     │  │  ├─ writer.py
│  │     │  │  ├─ workbook_builder.py
│  │     │  │  └─ sheet_mapper.py
│  │     │  ├─ automation/
│  │     │  └─ tests/
│  │     │
│  │     ├─ webhook/
│  │     │  ├─ common/
│  │     │  ├─ automation/
│  │     │  └─ tests/
│  │     │
│  │     ├─ slack/
│  │     │  ├─ common/
│  │     │  ├─ automation/
│  │     │  └─ tests/
│  │     │
│  │     ├─ email/
│  │     │  ├─ common/
│  │     │  ├─ automation/
│  │     │  └─ tests/
│  │     │
│  │     ├─ s3/
│  │     │  ├─ common/
│  │     │  ├─ backup/
│  │     │  ├─ automation/
│  │     │  └─ tests/
│  │     │
│  │     └─ local_fs/
│  │        ├─ common/
│  │        ├─ backup/
│  │        ├─ automation/
│  │        └─ tests/
│  │
│  ├─ identity/
│  │  ├─ backend/
│  │  │  ├─ api/
│  │  │  ├─ services/
│  │  │  ├─ policies/
│  │  │  └─ presenters/
│  │  ├─ frontend/
│  │  │  ├─ pages/
│  │  │  ├─ components/
│  │  │  └─ api/
│  │  └─ shared/
│  │     ├─ types/
│  │     └─ constants/
│  │
│  └─ admin/
│     ├─ backend/
│     │  ├─ api/
│     │  ├─ services/
│     │  ├─ reports/
│     │  └─ audit/
│     ├─ frontend/
│     │  ├─ pages/
│     │  ├─ components/
│     │  └─ api/
│     └─ shared/
│        ├─ types/
│        └─ constants/
│
├─ packages/
│  ├─ config/
│  │  └─ src/
│  │     ├─ settings.py
│  │     ├─ env.py
│  │     └─ feature_flags.py
│  │
│  ├─ database/
│  │  └─ src/
│  │     ├─ session.py
│  │     ├─ base.py
│  │     ├─ models/
│  │     │  ├─ identity/
│  │     │  ├─ credentials/
│  │     │  ├─ backup/
│  │     │  ├─ automation/
│  │     │  ├─ execution/
│  │     │  └─ connectors/
│  │     ├─ repositories/
│  │     └─ migrations/
│  │        └─ versions/
│  │
│  ├─ auth/
│  │  └─ src/
│  │     ├─ jwt.py
│  │     ├─ sessions.py
│  │     ├─ permissions.py
│  │     ├─ roles.py
│  │     └─ password.py
│  │
│  ├─ logger/
│  │  └─ src/
│  │     ├─ logging.py
│  │     ├─ metrics.py
│  │     ├─ tracing.py
│  │     └─ correlation.py
│  │
│  ├─ sdk/
│  │  └─ src/
│  │     ├─ connector_types.py
│  │     ├─ execution_types.py
│  │     ├─ manifest_types.py
│  │     ├─ workflow_types.py
│  │     └─ backup_types.py
│  │
│  ├─ ui/
│  │  └─ src/
│  │     ├─ components/
│  │     ├─ theme/
│  │     ├─ icons/
│  │     └─ hooks/
│  │
│  ├─ testing/
│  │  └─ src/
│  │     ├─ factories/
│  │     ├─ fixtures/
│  │     ├─ mocks/
│  │     └─ helpers/
│  │
│  └─ utils/
│     └─ src/
│        ├─ datetime.py
│        ├─ ids.py
│        ├─ encryption.py
│        ├─ json.py
│        └─ strings.py
│
├─ infrastructure/
│  ├─ docker/
│  │  ├─ api.Dockerfile
│  │  ├─ worker.Dockerfile
│  │  ├─ scheduler.Dockerfile
│  │  └─ web.Dockerfile
│  │
│  ├─ compose/
│  │  ├─ docker-compose.dev.yml
│  │  ├─ docker-compose.staging.yml
│  │  └─ docker-compose.prod.yml
│  │
│  ├─ nginx/
│  │  ├─ web.conf
│  │  └─ api.conf
│  │
│  ├─ scripts/
│  │  ├─ dev/
│  │  ├─ ci/
│  │  ├─ release/
│  │  └─ migration/
│  │
│  ├─ deploy/
│  │  ├─ kubernetes/
│  │  ├─ terraform/
│  │  └─ ansible/
│  │
│  └─ monitoring/
│     ├─ prometheus/
│     ├─ grafana/
│     ├─ alerts/
│     └─ dashboards/
│
├─ docs/
│  ├─ architecture/
│  │  ├─ overview.md
│  │  ├─ modules.md
│  │  ├─ execution-engine.md
│  │  ├─ connector-sdk.md
│  │  └─ security.md
│  │
│  ├─ api/
│  ├─ runbooks/
│  ├─ product/
│  ├─ decisions/
│  └─ onboarding/
│
├─ .github/
│  ├─ workflows/
│  └─ pull_request_template.md
│
├─ .env.example
├─ pnpm-workspace.yaml
├─ pyproject.toml
├─ package.json
├─ README.md
└─ Makefile