import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests (SRS 43.6).
 *
 * These drive the real UI against a running stack — the frontend, the product
 * API, the worker and the engine. Nothing is stubbed: a run that shows a green
 * node on the canvas got there through the compiler and n8n-core.
 *
 * Point them at whichever stack is up:
 *
 *   E2E_BASE_URL=http://127.0.0.1:3010 npm test     # containers
 *   E2E_BASE_URL=http://127.0.0.1:3100 npm test     # run.ps1 up
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

/**
 * The clean-install test destroys the deployment's data volume, so it is
 * opt-in.
 *
 * It has to exist -- "does a first deploy work" is the question a SaaS product
 * is asked most often and rehearses least -- but running it alongside the rest
 * would delete the workspaces those tests are using. CI gives it its own job,
 * before the main suite; locally it is `run.ps1 e2e -Destructive`.
 */
const INCLUDE_DESTRUCTIVE = process.env.E2E_DESTRUCTIVE === '1';

export default defineConfig({
  testDir: './tests',
  // Serial by default. These tests publish and activate workflows in a shared
  // workspace, and the per-workflow concurrency ceiling is 1 — parallel runs
  // would fight over it and fail for reasons that are not defects.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: {
    // Generous because a real run goes API → worker → engine → n8n and back;
    // a tight expect timeout here would make an honest test flaky.
    timeout: 20_000,
  },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    locale: 'vi-VN',
    timezoneId: 'Asia/Bangkok',
  },
  projects: [
    // Runs first and on its own: it tears the stack down to an empty volume,
    // brings it back up and checks the result, so nothing may be holding a
    // session while it works.
    ...(INCLUDE_DESTRUCTIVE ? [{
      name: 'clean-install',
      testMatch: /clean-install\.spec\.ts/,
      // A `docker compose down -v` plus a full rebuild-free `up --wait`, twice.
      timeout: 900_000,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
    }] : []),
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
      dependencies: INCLUDE_DESTRUCTIVE ? ['clean-install'] : [],
      // Runs once everything that depends on `setup` has finished, and fails
      // the run if the suite left workflows behind.
      teardown: 'cleanup',
    },
    {
      name: 'cleanup',
      testMatch: /global\.teardown\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: '.auth/owner.json' },
    },
    {
      name: 'chromium',
      testIgnore: /clean-install\.spec\.ts|global\.teardown\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // The editor's primary target is a desktop viewport (SRS 7.4): the
        // config panel is a 380px column that only appears above xl.
        viewport: { width: 1600, height: 1000 },
        storageState: '.auth/owner.json',
      },
      dependencies: ['setup'],
    },
  ],
  outputDir: 'test-results',
});
