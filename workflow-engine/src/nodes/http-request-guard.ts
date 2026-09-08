/**
 * The URL check in front of HTTP Request (SRS 32.2, layer 1).
 *
 * Wraps the pinned node's `execute` rather than reimplementing it: the node's
 * behaviour is the thing we want from n8n, and only the destination needs
 * policing. Reading the parameter through `getNodeParameter` is what makes this
 * work for a URL assembled by an expression -- by then it is resolved.
 */

import type { IExecuteFunctions, INodeExecutionData, INodeType } from 'n8n-workflow';

import { assertUrlAllowed } from '../runtime/egress-guard';
import { currentScope } from '../runtime/execution-context';

export function withEgressGuard(node: INodeType): INodeType {
	const original = node.execute;
	if (!original) return node;

	const guarded: INodeType = Object.create(Object.getPrototypeOf(node));
	Object.assign(guarded, node);

	guarded.execute = async function (this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const policy = currentScope()?.egressPolicy ?? {};
		const items = this.getInputData();
		// Every item, not just the first: one URL per item is the normal case for
		// this node, and checking only item 0 would leave the rest unchecked.
		for (let index = 0; index < Math.max(items.length, 1); index += 1) {
			const url = this.getNodeParameter('url', index, '') as string;
			if (url) assertUrlAllowed(String(url), policy);
		}
		return (await original.call(this)) as INodeExecutionData[][];
	};

	return guarded;
}
