/**
 * Triggers, execution history, settings and the degraded states.
 *
 * The last group covers what the interface does when something is wrong, which
 * is the part that never gets tested by hand.
 */

import { expect, test } from '@playwright/test';

import {
  Editor, OWNER, createWorkflow, deleteWorkflow, seedGraph, unique,
} from './fixtures';

test.describe('webhook trigger', () => {
  let workflowId: string;

  test.beforeEach(async ({ page }) => {
    workflowId = await createWorkflow(page, unique('E2E webhook'), 'webhook_trigger');
    await seedGraph(page, workflowId, {
      nodes: [
        {
          id: 'start_1', node_key: 'webhook_trigger', name: 'Webhook',
          position: { x: 80, y: 200 },
          config: {
            method: 'POST', auth_mode: 'HEADER_SIGNATURE',
            allowed_content_type: 'application/json',
          },
        },
        {
          id: 'set_1', node_key: 'edit_fields', name: 'Ghi nhận',
          position: { x: 360, y: 200 },
          config: { assignments: [{ name: 'seen', type: 'string', value: 'yes' }] },
        },
      ],
      connections: [{
        from: { node_id: 'start_1', port: 'main' },
        to: { node_id: 'set_1', port: 'main' },
      }],
    });
  });
  test.afterEach(async ({ page }) => {
    await deleteWorkflow(page, workflowId);
  });

  test('the config panel shows the URL, and says it needs activating',
    async ({ page }) => {
      const editor = new Editor(page);
      await page.goto(`/workflows/${workflowId}`);
      await editor.selectNode('Webhook');

      const url = editor.configPanel.locator('code');
      await expect(url).toBeVisible();
      const value = await url.innerText();
      // A random key, not the workflow's UUID: a guessable public path invites
      // enumeration (SRS 17.3).
      expect(value).toMatch(/\/hooks\/[0-9a-f]{32}$/);
      expect(value).not.toContain(workflowId);

      await expect(editor.configPanel.getByText(/chỉ hoạt động sau khi|only works once/))
        .toBeVisible();
      // The signing secret is described, never shown.
      await expect(editor.configPanel.getByText(/Đã cấu hình|Configured/)).toBeVisible();
      expect(await editor.configPanel.innerText()).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    });

  test('rotating the secret shows it once', async ({ page }) => {
    const editor = new Editor(page);
    await page.goto(`/workflows/${workflowId}`);
    await editor.selectNode('Webhook');

    await editor.configPanel
      .getByRole('button', { name: /Tạo khóa mới|Generate a new secret/ }).click();

    // The only place in the product where a secret appears in a response, and
    // it appears exactly once.
    const toast = page.locator('[data-sonner-toast]');
    await expect(toast).toBeVisible();
    expect(await toast.innerText()).toMatch(/[A-Za-z0-9_-]{30,}/);
  });
});

test.describe('schedule trigger', () => {
  let workflowId: string;

  test.beforeEach(async ({ page }) => {
    workflowId = await createWorkflow(page, unique('E2E schedule'), 'schedule_trigger');
    await seedGraph(page, workflowId, {
      nodes: [
        {
          id: 'start_1', node_key: 'schedule_trigger', name: 'Mỗi ngày',
          position: { x: 80, y: 200 },
          config: {
            schedule_type: 'DAILY', time_of_day: '02:00',
            timezone: 'Asia/Bangkok', overlap_policy: 'SKIP_IF_RUNNING',
          },
        },
        {
          id: 'set_1', node_key: 'edit_fields', name: 'Đánh dấu',
          position: { x: 360, y: 200 },
          config: { assignments: [{ name: 'ran', type: 'string', value: 'yes' }] },
        },
      ],
      connections: [{
        from: { node_id: 'start_1', port: 'main' },
        to: { node_id: 'set_1', port: 'main' },
      }],
    });
  });
  test.afterEach(async ({ page }) => {
    await deleteWorkflow(page, workflowId);
  });

  test('the panel shows the schedule, its timezone and the next three runs',
    async ({ page }) => {
      const editor = new Editor(page);
      await page.goto(`/workflows/${workflowId}`);
      await editor.selectNode('Mỗi ngày');

      // Naming the timezone is not decoration: "every day at 02:00" without it
      // is a sentence the reader will misinterpret (SRS 39). The summary line,
      // not the select -- the select lists every zone there is.
      await expect(editor.configPanel.getByText(/^H.ng ng.y 02:00 \(Asia\/Bangkok\)$/))
        .toBeVisible();

      // Three concrete times, because a schedule nobody can read is obviously
      // wrong once you see when it would actually fire (SRS 17.4).
      await expect(editor.configPanel.getByText(/Lần chạy tiếp theo|Next runs/))
        .toBeVisible();
      await expect(editor.configPanel.getByText(/Chưa bật|Not activated/)).toBeVisible();
    });

  test('changing the interval updates the summary on the canvas', async ({ page }) => {
    const editor = new Editor(page);
    await page.goto(`/workflows/${workflowId}`);
    await editor.selectNode('Mỗi ngày');

    await editor.chooseOption(/Kiểu lịch|Schedule kind/, 'INTERVAL');
    await editor.setField(/Chu kỳ|Interval/, '3600');
    await editor.waitSaved();

    await expect(editor.node('Mỗi ngày')).toContainText('INTERVAL');

    const trigger = await (
      await page.request.get(`/api/v1/workflows/${workflowId}/trigger`)
    ).json();
    expect(trigger.config.interval_seconds).toBe(3600);
    expect(trigger.schedule.next_runs).toHaveLength(3);
  });

  test('an interval below the floor is refused with a reason', async ({ page }) => {
    const editor = new Editor(page);
    await page.goto(`/workflows/${workflowId}`);
    await editor.selectNode('Mỗi ngày');

    await editor.chooseOption(/Kiểu lịch|Schedule kind/, 'INTERVAL');
    await editor.setField(/Chu kỳ|Interval/, '5');

    // A five-second schedule is not a schedule; the message says the floor.
    await expect(page.locator('[data-sonner-toast]').getByText(/tối thiểu|minimum/))
      .toBeVisible({ timeout: 20_000 });
  });
});

test.describe('execution history', () => {
  let workflowId: string;

  test.beforeEach(async ({ page }) => {
    workflowId = await createWorkflow(page, unique('E2E history'));
    await seedGraph(page, workflowId, {
      nodes: [
        {
          id: 'start_1', node_key: 'manual_trigger', name: 'Bắt đầu',
          position: { x: 80, y: 200 }, config: {},
        },
        {
          id: 'set_1', node_key: 'edit_fields', name: 'Tính toán',
          position: { x: 360, y: 200 },
          config: {
            assignments: [
              { name: 'doubled', type: 'string', value: '={{ 21 * 2 }}' },
            ],
          },
        },
      ],
      connections: [{
        from: { node_id: 'start_1', port: 'main' },
        to: { node_id: 'set_1', port: 'main' },
      }],
    });
    await page.request.post(`/api/v1/workflows/${workflowId}/executions`, {
      data: { kind: 'DRAFT', payload: [{ hello: 'world' }] },
    });
  });
  test.afterEach(async ({ page }) => {
    await deleteWorkflow(page, workflowId);
  });

  test('the detail page shows the node timeline and the real output',
    async ({ page }) => {
      await page.goto('/executions');
      const row = page.locator('tbody tr').first();
      await expect(row.getByText(/Thành công|Succeeded/)).toBeVisible({ timeout: 60_000 });

      await row.getByRole('link').first().click();
      await expect(page).toHaveURL(/\/executions\/[0-9a-f-]{36}/);

      // The short id is what a person quotes to support, so it is the title.
      await expect(page.getByRole('heading', { name: /^#[A-Z2-9]{6}$/ })).toBeVisible();
      await expect(page.getByText('Tính toán').first()).toBeVisible();

      // The expression really was evaluated by the engine.
      await page.getByRole('button', { name: 'Tính toán' }).first().click();
      await expect(page.getByText('42').first()).toBeVisible();
    });

  test('support details copy in one click', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/executions');
    await page.locator('tbody tr').first().getByRole('link').first().click();

    await page.getByRole('button', { name: /Sao chép thông tin|Copy support/ }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());

    // Everything a support conversation needs, in the order it gets asked for
    // (SRS 76).
    expect(copied).toContain('execution:');
    expect(copied).toContain('workflow:');
    expect(copied).toContain('trace:');
  });

  test('a retry creates a new run linked to the old one', async ({ page }) => {
    await page.goto('/executions');
    await expect(page.locator('tbody tr').first().getByText(/Thành công|Succeeded/))
      .toBeVisible({ timeout: 60_000 });

    await page.locator('tbody tr').first().getByRole('link').first().click();
    // Wait for the navigation before reading the URL, or `original` is the
    // list's own path and the assertion below compares nonsense.
    await expect(page).toHaveURL(/\/executions\/[0-9a-f-]{36}/);
    const original = page.url().split('/').pop();

    await page.getByRole('button', { name: /Chạy lại|Retry/ }).click();

    // Retry takes you to the run it started. It used to raise a toast naming
    // an id and leave you on the finished run, which is the product describing
    // what it did instead of doing it -- and this test asserted the toast,
    // so the gap was pinned rather than noticed.
    await expect(page).toHaveURL(
      new RegExp(`/executions/(?!${original})[0-9a-f-]{36}`), { timeout: 20_000 });
    const created = page.url().split('/').pop();
    expect(created).not.toBe(original);

    const runs = await (await page.request.get(
      `/api/v1/executions?workflow_id=${workflowId}`)).json();
    const retried = runs.items.find(
      (item: { id: string }) => item.id === created);
    // The old run is never mutated; the new one points at it (SRS 16.8).
    expect(retried?.retry_of_execution_id).toBe(original);
  });

  test('filters narrow the list', async ({ page }) => {
    await page.goto('/executions');
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });

    await page.getByLabel(/Trạng thái|Status/).selectOption('FAILED');
    // Either there are failures, or the empty state explains itself. Both are
    // correct; a blank panel would not be.
    await expect(
      page.locator('tbody tr').first().or(page.getByText(/Không có kết quả|no results/i)),
    ).toBeVisible();
  });
});

test.describe('workspace settings', () => {
  test('the timezone can be changed and it persists', async ({ page }) => {
    await page.goto('/settings/workspace');

    const select = page.getByLabel(/Múi giờ mặc định|Default timezone/);
    await expect(select).toBeVisible();
    // The help text warns what changing it does, because it moves every
    // scheduled workflow in the workspace.
    await expect(page.getByText(/không theo múi giờ trình duyệt|not the browser/))
      .toBeVisible();

    await select.selectOption('Asia/Singapore');
    await page.getByRole('button', { name: /^Lưu$|^Save$/ }).click();
    await expect(page.locator('[data-sonner-toast]')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(/Múi giờ mặc định|Default timezone/))
      .toHaveValue('Asia/Singapore');

    // Put it back.
    await page.getByLabel(/Múi giờ mặc định|Default timezone/)
      .selectOption('Asia/Bangkok');
    await page.getByRole('button', { name: /^Lưu$|^Save$/ }).click();
  });

  test('members and roles are listed and editable', async ({ page }) => {
    await page.goto('/settings/access');
    // Scoped to the page body: the account menu in the sidebar shows the same
    // address, and an unscoped match would find both.
    const main = page.getByRole('main');
    await expect(main.getByText(OWNER.email)).toBeVisible();

    // The role is a select for somebody who may change it, and the owner's own
    // row is included.
    const ownerRow = main.locator('li').filter({ hasText: OWNER.email });
    await expect(ownerRow.getByRole('combobox')).toHaveValue(/OWNER|PLATFORM_ADMIN/);
  });

  test('the last owner cannot be demoted', async ({ page }) => {
    await page.goto('/settings/access');
    const ownerRow = page.getByRole('main').locator('li')
      .filter({ hasText: OWNER.email });
    const role = ownerRow.getByRole('combobox');

    if ((await role.inputValue()) !== 'OWNER') {
      test.skip(true, 'the bootstrap account is a platform admin, not a workspace owner');
    }

    await role.selectOption('ANALYST');
    // A workspace with no owner cannot be administered by anyone, so the
    // refusal names the way out.
    await expect(page.locator('[data-sonner-toast]')
      .getByText(/ít nhất một Owner|at least one Owner/)).toBeVisible();
    await expect(role).toHaveValue('OWNER');
  });
});

test.describe('audit log', () => {
  test('records the mutating actions with an actor', async ({ page }) => {
    const workflowId = await createWorkflow(page, unique('E2E audited'));

    await page.goto('/audit');
    await expect(page.getByText('workflow.created').first()).toBeVisible();
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText(OWNER.email);
    await expect(row.getByText(/SUCCESS/)).toBeVisible();

    // The before/after summary is available but folded away, and it is
    // sanitized server-side.
    await row.getByText(/Chi tiết|Details/).click();
    await expect(row.locator('pre')).toBeVisible();

    await deleteWorkflow(page, workflowId);
  });
});
