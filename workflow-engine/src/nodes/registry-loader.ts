/**
 * The allowlisted node runtime (SRS 26.1, 32.4).
 *
 * nodes-base ships several hundred integrations and a directory loader that
 * registers all of them. This engine loads exactly the classes the product has
 * certified, by requiring the individual compiled node files. Two consequences,
 * both wanted:
 *
 * * a graph naming an uncertified node cannot execute even if it got past the
 *   product's own check — the allowlist is enforced twice, deliberately;
 * * the process does not pull several hundred node modules (and their transitive
 *   SDKs) into memory to run five of them.
 *
 * Adding a node here is a certification decision, not an import.
 */

import type { INodeType, INodeTypes, IVersionedNodeType } from 'n8n-workflow';

import { log } from '../logger';
import { withEgressGuard } from './http-request-guard';
import { PRODUCT_START_NODE_TYPE, ProductStartNode } from './product-start.node';

/* eslint-disable @typescript-eslint/no-var-requires */

/** engine node type -> the compiled class, and the versions we certified. */
interface AllowlistEntry {
	load: () => INodeType | IVersionedNodeType;
	certifiedVersions: number[];
}

const ALLOWLIST: Record<string, AllowlistEntry> = {
	[PRODUCT_START_NODE_TYPE]: {
		load: () => new ProductStartNode(),
		certifiedVersions: [1],
	},
	'n8n-nodes-base.set': {
		load: () => {
			const { Set: SetNode } = require('n8n-nodes-base/dist/nodes/Set/Set.node.js');
			return new SetNode();
		},
		// 3.2 is what the pinned 1.14.1 tree ships. Not "whatever is newest":
		// a node version is part of the compatibility contract (ADR-013).
		certifiedVersions: [3.2],
	},
	'n8n-nodes-base.if': {
		load: () => {
			const { If: IfNode } = require('n8n-nodes-base/dist/nodes/If/If.node.js');
			return new IfNode();
		},
		certifiedVersions: [1],
	},
	'n8n-nodes-base.filter': {
		load: () => {
			const { Filter: FilterNode } = require('n8n-nodes-base/dist/nodes/Filter/Filter.node.js');
			return new FilterNode();
		},
		// A plain node in the pinned tree, not a versioned one: `Filter` has a
		// single implementation at version 1 and no `nodeVersions` map.
		certifiedVersions: [1],
	},
	'n8n-nodes-base.switch': {
		load: () => {
			const { Switch: SwitchNode } = require('n8n-nodes-base/dist/nodes/Switch/Switch.node.js');
			return new SwitchNode();
		},
		certifiedVersions: [2],
	},
	'n8n-nodes-base.merge': {
		load: () => {
			const { Merge: MergeNode } = require('n8n-nodes-base/dist/nodes/Merge/Merge.node.js');
			return new MergeNode();
		},
		certifiedVersions: [2.1],
	},
	'n8n-nodes-base.httpRequest': {
		load: () => {
			const {
				HttpRequest: HttpRequestNode,
			} = require('n8n-nodes-base/dist/nodes/HttpRequest/HttpRequest.node.js');
			const versioned = new HttpRequestNode();
			// The egress check wraps each certified version's implementation, so
			// the guard cannot be skipped by a graph naming a different version.
			for (const version of Object.keys(versioned.nodeVersions)) {
				versioned.nodeVersions[version] = withEgressGuard(versioned.nodeVersions[version]);
			}
			return versioned;
		},
		certifiedVersions: [4.1],
	},
};

export class UnsupportedNodeError extends Error {
	readonly code = 'NODE_UNSUPPORTED';

	constructor(message: string) {
		super(message);
		this.name = 'UnsupportedNodeError';
	}
}

export class AllowlistedNodeTypes implements INodeTypes {
	private readonly loaded = new Map<string, INodeType | IVersionedNodeType>();

	constructor() {
		for (const [type, entry] of Object.entries(ALLOWLIST)) {
			try {
				this.loaded.set(type, entry.load());
			} catch (error) {
				// A node that will not load is a deployment fault, not a runtime
				// one. Recorded here so /healthz can report DEGRADED with the
				// missing type named, rather than the first execution failing with
				// a require error.
				log.error('node.load_failed', {
					engine_node_type: type,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		log.info('node.registry_loaded', { count: this.loaded.size });
	}

	get loadedTypes(): string[] {
		return [...this.loaded.keys()].sort();
	}

	get expectedTypes(): string[] {
		return Object.keys(ALLOWLIST).sort();
	}

	/** Whether every allowlisted node actually loaded. Drives DEGRADED health. */
	get complete(): boolean {
		return this.loaded.size === Object.keys(ALLOWLIST).length;
	}

	certifiedVersions(type: string): number[] {
		return ALLOWLIST[type]?.certifiedVersions ?? [];
	}

	isCertified(type: string, version: number): boolean {
		return this.certifiedVersions(type).includes(version);
	}

	getByName(nodeType: string): INodeType | IVersionedNodeType {
		const found = this.loaded.get(nodeType);
		if (!found) {
			throw new UnsupportedNodeError(`Node type is not allowlisted: ${nodeType}`);
		}
		return found;
	}

	getByNameAndVersion(nodeType: string, version?: number): INodeType {
		const found = this.getByName(nodeType);
		if (!('nodeVersions' in found)) {
			return found as INodeType;
		}
		const versioned = found as IVersionedNodeType;
		const wanted = version ?? versioned.currentVersion;
		const implementation = versioned.nodeVersions[wanted];
		if (!implementation) {
			throw new UnsupportedNodeError(
				`Node ${nodeType} has no version ${wanted} in the pinned package set`,
			);
		}
		return implementation;
	}
}

let singleton: AllowlistedNodeTypes | null = null;

export function nodeTypes(): AllowlistedNodeTypes {
	if (singleton === null) singleton = new AllowlistedNodeTypes();
	return singleton;
}
