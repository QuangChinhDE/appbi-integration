/**
 * A deterministic HTTP service for the Wave 0C reference workflows.
 *
 * The reference workflows are the point of Wave 0: seven graphs a real
 * customer would build, assembled **through the UI** and actually run. Five of
 * them need a real HTTP endpoint that answers predictably, and the deployed
 * stack has no internet access, so this stands in for the partner API.
 *
 * It binds on the host and the engine container reaches it through
 * `host.docker.internal`. That address resolves to a ULA (`fd..`), which the
 * egress guard blocks by default and correctly so, which is why the reference
 * run brings the stack up with `EGRESS_ALLOW_PRIVATE_NETWORKS=true`. That is a
 * property of this test stack only: the production posture is asserted
 * separately by `backend/tests/test_deployment_manifests.py`, and nothing here
 * changes it.
 *
 * Every route is deterministic. A reference workflow that asserts "five items,
 * ids 1..5" must get the same answer on every run, or the assertion is about
 * the fixture rather than the product.
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.REFERENCE_ENDPOINT_PORT ?? 4599);

/** `n` rows, alternating tier, ids from 1. The shape the workflows assert. */
const rows = (n) =>
	Array.from({ length: n }, (_, i) => ({
		id: i + 1,
		name: `Khách hàng ${i + 1}`,
		tier: i % 3 === 0 ? 'vip' : 'basic',
		amount: (i + 1) * 100,
	}));

function send(res, status, body, headers = {}) {
	const payload = typeof body === 'string' ? body : JSON.stringify(body);
	res.writeHead(status, { 'content-type': 'application/json', ...headers });
	res.end(payload);
}

const server = createServer((req, res) => {
	const url = new URL(req.url, `http://localhost:${PORT}`);
	const path = url.pathname;

	// /list?n=5  -> a top-level array, which fans out one item per element
	if (path === '/list') {
		return send(res, 200, rows(Number(url.searchParams.get('n') ?? 5)));
	}

	// /item/:id -> one row, so a fan-out can be counted and paired
	const item = /^\/item\/(\d+)$/.exec(path);
	if (item) {
		const id = Number(item[1]);
		return send(res, 200, { id, detail: `chi tiết ${id}`, fetched: true });
	}

	// /status/:code -> any status on demand, for the failure journeys
	const status = /^\/status\/(\d{3})$/.exec(path);
	if (status) {
		const code = Number(status[1]);
		return send(res, code, { error: `deliberate ${code}` });
	}

	// /slow?ms=N -> holds the connection open, so a run can be caught in flight
	// and the engine killed underneath it (Wave 0D)
	if (path === '/slow') {
		const ms = Number(url.searchParams.get('ms') ?? 60000);
		setTimeout(() => send(res, 200, { slow: true, waited: ms }), ms);
		return;
	}

	// /empty -> a well-formed empty list, for the "nothing to do today" journey
	if (path === '/empty') return send(res, 200, []);

	// /secured -> 401 unless the bearer token is the expected one, so a
	// credential can be fixed and the retry can be seen to work
	if (path === '/secured') {
		const auth = req.headers.authorization ?? '';
		if (auth === 'Bearer wave0-correct-token') {
			return send(res, 200, { authorised: true, id: 1 });
		}
		return send(res, 401, { error: 'bad token' });
	}

	return send(res, 404, { error: 'no such route' });
});

server.listen(PORT, '0.0.0.0', () => {
	// eslint-disable-next-line no-console
	console.log(`reference endpoint listening on 0.0.0.0:${PORT}`);
});
