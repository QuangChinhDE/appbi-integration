/**
 * How the product looks, at the widths people use.
 *
 * The rest of the suite runs at one viewport, 1600x1000, and only keeps a
 * screenshot when a test fails. So 109 passing tests were compatible with a
 * toolbar whose Run button was sliced in half by the right edge of a phone,
 * and with the entire metadata layer of the interface set at 10px.
 *
 * Two kinds of check here, because they catch different things:
 *
 * * **Measured invariants** -- no horizontal overflow, no text rendering below
 *   12px *after transforms*, the primary action inside the viewport, and a
 *   real minimum for how much of the editor is canvas rather than panel. These
 *   encode the review's rules directly, they say which element broke and by
 *   how much, and they never go flaky over a font hinting difference.
 *
 * * **Pixel baselines** of the screens people actually work in, with data in
 *   them: the overview, the editor with a real graph, and an execution that
 *   succeeded and one that failed. Timestamps and durations are masked --
 *   marked `data-volatile` at the few places that render them -- because a
 *   baseline that fails on the day "2 days ago" becomes "3 days ago" is a
 *   baseline nobody keeps. Everything else in the frame is asserted.
 *
 * Run with `--update-snapshots` to accept a deliberate visual change, and look
 * at the diff before you do.
 */

import { expect, test } from '@playwright/test';

import { createWorkflow, deleteWorkflow, seedGraph, unique } from './fixtures';

/**
 * The widths the review names, and how much canvas the editor owes at each.
 *
 * `canvasIdle` is with nothing selected, `canvasBusy` with a step open in the
 * inspector. Real numbers rather than "more than 200px", which everything
 * passes and which proved exactly nothing: at 1280 the canvas was 435px --
 * a third of the window -- and the test was green.
 *
 * `idleZoom` is how far the canvas may auto-zoom out to frame a *whole graph*,
 * which is a different question from how readable a step is while you work on
 * it. That second one is `FOCUS_ZOOM_FLOOR` below and it is the one that
 * matters: accepting 0.5 as the answer to both is how this test came to
 * certify an editor whose selected step was too small to see.
 *
 * The budget at 1280: 1280 total, less a 240px sidebar, less a 44px collapsed
 * palette, leaves 996. With the 380px inspector open, 616.
 */
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900,
    canvasIdle: 1050, canvasBusy: 670, idleZoom: 0.5 },
  { name: '1280x800', width: 1280, height: 800,
    canvasIdle: 900, canvasBusy: 600, idleZoom: 0.5 },
  // A phone shows the canvas alone: no sidebar column, no palette, no
  // inspector. The editor is a viewer here (see `useBelowMd`), and the canvas
  // is never auto-zoomed at all, so its labels stay at their declared size.
  { name: '390x844', width: 390, height: 844,
    canvasIdle: 340, canvasBusy: 340, idleZoom: 1 },
] as const;

/** The smallest type the product is allowed to render. */
const MIN_FONT_PX = 12;

/**
 * How small a *selected* step may be.
 *
 * Selecting a step is the editor saying "work on this one", and the canvas now
 * frames it rather than refitting the graph. Below this the step is not
 * workable, whatever the rest of the graph is doing.
 */
const FOCUS_ZOOM_FLOOR = 0.85;

/**
 * Elements whose text renders below the floor **on screen**.
 *
 * `getComputedStyle().fontSize` is the CSS value, not the rendered one, so the
 * size is multiplied by the cumulative scale of every transformed ancestor:
 * a 12px label inside a canvas fitted at 0.75 renders at 9px, and the first
 * version of this check reported 12px and passed. `DOMMatrix` on the computed
 * `transform` gives the scale, and walking the chain covers nesting.
 *
 * The canvas viewport itself is excluded, and that is a decision rather than
 * an exemption. It is a zoomable surface — a map — and the guarantee there is
 * a different one: the product may not *auto-zoom* below a stated floor, which
 * `canvasZoom` below asserts directly, and the person can always zoom back to
 * 100%. Holding a map to "no text under 12px at any zoom" would mean never
 * fitting a graph that does not fit, which is how a six-step workflow came to
 * open showing three of them.
 *
 * Only elements with their own text: a `<div>` inheriting a size but rendering
 * no characters of its own is not something anyone is squinting at.
 */
async function tooSmall(page: import('@playwright/test').Page) {
  return page.evaluate((floor) => {
    /** Cumulative scale applied to this element by its ancestors and itself. */
    const scaleOf = (start: Element): number => {
      let scale = 1;
      let node: Element | null = start;
      while (node && node !== document.documentElement) {
        const transform = window.getComputedStyle(node).transform;
        if (transform && transform !== 'none') {
          try {
            const matrix = new DOMMatrix(transform);
            // Uniform zoom in practice; taking the vertical component because
            // that is the one that decides whether type is legible.
            scale *= Math.abs(matrix.d) || 1;
          } catch {
            // An unparseable transform is not a reason to fail the page.
          }
        }
        node = node.parentElement;
      }
      return scale;
    };

    const canvas = document.querySelector('.react-flow__viewport');

    const out: {
      text: string; declared: number; rendered: number; tag: string; cls: string;
    }[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (canvas && canvas.contains(el)) continue;
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? '').trim())
        .join('')
        .trim();
      if (!own) continue;
      const box = (el as HTMLElement).getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const declared = Number.parseFloat(style.fontSize);
      if (!Number.isFinite(declared)) continue;
      const rendered = declared * scaleOf(el);
      // Half a pixel of slack: a 0.75 zoom on a 12px label is a defect, a
      // rounding difference of 11.98 is not.
      if (rendered < floor - 0.5) {
        out.push({
          text: own.slice(0, 40),
          declared,
          rendered: Math.round(rendered * 10) / 10,
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute('class') ?? '').slice(0, 70),
        });
      }
    }
    return out;
  }, MIN_FONT_PX);
}

/**
 * The canvas's current zoom.
 *
 * The guarantee that replaces the font floor inside the canvas: the product
 * never fits a graph below this, whatever the graph. On a phone that is 1, so
 * a 12px label stays 12px; on a desktop 0.5, where zooming back in is one
 * click and seeing the whole graph is worth more.
 */
async function canvasZoom(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport');
    if (!viewport) return null;
    const transform = window.getComputedStyle(viewport).transform;
    if (!transform || transform === 'none') return 1;
    return Math.abs(new DOMMatrix(transform).d);
  });
}

/** How far the document scrolls sideways. Anything above zero is a defect. */
async function horizontalOverflow(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      // The widest offender, to make the failure actionable rather than just
      // true. Without this the message is "something is 40px too wide".
      widest: Array.from(document.body.querySelectorAll('*'))
        .map((el) => {
          const box = el.getBoundingClientRect();
          return {
            right: Math.round(box.right),
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute('class') ?? '').slice(0, 60),
          };
        })
        .filter((row) => row.right > doc.clientWidth + 1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 3),
    };
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('the overview fits its viewport and reads at 12px or more', async ({ page }) => {
      await page.goto('/overview');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // The figures strip is the last thing to render; without it the page is
      // measured half-built and passes for the wrong reason.
      await page.waitForLoadState('networkidle');

      const { overflow, widest } = await horizontalOverflow(page);
      expect(overflow, `widest: ${JSON.stringify(widest)}`).toBeLessThanOrEqual(0);
      expect(await tooSmall(page)).toEqual([]);
    });

    test('the executions list fits its viewport', async ({ page }) => {
      await page.goto('/executions');
      await page.waitForLoadState('networkidle');

      // A table of runs is the most likely thing to push a narrow page
      // sideways, and it is allowed to scroll *inside its own container* --
      // which is why this asserts on the document, not on the table.
      const { overflow, widest } = await horizontalOverflow(page);
      expect(overflow, `widest: ${JSON.stringify(widest)}`).toBeLessThanOrEqual(0);
      expect(await tooSmall(page)).toEqual([]);
    });

    test('the editor keeps Run on screen and the canvas visible', async ({ page }) => {
      const name = unique('Visual');
      const id = await createWorkflow(page, name);
      try {
        await page.goto(`/workflows/${id}`);
        await expect(page.locator('.react-flow__node').first()).toBeVisible();
        await page.waitForLoadState('networkidle');

        const { overflow, widest } = await horizontalOverflow(page);
        expect(overflow, `widest: ${JSON.stringify(widest)}`).toBeLessThanOrEqual(0);

        // The button the screen exists for. It was being cut in half by the
        // window edge at 390px, and a passing suite had nothing to say about
        // it, because nothing was looking.
        const run = page.getByRole('button', { name: /^Run$/ });
        if (await run.count()) {
          const box = await run.first().boundingBox();
          expect(box, 'Run has no box').not.toBeNull();
          expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
          expect(box!.x).toBeGreaterThanOrEqual(0);
        }

        // The canvas is the subject of this screen, and the side panels are
        // not allowed to take it. Idle first: nothing selected, so the
        // inspector must not be mounted at all and the palette must be shut.
        const canvas = page.locator('.react-flow').first();
        const idle = await canvas.boundingBox();
        expect(idle, 'no canvas').not.toBeNull();
        expect(
          Math.round(idle!.width),
          `canvas with nothing selected, at ${viewport.name}`,
        ).toBeGreaterThanOrEqual(viewport.canvasIdle);
        expect(idle!.height).toBeGreaterThan(200);

        // Framing the whole graph is allowed to go small -- that is what a
        // fit is for -- but not unboundedly, and never on a phone.
        const idleZoom = await canvasZoom(page);
        expect(
          Number(idleZoom!.toFixed(2)),
          `whole-graph fit at ${viewport.name}`,
        ).toBeGreaterThanOrEqual(viewport.idleZoom);

        expect(await tooSmall(page)).toEqual([]);

        // Then with a step open, which is the state a person edits in.
        await page.locator('.react-flow__node').first().click();
        if (viewport.width >= 1280) {
          await expect(page.locator('aside').filter({ hasText: /Tên bước/ }))
            .toBeVisible();
        }
        await page.waitForTimeout(400);
        const busy = await canvas.boundingBox();
        expect(
          Math.round(busy!.width),
          `canvas while configuring a step, at ${viewport.name}`,
        ).toBeGreaterThanOrEqual(viewport.canvasBusy);

        // And the chrome is still legible with the panel open.
        expect(await tooSmall(page)).toEqual([]);

        // The step being configured has to be workable. This is the check
        // that matters, and the one that was missing: the previous version
        // accepted the *whole-graph* floor of 0.5 here, which is how a
        // selected step ended up rendering at half size with the test green.
        const focusZoom = await canvasZoom(page);
        expect(focusZoom, 'no canvas transform found').not.toBeNull();
        expect(
          Number(focusZoom!.toFixed(2)),
          `zoom on the selected step at ${viewport.name}`,
        ).toBeGreaterThanOrEqual(FOCUS_ZOOM_FLOOR);
      } finally {
        await deleteWorkflow(page, id);
      }
    });
  });
}

test.describe('pixel baseline: sign-in', () => {
  // Signed out, so this project's stored session must not apply.
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const viewport of VIEWPORTS) {
    test(`the sign-in page at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/login');
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page).toHaveScreenshot(`login-${viewport.name}.png`, {
        animations: 'disabled',
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});

/**
 * The screens with data in them.
 *
 * Built by the test rather than found: a baseline of whatever happens to be in
 * the workspace is a baseline of the last run's leftovers. This seeds a graph
 * of six steps with fixed names, runs it once, and breaks one step on purpose
 * so there is a failure to photograph too.
 */
test.describe('pixel baseline: the product with data in it', () => {
  test.describe.configure({ mode: 'serial' });

  let goodId = '';
  let badId = '';
  let goodRun = '';
  let badRun = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: '.auth/owner.json' });

    // Fixed names, so the picture is the same next week. `unique()` would put
    // a timestamp in the frame and every baseline would fail on the next run.
    goodId = await createWorkflow(page, 'Ảnh mẫu · đơn hàng');
    badId = await createWorkflow(page, 'Ảnh mẫu · lỗi mạng');

    await seedGraph(page, goodId, sampleGraph());
    await seedGraph(page, badId, brokenGraph());

    goodRun = await runToCompletion(page, goodId);
    badRun = await runToCompletion(page, badId);

    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: '.auth/owner.json' });
    for (const id of [goodId, badId]) {
      if (id) await deleteWorkflow(page, id);
    }
    await page.close();
  });

  for (const viewport of VIEWPORTS) {
    test.describe(`at ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test('the overview', async ({ page }) => {
        await page.goto('/overview');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot(`overview-${viewport.name}.png`, {
          animations: 'disabled',
          mask: [page.locator('[data-volatile]')],
          maxDiffPixelRatio: 0.01,
        });
      });

      test('the editor with a graph and a step open', async ({ page }) => {
        await page.goto(`/workflows/${goodId}`);
        await expect(page.locator('.react-flow__node').first()).toBeVisible();
        await page.waitForLoadState('networkidle');

        // A step selected, because that is the state the editor is used in and
        // the one whose layout the review was about.
        await page.locator('.react-flow__node').filter({ hasText: 'Chuẩn hoá' })
          .first().click();
        await page.waitForTimeout(600);

        await expect(page).toHaveScreenshot(`editor-${viewport.name}.png`, {
          animations: 'disabled',
          mask: [page.locator('[data-volatile]')],
          maxDiffPixelRatio: 0.01,
        });
      });

      test('an execution that succeeded', async ({ page }) => {
        await page.goto(`/executions/${goodRun}`);
        await expect(page.getByText(/Dữ liệu chạy|Run data/)).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot(`run-ok-${viewport.name}.png`, {
          animations: 'disabled',
          mask: [page.locator('[data-volatile]')],
          maxDiffPixelRatio: 0.01,
        });
      });

      test('an execution that failed', async ({ page }) => {
        await page.goto(`/executions/${badRun}`);
        await expect(page.getByText(/Dữ liệu chạy|Run data/)).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot(`run-failed-${viewport.name}.png`, {
          animations: 'disabled',
          mask: [page.locator('[data-volatile]')],
          maxDiffPixelRatio: 0.01,
        });
      });
    });
  }
});

/** Six steps with fixed names, so next week's baseline is the same picture. */
function sampleGraph() {
  const set = (name: string, value: string) => ({
    assignments: [{ name, type: 'string', value }],
    keep_only_set: false,
  });
  return {
    nodes: [
      { id: 'start_1', node_key: 'manual_trigger', name: 'Khi bấm Run',
        position: { x: 40, y: 200 }, config: {} },
      { id: 'set_1', node_key: 'edit_fields', name: 'Chuẩn hoá đơn',
        position: { x: 300, y: 200 }, config: set('trang_thai', 'da_nhan') },
      { id: 'if_1', node_key: 'if', name: 'Trên 5 triệu?',
        position: { x: 560, y: 200 },
        config: {
          combinator: 'and',
          conditions: [{
            left: '={{ $json.gia_tri }}', operator: 'gt',
            value_type: 'number', right: '5000000',
          }],
        } },
      { id: 'set_2', node_key: 'edit_fields', name: 'Chờ duyệt tay',
        position: { x: 820, y: 100 }, config: set('duyet', 'thu_cong') },
      { id: 'set_3', node_key: 'edit_fields', name: 'Tự động duyệt',
        position: { x: 820, y: 300 }, config: set('duyet', 'tu_dong') },
      { id: 'merge_1', node_key: 'merge', name: 'Gộp kết quả',
        position: { x: 1080, y: 200 }, config: { mode: 'APPEND' } },
    ],
    connections: [
      { from: { node_id: 'start_1', port: 'main' }, to: { node_id: 'set_1', port: 'main' } },
      { from: { node_id: 'set_1', port: 'main' }, to: { node_id: 'if_1', port: 'main' } },
      { from: { node_id: 'if_1', port: 'true' }, to: { node_id: 'set_2', port: 'main' } },
      { from: { node_id: 'if_1', port: 'false' }, to: { node_id: 'set_3', port: 'main' } },
      { from: { node_id: 'set_2', port: 'main' }, to: { node_id: 'merge_1', port: 'input_1' } },
      { from: { node_id: 'set_3', port: 'main' }, to: { node_id: 'merge_1', port: 'input_2' } },
    ],
  };
}

/** A graph that fails, so the error screen has something to photograph. */
function brokenGraph() {
  return {
    nodes: [
      { id: 'start_1', node_key: 'manual_trigger', name: 'Khi bấm Run',
        position: { x: 80, y: 200 }, config: {} },
      { id: 'http_1', node_key: 'http_request', name: 'Gọi API đối tác',
        position: { x: 360, y: 200 },
        config: {
          method: 'GET',
          // A name that cannot resolve, on purpose. Not a private address:
          // the egress guard would refuse that before the request left, and
          // the screen under test is the one for a *network* failure.
          url: 'https://api.invalid.example/orders',
          response_format: 'json',
        } },
    ],
    connections: [
      { from: { node_id: 'start_1', port: 'main' }, to: { node_id: 'http_1', port: 'main' } },
    ],
  };
}

/** Run a workflow's draft and wait for it to finish, whichever way it ends. */
async function runToCompletion(
  page: import('@playwright/test').Page,
  workflowId: string,
): Promise<string> {
  const started = await page.request.post(
    `/api/v1/workflows/${workflowId}/executions`,
    { data: { kind: 'DRAFT', payload: { gia_tri: 8_500_000 } } });
  expect(started.ok(), `could not start a run: ${await started.text()}`)
    .toBeTruthy();
  const { id } = await started.json();

  await expect(async () => {
    const detail = await (await page.request.get(`/api/v1/executions/${id}`)).json();
    expect(['SUCCEEDED', 'FAILED', 'CANCELLED']).toContain(detail.status);
  }).toPass({ timeout: 60_000 });

  return id as string;
}
