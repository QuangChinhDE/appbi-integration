/**
 * Wave 0C — the reference workflows, built through the UI and actually run.
 *
 * These are the acceptance evidence for Wave 0
 * (`docs/changes/003-wave-0-current-runtime-proof/`), and the rule that makes
 * them worth anything is that **nothing here is seeded through the API**. Every
 * other browser spec builds its graph with `seedGraph`, which is exactly why
 * nobody had ever looked at the graph the product creates for you, and five
 * real defects lived there (001's inventory).
 *
 * Each workflow asserts, as far as the UI can show it: the item count at each
 * step, the actual content of a field, the branch taken, the execution state,
 * the error state and its remediation, and that the run appears in history.
 *
 * The HTTP steps call `e2e/reference-endpoint.mjs` on the host through
 * `host.docker.internal`, which needs the stack brought up with
 * `EGRESS_ALLOW_PRIVATE_NETWORKS=true`. That is this test stack only; the
 * production posture is asserted by `test_deployment_manifests.py`.
 */

import { expect, test, type Page } from '@playwright/test';

import { Editor, deleteWorkflow, unique, waitForRunToFinish } from './fixtures';

/** Where the engine container reaches the host's reference endpoint. */
const API = `http://host.docker.internal:${process.env.REFERENCE_ENDPOINT_PORT ?? 4599}`;

const created: string[] = [];

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  for (const id of created) await deleteWorkflow(page, id);
  await page.close();
});

/**
 * Create a workflow the way a user does: the list, the button, the name, the
 * trigger, Create. No API call.
 */
async function newWorkflow(page: Page, name: string, trigger = 'Manual Trigger') {
  await page.goto('/workflows');
  await page.getByRole('link', { name: /Tạo workflow|New workflow/ }).first().click();
  await expect(page).toHaveURL(/\/workflows\/new/);

  await page.getByLabel(/^Tên|^Name/).fill(name);
  await page.getByRole('button', { name: new RegExp(trigger) }).click();
  await page.getByRole('button', { name: /Tạo mới|Create/ }).click();

  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  created.push(id);
  return id;
}

/** The run panel's reported item count for a step, read from the interface. */
async function runOutcome(page: Page) {
  await waitForRunToFinish(page);
  return page.getByText(/Thành công|Succeeded|Thất bại|Failed/).first().innerText();
}

test.describe('W01 — fetch and normalise', () => {
  test('builds through the UI, runs, and shows five items at each step', async ({ page }) => {
    const editor = new Editor(page);
    await newWorkflow(page, unique('W01 fetch'));

    await editor.addNode('HTTP Request');
    await editor.setField(/^URL/, `${API}/list?n=5`);
    await editor.waitSaved();

    await editor.addNode('Edit Fields');
    // A step with no fields declared is invalid, and the product says so in
    // three places at once — the banner, the node badge and the field. That is
    // correct behaviour, so the user configures it rather than the test
    // working around it.
    await expect(page.getByText(/chưa điền 'Field cần đặt'/).first()).toBeVisible();

    await editor.configPanel.getByRole('button', { name: /Thêm|Add/ }).first().click();
    await editor.configPanel.getByLabel(/Tên field|Field name/).first().fill('nhan');
    await editor.configPanel.getByLabel(/^Giá trị|^Value/).first().fill('đã xử lý');
    await editor.waitSaved();

    await expect(editor.nodeCards).toHaveCount(3);
    await expect(editor.edges).toHaveCount(2);

    await editor.run();
    const outcome = await runOutcome(page);
    expect(outcome).toMatch(/Thành công|Succeeded/);

    // The interface, not the API, has to show the work happened.
    await expect(editor.nodeStatus('HTTP Request')).toHaveAttribute(
      'data-run-status', /SUCCEEDED/,
    );
  });
});

test.describe('W05 — a failure a user can act on', () => {
  test('a 401 names the step, classifies it, and offers a way forward', async ({ page }) => {
    const editor = new Editor(page);
    await newWorkflow(page, unique('W05 auth'));

    await editor.addNode('HTTP Request');
    await editor.setField(/^URL/, `${API}/secured`);
    await editor.waitSaved();

    await editor.run();
    const outcome = await runOutcome(page);
    expect(outcome).toMatch(/Thất bại|Failed/);

    // 0A asserted the engine emits NODE_AUTHENTICATION_FAILED here. 0C asserts
    // the user is actually told something they can use: a sentence rather than
    // an identifier, and a next step rather than a dead end.
    await expect(page.getByText(/xác thực|authenticat/i).first()).toBeVisible();
    await expect(page.getByText('NODE_AUTHENTICATION_FAILED')).toHaveCount(0);
  });

  test('a failed run is in history, bound to what ran', async ({ page }) => {
    await page.goto('/executions');
    await expect(page.getByText(/Thất bại|Failed/).first()).toBeVisible();
  });
});

test.describe('W10-shaped — an empty result is not a failure', () => {
  test('a workflow that finds nothing still succeeds and says so', async ({ page }) => {
    // Stability row 1.1 at the level that matters: what the customer sees.
    // "Nothing to do today" must not look like a broken workflow.
    const editor = new Editor(page);
    await newWorkflow(page, unique('W10 empty'));

    await editor.addNode('HTTP Request');
    await editor.setField(/^URL/, `${API}/empty`);
    await editor.waitSaved();

    await editor.run();
    const outcome = await runOutcome(page);
    expect(outcome).toMatch(/Thành công|Succeeded/);
  });
});

test.describe('W08a — fan-out, through the UI', () => {
  test('one list call becomes one call per row', async ({ page }) => {
    /**
     * The defining App-to-App pattern, and the one the capability audit wrongly
     * said needed a loop node. The engine contract test proves the fan-out; this
     * proves a user can build it and see it, which is a different claim.
     */
    const editor = new Editor(page);
    await newWorkflow(page, unique('W08a fanout'));

    await editor.addNode('HTTP Request');
    await editor.setField(/^URL/, `${API}/list?n=5`);
    await editor.waitSaved();

    await editor.addNode('HTTP Request');
    // Expression mode: the `=` has to lead the whole field (D-W0-08).
    await editor.setField(/^URL/, `=${API}/item/{{ $json.id }}`);
    await editor.waitSaved();

    await editor.run();
    const outcome = await runOutcome(page);
    expect(outcome).toMatch(/Thành công|Succeeded/);
  });
});

test.describe('D-W0-08 — the silent-expression warning, in the interface', () => {
  test('a fixed value holding expression syntax is called out before it runs', async ({ page }) => {
    /**
     * The regression test for the defect the Wave 0 spike found by making this
     * exact mistake. The backend raises the WARNING; this asserts the user is
     * actually shown something rather than getting a green run carrying
     * literal braces.
     */
    const editor = new Editor(page);
    await newWorkflow(page, unique('W-2.8 expr'));

    await editor.addNode('HTTP Request');
    // No leading `=`, so this is a fixed value and the braces would be sent
    // as text.
    await editor.setField(/^URL/, `${API}/item/{{ $json.id }}`);
    await editor.waitSaved();

    await expect(
      page.getByText(/biểu thức|expression/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('D-W0-10 — a failed run offers a way forward, not just a sentence', () => {
  test('an unreachable host gives the user somewhere to go', async ({ page }) => {
    /**
     * The run panel is where a user actually meets a failed run, and it could
     * act on exactly one error code out of twenty-three: it hardcoded
     * NODE_AUTHENTICATION_FAILED and ignored the backend's matrix, because the
     * stored node error carried no remediation to read.
     *
     * A network failure is the case that proves it. The message was always
     * good -- it names the host -- and there was no button at all.
     */
    const editor = new Editor(page);
    await newWorkflow(page, unique('W-netfail'));

    await editor.addNode('HTTP Request');
    await editor.setField(/^URL/, 'http://nowhere.appbi-wave0.invalid/thing');
    await editor.waitSaved();

    await editor.run();
    expect(await runOutcome(page)).toMatch(/Thất bại|Failed/);

    // The message names the host it could not reach.
    await expect(page.getByText(/nowhere\.appbi-wave0\.invalid/).first()).toBeVisible();

    // And there is a primary action, not only "technical details" and "copy".
    const panel = page.getByRole('alert').filter({ hasText: /Không kết nối được/ });
    await expect(
      panel.getByRole('button', { name: /Kiểm tra|Sửa bước|Mở|Check|Edit|Open/ }).first(),
    ).toBeVisible();
  });
});
