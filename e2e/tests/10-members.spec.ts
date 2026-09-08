/**
 * Inviting people, changing their role, and the two rules that stop a
 * workspace becoming unadministerable (SRS 4.2, 35).
 *
 * `05-credentials-rbac.spec.ts` proves an Analyst cannot do things. This
 * proves the *management* of who is what: the invite journey through the
 * settings screen, a role change taking effect on the invited account's next
 * request, the last-owner rule, and the forced password change on first
 * sign-in.
 *
 * Runs in a workspace provisioned for the purpose. Inviting and demoting
 * people inside the workspace every other spec shares would make those specs
 * depend on the order this one ran in.
 */

import { APIRequestContext, Browser, expect, test } from '@playwright/test';

import { unique } from './fixtures';

const INITIAL = 'InvitedInitial123';
const CHANGED = 'InvitedChanged123';

let workspaceId: string;
let ownerEmail: string;
let ownerApi: APIRequestContext;

/** Sign in, walk the forced password change, and return a request context. */
async function signInFresh(
  browser: Browser, email: string, initial: string, settled: string,
): Promise<APIRequestContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/Mật khẩu|Password/).fill(initial);
  await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();

  await expect(page).toHaveURL(/\/change-password/);
  await page.getByLabel(/Mật khẩu hiện tại|Current password/).fill(initial);
  await page.getByLabel(/^Mật khẩu mới|^New password/).fill(settled);
  await page.getByLabel(/Nhập lại|Confirm/).fill(settled);
  await page.getByRole('button', { name: /Đổi mật khẩu|Change password/ }).click();
  await expect(page).toHaveURL(/\/overview/);

  return context.request;
}

test.beforeAll(async ({ browser }) => {
  const platform = await browser.newPage({ storageState: '.auth/owner.json' });
  ownerEmail = `members-owner-${Date.now().toString(36)}@example.com`;
  const created = await platform.request.post('/api/v1/platform/workspaces', {
    data: {
      name: unique('E2E members'),
      owner_email: ownerEmail,
      owner_password: INITIAL,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  workspaceId = (await created.json()).id;
  await platform.close();

  ownerApi = await signInFresh(browser, ownerEmail, INITIAL, CHANGED);
});

test.afterAll(async ({ browser }) => {
  const platform = await browser.newPage({ storageState: '.auth/owner.json' });
  await platform.request.put(
    `/api/v1/platform/workspaces/${workspaceId}/status`,
    { data: { status: 'ARCHIVED' } });
  await platform.close();
});

/** A browser page signed in as this workspace's owner. */
async function ownerPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByLabel(/Mật khẩu|Password/).fill(CHANGED);
  await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();
  await expect(page).toHaveURL(/\/overview/);
  return { context, page };
}

test.describe('inviting a member', () => {
  test('the invite journey, through the settings screen', async ({ browser }) => {
    const { context, page } = await ownerPage(browser);
    const email = `invited-ui-${Date.now().toString(36)}@example.com`;

    await page.goto('/settings/access');
    await page.getByRole('button', { name: /Thêm thành viên|Add a member/ })
      .first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel(/^Tên|^Name/).fill('Invited Builder');
    await dialog.getByLabel(/Vai trò|Role/).selectOption('AUTOMATION_BUILDER');
    await dialog.getByLabel(/Mật khẩu khởi tạo|Initial password/).fill(INITIAL);
    await dialog.getByRole('button', { name: /^Lưu$|^Save$|Thêm|Add/ }).click();
    await expect(dialog).not.toBeVisible();

    const main = page.getByRole('main');
    const row = main.locator('li').filter({ hasText: email });
    await expect(row).toBeVisible();
    await expect(row.getByRole('combobox')).toHaveValue('AUTOMATION_BUILDER');

    // The initial password is not echoed back into the page.
    expect(await main.innerText()).not.toContain(INITIAL);

    await context.close();
  });

  test('an invited account must change its password before anything else',
    async ({ browser }) => {
      const email = `invited-forced-${Date.now().toString(36)}@example.com`;
      const invited = await ownerApi.post('/api/v1/workspace/members', {
        data: { email, full_name: 'Forced Change', role: 'AUTOMATION_BUILDER',
                password: INITIAL },
      });
      expect(invited.ok(), await invited.text()).toBeTruthy();

      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel(/Mật khẩu|Password/).fill(INITIAL);
      await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();

      await expect(page).toHaveURL(/\/change-password/);
      // And nowhere else, however they ask.
      for (const path of ['/workflows', '/credentials', '/settings/access']) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/change-password/);
      }

      // The API refuses too, which is the control that actually holds: the
      // redirect is UX.
      const refused = await page.request.get('/api/v1/workflows');
      expect(refused.status()).toBe(403);
      expect((await refused.json()).error.code).toBe('PASSWORD_CHANGE_REQUIRED');

      await page.goto('/change-password');
      await page.getByLabel(/Mật khẩu hiện tại|Current password/).fill(INITIAL);
      await page.getByLabel(/^Mật khẩu mới|^New password/).fill(CHANGED);
      await page.getByLabel(/Nhập lại|Confirm/).fill(CHANGED);
      await page.getByRole('button', { name: /Đổi mật khẩu|Change password/ }).click();
      await expect(page).toHaveURL(/\/overview/);
      expect((await page.request.get('/api/v1/workflows')).ok()).toBeTruthy();

      await context.close();
    });

  test('changing a password invalidates the sessions it was issued for',
    async ({ browser }) => {
      // A password change that leaves old sessions working is not a password
      // change -- it is a second password.
      const email = `invited-session-${Date.now().toString(36)}@example.com`;
      await ownerApi.post('/api/v1/workspace/members', {
        data: { email, full_name: 'Session Test', role: 'ANALYST',
                password: INITIAL },
      });
      const api = await signInFresh(browser, email, INITIAL, CHANGED);
      expect((await api.get('/api/v1/workflows')).ok()).toBeTruthy();

      // A second sign-in changes nothing for the first session...
      const second = await browser.newContext();
      const page = await second.newPage();
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel(/Mật khẩu|Password/).fill(CHANGED);
      await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();
      await expect(page).toHaveURL(/\/overview/);
      expect((await api.get('/api/v1/workflows')).ok()).toBeTruthy();

      // ...but changing the password does.
      await page.goto('/settings/account').catch(() => {});
      const changed = await page.request.post('/api/v1/auth/change-password', {
        data: { current_password: CHANGED, new_password: 'ThirdPassword1234' },
      });
      expect(changed.ok(), await changed.text()).toBeTruthy();

      const after = await api.get('/api/v1/workflows');
      expect(after.status()).toBe(401);
      expect((await after.json()).error.code).toBe('SESSION_REVOKED');

      await second.close();
    });

  test('a weak initial password is refused with every reason at once',
    async () => {
      const response = await ownerApi.post('/api/v1/workspace/members', {
        data: { email: `weak-${Date.now().toString(36)}@example.com`,
                full_name: 'Weak', role: 'ANALYST', password: 'short' },
      });
      expect(response.status()).toBe(422);
      const error = (await response.json()).error;
      expect(error.code).toBe('PASSWORD_TOO_WEAK');
      // A form that reports one problem at a time makes the user guess how
      // many are left.
      expect(error.details.problems.length).toBeGreaterThan(1);
    });

  test('inviting the same person twice is a conflict, not a duplicate row',
    async () => {
      const email = `twice-${Date.now().toString(36)}@example.com`;
      const first = await ownerApi.post('/api/v1/workspace/members', {
        data: { email, full_name: 'Twice', role: 'ANALYST', password: INITIAL },
      });
      expect(first.ok()).toBeTruthy();

      const second = await ownerApi.post('/api/v1/workspace/members', {
        data: { email, full_name: 'Twice', role: 'OWNER', password: INITIAL },
      });
      expect(second.status()).toBe(409);
    });
});

test.describe('roles', () => {
  test('a role change takes effect on the account\'s next request',
    async ({ browser }) => {
      const email = `role-change-${Date.now().toString(36)}@example.com`;
      const invited = await (await ownerApi.post('/api/v1/workspace/members', {
        data: { email, full_name: 'Promoted', role: 'ANALYST',
                password: INITIAL },
      })).json();

      const api = await signInFresh(browser, email, INITIAL, CHANGED);

      // An Analyst cannot create a workflow.
      expect((await api.post('/api/v1/workflows',
        { data: { name: 'as analyst' } })).status()).toBe(403);

      await ownerApi.patch(`/api/v1/workspace/members/${invited.id}`,
        { data: { role: 'AUTOMATION_BUILDER' } });

      // No re-login: the role is resolved per request from the membership row,
      // not baked into the session token. A product that cached it in the
      // token would need the user to sign out and in again to lose access,
      // which is the wrong direction for a revocation.
      const created = await api.post('/api/v1/workflows',
        { data: { name: unique('as builder') } });
      expect(created.ok(), await created.text()).toBeTruthy();
    });

  test('a revoked membership takes effect immediately', async ({ browser }) => {
    const email = `revoked-${Date.now().toString(36)}@example.com`;
    const invited = await (await ownerApi.post('/api/v1/workspace/members', {
      data: { email, full_name: 'Revoked', role: 'AUTOMATION_BUILDER',
              password: INITIAL },
    })).json();

    const api = await signInFresh(browser, email, INITIAL, CHANGED);
    expect((await api.get('/api/v1/workflows')).ok()).toBeTruthy();

    await ownerApi.delete(`/api/v1/workspace/members/${invited.id}`);

    // The account still has a valid session token and no longer belongs to any
    // workspace, so it can reach nothing.
    const after = await api.get('/api/v1/workflows');
    expect(after.status()).toBe(403);
  });

  test('the last owner cannot be demoted or removed', async () => {
    const members = await (await ownerApi.get('/api/v1/workspace/members')).json();
    const owners = members.items.filter(
      (item: { role: string }) => item.role === 'OWNER');
    expect(owners).toHaveLength(1);
    const only = owners[0];

    // A workspace with no owner cannot be administered by anybody, including
    // the person who just demoted themselves.
    const demoted = await ownerApi.patch(
      `/api/v1/workspace/members/${only.id}`, { data: { role: 'ANALYST' } });
    expect(demoted.status()).toBe(409);
    expect((await demoted.json()).error.message)
      .toMatch(/ít nhất một Owner|at least one Owner/);

    const removed = await ownerApi.delete(
      `/api/v1/workspace/members/${only.id}`);
    expect([409, 422]).toContain(removed.status());

    // Still an owner afterwards.
    const after = await (await ownerApi.get('/api/v1/workspace/members')).json();
    expect(after.items.filter((i: { role: string }) => i.role === 'OWNER'))
      .toHaveLength(1);
  });

  test('a second owner makes the first demotable', async ({ browser }) => {
    // The complementary case: the rule is "at least one", not "this one".
    const email = `second-owner-${Date.now().toString(36)}@example.com`;
    const second = await (await ownerApi.post('/api/v1/workspace/members', {
      data: { email, full_name: 'Second Owner', role: 'OWNER',
              password: INITIAL },
    })).json();
    await signInFresh(browser, email, INITIAL, CHANGED);

    const members = await (await ownerApi.get('/api/v1/workspace/members')).json();
    const first = members.items.find(
      (item: { email: string }) => item.email === ownerEmail);

    const demoted = await ownerApi.patch(
      `/api/v1/workspace/members/${first.id}`, { data: { role: 'ANALYST' } });
    expect(demoted.ok(), await demoted.text()).toBeTruthy();

    // Put it back, so the rest of this file still has an owner to act as.
    const asSecond = await ownerApi.patch(
      `/api/v1/workspace/members/${first.id}`, { data: { role: 'OWNER' } });
    // The demoted account cannot promote itself back -- that is the point --
    // so this is expected to fail, and the second owner does it instead.
    if (!asSecond.ok()) {
      const secondApi = await (async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto('/login');
        await page.getByLabel('Email').fill(email);
        await page.getByLabel(/Mật khẩu|Password/).fill(CHANGED);
        await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();
        await expect(page).toHaveURL(/\/overview/);
        return context.request;
      })();
      const restored = await secondApi.patch(
        `/api/v1/workspace/members/${first.id}`, { data: { role: 'OWNER' } });
      expect(restored.ok(), await restored.text()).toBeTruthy();
    }
    expect(second.role).toBe('OWNER');
  });
});
