/**
 * Where the deployment under test lives, and how to talk to its containers.
 *
 * Every value here is overridable, because these specs are the ones that
 * reach outside the browser -- they shell out to `docker compose`, read the
 * deployment's `.env` and connect to its database. Hardcoding a project name
 * and a port means two stacks on one machine, or a CI job that names its
 * project after the branch, run the destructive tests against the wrong one.
 *
 *   COMPOSE_PROJECT_NAME   compose project (default: appbi-workflow)
 *   COMPOSE_FILE           compose file(s), `path` or `a:b` (default: docker-compose.yml)
 *   E2E_ENV_FILE           the deployment's env file (default: .env)
 *   E2E_REPO_ROOT          where the compose files and scripts are (default: ..)
 *   E2E_POSTGRES_SERVICE   compose service running Postgres (default: postgres)
 *   E2E_API_SERVICE        compose service running the API (default: api)
 *   POSTGRES_HOST_PORT     the database's published port (default: 5433)
 *   E2E_DB_NAME            the product database (default: appbi_workflow)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPO_ROOT = process.env.E2E_REPO_ROOT ?? '..';

export const COMPOSE_PROJECT = process.env.COMPOSE_PROJECT_NAME ?? 'appbi-workflow';
export const POSTGRES_SERVICE = process.env.E2E_POSTGRES_SERVICE ?? 'postgres';
export const API_SERVICE = process.env.E2E_API_SERVICE ?? 'api';
export const DB_NAME = process.env.E2E_DB_NAME ?? 'appbi_workflow';

/** `-f` arguments, so an overlay can be layered on for a scaled run. */
export function composeFiles(...extra: string[]): string[] {
  const configured = process.env.COMPOSE_FILE;
  const base = configured
    // Compose's own separator is `:` on POSIX and `;` on Windows; accept both
    // rather than making the caller care.
    ? configured.split(/[:;]/).filter(Boolean)
    : ['docker-compose.yml'];
  return [...base, ...extra].flatMap((file) => ['-f', file]);
}

/**
 * `--env-file` when one is configured.
 *
 * Not optional for a second stack: the ports, the database name and the
 * bootstrap credentials all come from it, and a `compose up` without it
 * recreates the containers using the *default* file's values -- which is how
 * a scale test aimed at one project ended up trying to bind another project's
 * published port.
 */
function envFileArgs(): string[] {
  const configured = process.env.E2E_ENV_FILE;
  if (!configured) return [];
  return ['--env-file', configured];
}

/** `docker compose ...`, addressed at the project under test. */
export function compose(args: string[], options: { extraFiles?: string[] } = {}) {
  return execFileSync(
    'docker',
    ['compose', '-p', COMPOSE_PROJECT, ...envFileArgs(),
     ...composeFiles(...(options.extraFiles ?? [])), ...args],
    { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 900_000 },
  );
}

/** One scalar from the deployment's database, via its own container. */
export function query(sql: string, database = DB_NAME): string {
  return compose([
    'exec', '-T', POSTGRES_SERVICE,
    'psql', '-U', 'appbi', '-d', database,
    '--no-align', '--tuples-only', '-c', sql,
  ]).trim();
}

/**
 * The deployment's environment file, as an operator's shell would have it.
 *
 * The scripts under test read `DATABASE_URL` and `SECRET_ENCRYPTION_KEY` from
 * the environment and Playwright's process has neither, so loading the same
 * file the stack was started from is what makes these tests exercise the
 * scripts rather than their "you forgot to configure me" branch.
 */
export function deploymentEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  const path = join(REPO_ROOT, process.env.E2E_ENV_FILE ?? '.env');
  if (existsSync(path)) {
    for (const raw of readFileSync(path, 'utf-8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const index = line.indexOf('=');
      let value = line.slice(index + 1).trim();
      if (!/^['"]/.test(value)) value = value.split(/\s+#/)[0].trim();
      else value = value.slice(1, -1);
      values[line.slice(0, index).trim()] = value;
    }
  }
  // These scripts run on the host, so the database is at its published port.
  const port = process.env.POSTGRES_HOST_PORT
    ?? values.POSTGRES_HOST_PORT ?? '5433';
  values.DATABASE_URL =
    `postgresql+asyncpg://appbi:appbi@localhost:${port}/${DB_NAME}`;
  return values;
}

/** The interpreter the project's dependencies are installed into. */
export const PYTHON = process.platform === 'win32'
  ? '.venv/Scripts/python.exe'
  : '.venv/bin/python';

/** Run one of the repository's scripts with the deployment's environment. */
export function script(
  args: string[], options: { allowFailure?: boolean } = {},
) {
  try {
    return {
      code: 0,
      output: execFileSync(PYTHON, args, {
        cwd: REPO_ROOT, encoding: 'utf-8', timeout: 900_000,
        env: { ...process.env, ...deploymentEnv() },
      }),
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    const output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    if (!options.allowFailure) {
      throw new Error(
        `${PYTHON} ${args.join(' ')} failed with ${failure.status}\n${output}`);
    }
    return { code: failure.status ?? 1, output };
  }
}
