/**
 * Publish, activate, roll back (SRS 69, UAT-005 … UAT-007).
 *
 * The behaviour the whole version model exists for: editing a live workflow is
 * safe, and rolling back does not mean republishing.
 */

import { expect, test } from '@playwright/test';

import {
  Editor, branchingGraph, createWorkflow, deleteWorkflow, seedGraph, unique,
} from './fixtures';

test.describe('publish', () => {
  let workflowId: string;

  test.beforeEach(async ({ page }) => {
    workflowId = await createWorkflow(page, unique('E2E publish'));
    await seedGraph(page, workflowId, branchingGraph());
  });
  test.afterEach(async ({ page }) => {
    await deleteWorkflow(page, workflowId);
  });

  test('the dialog names the version and does not activate by default',
    async ({ page }) => {
      await page.goto(`/workflows/${workflowId}`);
      await page.getByRole('button', { name: /^Publish$/ }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('v1');
      await expect(dialog.getByText(/hợp lệ|is valid/)).toBeVisible();

      // Publishing says "this is good"; activating says "run this in
      // production". The dialog must not conflate them (SRS 35.4).
      await expect(dialog.getByRole('checkbox')).not.toBeChecked();

      await dialog.getByRole('textbox').fill('first version from the browser');
      await dialog.getByRole('button', { name: /^Publish$/ }).click();
      await expect(dialog).not.toBeVisible();

      await expect(page.getByText(/Đã publish phiên bản|Published version/)).toBeVisible();

      // Published, and deliberately not active.
      const summary = await (await page.request.get(`/api/v1/workflows/${workflowId}`)).json();
      expect(summary.published.version).toBe(1);
      expect(summary.active_version).toBeNull();
    });

  test('an invalid graph cannot be published, and the dialog says why',
    async ({ page }) => {
      // Break the graph through the UI: an HTTP step with no URL.
      const editor = new Editor(page);
      await page.goto(`/workflows/${workflowId}`);
      await editor.selectNode('Gắn nhãn VIP');
      await editor.addNode('HTTP Request');
      await editor.waitSaved();

      await page.getByRole('button', { name: /^Publish$/ }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('button', { name: /^Publish$/ })).toBeDisabled();
      await expect(dialog.getByText(/vấn đề cần xử lý|problem/)).toBeVisible();
    });

  test('publishing with activate on makes the trigger live', async ({ page }) => {
    await page.goto(`/workflows/${workflowId}`);
    await page.getByRole('button', { name: /^Publish$/ }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: /^Publish$/ }).click();
    await expect(dialog).not.toBeVisible();

    // The header badge changes, which is how the user knows production moved.
    await expect(page.getByText(/Đang hoạt động|Active/).first()).toBeVisible();
    await expect(page.getByText('v1').first()).toBeVisible();
  });
});

test.describe('editing a live workflow', () => {
  let workflowId: string;
  let workflowName: string;

  test.beforeEach(async ({ page }) => {
    workflowName = unique('E2E live');
    workflowId = await createWorkflow(page, workflowName);
    await seedGraph(page, workflowId, branchingGraph());
    await page.request.post(`/api/v1/workflows/${workflowId}/publish`, {
      data: { change_note: 'v1' },
    });
    await page.request.post(`/api/v1/workflows/${workflowId}/activate`, { data: {} });
  });
  test.afterEach(async ({ page }) => {
    await deleteWorkflow(page, workflowId);
  });

  test('the draft can be changed while v1 keeps running, and v1 does not move',
    async ({ page }) => {
      const editor = new Editor(page);
      await page.goto(`/workflows/${workflowId}`);
      await expect(page.getByText(/Đang hoạt động|Active/).first()).toBeVisible();

      const before = await (
        await page.request.get(`/api/v1/workflows/${workflowId}/versions/1`)
      ).json();

      await editor.selectNode('Gắn nhãn VIP');
      await editor.configPanel.getByLabel(/Tên bước|Step name/).fill('Đổi tên trong khi chạy');
      await editor.configPanel.getByLabel(/Tên bước|Step name/).blur();
      await editor.waitSaved();

      // The header now says the draft has moved on — the signal that publish is
      // needed for production to follow.
      await expect(page.getByText(/chưa publish|Unpublished/)).toBeVisible();

      const after = await (
        await page.request.get(`/api/v1/workflows/${workflowId}/versions/1`)
      ).json();
      // UAT-005: a published version is immutable.
      expect(after.graph_hash).toBe(before.graph_hash);
    });

  test('a second version can be published and activated, then rolled back',
    async ({ page }) => {
      const editor = new Editor(page);
      await page.goto(`/workflows/${workflowId}`);

      await editor.selectNode('Gắn nhãn thường');
      await editor.configPanel.getByLabel(/Tên bước|Step name/).fill('Nhãn v2');
      await editor.configPanel.getByLabel(/Tên bước|Step name/).blur();
      await editor.waitSaved();

      await page.getByRole('button', { name: /^Publish$/ }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('v2');
      await dialog.getByRole('button', { name: /^Publish$/ }).click();
      await expect(dialog).not.toBeVisible();

      // Publishing v2 does not move production off v1.
      let summary = await (await page.request.get(`/api/v1/workflows/${workflowId}`)).json();
      expect(summary.published.version).toBe(2);
      expect(summary.active_version).toBe(1);

      // The versions page is where rollback lives.
      await page.getByRole('button', { name: /Phiên bản|Versions/ }).click();
      await expect(page).toHaveURL(/\/versions$/);

      const rows = page.locator('li').filter({ hasText: /^v[12]/ });
      await expect(rows).toHaveCount(2);

      // Activate v2 from the list. Wait for the row itself to say it is live --
      // `Active` is on screen either way while v1 holds it, so asserting on
      // that would just race the request.
      const v2 = rows.filter({ hasText: 'v2' });
      const v1 = rows.filter({ hasText: 'v1' });
      await v2.getByRole('button', { name: /^Bật$|^Activate$/ }).click();
      await expect(v2.getByText(/Đang hoạt động|Active/)).toBeVisible();
      await expect(v2.getByRole('button', { name: /^Bật$|^Activate$/ })).toHaveCount(0);

      summary = await (await page.request.get(`/api/v1/workflows/${workflowId}`)).json();
      expect(summary.active_version).toBe(2);

      // And back to v1: a rollback, not a republish (SRS 69.4).
      await v1.getByRole('button', { name: /^Bật$|^Activate$/ }).click();
      await expect(v1.getByText(/Đang hoạt động|Active/)).toBeVisible();

      summary = await (await page.request.get(`/api/v1/workflows/${workflowId}`)).json();
      expect(summary.active_version).toBe(1);
      expect(summary.published.version).toBe(2);
    });

  test('an active workflow cannot be deleted from the list until it is off',
    async ({ page }) => {
      await page.goto('/workflows');
      const search = page.getByRole('textbox').first();
      // This run's workflow by name, not the first row matching a prefix: a
      // previous failed run can leave an inactive namesake behind, and the
      // assertion below is specifically about the *active* one.
      await search.fill(workflowName);

      // Wait for the search to settle before opening the menu. The search is
      // debounced, so the table re-renders when the filtered fetch lands and
      // takes any open menu with it.
      //
      // Counting rows is not enough on its own, and stopped being enough the
      // day the suite got a workspace of its own: the unfiltered list now
      // already holds exactly one row, so `toHaveCount(1)` is satisfied
      // instantly, the menu opens, and *then* the filtered response arrives
      // and closes it. Waiting for the network is what the assertion was
      // standing in for.
      await expect(page.locator('tbody tr')).toHaveCount(1);
      await page.waitForLoadState('networkidle');

      const row = page.locator('tbody tr').filter({ hasText: workflowName });
      await expect(row).toBeVisible();

      // The list offers Deactivate rather than Delete while it is live: the
      // actions come from the backend, so the row never offers what the server
      // would refuse (SRS 80).
      const menu = page.getByRole('menu');
      await expect(async () => {
        await row.getByRole('button', { name: /Thao tác|Actions/ }).click();
        await expect(menu).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 20_000 });

      await expect(menu.getByRole('menuitem', { name: /^Tắt$|^Deactivate$/ })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: /^Bật$|^Activate$/ })).toHaveCount(0);
    });
});

test.describe('draft conflict', () => {
  let workflowId: string;

  test.beforeEach(async ({ page }) => {
    workflowId = await createWorkflow(page, unique('E2E conflict'));
    await seedGraph(page, workflowId, branchingGraph());
  });
  test.afterEach(async ({ page }) => {
    await deleteWorkflow(page, workflowId);
  });

  test('a draft changed elsewhere is refused, not overwritten', async ({ page }) => {
    const editor = new Editor(page);
    await page.goto(`/workflows/${workflowId}`);
    await expect(editor.nodeCards).toHaveCount(5);

    // Somebody else saves while this tab is open. Autosave in this tab now
    // holds a stale revision.
    const other = branchingGraph();
    other.nodes[1].name = 'Đã bị người khác đổi';
    await seedGraph(page, workflowId, other);

    await editor.selectNode('Gắn nhãn VIP');
    await editor.configPanel.getByLabel(/Tên bước|Step name/).fill('Thay đổi của tôi');
    await editor.configPanel.getByLabel(/Tên bước|Step name/).blur();

    // A conflict, not a silent overwrite of somebody's work (SRS 14.6).
    await expect(page.getByText(/Draft đã bị người khác cập nhật|updated this draft/))
      .toBeVisible({ timeout: 20_000 });

    // And the way out is offered rather than described.
    await page.getByRole('button', { name: /Tải lại|Reload/ }).first().click();
    await expect(editor.node('Đã bị người khác đổi')).toBeVisible();
    await expect(page.getByText(/Draft đã bị người khác cập nhật|updated this draft/))
      .not.toBeVisible();
  });
});
