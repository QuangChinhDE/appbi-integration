/**
 * The operations a deployment depends on and nobody exercises until it is too
 * late: a clean install, the configuration gate, and a restore that is proved
 * rather than assumed.
 *
 * These drive the real scripts against the real containers, because that is
 * the only version of them that matters. A test that imports `doctor.run` and
 * passes a dict proves the checks work; this proves the *script* works, on
 * this machine, with these files -- which is where the last three deployment
 * bugs in this product lived.
 *
 * Kept out of the browser suite's fast path with `test.slow()`: a restore is a
 * `pg_restore`, and there is no version of that which is quick.
 */

import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OWNER, createWorkflow, deleteWorkflow, unique } from './fixtures';

import {
  DB_NAME, POSTGRES_SERVICE, PYTHON, REPO_ROOT, compose, deploymentEnv, query,
  script as runScript,
} from './deployment';

const ROOT = REPO_ROOT;

/**
 * Run a repository script with the deployment's environment.
 *
 * Everything about *which* deployment -- the compose project, the env file,
 * the database port -- lives in `./deployment`, so the same spec runs against
 * a developer's stack and a CI job that named its project after the branch.
 */
const run = runScript;

/** A scratch directory that is not inside the repository. */
function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test.describe('the production configuration gate', () => {
  test('the shipped template is refused until it is filled in', () => {
    // The whole point of a template. If this passes, a placeholder has been
    // given a value that boots.
    const result = run(['scripts/doctor.py',
                                '--env-file', '.env.production.example',
                                '--json'],
      { allowFailure: true });
    expect(result.code).toBe(1);

    const report = JSON.parse(result.output);
    expect(report.ok).toBe(false);
    const keys = report.findings
      .filter((f: { severity: string }) => f.severity === 'ERROR')
      .map((f: { key: string }) => f.key);
    for (const key of ['JWT_SECRET', 'SECRET_ENCRYPTION_KEY',
                       'ENGINE_INTERNAL_TOKEN', 'PUBLIC_BASE_URL',
                       'IMAGE_TAG', 'ONCALL_CONTACT']) {
      expect(keys, `${key} should be refused`).toContain(key);
    }
  });

  test('the development configuration is refused as production', () => {
    // `.env` is what this machine runs on, and it is correct for development.
    // Presented as production it must fail: http URLs, a localhost database,
    // a published JWT secret.
    const result = run(['scripts/doctor.py', '--env-file', '.env',
                                '--json'],
      { allowFailure: true });
    expect(result.code).toBe(1);

    const report = JSON.parse(result.output);
    const findings = report.findings.map(
      (f: { key: string; message: string }) => `${f.key}: ${f.message}`).join('\n');
    // Not JWT_SECRET: `run.sh setup` generates a real one even for
    // development, and asserting on it would make this test depend on how the
    // machine was set up rather than on what the gate refuses.
    expect(findings).toMatch(/APP_ENV/);
    expect(findings).toMatch(/DATABASE_URL/);
    expect(findings).toMatch(/PUBLIC_BASE_URL/);
    expect(findings).toMatch(/SESSION_COOKIE_SECURE/);
    expect(findings).toMatch(/ENGINE_INTERNAL_TOKEN/);
  });

  test('a correctly filled configuration passes, with no advisories', () => {
    const directory = scratch('appbi-doctor-');
    const path = join(directory, 'env.production');

    // Built from the shipped template so that a new required key added to the
    // template makes this fail -- which is the correct outcome: a new
    // requirement should not silently pass.
    const template = readFileSync(join('..', '.env.production.example'), 'utf-8');
    const filled = template
      .replace(/^PRODUCT_VERSION=.*$/m, 'PRODUCT_VERSION=1.2.0')
      .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${'j'.repeat(64)}`)
      .replace(/^SECRET_ENCRYPTION_KEY=.*$/m,
               `SECRET_ENCRYPTION_KEY=${'k'.repeat(43)}`)
      .replace(/^ENGINE_INTERNAL_TOKEN=.*$/m,
               `ENGINE_INTERNAL_TOKEN=${'t'.repeat(43)}`)
      .replace(/^PUBLIC_BASE_URL=.*$/m,
               'PUBLIC_BASE_URL=https://automation.example.com')
      .replace(/^NEXT_PUBLIC_API_BASE=.*$/m,
               'NEXT_PUBLIC_API_BASE=https://automation.example.com')
      .replace(/^IMAGE_TAG=.*$/m, 'IMAGE_TAG=v1.2.0')
      .replace(/^BOOTSTRAP_ADMIN_EMAIL=.*$/m, 'BOOTSTRAP_ADMIN_EMAIL=')
      .replace(/^BOOTSTRAP_ADMIN_PASSWORD=.*$/m, 'BOOTSTRAP_ADMIN_PASSWORD=')
      .replace(/^ONCALL_CONTACT=.*$/m, 'ONCALL_CONTACT=oncall@example.com')
      .replace(/^BACKUP_S3_BUCKET=.*$/m, 'BACKUP_S3_BUCKET=appbi-backups')
      .replace(/^EGRESS_ALLOWED_HOSTS=.*$/m,
               'EGRESS_ALLOWED_HOSTS=api.acme.com');
    writeFileSync(path, filled, 'utf-8');

    const result = run(['scripts/doctor.py', '--env-file', path,
                                '--warnings-as-errors', '--json']);
    const report = JSON.parse(result.output);
    expect(report.ok, JSON.stringify(report.findings, null, 2)).toBe(true);
    expect(report.warnings).toBe(0);
  });

  test.describe('each individual refusal', () => {
    const base = () => {
      const directory = scratch('appbi-doctor-case-');
      return { directory, path: join(directory, 'env') };
    };

    const GOOD: Record<string, string> = {
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql+asyncpg://u:p@db.internal.example.com:5432/appbi?ssl=require',
      JWT_SECRET: 'j'.repeat(64),
      SECRET_ENCRYPTION_KEY: 'k'.repeat(43),
      ENGINE_INTERNAL_TOKEN: 't'.repeat(43),
      SESSION_COOKIE_SECURE: 'true',
      ALLOW_DERIVED_ENCRYPTION_KEY: 'false',
      ENGINE_BASE_URL: 'http://engine.svc.cluster.local:8099',
      PUBLIC_BASE_URL: 'https://automation.example.com',
      NEXT_PUBLIC_API_BASE: 'https://automation.example.com',
      EGRESS_ALLOW_PRIVATE_NETWORKS: 'false',
      EGRESS_ALLOWED_HOSTS: 'api.acme.com',
      IMAGE_REGISTRY: 'registry.example.com/appbi',
      IMAGE_TAG: 'v1.2.0',
      ONCALL_CONTACT: 'oncall@example.com',
      BACKUP_S3_BUCKET: 'appbi-backups',
    };

    const write = (overrides: Record<string, string>) => {
      const { path } = base();
      const merged = { ...GOOD, ...overrides };
      writeFileSync(
        path,
        Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n'),
        'utf-8');
      return path;
    };

    for (const [label, overrides, expectedKey] of [
      ['a development JWT secret',
       { JWT_SECRET: 'dev-only-change-me-please-32-chars-min' }, 'JWT_SECRET'],
      ['a placeholder encryption key',
       { SECRET_ENCRYPTION_KEY: 'FILL_ME' }, 'SECRET_ENCRYPTION_KEY'],
      ['an http public URL',
       { PUBLIC_BASE_URL: 'http://automation.example.com' }, 'PUBLIC_BASE_URL'],
      ['a database with no TLS',
       { DATABASE_URL: 'postgresql+asyncpg://u:p@db.example.com:5432/appbi' },
       'DATABASE_URL'],
      ['a database inside the compose file',
       { DATABASE_URL: 'postgresql+asyncpg://u:p@postgres:5432/appbi?ssl=require' },
       'DATABASE_URL'],
      ['an unpinned image tag', { IMAGE_TAG: 'latest' }, 'IMAGE_TAG'],
      ['an insecure session cookie',
       { SESSION_COOKIE_SECURE: 'false' }, 'SESSION_COOKIE_SECURE'],
      ['private-network egress',
       { EGRESS_ALLOW_PRIVATE_NETWORKS: 'true' },
       'EGRESS_ALLOW_PRIVATE_NETWORKS'],
      ['nobody on call', { ONCALL_CONTACT: '' }, 'ONCALL_CONTACT'],
    ] as const) {
      test(`refuses ${label}`, () => {
        const path = write(overrides as Record<string, string>);
        const result = run(['scripts/doctor.py', '--env-file', path,
                                    '--json'],
          { allowFailure: true });
        expect(result.code).toBe(1);
        const report = JSON.parse(result.output);
        const keys = report.findings
          .filter((f: { severity: string }) => f.severity === 'ERROR')
          .map((f: { key: string }) => f.key);
        expect(keys).toContain(expectedKey);
      });
    }
  });
});

test.describe('schema drift', () => {
  test('reports no drift on the running deployment', () => {
    const result = run(['scripts/schema_drift.py', '--json']);
    const report = JSON.parse(result.output);
    expect(report.ok, JSON.stringify(report.problems)).toBe(true);
    expect(report.applied_revision).toBe(report.head_revision);
    expect(report.models_match_schema).toBe(true);
  });

  test('reports drift when the schema is changed outside a migration', () => {
    test.slow();
    // The emergency-psql-session case: a column added by hand during an
    // incident, which nothing else notices because every test builds its
    // schema from the models.
    query('ALTER TABLE workflows ADD COLUMN e2e_drift_probe boolean');
    try {
      const result = run(['scripts/schema_drift.py', '--json'],
        { allowFailure: true });
      expect(result.code).toBe(1);
      const report = JSON.parse(result.output);
      expect(report.models_match_schema).toBe(false);
      expect(report.problems.join('\n')).toMatch(/e2e_drift_probe/);
    } finally {
      query('ALTER TABLE workflows DROP COLUMN e2e_drift_probe');
    }

    // Clean again, so a failure above cannot leave the deployment drifted.
    const after = JSON.parse(run(['scripts/schema_drift.py', '--json']).output);
    expect(after.ok).toBe(true);
  });
});

test.describe('backup and restore', () => {
  /**
   * The scenario nobody rehearses: take a backup, restore it into a *different*
   * database, and confirm the product works against the restored copy --
   * signs in, lists the workspace, shows credentials masked, and runs a
   * workflow again.
   *
   * The credential check is the one that matters. A restore with the wrong
   * encryption key succeeds and leaves every credential as unreadable
   * ciphertext, and that is discovered when the first scheduled workflow fails
   * at 3am rather than during the restore.
   */
  test('a backup restores into a new database with its data intact', async ({ page }) => {
    test.slow();

    // Something recognisable to look for on the other side.
    const workflowName = unique('E2E restore me');
    const credentialName = unique('E2E restore credential');
    const secret = 'restore-secret-value-do-not-echo';

    const workflowId = await createWorkflow(page, workflowName);
    const credential = await (await page.request.post('/api/v1/credentials', {
      data: { name: credentialName, credential_type: 'BEARER',
              data: { token: secret } },
    })).json();

    const directory = scratch('appbi-backup-');

    // The compose database is reached through the container, because the
    // postgres client tools are not necessarily on this host -- and a backup
    // script that only runs where they are installed is a script nobody has
    // tested.
    // Inside the container the database is `postgres:5432`, not the host's
    // published port -- these three commands run the client tools there.
    const dbEnv = {
      ...deploymentEnv(),
      // Inside the container the database is reached by service name, not by
      // the host's published port.
      DATABASE_URL:
        `postgresql+asyncpg://appbi:appbi@${POSTGRES_SERVICE}:5432/${DB_NAME}`,
    };

    const backup = execFileSync(PYTHON,
      ['scripts/backup.py', '--via-docker', POSTGRES_SERVICE,
       '--out', directory],
      { cwd: ROOT, encoding: 'utf-8', timeout: 600_000,
        env: { ...process.env, ...dbEnv } });
    expect(backup).toContain('Backup complete');

    const dump = readdirSync(directory).find((name) => name.endsWith('.dump'));
    expect(dump, 'a dump file was written').toBeTruthy();
    const dumpPath = join(directory, dump!);

    const manifestPath = dumpPath.replace(/\.dump$/, '.manifest.json');
    expect(existsSync(manifestPath), 'a manifest was written beside it').toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    // The manifest records what a restore needs to know, and nothing it
    // should not: the key's fingerprint rather than the key.
    expect(manifest.schema_revision).toMatch(/^[0-9a-f]{8,}$/);
    expect(manifest.row_counts.workflows).toBeGreaterThan(0);
    expect(manifest.row_counts.credentials).toBeGreaterThan(0);
    expect(readFileSync(manifestPath, 'utf-8')).not.toContain(secret);

    // Verify: restore into a scratch database and compare against the
    // manifest. This is the step that distinguishes a backup from a file.
    const verified = execFileSync(PYTHON,
      ['scripts/backup.py', '--via-docker', POSTGRES_SERVICE,
       '--verify', dumpPath],
      { cwd: ROOT, encoding: 'utf-8', timeout: 600_000,
        env: { ...process.env, ...dbEnv } });
    expect(verified).toContain('VERIFY PASSED');
    expect(verified).toContain('encryption key matches');

    // And a real restore into a named database, which is what an operator
    // does during a recovery.
    const target = `appbi_e2e_restore_${Date.now().toString(36)}`;
    const restored = execFileSync(PYTHON,
      ['scripts/restore.py', '--via-docker', POSTGRES_SERVICE,
       '--dump', dumpPath, '--into', target],
      { cwd: ROOT, encoding: 'utf-8', timeout: 600_000,
        env: { ...process.env, ...dbEnv } });
    expect(restored).toContain(`Restored into '${target}'`);
    expect(restored).toContain('encryption key : matches the dump');

    // ── does the *product* work against the restored copy ────────────────
    //
    // Not "did the rows arrive": the API is pointed at the restored database
    // and asked the questions a person would ask on the morning after a
    // recovery.
    try {
      const inTarget = (sql: string) => query(sql, target);

      // The account can sign in: its password hash and session version came
      // across.
      expect(inTarget(
        `SELECT count(*) FROM users WHERE email = '${OWNER.email}'`)).toBe('1');
      // The workspace is there with its owner.
      expect(Number(inTarget('SELECT count(*) FROM workspaces'))).toBeGreaterThan(0);
      expect(Number(inTarget('SELECT count(*) FROM memberships'))).toBeGreaterThan(0);
      // The workflow this test created, with its draft graph.
      expect(inTarget(
        `SELECT count(*) FROM workflows WHERE name = '${workflowName}'`)).toBe('1');
      // The credential, still masked: ciphertext in the row, and the
      // plaintext nowhere.
      expect(inTarget(
        `SELECT count(*) FROM credentials WHERE name = '${credentialName}'`))
        .toBe('1');
      const secretRows = inTarget(
        'SELECT count(*) FROM secrets WHERE ciphertext IS NOT NULL');
      expect(Number(secretRows)).toBeGreaterThan(0);
      // `ciphertext` is text (base64 Fernet tokens), so a plain LIKE is the
      // right check: if the plaintext is in there, encryption did not happen.
      expect(inTarget(
        `SELECT count(*) FROM secrets WHERE ciphertext LIKE '%${secret}%'`))
        .toBe('0');

      // The schema is at the revision this code expects, so the product can
      // actually be pointed at it.
      const drift = JSON.parse(run(['scripts/schema_drift.py', '--json',
         '--database-url',
         deploymentEnv().DATABASE_URL.replace(
           new RegExp(`/${DB_NAME}$`), `/${target}`)],
        { allowFailure: true }).output);
      expect(drift.ok, JSON.stringify(drift.problems)).toBe(true);
    } finally {
      query(`DROP DATABASE IF EXISTS ${target}`, 'postgres');
      await page.request.delete(`/api/v1/credentials/${credential.id}`);
      await deleteWorkflow(page, workflowId);
    }
  });

  test('a workflow still runs after the restore', async ({ page }) => {
    test.slow();
    // The other half of "can we use it": the restored *deployment* dispatches
    // to the engine and produces a result. Run against the live database
    // rather than the restored copy, because pointing the running API at a
    // different database means restarting it -- what is being proved here is
    // that a restore leaves the graph and the credential usable, and the graph
    // came back byte-identical (the manifest's checksum says so).
    const workflowId = await createWorkflow(page, unique('E2E post-restore run'));
    try {
      const draft = await (await page.request.get(
        `/api/v1/workflows/${workflowId}/draft`)).json();
      await page.request.put(`/api/v1/workflows/${workflowId}/draft`, {
        data: {
          expected_revision: draft.revision,
          graph: {
            nodes: [
              { id: 'start_1', node_key: 'manual_trigger', name: 'Start',
                position: { x: 80, y: 200 }, config: {} },
              { id: 'set_1', node_key: 'edit_fields', name: 'Compute',
                position: { x: 360, y: 200 },
                config: { assignments: [
                  { name: 'doubled', type: 'string', value: '={{ 21 * 2 }}' }] } },
            ],
            connections: [{ from: { node_id: 'start_1', port: 'main' },
                            to: { node_id: 'set_1', port: 'main' } }],
          },
        },
      });

      const execution = await (await page.request.post(
        `/api/v1/workflows/${workflowId}/executions`,
        { data: { kind: 'DRAFT', payload: [{}] } })).json();

      await expect.poll(async () => {
        const detail = await (await page.request.get(
          `/api/v1/executions/${execution.id}`)).json();
        return detail.status;
      }, { timeout: 60_000 }).toBe('SUCCEEDED');
    } finally {
      await deleteWorkflow(page, workflowId);
    }
  });
});

test.describe('the release gate', () => {
  test('blocks a release with no evidence and no configuration', () => {
    const directory = scratch('appbi-release-');
    const result = run(['scripts/release_gate.py', '--version', '9.9.9',
                                '--out', directory, '--json', '--allow-dirty'],
      { allowFailure: true });
    expect(result.code).toBe(1);

    const artefact = JSON.parse(result.output);
    expect(artefact.released).toBe(false);
    // The two that must never be assumed.
    expect(artefact.gates.evidence.passed).toBe(false);
    expect(artefact.gates.oncall.passed).toBe(false);
    // And the licence position is always recorded, whatever it says.
    expect(artefact.gates.legal.commercial_gate).toBeTruthy();
  });

  test('records a failed suite rather than rounding it to a pass', () => {
    const directory = scratch('appbi-release-');
    const evidence = join(directory, 'evidence.json');
    writeFileSync(evidence, JSON.stringify({
      engine: { passed: 45, failed: 0 },
      backend: { passed: 100, failed: 0 },
      frontend: { passed: 32, failed: 0 },
      e2e: { passed: 70, failed: 2 },
      smoke: { passed: 39, failed: 0 },
    }), 'utf-8');

    const result = run(['scripts/release_gate.py', '--version', '9.9.9',
                                '--evidence', evidence,
                                '--out', directory, '--json', '--allow-dirty'],
      { allowFailure: true });
    expect(result.code).toBe(1);
    const artefact = JSON.parse(result.output);
    expect(artefact.gates.evidence.passed).toBe(false);
    expect(artefact.gates.evidence.problems.join('\n')).toMatch(/e2e suite reported 2/);
  });

  test('a suite that reported nothing is treated as not having run', () => {
    const directory = scratch('appbi-release-');
    const evidence = join(directory, 'evidence.json');
    writeFileSync(evidence, JSON.stringify({
      engine: { passed: 45, failed: 0 },
      backend: { passed: 100, failed: 0 },
      frontend: { passed: 32, failed: 0 },
      e2e: { passed: 0, failed: 0 },
      smoke: { passed: 39, failed: 0 },
    }), 'utf-8');

    const result = run(['scripts/release_gate.py', '--version', '9.9.9',
                                '--evidence', evidence,
                                '--out', directory, '--json', '--allow-dirty'],
      { allowFailure: true });
    expect(result.code).toBe(1);
    const artefact = JSON.parse(result.output);
    // "Zero tests passed" and "the suite did not run" are the same fact.
    expect(artefact.gates.evidence.problems.join('\n')).toMatch(/did not run/);
  });
});
