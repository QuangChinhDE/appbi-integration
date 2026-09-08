import { defineConfig } from 'vitest/config';

export default defineConfig({
	// The pinned n8n packages declare an `import` condition pointing at
	// `src/index.ts`, which they do not ship -- only `dist` is published. Vite's
	// ESM resolution therefore finds nothing. Pinning the resolver to the
	// `require` condition (and keeping the packages external) makes the test run
	// load exactly the CommonJS build the engine loads in production, which is
	// also what a contract test should be exercising.
	resolve: { conditions: ['require', 'node', 'default'] },
	ssr: {
		resolve: {
			conditions: ['require', 'node', 'default'],
			externalConditions: ['require', 'node', 'default'],
		},
	},
	test: {
		include: ['tests/**/*.test.ts'],
		// A real n8n runtime and real HTTP requests are not fast.
		testTimeout: 30_000,
		hookTimeout: 30_000,
		// Serial by design: the execution manager and the DNS guard are
		// process-wide, so parallel files would fight over both.
		fileParallelism: false,
		pool: 'forks',
		server: { deps: { external: [/n8n-workflow/, /n8n-core/, /n8n-nodes-base/] } },
	},
});
