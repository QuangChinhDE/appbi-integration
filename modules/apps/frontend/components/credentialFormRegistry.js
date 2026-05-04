/**
 * Per-app credential form registry.
 *
 * Each connector app owns its own credential UI under
 *   `modules/connectors/apps/<appId>/frontend/CredentialForm.jsx`
 * The shared CredentialModal dispatches by appId through this registry instead
 * of hard-coding source-vs-destination branches. Apps without a dedicated form
 * fall back to the generic Source/Google forms below.
 */

import { SOURCE_APP_IDS, DESTINATION_APP_IDS } from '@modules/apps/frontend/constants'
import SourceCredentialForm from '@modules/apps/frontend/components/SourceCredentialForm'
import GoogleCredentialForm from '@modules/apps/frontend/components/GoogleCredentialForm'

import BigQueryCredentialForm from '@modules/connectors/apps/bigquery/frontend/CredentialForm'


/** Map of appId -> per-app credential form component. */
const APP_FORM_OVERRIDES = {
  bigquery: BigQueryCredentialForm,
}


/** Return the credential form component for a given appId.
 * Fallback rules:
 *   - Source-style apps → SourceCredentialForm (token/domain)
 *   - Destination-style apps → GoogleCredentialForm (Drive/Sheets shape)
 */
export function getCredentialFormForApp(appId) {
  if (!appId) return null
  if (APP_FORM_OVERRIDES[appId]) return APP_FORM_OVERRIDES[appId]
  if (SOURCE_APP_IDS.has(appId)) return SourceCredentialForm
  if (DESTINATION_APP_IDS.has(appId)) return GoogleCredentialForm
  return null
}
