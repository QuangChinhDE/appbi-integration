/**
 * The workflow editor — the journey the product exists for (SRS 9.1).
 *
 * Everything here goes through the canvas and the config panel. When a node
 * turns green, it is because the product API dispatched to the worker, the
 * worker called the engine, the engine compiled the graph and n8n-core ran it.
 */

import { expect, test } from '@playwright/test';

import {
  Editor, branchingGraph, createWorkflow, deleteWorkflow, seedGraph, unique,
  waitForRunToFinish,
} from './fixtures';

test.describe('creating a workflow', () => {
  const created: string[] = [];

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    for (const id of created) await deleteWorkflow(page, id);
    await page.close();
  });

  test('a new workflow opens in the editor with its trigger already there',
    async ({ page }) => {
      const name = unique('E2E create');

      await page.goto('/workflows');
      await page.getByRole('link', { name: /Tạo workflow|New workflow/ }).first().click();
      await expect(page).toHaveURL(/\/workflows\/new/);

      await page.getByLabel(/^Tên|^Name/).fill(name);
      // The trigger is a choice made here because it changes the shape of
      // everything after it.
      await page.getByRole('button', { name: /Manual Trigger/ }).click();
      await page.getByRole('button', { name: /Tạo mới|Create/ }).click();

      await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/);
      created.push(page.url().split('/').pop()!);

      const editor = new Editor(page);
      await expect(editor.canvas).toBeVisible();
      // A blank canvas is a puzzle; the trigger is already on it (SRS 17.2).
      await expect(editor.nodeCards).toHaveCount(1);
      await expect(page.getByRole('textbox').first()).toHaveValue(name);
    });

  test('a webhook workflow arrives complete, and shows its URL',
    async ({ page }) => {
      /**
       * The whole first-minute experience for the most common trigger.
       *
       * Every other test in this file seeds its graph through the API, which
       * is why none of them noticed that the *seeded* one was wrong: a
       * webhook workflow was created with the manual trigger's name, an empty
       * config and a MANUAL binding. What that produced on screen was a step
       * called "Khi bấm Run" on a webhook workflow, a header badge reading
       * "Thủ công", no webhook URL anywhere, and validation reporting
       * `HTTP method` as unfilled while the panel showed it set to POST.
       */
      const name = unique('E2E webhook seed');

      await page.goto('/workflows/new');
      await page.getByLabel(/^Tên|^Name/).fill(name);
      await page.getByRole('button', { name: /Webhook Trigger/ }).click();
      await page.getByRole('button', { name: /Tạo mới|Create/ }).click();
      await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/);
      created.push(page.url().split('/').pop()!);

      const editor = new Editor(page);
      await expect(editor.nodeCards).toHaveCount(1);

      // Named for the trigger that was chosen, not for a different one.
      await expect(editor.node('Khi có request')).toBeVisible();
      await expect(editor.node('Khi bấm Run')).toHaveCount(0);

      // The header says what kind of workflow this is.
      await expect(page.getByText(/^Webhook$/).first()).toBeVisible();

      // Nothing is wrong with it yet. A brand-new workflow that greets its
      // author with two validation errors -- for fields the form shows as
      // filled -- is the worst first impression the product can make.
      await expect(page.getByText(/chưa điền|has not filled/)).toHaveCount(0);

      await editor.selectNode('Khi có request');

      // The defaults are real values, not placeholder rendering: the panel
      // and the stored config have to agree.
      await expect(editor.configPanel.getByLabel(/HTTP method/))
        .toHaveValue('POST');
      const draft = await (await page.request.get(
        `/api/v1/workflows/${page.url().split('/').pop()}/draft`)).json();
      expect(draft.graph.nodes[0].config).toMatchObject({
        method: 'POST',
        auth_mode: 'HEADER_SIGNATURE',
        allowed_content_type: 'application/json',
      });

      // And the one thing a webhook is for: the URL, present from creation
      // rather than after the first edit, with a way to copy it.
      const url = editor.configPanel.locator('code');
      await expect(url).toBeVisible();
      expect(await url.innerText()).toMatch(/\/hooks\/[0-9a-f]{32}$/);
      await expect(editor.configPanel.getByText(/Đã cấu hình|Configured/))
        .toBeVisible();
    });

  test('the name field refuses to be emptied', async ({ page }) => {
    await page.goto('/workflows/new');
    await expect(page.getByRole('button', { name: /Tạo mới|Create/ })).toBeDisabled();
    await page.getByLabel(/^Tên|^Name/).fill('   ');
    await expect(page.getByRole('button', { name: /Tạo mới|Create/ })).toBeDisabled();
  });
});

test.describe('building a graph', () => {
  let workflowId: string;

  test.beforeEach(async ({ page }) => {
    workflowId = await createWorkflow(page, unique('E2E build'));
  });

  test.afterEach(async ({ page }) => {
    await deleteWorkflow(page, workflowId);
  });

  test('adds a step from the palette, wires it and saves the draft',
    async ({ page }) => {
      const editor = new Editor(page);
      await page.goto(`/workflows/${workflowId}`);
      await expect(editor.nodeCards).toHaveCount(1);

      await editor.addNode('HTTP Request');

      // Adding a step after the selected one wires it: making the user draw
      // every edge by hand is friction with no upside.
      await expect(editor.nodeCards).toHaveCount(2);
      await expect(editor.edges).toHaveCount(1);

      // The config panel opens on the node just added.
      await expect(editor.configPanel).toBeVisible();
      await expect(editor.configPanel.getByText('HTTP Request')).toBeVisible();

      await editor.setField(/^URL/, 'https://api.example.com/customers');
      await editor.chooseOption(/Method/, 'POST');
      await editor.waitSaved();

      // The canvas card summarises what the step is configured to do, so a long
      // chain is readable without opening each one.
      await expect(editor.node('HTTP Request')).toContainText('POST');

      // And the draft really is on the server.
      const draft = await page.request.get(`/api/v1/workflows/${workflowId}/draft`);
      const body = await draft.json();
      expect(body.graph.nodes).toHaveLength(2);
      expect(body.graph.connections).toHaveLength(1);
      expect(body.revision).toBeGreaterThan(1);
    });

  test('a required field that is empty blocks the run and says which step',
    async ({ page }) => {
      const editor = new Editor(page);
      await page.goto(`/workflows/${workflowId}`);
      await editor.addNode('HTTP Request');
      await editor.waitSaved();

      // URL is required and empty: the strip names the problem and Run is off.
      await expect(page.getByText(/chưa điền|has not filled|URL/).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /^Run$/ })).toBeDisabled();

      await editor.setField(/^URL/, 'https://api.example.com');
      await editor.waitSaved();
      await expect(page.getByRole('button', { name: /^Run$/ })).toBeEnabled();
    });

  test('renaming a step updates the card and the saved draft', async ({ page }) => {
    const editor = new Editor(page);
    await page.goto(`/workflows/${workflowId}`);

    await editor.selectNode('Khi bấm Run');
    await editor.renameSelected('Khởi động');
    await editor.waitSaved();

    await expect(editor.node('Khởi động')).toBeVisible();
    const draft = await page.request.get(`/api/v1/workflows/${workflowId}/draft`);
    expect((await draft.json()).graph.nodes[0].name).toBe('Khởi động');
  });

  test('deleting a step removes it and its connection', async ({ page }) => {
    const editor = new Editor(page);
    await page.goto(`/workflows/${workflowId}`);
    await editor.addNode('Edit Fields');
    await expect(editor.edges).toHaveCount(1);
    await editor.waitSaved();

    await editor.configPanel.getByRole('button', { name: /Xóa bước|Delete step/ }).click();
    await expect(editor.nodeCards).toHaveCount(1);
    await expect(editor.edges).toHaveCount(0);
    await editor.waitSaved();
  });

  test('the palette stops offering a second trigger', async ({ page }) => {
    // V1 allows exactly one start (SRS 17.1), so offering another is offering
    // an error.
    const editor = new Editor(page);
    await page.goto(`/workflows/${workflowId}`);

    const palette = await editor.palette();
    await expect(palette.getByRole('button', { name: /HTTP Request/ })).toBeVisible();
    await expect(palette.getByRole('button', { name: /Manual Trigger/ })).toHaveCount(0);
    await expect(palette.getByRole('button', { name: /Webhook Trigger/ })).toHaveCount(0);
  });

  test('the palette searches', async ({ page }) => {
    const editor = new Editor(page);
    await page.goto(`/workflows/${workflowId}`);
    const palette = await editor.palette();

    await palette.getByRole('textbox').fill('merge');
    await expect(palette.getByRole('button', { name: /Merge/ })).toBeVisible();
    await expect(palette.getByRole('button', { name: /HTTP Request/ })).toHaveCount(0);

    await palette.getByRole('textbox').fill('nothing matches this');
    await expect(palette.getByText(/Không có kết quả|no results/i)).toBeVisible();
  });

  test('undo puts back a deleted step', async ({ page }) => {
    const editor = new Editor(page);
    await page.goto(`/workflows/${workflowId}`);
    await editor.addNode('Edit Fields');
    await expect(editor.nodeCards).toHaveCount(2);
    await editor.waitSaved();

    await editor.configPanel.getByRole('button', { name: /Xóa bước|Delete step/ }).click();
    await expect(editor.nodeCards).toHaveCount(1);

    await page.getByRole('button', { name: /Hoàn tác|Undo/ }).click();
    await expect(editor.nodeCards).toHaveCount(2);
  });
});

test.describe('the expression editor', () => {
  let workflowId: string;

  test.beforeEach(async ({ page }) => {
    workflowId = await createWorkflow(page, unique('E2E expression'));
  });
  test.afterEach(async ({ page }) => {
    await deleteWorkflow(page, workflowId);
  });

  test('a field switches between a literal and an expression', async ({ page }) => {
    const editor = new Editor(page);
    await page.goto(`/workflows/${workflowId}`);
    await editor.addNode('HTTP Request');

    await editor.setField(/^URL/, 'https://api.example.com');
    await editor.waitSaved();

    await editor.configPanel
      .getByRole('button', { name: /Dùng biểu thức|Use an expression/ }).click();
    // The expression state is visibly different, not just a different value.
    await expect(editor.configPanel.getByText(/Biểu thức|Expression/).first()).toBeVisible();

    await editor.configPanel.getByRole('textbox').last()
      .fill('{{ $json.customer_url }}');
    await editor.waitSaved();

    const draft = await page.request.get(`/api/v1/workflows/${workflowId}/draft`);
    const http = (await draft.json()).graph.nodes
      .find((node: { node_key: string }) => node.node_key === 'http_request');
    // Stored with the `=` marker the compiler and the engine agree on.
    expect(http.config.url).toBe('={{ $json.customer_url }}');
  });
});

test.describe('running a draft', () => {
  let workflowId: string;

  test.beforeEach(async ({ page }) => {
    workflowId = await createWorkflow(page, unique('E2E run'));
    await seedGraph(page, workflowId, branchingGraph());
  });
  test.afterEach(async ({ page }) => {
    await deleteWorkflow(page, workflowId);
  });

  test('Run shows per-node status and real output on the canvas',
    async ({ page }) => {
      const editor = new Editor(page);
      await page.goto(`/workflows/${workflowId}`);
      await expect(editor.nodeCards).toHaveCount(5);

      await editor.run();
      await waitForRunToFinish(page);

      // Every step reports what happened, on the card, without opening a panel.
      await expect(editor.node('Bắt đầu')).toContainText('item');
      await expect(editor.node('Chuẩn hóa')).toContainText('item');

      // The run panel lists the steps with their durations.
      await expect(page.getByText(/Dữ liệu chạy|Run data/)).toBeVisible();
      await expect(page.getByRole('button', { name: /Dữ liệu ra|Output/ })).toBeVisible();

      // And the output really is what n8n produced: the expression resolved.
      await page.getByRole('button', { name: 'Chuẩn hóa' }).first().click();
      await expect(page.getByText('tier').first()).toBeVisible();
    });

  test('the untaken branch is greyed out rather than left looking pending',
    async ({ page }) => {
      const editor = new Editor(page);
      await page.goto(`/workflows/${workflowId}`);
      await editor.run();
      await waitForRunToFinish(page);

      // With no payload the IF condition is false, so the VIP branch is skipped
      // and the canvas has to say so -- not leave it looking like it is still
      // about to run.
      await expect(editor.nodeStatus('Gắn nhãn VIP'))
        .toHaveAttribute('data-run-status', 'SKIPPED');
      await expect(editor.nodeStatus('Gắn nhãn thường'))
        .toHaveAttribute('data-run-status', 'SUCCEEDED');
    });

  test('an execution appears in the history with the draft revision it ran',
    async ({ page }) => {
      const editor = new Editor(page);
      await page.goto(`/workflows/${workflowId}`);
      await editor.run();
      await waitForRunToFinish(page);

      await page.getByRole('link', { name: /Lần chạy|Executions/ }).click();
      await expect(page).toHaveURL(/\/executions/);

      const row = page.locator('tbody tr').first();
      await expect(row).toContainText('draft');
      await expect(row.getByText(/Thành công|Succeeded/)).toBeVisible();
    });
});
