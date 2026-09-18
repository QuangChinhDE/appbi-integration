/**
 * The shell and the read-only screens.
 *
 * Cheap to run and they catch the failure that breaks everything else: a page
 * that renders nothing because the session, the proxy or a query key is wrong.
 */

import { expect, test } from '@playwright/test';

import {
  OWNER, createWorkflow, deleteWorkflow, signInSettlingPassword, unique,
} from './fixtures';

// The path only. Screens with tabs put the active tab in the query string as
// soon as they mount, so anchoring on the end of the URL would be a race the
// test loses about half the time.
const JOURNEY: [RegExp, RegExp][] = [
  [/^Workflows$/, /\/workflows(\?|$)/],
  [/Thông tin xác thực|Credentials/, /\/credentials(\?|$)/],
  [/Lần chạy|Executions/, /\/executions(\?|$)/],
  [/Giám sát|Monitoring/, /\/monitoring(\?|$)/],
  [/Cảnh báo|Alerts/, /\/alerts(\?|$)/],
  [/Thư viện bước|Node library/, /\/nodes(\?|$)/],
  [/Nhật ký hoạt động|Audit log/, /\/audit(\?|$)/],
];

test.describe('navigation', () => {
  test('every module in the sidebar opens its page', async ({ page }) => {
    // A workspace with a workflow in it, which is the state the navigation is
    // designed for. On a brand-new workspace the sidebar deliberately folds
    // the advanced modules away -- see the first-run tests below.
    const workflowId = await createWorkflow(page, unique('E2E nav'));
    try {
      await page.goto('/overview');

      for (const [linkName, url] of JOURNEY) {
        await page.getByRole('link', { name: linkName }).click();
        await expect(page).toHaveURL(url);
        // A heading proves the page rendered, not just that the route resolved.
        await expect(page.getByRole('heading').first()).toBeVisible();
      }
    } finally {
      await deleteWorkflow(page, workflowId);
    }
  });

  test('the sidebar collapses and remembers it', async ({ page }) => {
    await page.goto('/overview');
    const aside = page.locator('aside').first();

    await expect(aside).toHaveClass(/w-60/);
    await page.getByRole('button', { name: /Thu gọn|Collapse/ }).click();
    await expect(aside).toHaveClass(/w-14/);

    await page.reload();
    // Remembered in localStorage: a preference that resets on every page load
    // is not a preference.
    await expect(page.locator('aside').first()).toHaveClass(/w-14/);

    await page.getByRole('button', { name: /Mở rộng|Expand/ }).click();
    await expect(page.locator('aside').first()).toHaveClass(/w-60/);
  });

  test('the workspace switcher shows the current role', async ({ page }) => {
    // The workspace name comes from the session rather than being written in.
    // It used to be the literal 'AppBI Automation', which was true only while
    // every run happened in the bootstrap tenant -- the moment the suite got a
    // workspace of its own, this failed for a reason that had nothing to do
    // with the switcher.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.ok()).toBeTruthy();
    const workspaceName = (await me.json()).workspace.name as string;

    await page.goto('/overview');

    // The name appears in the brand, the switcher and the breadcrumb, so name
    // the one that matters: the switcher, which also carries the role. A
    // plain string matches the accessible name as a substring, which avoids
    // having to escape a workspace name into a regular expression.
    const switcher = page.getByRole('button', { name: workspaceName });
    await expect(switcher).toBeVisible();
    await expect(switcher).toContainText(/Chủ sở hữu|Quản trị nền tảng|Owner|Platform Admin/);
  });
});

test.describe('overview', () => {
  test('shows the figures from the product database', async ({ page }) => {
    const workflowId = await createWorkflow(page, unique('E2E kpi'));
    try {
      await page.goto('/overview');

      for (const label of [/Workflow/, /Đang hoạt động|Active/, /Đang chạy|Running/]) {
        await expect(page.getByText(label).first()).toBeVisible();
      }

      // Every figure carries a value, so a broken aggregate shows as a blank
      // rather than a plausible zero. Addressed by `data-figure` rather than
      // by `p.tabular-nums`: the six bordered tiles this was written against
      // are now one borderless strip of `<dd>`s, and a selector tied to the
      // old markup would have gone quiet instead of failing.
      const figures = page.locator('[data-figure]');
      await expect(figures.first()).toBeVisible();
      const count = await figures.count();
      expect(count).toBeGreaterThanOrEqual(4);
      for (let index = 0; index < count; index += 1) {
        await expect(figures.nth(index)).not.toBeEmpty();
      }
    } finally {
      await deleteWorkflow(page, workflowId);
    }
  });
});

test.describe('a workspace with nothing in it', () => {
  /**
   * The first-run shape is deliberate product behaviour (SRS 17.2), so it is
   * pinned rather than worked around: an empty workspace shows the path
   * through the product, not every module at once.
   *
   * Tested in a workspace of its own, provisioned for the purpose. Asserting
   * "nothing exists" inside a workspace other tests are creating workflows in
   * would be a test that passes or fails depending on what ran before it.
   */
  let workspaceId: string;
  const email = `firstrun-${Date.now().toString(36)}@example.com`;
  const password = 'FirstRunPassword123';

  test.beforeAll(async ({ browser }) => {
    const owner = await browser.newPage({ storageState: '.auth/owner.json' });
    const created = await owner.request.post('/api/v1/platform/workspaces', {
      data: {
        name: `E2E first run ${Date.now().toString(36)}`,
        owner_email: email,
        owner_password: password,
      },
    });
    expect(created.ok()).toBeTruthy();
    workspaceId = (await created.json()).id;
    await owner.close();
  });

  test.afterAll(async ({ browser }) => {
    const owner = await browser.newPage({ storageState: '.auth/owner.json' });
    await owner.request.put(`/api/v1/platform/workspaces/${workspaceId}/status`, {
      data: { status: 'ARCHIVED' },
    });
    await owner.close();
  });

  test('folds the advanced modules away, and offers them in one click',
    async ({ browser }) => {
      const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page = await context.newPage();

      // Settles the forced first-use change whichever state the account is in.
      // Hard-coding "sign in with the initial password, then change it" made
      // the next test depend on this one having succeeded, and a retry
      // re-provisions a different account entirely.
      await signInSettlingPassword(page, email, password, 'FirstRunChanged123');

      // Build is offered; operate-and-manage is not, yet.
      await expect(page.getByRole('link', { name: /^Workflows$/ })).toBeVisible();
      await expect(
        page.getByRole('link', { name: /Giám sát|Monitoring/ })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /Nhật ký hoạt động|Audit log/ })).toHaveCount(0);

      // Folded, not removed: the rest of the product is one click away and
      // says so.
      await page.getByRole('button',
        { name: /Hiện toàn bộ chức năng|Show everything/ }).click();
      await expect(
        page.getByRole('link', { name: /Giám sát|Monitoring/ })).toBeVisible();
      await expect(page.getByRole('link', { name: /Nhật ký hoạt động|Audit log/ })).toBeVisible();

      await context.close();
    });

  test('the overview says what to do rather than showing six zeroes',
    async ({ browser }) => {
      const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page = await context.newPage();
      await signInSettlingPassword(page, email, password, 'FirstRunChanged123');

      // A strip of zeroes reads as a broken dashboard; an empty state reads as
      // an empty workspace (SRS 17.2).
      await expect(page.getByText(/Chưa có workflow nào|No workflows/)).toBeVisible();
      await expect(page.locator('p.tabular-nums')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /Tạo workflow|New workflow/ }).first(),
      ).toBeVisible();

      await context.close();
    });
});

test.describe('node library', () => {
  test('lists the eight certified nodes', async ({ page }) => {
    await page.goto('/nodes');

    for (const name of [
      'Manual Trigger', 'Webhook Trigger', 'Schedule Trigger', 'HTTP Request',
      'Edit Fields', 'IF', 'Switch', 'Merge',
    ]) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
  });

  test('never shows an engine node type', async ({ page }) => {
    // Guardrail 9, checked where it matters: in the rendered page a user sees.
    await page.goto('/nodes');
    await expect(page.getByRole('heading', { name: 'HTTP Request' })).toBeVisible();

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('n8n');
    expect(body).not.toContain('typeVersion');
  });

  test('filters by category', async ({ page }) => {
    await page.goto('/nodes');
    await page.getByLabel(/Nhóm|Group/).selectOption('TRIGGER');

    await expect(page.getByRole('heading', { name: 'Manual Trigger' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'HTTP Request' })).not.toBeVisible();
  });
});

test.describe('engine settings', () => {
  test('reports the runtime without leaking its address', async ({ page }) => {
    await page.goto('/settings/engine');

    await expect(page.getByText('HEALTHY')).toBeVisible();
    await expect(page.getByText('n8n-core@1.14.1')).toBeVisible();

    // The version is operational information an admin needs; the URL is not,
    // and must not be on the page (SRS 61).
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('8099');
    expect(body.toLowerCase()).not.toContain('engine_base_url');
  });

  test('shows the catalogue agreeing with the runtime', async ({ page }) => {
    await page.goto('/settings/engine');
    await expect(page.getByText(/đang khớp nhau|agree/)).toBeVisible();
  });
});
