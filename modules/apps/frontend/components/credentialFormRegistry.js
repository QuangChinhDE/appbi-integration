/**
 * Per-app credential form registry.
 *
 * Each connector app owns its frontend entrypoint under:
 *   modules/connectors/apps/<appId>/frontend/CredentialForm.jsx
 *
 * Shared form implementations can still live in Apps frontend, but every app
 * must expose its own entrypoint so app packages stay structurally consistent.
 */

import { SOURCE_APP_IDS, DESTINATION_APP_IDS } from '@modules/apps/frontend/constants'
import SourceCredentialForm from '@modules/apps/frontend/components/SourceCredentialForm'
import GoogleCredentialForm from '@modules/apps/frontend/components/GoogleCredentialForm'

import BaseCrmCredentialForm from '@modules/connectors/apps/base_crm/frontend/CredentialForm'
import BaseGoalCredentialForm from '@modules/connectors/apps/base_goal/frontend/CredentialForm'
import BaseHrmCredentialForm from '@modules/connectors/apps/base_hrm/frontend/CredentialForm'
import BaseIncomeCredentialForm from '@modules/connectors/apps/base_income/frontend/CredentialForm'
import BaseMeetingCredentialForm from '@modules/connectors/apps/base_meeting/frontend/CredentialForm'
import BasePayrollCredentialForm from '@modules/connectors/apps/base_payroll/frontend/CredentialForm'
import BaseRequestCredentialForm from '@modules/connectors/apps/base_request/frontend/CredentialForm'
import BaseServiceCredentialForm from '@modules/connectors/apps/base_service/frontend/CredentialForm'
import BaseTableCredentialForm from '@modules/connectors/apps/base_table/frontend/CredentialForm'
import BaseTimeoffCredentialForm from '@modules/connectors/apps/base_timeoff/frontend/CredentialForm'
import BaseWeworkCredentialForm from '@modules/connectors/apps/base_wework/frontend/CredentialForm'
import BaseWorkflowCredentialForm from '@modules/connectors/apps/base_workflow/frontend/CredentialForm'
import BigQueryCredentialForm from '@modules/connectors/apps/bigquery/frontend/CredentialForm'
import GDriveCredentialForm from '@modules/connectors/apps/gdrive/frontend/CredentialForm'
import GSheetsCredentialForm from '@modules/connectors/apps/gsheets/frontend/CredentialForm'
import OneDriveCredentialForm from '@modules/connectors/apps/onedrive/frontend/CredentialForm'


const APP_CREDENTIAL_FORMS = {
  base_crm: BaseCrmCredentialForm,
  base_goal: BaseGoalCredentialForm,
  base_hrm: BaseHrmCredentialForm,
  base_income: BaseIncomeCredentialForm,
  base_meeting: BaseMeetingCredentialForm,
  base_payroll: BasePayrollCredentialForm,
  base_request: BaseRequestCredentialForm,
  base_service: BaseServiceCredentialForm,
  base_table: BaseTableCredentialForm,
  base_timeoff: BaseTimeoffCredentialForm,
  base_wework: BaseWeworkCredentialForm,
  base_workflow: BaseWorkflowCredentialForm,
  bigquery: BigQueryCredentialForm,
  gdrive: GDriveCredentialForm,
  gsheets: GSheetsCredentialForm,
  onedrive: OneDriveCredentialForm,
}


export function getCredentialFormForApp(appId) {
  if (!appId) return null
  if (APP_CREDENTIAL_FORMS[appId]) return APP_CREDENTIAL_FORMS[appId]

  // Migration fallback for future or legacy apps not yet packaged with frontend.
  if (SOURCE_APP_IDS.has(appId)) return SourceCredentialForm
  if (DESTINATION_APP_IDS.has(appId)) return GoogleCredentialForm
  return null
}
