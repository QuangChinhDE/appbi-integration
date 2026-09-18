/**
 * Regression tests for the product stabilization pass
 * (`docs/changes/001-product-stabilization/DEFECT_INVENTORY.md`).
 *
 * Each of these was written against the defect as observed and watched failing
 * before the fix went in. They cover the decisions, not the markup: whether a
 * read-only user is told to do something they cannot do, whether a failing
 * mutation is allowed to be silent, and whether an identifier reaches a
 * customer where a sentence belongs.
 */

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { resolveRemediation } from '@/components/automation/ErrorRemediationCard';
import { ApiError } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { QueryProvider } from '@/providers/QueryProvider';
import { EmptyState } from '@/components/ui/Feedback';
import { CATALOGS } from '@/lib/i18n';
import { renderWithProviders } from './helpers';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe('D-P01 — empty-state copy respects permissions', () => {
  /**
   * The button was already gated; the sentence next to it was not. An Analyst
   * saw "Create your first workflow: choose a starting step..." with no way to
   * do any of it, which reads as broken rather than as read-only.
   */
  it('offers a read-only wording for every empty state that instructs an action', () => {
    for (const key of [
      'overview.emptyBody',
      'workflows.emptyBody',
      'executions.emptyBody',
      'credentials.emptyBody',
    ]) {
      const readOnly = `${key}ReadOnly`;
      expect(CATALOGS.vi, `${readOnly} missing from the vi catalogue`)
        .toHaveProperty(readOnly);
      expect(CATALOGS.en, `${readOnly} missing from the en catalogue`)
        .toHaveProperty(readOnly);

      // The read-only variant must not tell the reader to do the thing.
      const vietnamese = (CATALOGS.vi as Record<string, string>)[readOnly];
      expect(vietnamese, `${readOnly} still instructs an action`)
        .not.toMatch(/^(Tạo|Chạy)\b/);
    }
  });

  it('renders the description it is given and no action when there is none', () => {
    renderWithProviders(
      <EmptyState title="Chưa có workflow nào" description="Workspace này chưa có workflow nào." />,
    );
    expect(screen.getByText('Workspace này chưa có workflow nào.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('D-P07 / D-P08 — identifiers never reach the customer as prose', () => {
  /**
   * The overview's recent-failures row rendered `row.error_code` directly, so a
   * customer's first screen said `NODE_NETWORK_UNREACHABLE`. Every code the
   * backend can emit now has a label; the raw code remains the fallback, which
   * is correct for a code added later, but the set we ship must be complete.
   */
  const BACKEND_ERROR_CODES = [
    'CREDENTIAL_INVALID', 'CREDENTIAL_REQUIRED', 'DRAFT_VERSION_CONFLICT',
    'EGRESS_BLOCKED', 'ENGINE_INCOMPATIBLE', 'ENGINE_INTERRUPTED',
    'ENGINE_UNAVAILABLE', 'EXECUTION_CANCELLED', 'EXECUTION_TIMED_OUT',
    'EXPRESSION_EVALUATION_FAILED', 'EXPRESSION_INVALID',
    'NODE_AUTHENTICATION_FAILED', 'NODE_CONFIGURATION_INVALID',
    'NODE_EXECUTION_FAILED', 'NODE_NETWORK_UNREACHABLE', 'NODE_RATE_LIMITED',
    'NODE_TIMEOUT', 'NODE_UNSUPPORTED', 'SCHEDULE_INVALID',
    'WEBHOOK_AUTH_FAILED', 'WORKFLOW_ALREADY_RUNNING', 'WORKFLOW_INVALID',
    'WORKFLOW_NOT_PUBLISHED',
  ];

  it.each(BACKEND_ERROR_CODES)('%s has a human label in both locales', (code) => {
    expect(CATALOGS.vi).toHaveProperty(`errorCode.${code}`);
    expect(CATALOGS.en).toHaveProperty(`errorCode.${code}`);
  });

  it('no error label is just the code back again', () => {
    for (const code of BACKEND_ERROR_CODES) {
      expect((CATALOGS.vi as Record<string, string>)[`errorCode.${code}`]).not.toBe(code);
    }
  });

  /**
   * Every remediation action that `resolveRemediation` gives a destination to
   * renders a *button*, and a button label is read by a person.
   * `INSPECT_EXECUTION` was the one action with a destination and no label, so
   * a timed-out run offered a button that said `INSPECT_EXECUTION`.
   */
  const ACTIONS_WITH_A_DESTINATION = [
    'UPDATE_CREDENTIAL', 'CHOOSE_CREDENTIAL', 'VIEW_EXECUTION', 'INSPECT_EXECUTION',
    'OPEN_WORKFLOW', 'PUBLISH_WORKFLOW', 'DEACTIVATE', 'EDIT_SCHEDULE', 'EDIT_NODE',
    'SHOW_INVALID_NODES', 'RELOAD_DRAFT', 'RETRY_EXECUTION', 'INSPECT_INPUT',
    'INSPECT_NODE', 'VIEW_DEPENDENCIES',
  ];

  it.each(ACTIONS_WITH_A_DESTINATION)(
    '%s resolves to a button and has a label to put on it',
    (action) => {
      const target = resolveRemediation(
        action,
        { workflowId: 'w1', executionId: 'e1', credentialId: 'c1' },
        { onReload: () => {}, onRetry: () => {}, onInspect: () => {} },
      );
      expect(target, `${action} no longer resolves to a destination`).not.toBeNull();
      expect(CATALOGS.vi, `remediation.${action} has no Vietnamese label`)
        .toHaveProperty(`remediation.${action}`);
      expect(CATALOGS.en, `remediation.${action} has no English label`)
        .toHaveProperty(`remediation.${action}`);
    },
  );
});

describe('D-P02 — a failing mutation is never silent', () => {
  /**
   * `QueryProvider` installs a `MutationCache` floor so that a mutation which
   * forgot its own `onError` still tells the user it failed. Before it,
   * `/alerts` shipped an Acknowledge button that reported neither success nor
   * failure, and nothing in the suite noticed.
   *
   * These drive the real provider rather than asserting on its source: the
   * decision being protected is "what the user is told", not "which lines
   * exist".
   */
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  function Harness({
    meta, onError, status = 500,
  }: {
    meta?: Record<string, unknown>;
    onError?: () => void;
    status?: number;
  }) {
    const mutation = useMutation({
      meta,
      onError,
      mutationFn: async () => {
        throw new ApiError(status, {
          code: 'NODE_NETWORK_UNREACHABLE',
          message: 'Không gọi được dịch vụ.',
          category: 'NETWORK',
          trace_id: 'trc_test',
        });
      },
    });
    return (
      <>
        <button type="button" onClick={() => mutation.mutate()}>go</button>
        {/* The three "stays quiet" cases below assert an absence, and an
            absence passes just as well when nothing ran at all -- a renamed
            button or a changed mutationFn would turn a broken test green.
            Waiting on this first proves the mutation reached error state, so
            the silence being asserted is a decision rather than a no-op. */}
        {mutation.isError && <span data-testid="failed">failed</span>}
      </>
    );
  }

  const press = async (ui: React.ReactElement) => {
    renderWithProviders(<QueryProvider>{ui}</QueryProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
  };

  it('toasts when the mutation has no error handling of its own', async () => {
    await press(<Harness />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe('Không gọi được dịch vụ.');
  });

  it('stays quiet when the mutation handles its own failure', async () => {
    const onError = vi.fn();
    await press(<Harness onError={onError} />);
    await screen.findByTestId('failed');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('stays quiet for a form that renders the reason inline', async () => {
    // login and change-password both put the reason next to the field; a
    // toast repeating it is noise, not safety.
    await press(<Harness meta={{ errorHandledInline: true }} />);
    await screen.findByTestId('failed');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('stays quiet on 401, which belongs to the shell', async () => {
    // An expired session must not produce a toast carrying a trace id on a
    // screen that is about to be replaced by /login. Both reviewers caught
    // this one; the query handler had the rule and the mutation floor did not.
    await press(<Harness status={401} />);
    await screen.findByTestId('failed');
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('D-P03 / D-P04 — the unfiltered workflow key is a true prefix', () => {
  /**
   * Creating a workflow invalidates `qk.workflows(ws)`. That only reaches the
   * list and the sidebar's first-run probe because `withFilters` *appends* the
   * filter segment, making the unfiltered key an ancestor rather than a
   * sibling. Appending `undefined` instead is the documented way this has gone
   * wrong before (`queryKeys.ts`), and it fails silently: the invalidation
   * matches nothing and the created row never appears.
   */
  const isPrefix = (prefix: readonly unknown[], key: readonly unknown[]) =>
    prefix.length <= key.length
    && prefix.every((segment, i) => JSON.stringify(segment) === JSON.stringify(key[i]));

  it('matches the list, the first-run probe and the overview slice', () => {
    const ws = 'ws-1';
    const base = qk.workflows(ws);
    for (const key of [
      qk.workflows(ws, { q: 'x', status: 'ACTIVE' }),
      qk.workflows(ws, { probe: 'first-run' }),
      qk.workflows(ws, { recent: 5 }),
    ]) {
      expect(isPrefix(base, key), `${JSON.stringify(base)} is not a prefix of ${JSON.stringify(key)}`)
        .toBe(true);
    }
  });

  it('does not reach another workspace', () => {
    expect(isPrefix(qk.workflows('ws-1'), qk.workflows('ws-2', { q: 'x' }))).toBe(false);
  });
});
