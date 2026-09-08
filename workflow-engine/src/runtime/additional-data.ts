/**
 * `IWorkflowExecuteAdditionalData` for one execution (SRS 26.5).
 *
 * This is the object n8n's runtime reaches through for everything it cannot do
 * on its own: credentials, sub-workflows, webhook URLs, external secrets. In
 * the n8n application each of those is a service backed by a database. Here
 * every one of them is either supplied by the product for this run or
 * deliberately closed off.
 *
 * The closures matter as much as the implementations. `executeWorkflow` throws
 * rather than returning nothing, and `secretsHelpers` reports no providers
 * rather than an empty one — a disabled capability that fails quietly is a
 * capability somebody will later assume works.
 */

import type { IWorkflowExecuteAdditionalData } from 'n8n-workflow';

import { config } from '../config';
import { RuntimeCredentialsHelper } from '../credentials/runtime-credential-provider';

export function buildAdditionalData(options: {
	executionId: string;
	credentialData: Map<string, Record<string, unknown>>;
	timeoutSeconds: number;
}): IWorkflowExecuteAdditionalData {
	return {
		credentialsHelper: new RuntimeCredentialsHelper(options.credentialData),

		executeWorkflow: async () => {
			// Sub-workflows are out of scope for V1 (SRS 72). They need parent/child
			// execution records, cross-workflow cycle detection and a permission
			// model, none of which exist yet.
			throw new Error('sub-workflow execution is disabled');
		},

		executionId: options.executionId,

		// n8n builds callback URLs from these for its own webhook server. This
		// engine has no webhook server and no public route (ADR-005), so they are
		// empty on purpose: a node that tries to register a callback will fail
		// visibly rather than publishing an unreachable URL.
		restApiUrl: '',
		instanceBaseUrl: '',
		webhookBaseUrl: '',
		webhookWaitingBaseUrl: '',
		webhookTestBaseUrl: '',

		timezone: config.timezone,
		// Not a real user id. Execution attribution lives in the product's
		// database; the engine has no user model (SRS 26.2).
		userId: 'engine',
		variables: {},

		executionTimeoutTimestamp: Date.now() + options.timeoutSeconds * 1000,

		secretsHelpers: {
			async update() {},
			async waitForInit() {},
			getSecret: () => undefined,
			hasSecret: () => false,
			hasProvider: () => false,
			listProviders: () => [],
			listSecrets: () => [],
		} as IWorkflowExecuteAdditionalData['secretsHelpers'],
	};
}
