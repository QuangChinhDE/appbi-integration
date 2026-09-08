/**
 * Phase A go/no-go probe (SRS 26.5, appendix G).
 *
 * The one question this answers: can `WorkflowExecute` from the pinned n8n-core
 * run a real graph with real nodes-base nodes, without dragging in the n8n CLI,
 * its database or its editor?
 *
 * Kept as a script rather than folded into the contract suite because its job
 * is to be run by a human deciding whether the architecture holds, and to be
 * quotable in the ADR when it does.
 *
 *   npm run spike
 */

import { LoggerProxy, Workflow } from 'n8n-workflow';
import type {
	ICredentialDataDecryptedObject,
	ICredentialsHelper,
	IHttpRequestOptions,
	INode,
	INodeType,
	INodeTypes,
	IVersionedNodeType,
	IWorkflowExecuteAdditionalData,
} from 'n8n-workflow';
import { WorkflowExecute } from 'n8n-core';

// ── the node registry, allowlisted by hand ─────────────────────────────────
// Loading nodes-base's directory loader would register 400 integrations. The
// product exposes eight nodes, so the engine loads eight classes.
function loadNodeTypes(): INodeTypes {
	/* eslint-disable @typescript-eslint/no-var-requires */
	const { Set: SetNode } = require('n8n-nodes-base/dist/nodes/Set/Set.node.js');
	const { If: IfNode } = require('n8n-nodes-base/dist/nodes/If/If.node.js');
	const { Switch: SwitchNode } = require('n8n-nodes-base/dist/nodes/Switch/Switch.node.js');
	const { Merge: MergeNode } = require('n8n-nodes-base/dist/nodes/Merge/Merge.node.js');
	const {
		HttpRequest: HttpRequestNode,
	} = require('n8n-nodes-base/dist/nodes/HttpRequest/HttpRequest.node.js');

	const start: INodeType = {
		description: {
			displayName: 'AppBI Start',
			name: 'appbi.start',
			group: ['trigger'],
			version: 1,
			description: 'Product-owned start node. Emits the payload the product supplied.',
			defaults: { name: 'Start' },
			inputs: [],
			outputs: ['main'],
			properties: [],
		},
		async execute(this: any) {
			// A pass-through. The payload is seeded into the execution stack
			// before the run starts (see `main`), which is how n8n itself injects
			// webhook data -- it keeps an arbitrarily large body out of node
			// parameters and away from the expression resolver.
			return [this.getInputData()];
		},
	};

	const registry = new Map<string, INodeType | IVersionedNodeType>([
		['appbi.start', start],
		['n8n-nodes-base.set', new SetNode()],
		['n8n-nodes-base.if', new IfNode()],
		['n8n-nodes-base.switch', new SwitchNode()],
		['n8n-nodes-base.merge', new MergeNode()],
		['n8n-nodes-base.httpRequest', new HttpRequestNode()],
	]);

	return {
		getByName(type: string) {
			const found = registry.get(type);
			if (!found) throw new Error(`node type not allowlisted: ${type}`);
			return found;
		},
		getByNameAndVersion(type: string, version?: number) {
			const found = registry.get(type);
			if (!found) throw new Error(`node type not allowlisted: ${type}`);
			if ('nodeVersions' in found) {
				const wanted = version ?? found.currentVersion;
				const impl = found.nodeVersions[wanted as number];
				if (!impl) {
					throw new Error(`node ${type} has no version ${wanted}`);
				}
				return impl;
			}
			return found as INodeType;
		},
	};
}

// ── credentials: resolved by the product, never read from a database ───────
class ProbeCredentialsHelper implements ICredentialsHelper {
	getParentTypes(): string[] {
		return [];
	}

	async getCredentials(): Promise<any> {
		throw new Error('not used on the execution path');
	}

	async getDecrypted(): Promise<ICredentialDataDecryptedObject> {
		return { user: 'demo', password: 'demo' };
	}

	async preAuthentication(): Promise<undefined> {
		return undefined;
	}

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		typeName: string,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		if (typeName === 'httpBasicAuth') {
			requestOptions.auth = {
				username: String(credentials.user ?? ''),
				password: String(credentials.password ?? ''),
			};
		}
		return requestOptions;
	}

	async updateCredentials(): Promise<void> {
		/* the engine never writes a credential back */
	}
}

function additionalData(): IWorkflowExecuteAdditionalData {
	return {
		credentialsHelper: new ProbeCredentialsHelper(),
		executeWorkflow: async () => {
			// Sub-workflows are out of scope for V1 (ADR: SRS 72). Failing loudly
			// beats a silent no-op that looks like an empty result.
			throw new Error('sub-workflow execution is disabled');
		},
		restApiUrl: '',
		instanceBaseUrl: '',
		webhookBaseUrl: '',
		webhookWaitingBaseUrl: '',
		webhookTestBaseUrl: '',
		timezone: 'Asia/Bangkok',
		userId: 'engine',
		variables: {},
		secretsHelpers: {
			async update() {},
			async waitForInit() {},
			getSecret: () => undefined,
			hasSecret: () => false,
			hasProvider: () => false,
			listProviders: () => [],
			listSecrets: () => [],
		} as any,
	};
}

function node(partial: Partial<INode> & { name: string; type: string }): INode {
	return {
		id: partial.name,
		name: partial.name,
		type: partial.type,
		typeVersion: partial.typeVersion ?? 1,
		position: partial.position ?? [0, 0],
		parameters: partial.parameters ?? {},
		...(partial.credentials ? { credentials: partial.credentials } : {}),
	} as INode;
}

async function main() {
	// n8n's runtime logs through a module-level proxy that throws until it is
	// initialised. Nothing in the product wants n8n's log lines, so they go to a
	// sink; the engine's own structured logging is separate.
	LoggerProxy.init({
		log: () => {},
		debug: () => {},
		verbose: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
	});

	const nodeTypes = loadNodeTypes();

	const nodes: INode[] = [
		node({ name: 'Start', type: 'appbi.start', typeVersion: 1 }),
		node({
			name: 'Edit Fields',
			type: 'n8n-nodes-base.set',
			typeVersion: 3.2,
			parameters: {
				mode: 'manual',
				include: 'all',
				fields: {
					values: [
						{ name: 'label', type: 'stringValue', stringValue: '={{ $json.status }}-tier' },
						{ name: 'doubled', type: 'stringValue', stringValue: '={{ $json.amount * 2 }}' },
					],
				},
			},
		}),
		node({
			name: 'Check tier',
			type: 'n8n-nodes-base.if',
			typeVersion: 1,
			parameters: {
				combineOperation: 'all',
				conditions: {
					string: [{ value1: '={{ $json.status }}', operation: 'equal', value2: 'vip' }],
				},
			},
		}),
		node({
			name: 'Mark VIP',
			type: 'n8n-nodes-base.set',
			typeVersion: 3.2,
			parameters: {
				mode: 'manual',
				include: 'all',
				fields: { values: [{ name: 'tier', type: 'stringValue', stringValue: 'VIP' }] },
			},
		}),
		node({
			name: 'Mark Basic',
			type: 'n8n-nodes-base.set',
			typeVersion: 3.2,
			parameters: {
				mode: 'manual',
				include: 'all',
				fields: { values: [{ name: 'tier', type: 'stringValue', stringValue: 'BASIC' }] },
			},
		}),
	];

	const workflow = new Workflow({
		id: 'probe',
		name: 'probe',
		nodes,
		connections: {
			Start: { main: [[{ node: 'Edit Fields', type: 'main', index: 0 }]] },
			'Edit Fields': { main: [[{ node: 'Check tier', type: 'main', index: 0 }]] },
			'Check tier': {
				main: [
					[{ node: 'Mark VIP', type: 'main', index: 0 }],
					[{ node: 'Mark Basic', type: 'main', index: 0 }],
				],
			},
		},
		active: false,
		nodeTypes,
		settings: {},
	});

	const startPayload = [
		{ status: 'vip', amount: 120 },
		{ status: 'basic', amount: 5 },
	];

	// Seed the stack with the start node and its input, then drive the engine
	// directly. `run()` would call `workflow.getStartNode()`, which looks for
	// n8n's own trigger types -- the product's start node is deliberately not
	// one of them (ADR-004).
	const execute = new WorkflowExecute(additionalData(), 'manual', {
		startData: {},
		resultData: { runData: {} },
		executionData: {
			contextData: {},
			nodeExecutionStack: [
				{
					node: workflow.getNode('Start')!,
					data: { main: [startPayload.map((json) => ({ json }))] },
					source: null,
				},
			],
			metadata: {},
			waitingExecution: {},
			waitingExecutionSource: {},
		},
	});
	const run = await execute.processRunExecutionData(workflow);

	console.log('\n=== PROBE RESULT ===');
	console.log('finished:', run.finished, 'status:', (run as any).status);
	console.log('error:', run.data.resultData.error?.message ?? null);
	for (const [name, tasks] of Object.entries(run.data.resultData.runData)) {
		for (const task of tasks) {
			const items = task.data?.main?.flatMap((branch) => branch ?? []) ?? [];
			console.log(
				`  ${name}: ${task.error ? 'FAILED ' + task.error.message : 'ok'} ` +
					`items=${items.length} ${JSON.stringify(items.map((i) => i.json)).slice(0, 220)}`,
			);
		}
	}
}

main().catch((error) => {
	console.error('PROBE FAILED:', error);
	process.exit(1);
});
