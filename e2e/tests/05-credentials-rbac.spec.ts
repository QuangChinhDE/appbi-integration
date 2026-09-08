/**
 * Credentials and role gating (SRS 12, 4.2; UAT-019).
 *
 * The credential tests all check the same rule from different angles: a secret
 * goes in and never comes back out — not in a response, not in the DOM, not in
 * a network payload the browser can see.
 */

import { expect, test } from '@playwright/test';

import { deleteWorkflow, unique } from './fixtures';

const SECRET = 'e2e-secret-value-do-not-echo';

test.describe('credentials', () => {
  test('creating one stores the secret and never shows it again',
    async ({ page }) => {
      const name = unique('E2E bearer');

      // Every response body the browser receives, watched for the secret.
      const bodies: string[] = [];
      page.on('response', async (response) => {
        if (!response.url().includes('/api/v1/credentials')) return;
        try {
          bodies.push(await response.text());
        } catch {
          /* a redirect or an aborted request has no body */
        }
      });

      await page.goto('/credentials');
      await page.getByRole('button', { name: /Tạo thông tin xác thực|New credential/ })
        .first().click();

      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(/^Tên|^Name/).fill(name);
      await dialog.getByLabel(/^Loại|^Type/).selectOption('BEARER');
      await dialog.getByLabel(/Token/).fill(SECRET);
      await dialog.getByRole('button', { name: /^Lưu$|^Save$/ }).click();
      await expect(dialog).not.toBeVisible();

      const row = page.locator('tbody tr').filter({ hasText: name });
      await expect(row).toBeVisible();
      // A hint, not the value: enough to tell four bearer tokens apart.
      await expect(row.getByText(/••••/)).toBeVisible();
      await expect(row.getByText(/Đã lưu|Stored/)).toBeVisible();

      // Reopening shows an empty input with the hint as a placeholder, because
      // an empty input means "leave it alone" (SRS 12.4).
      await row.getByRole('button').first().click();
      const reopened = page.getByRole('dialog');
      await expect(reopened.getByLabel(/Token/)).toHaveValue('');
      await expect(reopened.getByLabel(/Token/)).toHaveAttribute('placeholder', /••••/);
      await expect(reopened.getByText(/Để trống nếu|Leave blank/)).toBeVisible();
      await reopened.getByRole('button', { name: /^Hủy$|^Cancel$/ }).click();

      // UAT-019: not in the page, and not in anything the API sent back.
      const pageText = await page.locator('body').innerText();
      expect(pageText).not.toContain(SECRET);
      expect(bodies.join('\n')).not.toContain(SECRET);
      expect(bodies.length).toBeGreaterThan(0);

      // Clean up.
      const list = await (await page.request.get('/api/v1/credentials')).json();
      const created = list.items.find((item: { name: string }) => item.name === name);
      if (created) await page.request.delete(`/api/v1/credentials/${created.id}`);
    });

  test('renaming keeps the stored secret', async ({ page }) => {
    const name = unique('E2E rename');
    const created = await page.request.post('/api/v1/credentials', {
      data: { name, credential_type: 'BEARER', data: { token: SECRET } },
    });
    const { id } = await created.json();

    await page.goto('/credentials');
    const row = page.locator('tbody tr').filter({ hasText: name });
    await row.getByRole('button').first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Tên|^Name/).fill(`${name} renamed`);
    // The token field is left empty on purpose.
    await dialog.getByRole('button', { name: /^Lưu$|^Save$/ }).click();
    await expect(dialog).not.toBeVisible();

    const after = await (await page.request.get(`/api/v1/credentials/${id}`)).json();
    expect(after.name).toBe(`${name} renamed`);
    // A form that could erase a secret by being submitted would be a footgun.
    expect(after.secret.configured).toBe(true);

    await page.request.delete(`/api/v1/credentials/${id}`);
  });

  test('the credential type cannot be changed after creation', async ({ page }) => {
    const name = unique('E2E fixed type');
    const created = await page.request.post('/api/v1/credentials', {
      data: {
        name, credential_type: 'HEADER_API_KEY',
        data: { header_name: 'X-API-Key', value: SECRET },
      },
    });
    const { id } = await created.json();

    await page.goto('/credentials');
    await page.locator('tbody tr').filter({ hasText: name })
      .getByRole('button').first().click();

    // Changing it would leave the stored secret shaped for a different kind of
    // authentication.
    await expect(page.getByRole('dialog').getByLabel(/^Loại|^Type/)).toBeDisabled();
    // A non-secret field is shown, because it is not a secret.
    await expect(page.getByRole('dialog').getByLabel(/Tên header|header/i))
      .toHaveValue('X-API-Key');

    await page.getByRole('dialog').getByRole('button', { name: /^Hủy$|^Cancel$/ }).click();
    await page.request.delete(`/api/v1/credentials/${id}`);
  });

  test('a credential in use by an active workflow cannot be deleted',
    async ({ page }) => {
      const name = unique('E2E in use');
      const credential = await (await page.request.post('/api/v1/credentials', {
        data: { name, credential_type: 'BEARER', data: { token: SECRET } },
      })).json();

      // A webhook trigger, not a manual one: "active" means a trigger is bound
      // and listening, and a manual workflow has nothing to bind -- so a
      // manual one can never reach the state this test is about.
      const workflow = await (await page.request.post('/api/v1/workflows', {
        data: {
          name: unique('E2E uses credential'),
          trigger_node_key: 'webhook_trigger',
        },
      })).json();
      const draft = await (await page.request.get(
        `/api/v1/workflows/${workflow.id}/draft`)).json();
      await page.request.put(`/api/v1/workflows/${workflow.id}/draft`, {
        data: {
          expected_revision: draft.revision,
          graph: {
            nodes: [
              {
                id: 'start_1', node_key: 'webhook_trigger', name: 'Start',
                position: { x: 80, y: 200 },
                config: {
                  method: 'POST', auth_mode: 'HEADER_SIGNATURE',
                  allowed_content_type: 'application/json',
                },
              },
              {
                id: 'http_1', node_key: 'http_request', name: 'Call',
                position: { x: 360, y: 200 },
                config: {
                  method: 'GET', url: 'https://api.example.com',
                  credential_id: credential.id,
                },
              },
            ],
            connections: [{
              from: { node_id: 'start_1', port: 'main' },
              to: { node_id: 'http_1', port: 'main' },
            }],
          },
        },
      });
      const published = await page.request.post(
        `/api/v1/workflows/${workflow.id}/publish`, { data: {} });
      expect(published.ok()).toBeTruthy();
      const activated = await page.request.post(
        `/api/v1/workflows/${workflow.id}/activate`, { data: {} });
      expect(activated.ok()).toBeTruthy();

      await page.goto('/credentials');
      const row = page.locator('tbody tr').filter({ hasText: name });
      await row.getByRole('button', { name: /Thao tác|Actions/ }).click();
      await page.getByRole('menuitem', { name: /^Xóa$|^Delete$/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /^Xóa$|^Delete$/ }).click();

      // The refusal names what depends on it, which is the only useful answer
      // to "why can I not delete this" (SRS 12.6).
      await expect(page.getByText(/đang được một workflow|used by an active/))
        .toBeVisible();

      // Clean up through the helper, which fails loudly if the delete is
      // refused. Written out by hand, both calls were unchecked -- and this
      // workflow is deliberately *active*, which is the one state the product
      // refuses to delete from, so a missed deactivate left the row behind
      // silently. That is how the leftovers accumulated.
      await deleteWorkflow(page, workflow.id);
      await page.request.delete(`/api/v1/credentials/${credential.id}`);
    });
});

test.describe('role gating', () => {
  const password = 'AnalystPassword123';
  let email: string;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: '.auth/owner.json' });
    email = `analyst-${Date.now().toString(36)}@example.com`;
    const invited = await page.request.post('/api/v1/workspace/members', {
      data: { email, full_name: 'Read Only', role: 'ANALYST', password },
    });
    expect(invited.ok()).toBeTruthy();
    await page.close();
  });

  test('an Analyst sees the data but none of the buttons that would 403',
    async ({ browser }) => {
      const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page = await context.newPage();

      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel(/Mật khẩu|Password/).fill(password);
      await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();

      // First sign-in must change the password.
      await expect(page).toHaveURL(/\/change-password/);
      await page.getByLabel(/Mật khẩu hiện tại|Current password/).fill(password);
      await page.getByLabel(/^Mật khẩu mới|^New password/).fill('AnalystChanged123');
      await page.getByLabel(/Nhập lại|Confirm/).fill('AnalystChanged123');
      await page.getByRole('button', { name: /Đổi mật khẩu|Change password/ }).click();
      await expect(page).toHaveURL(/\/overview/);

      // The role is visible where the user can check their own access.
      await expect(page.getByText(/Analyst/)).toBeVisible();

      await page.goto('/workflows');
      // Read-only: no create, and the row menu offers nothing destructive.
      await expect(page.getByRole('link', { name: /Tạo workflow|New workflow/ }))
        .toHaveCount(0);

      // FE gating is UX only, so confirm the backend refuses too — the check
      // that actually protects anything.
      const refused = await page.request.post('/api/v1/workflows', {
        data: { name: 'analyst should not manage this' },
      });
      expect(refused.status()).toBe(403);

      // The audit log is not for an Analyst, and the sidebar does not offer it.
      await expect(page.getByRole('link', { name: /Audit log/ })).toHaveCount(0);

      await context.close();
    });

  test('an Analyst opening an editor gets no Publish or Run', async ({ browser }) => {
    const owner = await browser.newPage({ storageState: '.auth/owner.json' });
    const workflow = await (await owner.request.post('/api/v1/workflows', {
      data: { name: unique('E2E analyst view') },
    })).json();
    await owner.close();

    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel(/Mật khẩu|Password/).fill('AnalystChanged123');
    await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();
    await expect(page).toHaveURL(/\/overview/);

    await page.goto(`/workflows/${workflow.id}`);
    await expect(page.locator('.react-flow')).toBeVisible();

    // Present in the header for an owner, absent here.
    await expect(page.getByRole('button', { name: /^Publish$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Run$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Thêm bước|Add step/ })).toHaveCount(0);

    await context.close();

    const cleanup = await browser.newPage({ storageState: '.auth/owner.json' });
    await deleteWorkflow(cleanup, workflow.id);
    await cleanup.close();
  });
});
