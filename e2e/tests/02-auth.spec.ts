/**
 * Sign-in, session and the forced password change.
 *
 * Runs without the saved session on purpose: these are the paths a signed-in
 * test can never exercise.
 */

import { expect, test } from '@playwright/test';

import { OWNER } from './fixtures';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('sign in', () => {
  test('an unauthenticated visit lands on the login form', async ({ page }) => {
    await page.goto('/overview');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel('Email')).toBeVisible();
  });

  test('a wrong password shows a message, not a stack trace', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel(/Mật khẩu|Password/).fill('definitely-not-the-password');
    await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();

    const error = page.getByText(/Email hoặc mật khẩu không đúng|Email or password/);
    await expect(error).toBeVisible();

    // The message must not distinguish "no such account" from "wrong
    // password", or the form becomes an account-enumeration endpoint.
    const text = await error.innerText();
    expect(text.toLowerCase()).not.toContain('not found');
    expect(text.toLowerCase()).not.toContain('không tồn tại');

    // And nothing that looks like an exception reached the user.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('SyntaxError');
    expect(body).not.toContain('Traceback');
    expect(body).not.toContain('Internal Server Error');

    await expect(page).toHaveURL(/\/login/);
  });

  test('an unknown account fails the same way as a wrong password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel(/Mật khẩu|Password/).fill('whatever-1234');
    await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();

    await expect(
      page.getByText(/Email hoặc mật khẩu không đúng|Email or password/),
    ).toBeVisible();
  });

  test('the submit button stays disabled until both fields are filled', async ({ page }) => {
    await page.goto('/login');
    const submit = page.getByRole('button', { name: /Đăng nhập|Sign in/ });

    await expect(submit).toBeDisabled();
    await page.getByLabel('Email').fill(OWNER.email);
    await expect(submit).toBeDisabled();
    await page.getByLabel(/Mật khẩu|Password/).fill('something');
    await expect(submit).toBeEnabled();
  });

  test('signing in reaches the overview and keeps the session across a reload',
    async ({ page }) => {
      await page.goto('/login');
      await page.getByLabel('Email').fill(OWNER.email);
      await page.getByLabel(/Mật khẩu|Password/).fill(OWNER.password);
      await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();

      await expect(page).toHaveURL(/\/overview/);
      await page.reload();
      // A session that does not survive a reload is a session in memory, which
      // is not a session.
      await expect(page).toHaveURL(/\/overview/);
      await expect(page.getByRole('link', { name: /Workflows/ })).toBeVisible();
    });

  test('signing out clears the session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel(/Mật khẩu|Password/).fill(OWNER.password);
    await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();
    await expect(page).toHaveURL(/\/overview/);

    await page.getByRole('button', { name: /Tài khoản|Account/ }).click();
    await page.getByRole('button', { name: /Đăng xuất|Sign out/ }).click();
    await expect(page).toHaveURL(/\/login/);

    // And the cleared session actually stops working.
    await page.goto('/workflows');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('the forced password change', () => {
  test('a newly invited account must change its password before anything else',
    async ({ page, request }) => {
      // Invited through the API because the point of the test is what happens
      // *after*: the invite itself is covered by the settings journey.
      const owner = await request.post('/api/v1/auth/login', {
        data: { email: OWNER.email, password: OWNER.password },
      });
      expect(owner.ok()).toBeTruthy();

      const email = `invited-${Date.now().toString(36)}@example.com`;
      const invited = await request.post('/api/v1/workspace/members', {
        data: {
          email,
          full_name: 'Invited Person',
          role: 'AUTOMATION_BUILDER',
          password: 'InitialPassword123',
        },
      });
      expect(invited.ok()).toBeTruthy();

      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel(/Mật khẩu|Password/).fill('InitialPassword123');
      await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();

      // Not the overview: the account can sign in and change its password, and
      // nothing else, until it has.
      await expect(page).toHaveURL(/\/change-password/);
      await expect(page.getByText(/Bạn cần đổi mật khẩu|need to change/)).toBeVisible();

      // Going anywhere else bounces straight back.
      await page.goto('/workflows');
      await expect(page).toHaveURL(/\/change-password/);

      // Mismatched confirmation is caught before the request is sent.
      await page.getByLabel(/Mật khẩu hiện tại|Current password/).fill('InitialPassword123');
      await page.getByLabel(/^Mật khẩu mới|^New password/).fill('BrandNewPassword123');
      await page.getByLabel(/Nhập lại|Confirm/).fill('BrandNewPassword124');
      await expect(page.getByText(/không giống nhau|do not match/)).toBeVisible();
      await expect(page.getByRole('button', { name: /Đổi mật khẩu|Change password/ }))
        .toBeDisabled();

      // A weak password is refused with every reason at once.
      await page.getByLabel(/Nhập lại|Confirm/).fill('BrandNewPassword123');
      await page.getByLabel(/^Mật khẩu mới|^New password/).fill('short');
      await page.getByLabel(/Nhập lại|Confirm/).fill('short');
      await page.getByRole('button', { name: /Đổi mật khẩu|Change password/ }).click();
      await expect(page.getByText(/ít nhất 12 ký tự|at least 12/)).toBeVisible();

      // And a real one gets the account in.
      await page.getByLabel(/^Mật khẩu mới|^New password/).fill('BrandNewPassword123');
      await page.getByLabel(/Nhập lại|Confirm/).fill('BrandNewPassword123');
      await page.getByRole('button', { name: /Đổi mật khẩu|Change password/ }).click();
      await expect(page).toHaveURL(/\/overview/);
      await expect(page.getByRole('link', { name: /Workflows/ })).toBeVisible();
    });
});
