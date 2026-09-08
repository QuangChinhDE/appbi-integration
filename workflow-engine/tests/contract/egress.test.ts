/**
 * SSRF controls (SRS 32.2, release DoD "SSRF test for HTTP Request").
 *
 * The URL layer is tested directly because it is a pure function of a URL and a
 * policy, and because the alternative — asserting that a request to the cloud
 * metadata endpoint did not happen — is a test that passes for the wrong reason
 * on a machine with no network.
 */

import { describe, expect, it } from 'vitest';

import { assertUrlAllowed, EgressBlockedError } from '../../src/runtime/egress-guard';

const OPEN = { allow_private_networks: true };
const CLOSED = { allow_private_networks: false };

describe('egress URL policy', () => {
	it('blocks the cloud metadata endpoint even when private networks are allowed', () => {
		// The one rule no configuration relaxes: allowing internal traffic is not
		// agreeing to expose the instance's own IAM credentials.
		for (const url of [
			'http://169.254.169.254/latest/meta-data/',
			'http://169.254.169.254',
			'http://100.100.100.200/',
		]) {
			expect(() => assertUrlAllowed(url, OPEN)).toThrow(EgressBlockedError);
		}
	});

	it('blocks an IPv4-mapped IPv6 form of a private address', () => {
		// Same destination, different notation. Reading this as "not IPv4" is how
		// the control gets bypassed.
		expect(() => assertUrlAllowed('http://[::ffff:10.0.0.5]/', CLOSED)).toThrow(
			EgressBlockedError,
		);
	});

	it('blocks private ranges, loopback and localhost by default', () => {
		for (const url of [
			'http://127.0.0.1:8080/x',
			'http://localhost:3000/x',
			'http://10.1.2.3/x',
			'http://172.16.0.9/x',
			'http://192.168.1.1/x',
			'http://100.64.0.1/x',
			'http://[::1]:9000/x',
			'http://[fd00::1]/x',
		]) {
			expect(() => assertUrlAllowed(url, CLOSED)).toThrow(EgressBlockedError);
		}
	});

	it('allows those same addresses when the deployment opts in', () => {
		for (const url of ['http://127.0.0.1:8080/x', 'http://10.1.2.3/x', 'http://[::1]/x']) {
			expect(() => assertUrlAllowed(url, OPEN)).not.toThrow();
		}
	});

	it('allows ordinary public hosts', () => {
		for (const url of ['https://api.example.com/v1/x', 'http://example.org']) {
			expect(() => assertUrlAllowed(url, CLOSED)).not.toThrow();
		}
	});

	it('refuses protocols other than http and https', () => {
		for (const url of [
			'file:///etc/passwd',
			'ftp://example.com/x',
			'gopher://example.com/',
			'data:text/plain,hello',
		]) {
			expect(() => assertUrlAllowed(url, OPEN)).toThrow(EgressBlockedError);
		}
	});

	it('honours a per-workspace blocklist and allowlist', () => {
		expect(() =>
			assertUrlAllowed('https://internal.corp.example/x', {
				blocked_hosts: ['corp.example'],
			}),
		).toThrow(EgressBlockedError);

		// An allowlist is exclusive: anything not on it is refused, which is the
		// only useful meaning for an allowlist.
		expect(() =>
			assertUrlAllowed('https://api.other.com/x', { allowed_hosts: ['api.example.com'] }),
		).toThrow(EgressBlockedError);
		expect(() =>
			assertUrlAllowed('https://api.example.com/x', { allowed_hosts: ['api.example.com'] }),
		).not.toThrow();
		// A subdomain of an allowed host is allowed; a lookalike suffix is not.
		expect(() =>
			assertUrlAllowed('https://eu.api.example.com/x', { allowed_hosts: ['api.example.com'] }),
		).not.toThrow();
		expect(() =>
			assertUrlAllowed('https://notapi.example.com/x', { allowed_hosts: ['api.example.com'] }),
		).toThrow(EgressBlockedError);
	});

	it('refuses a malformed URL rather than letting the node try it', () => {
		expect(() => assertUrlAllowed('not a url', OPEN)).toThrow(EgressBlockedError);
		expect(() => assertUrlAllowed('', OPEN)).toThrow(EgressBlockedError);
	});
});
