/**
 * The product's start node (SRS 25.3).
 *
 * Manual, webhook and schedule triggers all compile to this one node. The
 * product decides when a workflow runs and what payload it starts with
 * (ADR-004, ADR-005); by the time the engine is involved, triggering has
 * already happened. So this node waits for nothing, polls nothing and listens
 * on nothing — it hands its seeded input to the rest of the graph.
 *
 * Not `n8n-nodes-base.manualTrigger`: that type carries n8n's own trigger
 * semantics, and a graph the product compiled would then be one edit away from
 * depending on them.
 */

import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';

export const PRODUCT_START_NODE_TYPE = 'appbi.start';
export const PRODUCT_START_NODE_VERSION = 1;

export class ProductStartNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AppBI Start',
		name: PRODUCT_START_NODE_TYPE,
		group: ['trigger'],
		version: PRODUCT_START_NODE_VERSION,
		description: 'Product-owned start. Emits the payload the product supplied.',
		defaults: { name: 'Start', color: '#5E6AD2' },
		inputs: [],
		outputs: ['main'],
		properties: [
			{
				// Present so the trigger kind is visible when debugging a compiled
				// graph. It is metadata: the node's behaviour does not branch on it.
				displayName: 'Trigger Type',
				name: 'triggerType',
				type: 'string',
				default: 'MANUAL',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// The payload is seeded into the execution stack before the run starts
		// (see runtime/execution-manager.ts). Passing it through here rather than
		// through a node parameter keeps an arbitrarily large webhook body out of
		// the expression resolver.
		const input = this.getInputData();
		if (input.length > 0) return [input];
		// A run started with no payload still has to produce one item, or every
		// node downstream receives an empty input and does nothing -- which looks
		// like a broken workflow rather than an empty trigger.
		return [[{ json: {} }]];
	}
}
