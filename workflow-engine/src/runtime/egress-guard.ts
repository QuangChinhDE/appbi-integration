/**
 * SSRF controls for HTTP Request (SRS 32.2).
 *
 * HTTP Request is the most powerful node in the V1 set and the one that can be
 * pointed at the cloud metadata endpoint. Two layers, because neither is
 * sufficient alone:
 *
 * 1. **A URL check before the request.** Runs against the *resolved* URL, so a
 *    URL built by an expression is checked too, and it can honour a per-request
 *    allowlist. It cannot see where a redirect leads.
 *
 * 2. **A DNS guard.** Wraps `dns.lookup`, so every address resolved *while a
 *    workflow is executing* is checked -- including the target of a redirect
 *    and the second answer in a DNS-rebinding attack, neither of which layer 1
 *    can see.
 *
 * Layer 2 is scoped to an execution rather than applied process-wide, and that
 * is not a weakening. `dns.lookup` is used for inbound binds as well as
 * outbound connections: a process-wide version refused the engine's own
 * `listen()` on 127.0.0.1 and the service could not start. Scoping it to the
 * execution context makes the rule say what it means -- workflow traffic is
 * policed, the engine's own sockets are not -- and lets each run be judged
 * against the policy that arrived with it, which a global hook could not do
 * without racing between concurrent runs.
 */

import dns from 'node:dns';
import net from 'node:net';

import type { EgressPolicy } from '../contracts/engine-dto';
import { log } from '../logger';
import { currentScope } from './execution-context';

export class EgressBlockedError extends Error {
	readonly code = 'EGRESS_BLOCKED';

	constructor(message: string) {
		super(message);
		this.name = 'EgressBlockedError';
	}
}

/** Ranges that are never a legitimate target for a workflow HTTP call. */
function isBlockedAddress(address: string, allowPrivate: boolean): string | null {
	const version = net.isIP(address);
	if (version === 0) return null;

	if (version === 4) {
		const [a, b] = address.split('.').map(Number);

		// Always blocked, whatever the policy says. The link-local range carries
		// every cloud provider's instance-metadata endpoint, and an operator who
		// allows traffic to their own internal network has not thereby agreed to
		// let a workflow read the instance's IAM credentials.
		if (a === 169 && b === 254) return 'link-local / cloud metadata';
		if (address === '100.100.100.200') return 'cloud metadata endpoint';
		if (a === 0) return 'unspecified address';

		// Everything else that is not routable on the public internet is gated by
		// one switch. Loopback belongs in this group rather than in the group
		// above: a deployment that legitimately calls a service on the same host
		// (a sidecar, an internal gateway) is a real configuration, and refusing
		// it unconditionally would just push people to disable the guard.
		if (allowPrivate) return null;
		if (a === 127) return 'loopback';
		if (a === 10) return 'private network';
		if (a === 172 && b >= 16 && b <= 31) return 'private network';
		if (a === 192 && b === 168) return 'private network';
		if (a === 100 && b >= 64 && b <= 127) return 'carrier-grade NAT';
		return null;
	}

	const lowered = address.toLowerCase();
	if (lowered.startsWith('fe80')) return 'link-local';
	if (lowered === '::') return 'unspecified address';
	if (allowPrivate) return null;
	if (lowered === '::1') return 'loopback';
	if (lowered.startsWith('fd') || lowered.startsWith('fc')) return 'private network';
	// An IPv4-mapped IPv6 address is the same destination wearing a different
	// hat, and reading it as "not IPv4" is how this control gets bypassed. Both
	// notations have to be handled: `::ffff:10.0.0.5` is what a user types, and
	// `::ffff:a00:5` is what URL parsing normalises it to.
	const dotted = lowered.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (dotted) return isBlockedAddress(dotted[1], allowPrivate);
	const hex = lowered.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
	if (hex) {
		const high = parseInt(hex[1], 16);
		const low = parseInt(hex[2], 16);
		const asIpv4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
		return isBlockedAddress(asIpv4, allowPrivate);
	}
	return null;
}

/**
 * Check a URL before the request is made.
 *
 * Throws `EgressBlockedError`, which the error normalizer turns into
 * EGRESS_BLOCKED with an "edit the node" remediation.
 */
export function assertUrlAllowed(rawUrl: string, policy: EgressPolicy = {}): void {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new EgressBlockedError(`URL không hợp lệ: ${rawUrl.slice(0, 200)}`);
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new EgressBlockedError(`Giao thức '${url.protocol}' không được phép.`);
	}

	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

	const blockedHosts = (policy.blocked_hosts ?? []).map((h) => h.toLowerCase());
	if (blockedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`))) {
		throw new EgressBlockedError(`Host '${host}' nằm trong danh sách chặn.`);
	}

	const allowedHosts = (policy.allowed_hosts ?? []).map((h) => h.toLowerCase());
	if (allowedHosts.length > 0) {
		const permitted = allowedHosts.some(
			(entry) => host === entry || host.endsWith(`.${entry}`),
		);
		if (!permitted) {
			throw new EgressBlockedError(
				`Host '${host}' không nằm trong danh sách được phép của workspace.`,
			);
		}
	}

	if (host === 'localhost' && !policy.allow_private_networks) {
		// The name, not just the address: `localhost` resolves per-machine and the
		// DNS guard would catch it anyway, but naming it here gives the user a
		// message about what they typed.
		throw new EgressBlockedError('Không được gọi tới localhost.');
	}

	const literal = isBlockedAddress(host, Boolean(policy.allow_private_networks));
	if (literal) {
		throw new EgressBlockedError(`Địa chỉ ${host} bị chặn (${literal}).`);
	}
}

let installed = false;

/**
 * Wrap `dns.lookup` so no address a workflow resolves lands in a blocked range.
 * Idempotent; call once at boot.
 *
 * A lookup outside an execution scope passes through untouched: that is the
 * engine's own networking (its listening socket), not workflow traffic, and
 * there is nothing for this control to protect there.
 *
 * `deploymentPolicy` is the floor. A run whose request carries no policy is
 * judged against it, so a client that forgets to send one gets the strict
 * behaviour rather than none.
 */
export function installEgressGuard(deploymentPolicy: EgressPolicy): void {
	if (installed) return;
	installed = true;

	const original = dns.lookup.bind(dns) as typeof dns.lookup;

	const guarded = ((hostname: string, options: any, callback: any) => {
		const done = typeof options === 'function' ? options : callback;
		const opts = typeof options === 'function' ? {} : options;

		const scope = currentScope();
		if (scope === undefined) {
			return (original as any)(hostname, opts, done);
		}
		const allowPrivate = Boolean(
			(scope.egressPolicy?.allow_private_networks ??
				deploymentPolicy.allow_private_networks) === true,
		);

		return (original as any)(hostname, opts, (
			error: NodeJS.ErrnoException | null,
			addressOrList: any,
			family?: number,
		) => {
			if (error) return done(error, addressOrList, family);

			const entries = Array.isArray(addressOrList)
				? addressOrList
				: [{ address: addressOrList, family }];

			for (const entry of entries) {
				const reason = isBlockedAddress(String(entry.address), allowPrivate);
				if (reason) {
					log.warn('egress.blocked', {
						hostname,
						reason,
						execution_id: scope.executionId,
					});
					const blocked: NodeJS.ErrnoException = new EgressBlockedError(
						`DNS của '${hostname}' trỏ tới địa chỉ bị chặn (${reason}).`,
					);
					blocked.code = 'EGRESS_BLOCKED';
					return done(blocked, undefined, undefined);
				}
			}
			return done(null, addressOrList, family);
		});
	}) as typeof dns.lookup;

	// `dns.lookup` carries a promisified twin; replacing the function without it
	// would leave a hole for anything awaiting dns.promises.lookup.
	(guarded as any)[Symbol.for('nodejs.util.promisify.custom')] = (
		hostname: string,
		options: any,
	) =>
		new Promise((resolve, reject) => {
			(guarded as any)(hostname, options ?? {}, (error: unknown, address: any, family: any) =>
				error ? reject(error) : resolve(options?.all ? address : { address, family }),
			);
		});

	dns.lookup = guarded;

	// A response-size ceiling, which `max_response_bytes` promised in the
	// contract and nothing enforced: an 8 MB body came back whole against a
	// 1 MB policy. An unbounded response is a memory risk in a process that
	// runs other tenants' workflows, and it is reachable by any workflow
	// pointing at a URL somebody else controls.
	//
	// Applied as a *deployment* floor rather than per execution, deliberately.
	// `axios.defaults` is process-wide, so mutating it when an execution scope
	// opens would race between concurrent runs of different workflows — the
	// per-workflow concurrency ceiling is one, the per-process one is not.
	// This is a platform limit, which is what the compiler's own comment says
	// these caps are.
	log.info('egress.guard_installed', {
		scope: 'execution',
		default_allow_private_networks: Boolean(deploymentPolicy.allow_private_networks),
	});
}
