/**
 * A first deploy, from an empty database.
 *
 * The question a SaaS product is asked most often and rehearses least: does
 * `up` on a machine with nothing on it produce a working deployment? Every
 * other test in this suite runs against a database that has been through
 * dozens of runs, so none of them can answer it.
 *
 * Destructive: it deletes the data volume. Opt in with `E2E_DESTRUCTIVE=1`,
 * and it runs before everything else so that the rest of the suite is then
 * exercising a genuinely fresh install.
 *
 * What it proves, in order:
 *
 *   1. `docker compose down -v` really removes the volume;
 *   2. `up --wait` succeeds with no manual step -- the `migrate` service runs
 *      `alembic upgrade head`, `alembic check` and the bootstrap, and api and
 *      worker wait for it to finish;
 *   3. the schema is at head with no drift;
 *   4. the bootstrapped admin can sign in and is made to change its password;
 *   5. the API smoke suite passes end to end;
 *   6. a second `up` changes nothing -- the install is idempotent, which is
 *      what lets it run on every deploy rather than only the first.
 */

import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

import {
  COMPOSE_PROJECT, PYTHON, REPO_ROOT, compose, deploymentEnv, query,
} from './deployment';

/**
 * `docker volume ls`, which is not a compose subcommand and so is addressed
 * by the project's volume-name prefix rather than through `compose`.
 */
function volumeNames(): string {
  return execFileSync('docker', ['volume', 'ls', '--format', '{{.Name}}'],
    { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 60_000 });
}

/** A repository script, with the deployment's environment. */
function script(args: string[]): string {
  return execFileSync(PYTHON, args, {
    cwd: REPO_ROOT, encoding: 'utf-8', timeout: 900_000,
    env: { ...process.env, ...deploymentEnv() },
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('a first deploy', () => {
  const email = deploymentEnv().BOOTSTRAP_ADMIN_EMAIL || 'admin@appbi.vn';
  const password = deploymentEnv().BOOTSTRAP_ADMIN_PASSWORD;

  test('the environment names an admin password to bootstrap with', () => {
    // Without one, bootstrap generates a password and prints it, and the sign-in
    // test below has nothing to use. Better to say so here than to fail four
    // steps later with a wrong-password error.
    expect(password,
      'set BOOTSTRAP_ADMIN_PASSWORD in .env before running the destructive suite')
      .toBeTruthy();
  });

  test('down -v removes the data volume', () => {
    compose(['down', '-v']);
    // Compose names a volume `<project>_<volume>`, so the project under test
    // is what decides which one should be gone.
    expect(volumeNames()).not.toContain(`${COMPOSE_PROJECT}_postgres-data`);
  });

  test('up --wait produces a working deployment with no manual step', () => {
    // No `bootstrap --schema`, no `alembic upgrade head` by hand. If this needs
    // a step that is not in the compose file, a customer's first deploy needs
    // it too, and they do not have this test to tell them.
    compose(['up', '-d', '--wait', '--wait-timeout', '600']);

    const status = compose(['ps', '--format', '{{.Service}}\t{{.Status}}']);
    for (const service of ['postgres', 'engine', 'api', 'worker', 'frontend']) {
      expect(status, `${service} should be healthy`)
        .toMatch(new RegExp(`${service}\\s+Up.*healthy`));
    }

    // The migration ran, and ran to completion rather than being skipped.
    const migrate = compose(['logs', 'migrate']);
    expect(migrate).toContain('Running upgrade');
    expect(migrate).toContain('No new upgrade operations detected');
    expect(migrate).toContain('Install complete');
  });

  test('the schema is at head, with the catalogue and one admin seeded', () => {
    const drift = JSON.parse(script(['scripts/schema_drift.py', '--json']));
    expect(drift.ok, JSON.stringify(drift.problems)).toBe(true);
    expect(drift.applied_revision).toBe(drift.head_revision);

    // Eight certified nodes, one engine instance, one workspace, one admin.
    expect(query('SELECT count(*) FROM node_definitions')).toBe('8');
    expect(query('SELECT count(*) FROM engine_instances')).toBe('1');
    expect(query('SELECT count(*) FROM workspaces')).toBe('1');
    expect(query('SELECT count(*) FROM users')).toBe('1');
    expect(query('SELECT count(*) FROM memberships')).toBe('1');

    // The admin is a platform admin and must change its password.
    expect(query(
      "SELECT is_platform_admin::text || ',' || password_change_required::text "
      + 'FROM users')).toBe('true,true');

    // And nothing has run yet, which is what makes the first-run interface
    // tests meaningful.
    expect(query('SELECT count(*) FROM workflows')).toBe('0');
    expect(query('SELECT count(*) FROM executions')).toBe('0');
  });

  test('the bootstrapped admin signs in and is made to change its password',
    async ({ page }) => {
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel(/Mật khẩu|Password/).fill(password);
      await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();

      // Not the overview. A deployment whose first account can be used without
      // changing the password from the pipeline is a deployment with a shared
      // credential in it.
      await expect(page).toHaveURL(/\/change-password/);
      await expect(page.getByText(/Bạn cần đổi mật khẩu|need to change/))
        .toBeVisible();

      const settled = process.env.E2E_SETTLED_PASSWORD ?? 'E2EOwnerPassword123';
      await page.getByLabel(/Mật khẩu hiện tại|Current password/).fill(password);
      await page.getByLabel(/^Mật khẩu mới|^New password/).fill(settled);
      await page.getByLabel(/Nhập lại|Confirm/).fill(settled);
      await page.getByRole('button', { name: /Đổi mật khẩu|Change password/ }).click();
      await expect(page).toHaveURL(/\/overview/);

      // The whole product is reachable now.
      await expect(page.getByRole('link', { name: /^Workflows$/ })).toBeVisible();
    });

  test('the API smoke suite passes against the fresh install', () => {
    // Thirty-nine checks walking UAT-001 to UAT-019. The admin's password has
    // been changed by the test above, so the smoke script is given both --
    // it tries the initial one and falls back, which is what it does on a
    // re-run in any environment.
    const settled = process.env.E2E_SETTLED_PASSWORD ?? 'E2EOwnerPassword123';
    // The API's own origin, not the frontend's: the smoke suite is about the
    // product API and does not go through the proxy.
    const apiBase = process.env.E2E_API_BASE
      ?? `http://127.0.0.1:${deploymentEnv().API_HOST_PORT ?? '8000'}`;
    const output = script([
      'scripts/smoke.py',
      '--base', apiBase,
      '--email', email,
      '--password', settled,
      '--new-password', settled,
    ]);
    expect(output).toContain('All checks passed');
  });

  test('a second up changes nothing', () => {
    // Idempotence is what lets the install run on every deploy instead of
    // being a thing somebody remembers to do once.
    const before = {
      users: query('SELECT count(*) FROM users'),
      workspaces: query('SELECT count(*) FROM workspaces'),
      nodes: query('SELECT count(*) FROM node_definitions'),
      engines: query('SELECT count(*) FROM engine_instances'),
      revision: query('SELECT version_num FROM alembic_version'),
    };

    compose(['up', '-d', '--wait', '--wait-timeout', '600']);

    expect({
      users: query('SELECT count(*) FROM users'),
      workspaces: query('SELECT count(*) FROM workspaces'),
      nodes: query('SELECT count(*) FROM node_definitions'),
      engines: query('SELECT count(*) FROM engine_instances'),
      revision: query('SELECT version_num FROM alembic_version'),
    }).toEqual(before);

    // And the admin's changed password still works: the second bootstrap did
    // not reset the account.
    const migrate = compose(['logs', 'migrate']);
    expect(migrate).toContain('bootstrap.admin_exists');
  });
});
