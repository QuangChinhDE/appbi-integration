/**
 * An exploratory walk through the product, as a person rather than as a test.
 *
 *   node ux-walkthrough.mjs            # headless, screenshots only
 *   node ux-walkthrough.mjs --headed   # watch it happen
 *
 * Not a test: nothing here asserts. It provisions a fresh tenant, signs in as
 * its owner and does what a new customer would do on their first afternoon --
 * then screenshots every step so the result can be *looked at*. Assertions
 * tell you whether the product works; only looking tells you whether it is
 * pleasant to use, and the two questions have different answers.
 *
 * Screenshots land in `--out` (default ./ux-screenshots), numbered in the
 * order a user meets them.
 */

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3010';
const HEADED = process.argv.includes('--headed');
const OUT = (() => {
  const index = process.argv.indexOf('--out');
  return index > -1 ? process.argv[index + 1] : './ux-screenshots';
})();

mkdirSync(OUT, { recursive: true });

let step = 0;
const notes = [];

/** Screenshot, numbered, with a note about what the user is looking at. */
async function shot(page, name, note) {
  step += 1;
  const file = `${String(step).padStart(2, '0')}-${name}.png`;
  await page.waitForTimeout(600); // let animations settle
  await page.screenshot({ path: join(OUT, file), fullPage: false });
  notes.push(`${file}  ${note}`);
  console.log(`  [${String(step).padStart(2, '0')}] ${name} — ${note}`);
}

/** How long a thing took, because "does it feel fast" is a real question. */
async function timed(label, fn) {
  const started = Date.now();
  const result = await fn();
  const ms = Date.now() - started;
  console.log(`       ${label}: ${ms}ms`);
  notes.push(`      timing  ${label}: ${ms}ms`);
  return result;
}

const browser = await chromium.launch({
  headless: !HEADED,
  slowMo: HEADED ? 350 : 0,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: 'vi-VN',
  timezoneId: 'Asia/Bangkok',
});
const page = await context.newPage();

// Console errors and failed requests are part of the experience even when the
// screen looks fine.
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
});
const failedRequests = [];
page.on('response', (response) => {
  if (response.status() >= 400) {
    failedRequests.push(`${response.status()} ${response.request().method()} `
      + response.url().replace(BASE, ''));
  }
});

console.log(`\nWalking ${BASE} as a new customer\n`);

// ── provision a tenant, the way onboarding would ───────────────────────────
const stamp = Date.now().toString(36);
const email = `ux-${stamp}@example.com`;
const password = 'UxWalkthrough123';

const admin = await context.request.post(`${BASE}/api/v1/auth/login`, {
  data: { email: 'admin@appbi.vn', password: 'E2EOwnerPassword123' },
});
if (!admin.ok()) {
  console.error('could not sign in as the platform admin:', await admin.text());
  process.exit(1);
}
const tenant = await (await context.request.post(
  `${BASE}/api/v1/platform/workspaces`, {
    data: { name: `UX Walkthrough ${stamp}`, owner_email: email,
            owner_password: password },
  })).json();
console.log(`  provisioned ${tenant.slug} for ${email}\n`);
await context.clearCookies();

// ── 1. arriving ────────────────────────────────────────────────────────────
await page.goto(`${BASE}/workflows`, { waitUntil: 'networkidle' });
await shot(page, 'arrive-signed-out',
  'a deep link while signed out — where does it send me?');

await page.getByLabel('Email').fill(email);
await page.getByLabel(/Mật khẩu|Password/).fill(password);
await shot(page, 'login-filled', 'the sign-in form, filled');

await timed('sign in', async () => {
  await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();
  await page.waitForURL(/change-password|overview/, { timeout: 30000 });
});
await shot(page, 'forced-password-change',
  'first sign-in: the account must change its password');

await page.getByLabel(/Mật khẩu hiện tại|Current password/).fill(password);
await page.getByLabel(/^Mật khẩu mới|^New password/).fill('UxWalkthroughNew123');
await page.getByLabel(/Nhập lại|Confirm/).fill('UxWalkthroughNew123');
await page.getByRole('button', { name: /Đổi mật khẩu|Change password/ }).click();
await page.waitForURL(/overview/, { timeout: 30000 });

// ── 2. the empty product ───────────────────────────────────────────────────
await shot(page, 'overview-empty',
  'the very first screen a customer sees: an empty workspace');

await page.goto(`${BASE}/workflows`, { waitUntil: 'networkidle' });
await shot(page, 'workflows-empty', 'the workflow list with nothing in it');

// ── 3. making the first workflow ───────────────────────────────────────────
await page.goto(`${BASE}/workflows/new`, { waitUntil: 'networkidle' });
await shot(page, 'new-workflow-form',
  'creating one: what am I asked for before I can start?');

await page.getByLabel(/^Tên|^Name/).fill('Gửi cảnh báo đơn hàng lớn');
await page.getByRole('button', { name: /Webhook Trigger/ }).click();
await shot(page, 'new-workflow-trigger-chosen', 'a trigger has been chosen');

await timed('create workflow', async () => {
  await page.getByRole('button', { name: /Tạo mới|Create/ }).click();
  await page.waitForURL(/\/workflows\/[0-9a-f-]{36}$/, { timeout: 30000 });
});
const workflowUrl = page.url();
await page.waitForTimeout(1500);
await shot(page, 'editor-first-open',
  'the editor, immediately after creating a workflow');

// ── 4. configuring the trigger ─────────────────────────────────────────────
await page.locator('.react-flow__node').first().click();
await page.waitForTimeout(800);
await shot(page, 'editor-trigger-config',
  'the webhook trigger config panel — is the URL findable?');

// ── 5. adding a step ───────────────────────────────────────────────────────
// One labelled button at every width, opening a sheet below `xl` and the
// collapsed rail above it. This used to assume the button existed only below
// `xl` and hung for 30s on every desktop run -- which is why nobody saw that a
// wide screen offered neither the rail nor the button.
const addStepButton = page.getByRole('button', { name: /Thêm bước|Add step/ });
if (await addStepButton.count()) {
  await addStepButton.click();
  await page.waitForTimeout(600);
}
// Which surface opened depends on width, not on whether the button was there:
// below `xl` it is a sheet over the canvas, at `xl` and above the button
// expands the rail beside it. Ask the page rather than inferring.
const palette = (await page.getByRole('dialog').count())
  ? page.getByRole('dialog')
  : page.locator('[data-palette="rail"]');
await shot(page, 'node-palette', 'the step palette — can I tell what these do?');

await palette.getByRole('textbox').first().fill('http');
await page.waitForTimeout(400);
await shot(page, 'node-palette-search', 'searching the palette');

await palette.getByRole('button', { name: /HTTP Request/ })
  .first().click();
await page.waitForTimeout(1200);
await shot(page, 'editor-http-added',
  'an HTTP step added and auto-wired; note what the canvas says about it');

// ── 6. an incomplete step ──────────────────────────────────────────────────
await shot(page, 'editor-incomplete-state',
  'the step is not configured yet — how does the product tell me?');

const urlField = page.locator('aside').filter({ hasText: /Tên bước|Step name/ })
  .getByLabel(/^URL/);
await urlField.fill('https://hooks.slack.com/services/T000/B000/XXXX');
await page.waitForTimeout(1500);
await shot(page, 'editor-http-configured', 'with a URL filled in');

// ── 7. expressions, the hardest part of any automation tool ────────────────
await page.locator('aside').filter({ hasText: /Tên bước|Step name/ })
  .getByRole('button', { name: /Dùng biểu thức|Use an expression/ }).first()
  .click().catch(() => {});
await page.waitForTimeout(800);
await shot(page, 'expression-mode',
  'switching a field to an expression — is it clear what I can write?');

// ── 8. running it ──────────────────────────────────────────────────────────
await page.goto(workflowUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const runButton = page.getByRole('button', { name: /^Run$/ });
if (await runButton.isEnabled().catch(() => false)) {
  await timed('run a draft', async () => {
    await runButton.click();
    await page.waitForTimeout(6000);
  });
  await shot(page, 'editor-after-run',
    'after Run — what does the canvas show me happened?');
} else {
  await shot(page, 'editor-run-disabled',
    'Run is disabled — does the product say why?');
}

// ── 9. publishing ──────────────────────────────────────────────────────────
await page.getByRole('button', { name: /^Publish$/ }).click().catch(() => {});
await page.waitForTimeout(900);
await shot(page, 'publish-dialog',
  'the publish dialog — do I understand what publishing does?');
await page.keyboard.press('Escape');

// ── 10. the operational screens ────────────────────────────────────────────
for (const [path, name, note] of [
  ['/executions', 'executions-list', 'the run history'],
  ['/credentials', 'credentials-empty', 'credentials, before any exist'],
  ['/nodes', 'node-library', 'the node library'],
  ['/monitoring', 'monitoring', 'the monitoring dashboard'],
  ['/alerts', 'alerts', 'alert rules and notifications'],
  ['/audit', 'audit', 'the audit log'],
  ['/settings/workspace', 'settings-workspace', 'workspace settings'],
  ['/settings/access', 'settings-access', 'members and roles'],
  ['/settings/engine', 'settings-engine', 'the engine status page'],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await shot(page, name, note);
}

// ── 11. adding a credential, the other thing every customer does ───────────
await page.goto(`${BASE}/credentials`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Tạo thông tin xác thực|New credential/ })
  .first().click().catch(() => {});
await page.waitForTimeout(700);
await shot(page, 'credential-dialog',
  'creating a credential — is it obvious which type I need?');
await page.keyboard.press('Escape');

// ── 12. what a mistake looks like ──────────────────────────────────────────
await page.goto(`${BASE}/workflows/00000000-0000-0000-0000-000000000000`,
  { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot(page, 'error-not-found', 'a workflow that does not exist');

// ── 13. narrow window, because people do that ──────────────────────────────
await page.setViewportSize({ width: 1180, height: 900 });
await page.goto(workflowUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot(page, 'editor-narrow',
  'the editor below the xl breakpoint — where does the config panel go?');

await page.setViewportSize({ width: 900, height: 900 });
await page.goto(`${BASE}/workflows`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await shot(page, 'list-narrow', 'the workflow list on a narrow window');

// ── the report ─────────────────────────────────────────────────────────────
const report = [
  `UX walkthrough of ${BASE}`,
  `tenant: ${tenant.slug}  owner: ${email}`,
  '',
  ...notes,
  '',
  `console errors (${consoleErrors.length}):`,
  ...[...new Set(consoleErrors)].slice(0, 20).map((e) => `  ${e}`),
  '',
  `failed requests (${failedRequests.length}):`,
  ...[...new Set(failedRequests)].slice(0, 30).map((r) => `  ${r}`),
];
writeFileSync(join(OUT, 'walkthrough.txt'), report.join('\n'), 'utf-8');

console.log(`\n  ${step} screenshots -> ${OUT}`);
console.log(`  console errors: ${consoleErrors.length}`);
console.log(`  failed requests: ${new Set(failedRequests).size} distinct`);
for (const request of [...new Set(failedRequests)].slice(0, 15)) {
  console.log(`    ${request}`);
}

await browser.close();
