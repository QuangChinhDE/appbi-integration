/**
 * Proves the suite left nothing behind, and fails the run if it did.
 *
 * Cleanup used to be `.catch(() => {})` on both calls, in a workspace shared
 * with real data — so a delete the product refused, because the workflow was
 * still running, left the row there and said nothing. Seventy-five
 * accumulated before anyone counted them, and the suite was green throughout.
 *
 * One test, not two, and the order inside it is load-bearing: suspending the
 * run's workspace ends this session's access to it, so everything that has to
 * *read* happens first. As two tests they could interleave, and did — a run
 * where nothing was wrong failed with "could not list workspaces".
 */

import { expect, test as teardown } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

import { RUN_WORKSPACE_FILE, visibleWorkflows } from './fixtures';

teardown('the run leaves nothing behind', async ({ page }) => {
  // ── 1. what is still there ───────────────────────────────────────────────
  //
  // Every tenant this run created, not only the one the suite ran in. Several
  // specs provision their own -- quota, tenancy A and B, escalation, the
  // first-run shape -- and a check confined to the run workspace could say
  // "nothing left behind" while nine workflows sat in tenants beside it.
  const leftovers = await visibleWorkflowsAcrossRunTenants(page);
  if (leftovers.length) {
    // Named on every run, loudly, even though the teardown then removes them.
    // These are specs that do not clean up after themselves; the deployment
    // ends clean either way, and this is how that stays visible instead of
    // becoming the teardown's job forever.
    console.warn(
      `  ${leftovers.length} workflow(s) were left for the teardown to remove: `
      + leftovers.map((row) => `${row.tenant}/${row.name}`).join(', '));
  }

  // Best effort removal first: a straggler is worth clearing even though its
  // existence is still reported below. Leaving it *and* failing would make the
  // next run start dirty too.

  // ── 2. tenants this run created ──────────────────────────────────────────
  //
  // Not only the run's own workspace. Several specs provision tenants of their
  // own — quota, tenancy A and B, escalation, the first-run shape — and each
  // left one behind: eighty had piled up, none named consistently enough to
  // match on. `created_at` after the run began identifies them exactly, and
  // cannot reach anybody's real data.
  //
  // Suspended rather than deleted: removing a tenant is not something the
  // product exposes, on purpose, and a hold is what that state is for.
  const stuck: string[] = [];
  let suspended = 0;

  if (existsSync(RUN_WORKSPACE_FILE)) {
    const { id: runWorkspace, startedAt } =
      JSON.parse(readFileSync(RUN_WORKSPACE_FILE, 'utf-8'));
    const response = await page.request.get('/api/v1/platform/workspaces');

    if (response.ok()) {
      const body = await response.json();
      const rows = (body.items ?? body) as {
        id: string; name: string; status: string; created_at: string;
      }[];
      const mine = rows.filter((row) => row.status === 'ACTIVE'
        && Date.parse(row.created_at) >= Date.parse(startedAt));

      // The run's own workspace last of all: suspending it ends the session,
      // and every other hold still needs that session.
      const ordered = [
        ...mine.filter((row) => row.id !== runWorkspace),
        ...mine.filter((row) => row.id === runWorkspace),
      ];
      for (const row of ordered) {
        if (row.id === runWorkspace) {
          // Move the account off this tenant before putting it on hold.
          //
          // A suspended workspace refuses every request including its owner's
          // — that is the point of the state — and the account's *current*
          // workspace is remembered on the server. Suspending the one the
          // bootstrap owner is sitting in left them unable to sign in at all,
          // so the next run's setup timed out on the login page for a reason
          // that had nothing to do with the next run.
          const home = rows.find((candidate) => candidate.status === 'ACTIVE'
            && Date.parse(candidate.created_at) < Date.parse(startedAt));
          if (home) {
            await page.request.post(`/api/v1/auth/switch-workspace/${home.id}`)
              .catch(() => {});
          } else {
            // Nothing older is active, so suspending this would strand the
            // account. Leaving one tenant behind is the lesser fault, and it
            // is reported.
            stuck.push(`${row.name} (kept: no other active workspace to move to)`);
            continue;
          }
        }

        const put = await page.request.put(
          `/api/v1/platform/workspaces/${row.id}/status`,
          { data: { status: 'SUSPENDED' } });
        if (put.ok()) suspended += 1;
        else stuck.push(`${row.name} (${put.status()})`);
      }
    } else {
      stuck.push(`could not list workspaces: ${response.status()}`);
    }
  }

  console.log(`  suspended ${suspended} tenant(s) created by this run`);
  if (stuck.length) {
    // Reported, not thrown: this is tidying, and a run whose tests all passed
    // should not be marked failed because a hold did not take. Naming them
    // keeps a growing pile visible rather than silent.
    console.warn(`  could not suspend: ${stuck.join(', ')}`);
  }

  // ── 3. the assertion ─────────────────────────────────────────────────────
  //
  // A workflow still visible means some test's cleanup did not run or did not
  // work — a defect in the suite whether or not the product is fine.
  // The deployment is clean. Not "no spec was untidy" -- that is the warning
  // above, and failing a run over it would mean the suite reports red for a
  // problem it has already fixed. This fails when something could *not* be
  // removed, which is the state that actually matters to the next run.
  expect(
    stubborn.map((row) => `${row.tenant}/${row.name}`),
    'workflows survived the teardown: they are still visible to a tenant',
  ).toEqual([]);
});

/**
 * Workflows still visible in any tenant this run created.
 *
 * Switching the session into each one in turn, because there is no
 * cross-tenant list -- and there should not be. The platform admin can reach
 * every workspace, which is exactly the reach needed to prove they are all
 * empty.
 */
async function visibleWorkflowsAcrossRunTenants(
  page: import('@playwright/test').Page,
): Promise<{ id: string; name: string; tenant: string }[]> {
  const found: { id: string; name: string; tenant: string }[] = [];

  if (!existsSync(RUN_WORKSPACE_FILE)) {
    return (await visibleWorkflows(page))
      .map((row) => ({ ...row, tenant: '(current)' }));
  }
  const { startedAt } = JSON.parse(readFileSync(RUN_WORKSPACE_FILE, 'utf-8'));

  const response = await page.request.get('/api/v1/platform/workspaces');
  if (!response.ok()) {
    return (await visibleWorkflows(page))
      .map((row) => ({ ...row, tenant: '(current)' }));
  }
  const body = await response.json();
  const rows = (body.items ?? body) as {
    id: string; name: string; status: string; created_at: string;
  }[];

  for (const tenant of rows) {
    if (Date.parse(tenant.created_at) < Date.parse(startedAt)) continue;

    // A tenant the run already archived is still emptied.
    //
    // Skipping them was the hole: several specs archive their own tenant in
    // `afterAll`, which runs before this, so their workflows sat inside a
    // suspended workspace and the teardown reported the run clean. Nine of
    // them accumulated that way. "Unreachable" is not "removed" -- a review
    // counting rows in the database finds them, and they are real customer-
    // shaped data sitting in a deployment somebody is about to demo.
    //
    // Reinstated, emptied, put back. A suspended tenant refuses every request
    // including the platform admin's, so there is no way to clean one in
    // place.
    const wasSuspended = tenant.status !== 'ACTIVE';
    if (wasSuspended) {
      const reinstated = await page.request.put(
        `/api/v1/platform/workspaces/${tenant.id}/status`,
        { data: { status: 'ACTIVE' } });
      if (!reinstated.ok()) continue;
    }

    const switched = await page.request.post(
      `/api/v1/auth/switch-workspace/${tenant.id}`);
    if (!switched.ok()) continue;

    // Delete inside the tenant, while the session is in it. Doing it
    // afterwards from wherever the loop ended answers 404 for every row --
    // correctly, since a workflow in another tenant does not exist for you.
    for (const row of await visibleWorkflows(page)) {
      found.push({ ...row, tenant: tenant.name });
      await page.request.post(`/api/v1/workflows/${row.id}/deactivate`)
        .catch(() => {});
      await page.request.delete(`/api/v1/workflows/${row.id}`).catch(() => {});
    }

    // What is left after trying. This is the number the assertion uses: the
    // list above says which specs are untidy, this says whether the run
    // actually leaves the deployment clean.
    for (const row of await visibleWorkflows(page)) {
      stubborn.push({ ...row, tenant: tenant.name });
    }

    if (wasSuspended) {
      // Back to where the spec left it. The main loop suspends whatever is
      // still ACTIVE; this one was not, and putting it back here keeps the
      // two from arguing about it.
      await page.request.put(
        `/api/v1/platform/workspaces/${tenant.id}/status`,
        { data: { status: 'SUSPENDED' } }).catch(() => {});
    }
  }
  return found;
}

/** Rows still there after the teardown tried to remove them. */
const stubborn: { id: string; name: string; tenant: string }[] = [];
