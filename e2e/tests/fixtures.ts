/**
 * Shared page objects and helpers.
 *
 * The locators live here so a change to the editor's markup is one edit rather
 * than fifteen, and so each test reads as a user journey instead of a list of
 * selectors.
 */

import { expect, type Locator, type Page } from '@playwright/test';

/** Unique enough that a re-run does not collide with the last one. */
/**
 * Where `global.setup` leaves this run's workspace id for the teardown.
 *
 * Here rather than in the setup file because Playwright refuses to let one
 * test file import another, and both need the path.
 */
export const RUN_WORKSPACE_FILE = '.auth/run-workspace.json';

export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}

/**
 * The bootstrap owner's credentials.
 *
 * Defined once because the password *changes*: the product forces the account
 * issued by bootstrap to replace it on first sign-in, so `global.setup` moves
 * it to `OWNER.password` and every later run uses that. A spec with the
 * initial value hardcoded would pass on a fresh database and fail on the
 * second run of the same suite.
 */
export const OWNER = {
  email: process.env.E2E_EMAIL ?? 'admin@appbi.vn',
  /** After the forced change. What a test should sign in with. */
  password: process.env.E2E_SETTLED_PASSWORD ?? 'E2EOwnerPassword123',
  /** What bootstrap was given. Only valid before the forced change. */
  initialPassword: process.env.E2E_PASSWORD ?? 'SmokeTestPass123!',
} as const;

export class Editor {
  constructor(private readonly page: Page) {}

  get canvas(): Locator {
    return this.page.locator('.react-flow');
  }

  /** A node card on the canvas, addressed by the name the user gave it. */
  node(name: string): Locator {
    return this.page.locator('.react-flow__node').filter({ hasText: name });
  }

  get nodeCards(): Locator {
    return this.page.locator('.react-flow__node');
  }

  /**
   * The run outcome the canvas is showing for a node.
   *
   * Read from `data-run-status` rather than from a Tailwind class: the class is
   * how it looks, the attribute is what it means, and a test that asserts on
   * the former breaks every time the palette is retouched.
   */
  nodeStatus(name: string): Locator {
    return this.page.locator(`[data-node-name="${name}"]`);
  }

  get edges(): Locator {
    return this.page.locator('.react-flow__edge');
  }

  get saveIndicator(): Locator {
    return this.page.getByText(/Đã lưu|Saved|Đang lưu|Saving/);
  }

  get configPanel(): Locator {
    return this.page.locator('aside').filter({ hasText: /Tên bước|Step name/ });
  }

  /**
   * The palette, wherever this viewport puts it.
   *
   * On a desktop it is a rail beside the canvas; below `xl` there is no room
   * for a third column and it is a sheet. A fixture that knew only about the
   * sheet made nine tests fail the day the rail arrived, none of them about
   * the palette's shape.
   */
  async palette(): Promise<Locator> {
    const rail = this.page.locator('[data-palette="rail"]');
    const collapsed = this.page.locator('[data-palette="collapsed"]');
    const addButton = this.page.getByRole('button', { name: /Thêm bước|Add step/ });

    // Wait for whichever of the three this viewport renders, *before* asking
    // which one it is. `count()` resolves immediately and does not retry, so
    // a call straight after `goto` answered "no rail" -- the page had not
    // hydrated yet -- and sent every desktop test down the narrow-viewport
    // path to click a button that only exists below `xl`. The tests that
    // happened to await the canvas first passed, which made it look like the
    // palette rather than the timing.
    await expect(rail.or(collapsed).or(addButton).first()).toBeVisible();

    if (await collapsed.count()) {
      // Collapsed state persists per browser profile, so a fresh context can
      // legitimately arrive with the rail shut.
      await collapsed.getByRole('button').first().click();
      await expect(rail).toBeVisible();
    }

    if (await rail.count()) return rail;

    await addButton.click();
    const sheet = this.page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    return sheet;
  }

  async addNode(displayName: string) {
    const palette = await this.palette();
    await palette.getByRole('button', { name: new RegExp(displayName) }).first().click();
    // The sheet closes on pick; the rail stays. Waiting for "not visible"
    // unconditionally would hang forever on a desktop.
    if (await this.page.getByRole('dialog').count()) {
      await expect(this.page.getByRole('dialog')).not.toBeVisible();
    }
  }

  async selectNode(name: string) {
    await this.node(name).click();
    await expect(this.configPanel).toBeVisible();
  }

  /** Rename the selected node through the config panel. */
  async renameSelected(name: string) {
    const field = this.configPanel.getByLabel(/Tên bước|Step name/);
    await field.fill(name);
    await field.blur();
  }

  async setField(label: string | RegExp, value: string) {
    await this.configPanel.getByLabel(label).fill(value);
  }

  async chooseOption(label: string | RegExp, value: string) {
    await this.configPanel.getByLabel(label).selectOption(value);
  }

  /** Wait for autosave to settle, so the next action reads a saved draft. */
  async waitSaved() {
    await expect(this.page.getByText(/Đã lưu|Saved/)).toBeVisible({ timeout: 20_000 });
  }

  async run() {
    await this.page.getByRole('button', { name: /^Run$/ }).click();
  }

  get runPanel(): Locator {
    return this.page.locator('div').filter({ hasText: /Dữ liệu chạy|Run data/ }).last();
  }
}

/**
 * The status a node shows on the canvas after a run.
 *
 * Read from the card rather than from the API: the point of these tests is
 * that the *interface* tells the truth.
 */
export async function waitForRunToFinish(page: Page) {
  // The header's Run button stops spinning, and the panel shows a terminal
  // execution badge.
  await expect(
    page.getByText(/Thành công|Succeeded|Thất bại|Failed|Đã hủy|Cancelled/).first(),
  ).toBeVisible({ timeout: 60_000 });
}

/** Seed a workflow graph through the API, for tests about what comes after. */
export async function seedGraph(
  page: Page,
  workflowId: string,
  graph: unknown,
): Promise<number> {
  const draft = await page.request.get(`/api/v1/workflows/${workflowId}/draft`);
  const revision = (await draft.json()).revision as number;
  const saved = await page.request.put(`/api/v1/workflows/${workflowId}/draft`, {
    data: { graph, expected_revision: revision },
  });
  expect(saved.ok()).toBeTruthy();
  return (await saved.json()).revision as number;
}

export async function createWorkflow(
  page: Page,
  name: string,
  triggerNodeKey = 'manual_trigger',
): Promise<string> {
  const response = await page.request.post('/api/v1/workflows', {
    data: { name, trigger_node_key: triggerNodeKey },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).id as string;
}

/**
 * Remove a workflow a test created, and fail if it does not go.
 *
 * Both calls used to be `.catch(() => {})`, so a delete that was refused --
 * an active trigger, a permission the test had just revoked from itself, a
 * 500 -- left the row behind and said nothing. Seventy-five of them
 * accumulated in the shared workspace before anybody counted.
 *
 * The deactivate is still allowed to fail: a workflow that was never
 * activated returns a conflict, and that is not an error. The delete is not.
 * `404` counts as gone, because a test that cleans up twice is tidy, not
 * broken.
 */
export async function deleteWorkflow(page: Page, workflowId: string) {
  await page.request.post(`/api/v1/workflows/${workflowId}/deactivate`)
    .catch(() => {});

  // The product refuses to delete a workflow that is running -- correctly; a
  // row that vanishes mid-execution is a worse outcome than a refused delete.
  // Several tests fire a run and tear down immediately, so the refusal is the
  // normal case for them, and the old `.catch(() => {})` turned it into a
  // leaked row nobody was told about. This waits the run out instead, and
  // cancels first so it does not wait for a timeout it could have ended.
  const deadline = Date.now() + 30_000;
  let last = '';
  for (;;) {
    const response = await page.request.delete(`/api/v1/workflows/${workflowId}`);
    if (response.ok() || response.status() === 404) return;

    last = `${response.status()} ${await response.text()}`;
    if (!last.includes('WORKFLOW_ALREADY_RUNNING') || Date.now() > deadline) {
      throw new Error(
        `cleanup failed: DELETE /workflows/${workflowId} returned ${last}`);
    }

    await cancelRunning(page, workflowId);
    await page.waitForTimeout(500);
  }
}

/** Cancel whatever is still in flight for a workflow, best effort. */
async function cancelRunning(page: Page, workflowId: string) {
  const response = await page.request.get(
    `/api/v1/executions?workflow_id=${workflowId}&page_size=50`);
  if (!response.ok()) return;
  const body = await response.json();
  for (const row of (body.items ?? []) as { id: string; status: string }[]) {
    if (row.status === 'RUNNING' || row.status === 'QUEUED') {
      await page.request.post(`/api/v1/executions/${row.id}/cancel`)
        .catch(() => {});
    }
  }
}

/**
 * Every workflow this run can still see, with the E2E ones separated out.
 *
 * Used by the teardown to prove the suite left nothing behind. Paged, because
 * "nothing left" is a claim about all of them and the default page is 20.
 */
export async function visibleWorkflows(page: Page): Promise<
  { id: string; name: string }[]
> {
  const out: { id: string; name: string }[] = [];
  for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
    const response = await page.request.get(
      `/api/v1/workflows?page=${pageNumber}&page_size=100`);
    if (!response.ok()) break;
    const body = await response.json();
    const items = (body.items ?? []) as { id: string; name: string }[];
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

/** A three-node graph: start -> edit fields -> if, wired and valid. */
export function branchingGraph() {
  return {
    nodes: [
      {
        id: 'start_1', node_key: 'manual_trigger', name: 'Bắt đầu',
        position: { x: 80, y: 220 }, config: {},
      },
      {
        id: 'set_1', node_key: 'edit_fields', name: 'Chuẩn hóa',
        position: { x: 360, y: 220 },
        config: {
          assignments: [
            { name: 'tier', type: 'string', value: '={{ $json.plan }}' },
            { name: 'double', type: 'string', value: '={{ $json.amount * 2 }}' },
          ],
          keep_only_set: false,
        },
      },
      {
        id: 'if_1', node_key: 'if', name: 'Là VIP',
        position: { x: 640, y: 220 },
        config: {
          combinator: 'and',
          conditions: [{
            left: '={{ $json.plan }}', operator: 'equals',
            value_type: 'string', right: 'vip',
          }],
        },
      },
      {
        id: 'set_vip', node_key: 'edit_fields', name: 'Gắn nhãn VIP',
        position: { x: 920, y: 120 },
        config: { assignments: [{ name: 'label', type: 'string', value: 'VIP' }] },
      },
      {
        id: 'set_std', node_key: 'edit_fields', name: 'Gắn nhãn thường',
        position: { x: 920, y: 320 },
        config: { assignments: [{ name: 'label', type: 'string', value: 'STANDARD' }] },
      },
    ],
    connections: [
      { from: { node_id: 'start_1', port: 'main' }, to: { node_id: 'set_1', port: 'main' } },
      { from: { node_id: 'set_1', port: 'main' }, to: { node_id: 'if_1', port: 'main' } },
      { from: { node_id: 'if_1', port: 'true' }, to: { node_id: 'set_vip', port: 'main' } },
      { from: { node_id: 'if_1', port: 'false' }, to: { node_id: 'set_std', port: 'main' } },
    ],
  };
}
