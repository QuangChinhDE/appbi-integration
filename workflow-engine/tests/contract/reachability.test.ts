/**
 * Which dependencies the runtime actually loads.
 *
 * `npm audit` answers "is it in the dependency tree". For a runtime that loads
 * six of `n8n-nodes-base`'s several hundred nodes that is the wrong question,
 * and answering it produces 29 findings that nobody can act on.
 *
 * This answers the one that decides triage: after booting the engine the way
 * the server boots it and executing a real workflow, what is in the module
 * cache? The answer is written to `reachability.json`, and `scripts/sbom.py`
 * builds the VEX from that file — so every `not affected` claim in a release
 * artefact traces back to a measurement in a test that runs on every build,
 * rather than to a list somebody maintained by hand and stopped updating.
 *
 * Anything absent from the file is reported as `in_triage` and treated as
 * affected, which is the only honest default: a VEX that guesses is worse than
 * no VEX.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { initN8nLogger } from '../../src/logger';
import { registerBinaryDataService } from '../../src/runtime/binary-data';
import { installEgressGuard } from '../../src/runtime/egress-guard';
import { startExecution } from '../../src/runtime/execution-manager';
import { createApp } from '../../src/server';
import { link, node, request, waitForTerminal } from '../helpers';

/**
 * Every package `npm audit --omit=dev` currently flags, plus the ones the
 * engine depends on directly.
 *
 * Listed rather than derived from `npm audit` at test time: the test must not
 * need the network, and a fixed list makes an addition somebody has to notice
 * rather than a silent change in what is measured.
 */
const AUDITED = [
  // n8n's own
  'n8n-core', 'n8n-workflow', 'n8n-nodes-base', '@n8n/client-oauth2',
  '@n8n/tournament',
  // reached through NodeExecuteFunctions, or the engine's own server
  'axios', 'express', 'path-to-regexp', 'body-parser', 'qs', 'uuid',
  'form-data',
  // database drivers for uncertified nodes
  'mysql2', 'pg-promise', 'mssql', 'tedious', 'snowflake-sdk', 'ldapts',
  // cloud SDKs for uncertified nodes
  '@azure/identity', '@azure/storage-blob', '@azure/core-http',
  '@azure/msal-node', '@google-cloud/storage', 'gaxios', 'teeny-request',
  'retry-request',
  // format and protocol handlers for uncertified nodes
  'xlsx', 'pdfjs-dist', 'nodemailer', 'imap', 'imap-simple', 'utf7', 'toml',
  'fast-xml-parser', 'file-type', 'showdown', 'minifaker', 'simple-git',
  'semver',
] as const;

function loaded(): Set<string> {
  const req = createRequire(join(process.cwd(), 'noop.js'));
  const cache = (req as unknown as { cache?: Record<string, unknown> }).cache;
  const hit = new Set<string>();
  for (const key of Object.keys(cache ?? {})) {
    const norm = key.split('\\').join('/');
    for (const name of AUDITED) {
      if (norm.includes(`/node_modules/${name}/`)) hit.add(name);
    }
  }
  return hit;
}

beforeAll(async () => {
  initN8nLogger();
  await registerBinaryDataService();
  installEgressGuard({ allow_private_networks: true });
});

describe('dependency reachability', () => {
  it('records what a real execution pulls into the process', async () => {
    // An HTTP step, because that is the busiest path in the product and the
    // one that reaches furthest into n8n's own helpers.
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

    // Build the HTTP app as well as running a workflow.
    //
    // The engine is a server, and `express` and its router are loaded the
    // moment it is constructed -- not by executing a graph. Measuring only the
    // execution path marked them unreachable and would have put three
    // genuinely reachable packages in the VEX as `not affected`, which is the
    // one kind of mistake a VEX must not make. `createApp` builds the app
    // without listening, which is all the module cache needs to see.
    createApp();

    const { ref } = startExecution(request(graph));
    const status = await waitForTerminal(ref);
    // Without a completed run the measurement means nothing: an empty module
    // cache would mark everything unreachable and produce a VEX that clears
    // the whole tree.
    expect(status.status).toBe('SUCCEEDED');

    const reachable = [...loaded()].sort();
    const unreachable = AUDITED.filter((name) => !reachable.includes(name)).sort();

    writeFileSync(
      join(process.cwd(), 'reachability.json'),
      `${JSON.stringify({
        measuredAt: new Date().toISOString(),
        note: 'Written by tests/contract/reachability.test.ts. Consumed by '
          + 'scripts/sbom.py to build the VEX. Do not edit by hand.',
        reachable,
        unreachable,
      }, null, 2)}\n`,
      'utf-8',
    );

    console.log(`\n  reachable (${reachable.length}): ${reachable.join(', ')}`);
    console.log(`  unreachable (${unreachable.length}): ${unreachable.join(', ')}`);

    // The measurement has to say *something*, or the file is a rubber stamp.
    expect(reachable.length).toBeGreaterThan(0);
    expect(unreachable.length).toBeGreaterThan(0);
  }, 60_000);

  it('the certified allowlist is what makes most of them unreachable', () => {
    // The structural reason behind every `not affected` in the VEX. If the
    // engine ever starts loading nodes by directory, the claim collapses and
    // this is where it should be noticed.
    const loader = readLoaderSource();
    expect(loader).not.toMatch(/DirectoryLoader/);
    expect(loader).toMatch(/const ALLOWLIST/);
  });
});

function readLoaderSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs');
  return readFileSync(
    join(process.cwd(), 'src', 'nodes', 'registry-loader.ts'), 'utf-8');
}
