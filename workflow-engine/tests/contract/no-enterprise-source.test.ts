/**
 * No Enterprise-licensed n8n source is loaded by the runtime.
 *
 * n8n ships under the Sustainable Use License, except source files whose name
 * contains `.ee.`, which require an n8n Enterprise License. `compatibility.yaml`
 * declares the product does not use any, and ADR-015 states the policy.
 *
 * That declaration was false, and no test could see it. `n8n-core`'s entry
 * point (`dist/index.js`) *statically* re-exports
 * `ObjectStore/ObjectStore.service.ee`, so `import { WorkflowExecute } from
 * 'n8n-core'` loaded Enterprise source into every engine process. Reading the
 * code suggested otherwise: the only reference to the ObjectStore inside
 * `BinaryData.service.init` is behind `if (availableModes.includes('s3'))`,
 * and the engine passes `['default']`. The guard is real and irrelevant --
 * the barrel file has already loaded the module by the time `init` runs.
 *
 * So the check cannot be a grep over our own imports, and cannot be an
 * argument about which branch runs. It has to be a measurement of what the
 * process actually loaded, after doing the thing that would load it.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { initN8nLogger } from '../../src/logger';
import { registerBinaryDataService } from '../../src/runtime/binary-data';
import { installEgressGuard } from '../../src/runtime/egress-guard';
import { startExecution } from '../../src/runtime/execution-manager';
import { link, node, request, waitForTerminal } from '../helpers';

/**
 * Modules in this process whose path marks them Enterprise-licensed.
 *
 * n8n's own licence names two forms: `.ee.` in a filename and `.ee` as a
 * directory name. Both are matched, so a future n8n version that moves the
 * ObjectStore into `ObjectStore/.ee/` does not silently pass.
 */
function enterpriseModules(): string[] {
  // Rooted at the project rather than at `import.meta.url`, which this
  // tsconfig's module setting does not permit. The CommonJS module cache is
  // process-global, so any require instance sees the same entries.
  const req = createRequire(join(process.cwd(), 'noop.js'));
  const cache = (req as unknown as { cache?: Record<string, unknown> }).cache;
  return Object.keys(cache ?? {})
    .map((key) => key.split('\\').join('/'))
    .filter((key) => key.includes('.ee.') || key.includes('/.ee/'))
    .map((key) => key.slice(key.lastIndexOf('node_modules/')));
}

beforeAll(async () => {
  initN8nLogger();
  await registerBinaryDataService();
  installEgressGuard({ allow_private_networks: true });
});

describe('enterprise-licensed source', () => {
  it('is absent after the runtime has executed a real workflow', async () => {
    // An HTTP step, deliberately: `HttpRequest` calls `helpers.binaryToBuffer`
    // on every response it reads, so this is the path that reaches
    // BinaryDataService and therefore the ObjectStore, if anything does.
    const graph = {
      nodes: [
        node('start_1', 'manual_trigger', 'Bắt đầu'),
        node('http_1', 'http_request', 'Gọi API', {
          method: 'GET',
          url: 'https://jsonplaceholder.typicode.com/todos/1',
          response_format: 'json',
        }),
      ],
      connections: [link('start_1', 'http_1')],
    };

    const { ref } = startExecution(request(graph));
    const status = await waitForTerminal(ref);

    // If the run did not happen, the absence of the module proves nothing.
    expect(status.status).toBe('SUCCEEDED');
    expect(enterpriseModules()).toEqual([]);
  }, 60_000);

  it('stays absent when the engine boots without running anything', () => {
    // The import graph alone must be clean: a deployment that starts and
    // serves no traffic has still loaded whatever the entry points pull in,
    // and that is the state most of the fleet is in most of the time.
    expect(enterpriseModules()).toEqual([]);
  });
});
