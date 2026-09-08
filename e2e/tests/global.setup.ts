/**
 * Signs in once, puts the run in a workspace of its own, and saves the session
 * for every other test.
 *
 * Doing it through the login form rather than by minting a cookie: if sign-in
 * is broken, every test should fail here with a clear reason rather than fifty
 * tests failing on a redirect to /login.
 *
 * Handles the forced password change, because a genuinely fresh deployment
 * always presents it. A setup that only worked against a database somebody had
 * already signed into by hand would mean the suite could never run against a
 * clean install -- which is the one thing a clean install most needs tested.
 */

import { expect, test as setup } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import { RUN_WORKSPACE_FILE } from './fixtures';

const OWNER_STATE = '.auth/owner.json';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@appbi.vn';
/** What bootstrap was given. Valid until the account changes it. */
const INITIAL_PASSWORD = process.env.E2E_PASSWORD ?? 'SmokeTestPass123!';
/**
 * What the account ends up with.
 *
 * A second value is needed because the product refuses to let an account keep
 * the password it was issued -- so after the first run of the suite the
 * initial one no longer works, and the setup has to try both.
 */
const SETTLED_PASSWORD = process.env.E2E_SETTLED_PASSWORD ?? 'E2EOwnerPassword123';



setup('sign in as the workspace owner', async ({ page }) => {
  mkdirSync('.auth', { recursive: true });

  await page.goto('/login');

  // The settled password first: on every run after the first, that is the one
  // that works, and trying the initial one would spend a failed attempt
  // against the account lockout.
  for (const password of [SETTLED_PASSWORD, INITIAL_PASSWORD]) {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel(/Mật khẩu|Password/).fill(password);
    await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();

    const landed = await Promise.race([
      page.waitForURL(/\/overview/, { timeout: 20_000 }).then(() => 'overview'),
      page.waitForURL(/\/change-password/, { timeout: 20_000 })
        .then(() => 'change-password'),
      page.getByText(/Email hoặc mật khẩu không đúng|Email or password/)
        .waitFor({ timeout: 20_000 }).then(() => 'rejected'),
    ]).catch(() => 'rejected');

    if (landed === 'overview') break;

    if (landed === 'change-password') {
      // A fresh deployment. The account can sign in and change its password,
      // and nothing else, until it has.
      await page.getByLabel(/Mật khẩu hiện tại|Current password/).fill(password);
      await page.getByLabel(/^Mật khẩu mới|^New password/).fill(SETTLED_PASSWORD);
      await page.getByLabel(/Nhập lại|Confirm/).fill(SETTLED_PASSWORD);
      await page.getByRole('button', { name: /Đổi mật khẩu|Change password/ }).click();
      await expect(page).toHaveURL(/\/overview/, { timeout: 30_000 });
      break;
    }

    // Wrong password: clear the form and try the other one.
    await page.goto('/login');
  }

  // The shell only renders once /auth/me has answered, so waiting for the
  // sidebar is waiting for a real session rather than for a redirect.
  await expect(page).toHaveURL(/\/overview/, { timeout: 30_000 });
  await expect(page.getByRole('link', { name: /Workflows/ })).toBeVisible();

  // ── a workspace for this run ──────────────────────────────────────────
  //
  // Every test used to build in the bootstrap owner's own workspace, so a
  // cleanup that silently failed left its rows next to real data and nobody
  // saw it until somebody counted seventy-five of them. A run gets its own
  // tenant; the teardown proves it emptied it, and suspends it either way.
  //
  // Provisioned through the platform API, which is the same path a real
  // customer takes -- so if tenant provisioning breaks, the suite says so
  // here rather than in whichever test happens to run first.
  const stamp = `${Date.now().toString(36)}`;
  const provisioned = await page.request.post('/api/v1/platform/workspaces', {
    data: {
      name: `E2E run ${stamp}`,
      owner_email: EMAIL,
      max_concurrent_executions: 20,
    },
  });
  expect(
    provisioned.ok(),
    `could not provision a workspace for this run: ${await provisioned.text()}`,
  ).toBeTruthy();
  const workspace = await provisioned.json();

  const switched = await page.request.post(
    `/api/v1/auth/switch-workspace/${workspace.id}`);
  expect(
    switched.ok(),
    `could not switch into the run workspace: ${await switched.text()}`,
  ).toBeTruthy();

  writeFileSync(
    RUN_WORKSPACE_FILE,
    JSON.stringify({
      id: workspace.id,
      name: workspace.name,
      // The teardown suspends every tenant created after this instant, which
      // is how the workspaces that individual tests provision -- quota,
      // tenancy, escalation -- get cleared without the teardown having to
      // know each test's naming scheme. Anything older is somebody's real
      // data and is never touched.
      startedAt: new Date(Date.now() - 5_000).toISOString(),
    }, null, 2),
    'utf-8');

  await page.context().storageState({ path: OWNER_STATE });
});
