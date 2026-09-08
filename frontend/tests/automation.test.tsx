/**
 * The rest of the automation components (SRS 43.5).
 *
 * Chosen for the ones that carry a decision rather than markup: which ports a
 * node offers, whether publish is allowed, where a remediation sends the user,
 * and whether status is ever conveyed by colour alone.
 */

import * as React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveRemediation,
} from '@/components/automation/ErrorRemediationCard';
import { JsonTreeViewer } from '@/components/automation/JsonTreeViewer';
import { PublishWorkflowDialog } from '@/components/automation/PublishWorkflowDialog';
import {
  ExecutionStatusBadge, HealthBadge, NodeStatusBadge, TriggerBadge, VersionBadge,
} from '@/components/automation/StatusBadges';
import { inputPortsOf, outputPortsOf } from '@/components/automation/WorkflowCanvas';
import type { ExecutionStatus, WorkflowSummary } from '@/lib/types';
import { nodeDefinition, renderWithProviders } from './helpers';

describe('canvas ports', () => {
  const switchDefinition = nodeDefinition({
    node_key: 'switch',
    capability: {
      input_ports: [{ key: 'main' }],
      output_ports: [],
      output_ports_from: 'rules',
    },
  });

  const node = (config: Record<string, unknown>) => ({
    id: 'sw_1', node_key: 'switch', name: 'By type',
    position: { x: 0, y: 0 }, config,
  });

  it('derives a switch branch per rule', () => {
    expect(outputPortsOf(
      node({ rules: [{ output_key: 'vip' }, { output_key: 'pro' }] }),
      switchDefinition,
    )).toEqual(['vip', 'pro']);
  });

  it('adds the fallback branch only when it is turned on', () => {
    expect(outputPortsOf(
      node({ rules: [{ output_key: 'vip' }], fallback: 'NONE' }),
      switchDefinition,
    )).toEqual(['vip']);

    expect(outputPortsOf(
      node({ rules: [{ output_key: 'vip' }], fallback: 'EXTRA_OUTPUT' }),
      switchDefinition,
    )).toEqual(['vip', 'other']);
  });

  it('ignores a rule with no branch name', () => {
    // A half-typed rule must not produce a nameless handle that a connection
    // could then be drawn to.
    expect(outputPortsOf(
      node({ rules: [{ output_key: 'vip' }, { output_key: '  ' }, {}] }),
      switchDefinition,
    )).toEqual(['vip']);
  });

  it('gives an IF its two named branches', () => {
    const ifDefinition = nodeDefinition({
      node_key: 'if',
      capability: {
        input_ports: [{ key: 'main' }],
        output_ports: [{ key: 'true' }, { key: 'false' }],
      },
    });
    expect(outputPortsOf(
      { id: 'if_1', node_key: 'if', name: 'Check', position: { x: 0, y: 0 }, config: {} },
      ifDefinition,
    )).toEqual(['true', 'false']);
  });

  it('gives a trigger no input port', () => {
    // This is how the canvas says "nothing can come before this".
    const trigger = nodeDefinition({
      node_key: 'manual_trigger',
      capability: { input_ports: [], output_ports: [{ key: 'main' }], is_trigger: true },
    });
    expect(inputPortsOf(trigger)).toEqual([]);
  });

  it('gives merge two named inputs', () => {
    const merge = nodeDefinition({
      node_key: 'merge',
      capability: {
        input_ports: [{ key: 'input_1' }, { key: 'input_2' }],
        output_ports: [{ key: 'main' }],
      },
    });
    expect(inputPortsOf(merge)).toEqual(['input_1', 'input_2']);
  });
});

describe('the publish dialog', () => {
  const workflow = {
    id: 'wf-1',
    name: 'Customer onboarding',
    published: { version: 2, published_at: '2026-01-01T00:00:00Z' },
    trigger: { type: 'WEBHOOK', enabled: true, summary: 'POST webhook', next_run_at: null },
  } as unknown as WorkflowSummary;

  it('names the version it is about to create', () => {
    renderWithProviders(
      <PublishWorkflowDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        workflow={workflow}
        validation={{ ok: true, issues: [], engine: 'OK' }}
      />,
    );
    expect(screen.getByText(/v3/)).toBeInTheDocument();
  });

  it('refuses to publish while the graph has errors', () => {
    renderWithProviders(
      <PublishWorkflowDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        workflow={workflow}
        validation={{
          ok: false,
          engine: 'SKIPPED',
          issues: [{
            code: 'NODE_CONFIGURATION_INVALID',
            message: 'Step "Get customer" has no URL.',
            node_id: 'http_1', field: 'url', severity: 'ERROR',
          }],
        }}
      />,
    );

    expect(screen.getByRole('button', { name: /publish/i })).toBeDisabled();
    // And it says which problem, not just that there is one.
    expect(screen.getByText(/has no URL/)).toBeInTheDocument();
  });

  it('refuses to publish when the engine could not be reached', () => {
    // Freezing a version that could not be compiled would make it
    // publishable-but-unrunnable (SRS 27.2).
    renderWithProviders(
      <PublishWorkflowDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        workflow={workflow}
        validation={{ ok: true, issues: [], engine: 'UNAVAILABLE' }}
      />,
    );
    expect(screen.getByRole('button', { name: /publish/i })).toBeDisabled();
  });

  it('does not activate unless asked, and passes the choice through', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithProviders(
      <PublishWorkflowDialog
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
        workflow={workflow}
        validation={{ ok: true, issues: [], engine: 'OK' }}
      />,
    );

    // Default off: publishing is "this is good", activating is "run this in
    // production", and the dialog must not conflate them.
    await user.click(screen.getByRole('button', { name: /publish/i }));
    expect(onConfirm).toHaveBeenCalledWith({ changeNote: '', activate: false });

    onConfirm.mockClear();
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByRole('textbox'), 'added the tier check');
    await user.click(screen.getByRole('button', { name: /publish/i }));
    expect(onConfirm).toHaveBeenCalledWith({
      changeNote: 'added the tier check', activate: true,
    });
  });
});

describe('remediation routing', () => {
  it('sends a credential problem to the credential it names', () => {
    expect(resolveRemediation('UPDATE_CREDENTIAL', { credentialId: 'cred-9' }))
      .toEqual({ label: 'UPDATE_CREDENTIAL', href: '/credentials/cred-9' });
  });

  it('falls back to the list when no credential is named', () => {
    expect(resolveRemediation('CHOOSE_CREDENTIAL', {})?.href).toBe('/credentials');
  });

  it('sends a draft conflict to a handler, not a URL', () => {
    const onReload = vi.fn();
    const target = resolveRemediation('RELOAD_DRAFT', {}, { onReload });
    target?.onClick?.();
    expect(onReload).toHaveBeenCalled();
  });

  it('offers nothing for an action with no destination', () => {
    // A card with a button that does nothing is worse than a card with none.
    expect(resolveRemediation('RETRY_LATER', {})).toBeNull();
    expect(resolveRemediation('CONTACT_ADMIN', {})).toBeNull();
    expect(resolveRemediation(undefined, {})).toBeNull();
  });

  it('needs a workflow id before it will point at a workflow', () => {
    expect(resolveRemediation('OPEN_WORKFLOW', {})).toBeNull();
    expect(resolveRemediation('OPEN_WORKFLOW', { workflowId: 'wf-2' })?.href)
      .toBe('/workflows/wf-2');
  });
});

describe('status is never colour alone', () => {
  const statuses: ExecutionStatus[] = [
    'QUEUED', 'DISPATCHING', 'RUNNING', 'SUCCEEDED', 'FAILED',
    'CANCEL_REQUESTED', 'CANCELLED', 'TIMED_OUT', 'FAILED_TO_START',
    'ENGINE_INTERRUPTED',
  ];

  it('every execution status renders a word', () => {
    // SRS 40: a badge that only differs by colour is unreadable for a
    // colour-blind user and invisible to a screen reader.
    for (const status of statuses) {
      const { unmount } = renderWithProviders(<ExecutionStatusBadge status={status} />);
      expect(screen.getByText(/\S/)).toBeInTheDocument();
      unmount();
    }
  });

  it('a node status renders a word', () => {
    renderWithProviders(<NodeStatusBadge status="SKIPPED" />);
    expect(screen.getByText(/bỏ qua|skipped/i)).toBeInTheDocument();
  });

  it('health carries its label', () => {
    renderWithProviders(<HealthBadge level="ACTION_REQUIRED" label="Cần xử lý" />);
    expect(screen.getByText('Cần xử lý')).toBeInTheDocument();
  });

  it('a trigger badge names its type', () => {
    renderWithProviders(<TriggerBadge type="SCHEDULE" enabled />);
    expect(screen.getByText(/lịch|schedule/i)).toBeInTheDocument();
  });

  it('a draft run is distinguishable from a published one', () => {
    const { unmount } = renderWithProviders(
      <VersionBadge kind="PUBLISHED" number={3} />);
    expect(screen.getByText('v3')).toBeInTheDocument();
    unmount();

    renderWithProviders(<VersionBadge kind="DRAFT" draftRevision={18} />);
    expect(screen.getByText('draft')).toBeInTheDocument();
  });
});

describe('the data picker', () => {
  const items = [{ customer: { id: 42, email: 'a@example.com' }, amount: 120 }];

  it('hands back a path that reads as an expression', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderWithProviders(
      <JsonTreeViewer
        items={items}
        rootPath='$node["Get customer"].json'
        onPick={onPick}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'amount' }));
    expect(onPick).toHaveBeenCalledWith('$node["Get customer"].json.amount');
  });

  it('reaches a nested field once its parent is expanded', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderWithProviders(
      <JsonTreeViewer items={items} rootPath="$json" onPick={onPick} />,
    );

    // Collapsed below the first level: a 200-key payload should not push the
    // rest of the panel off screen.
    expect(screen.queryByRole('button', { name: 'email' })).not.toBeInTheDocument();

    // Two distinct controls on the row: one expands, one inserts. Clicking the
    // expander by its own name is also the assertion that they are
    // distinguishable.
    await user.click(screen.getByRole('button', { name: /mở rộng customer|expand customer/i }));
    await user.click(await screen.findByRole('button', { name: 'email' }));
    expect(onPick).toHaveBeenCalledWith('$json.customer.email');
    // Expanding must not have inserted anything.
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('says so when there is nothing to show', () => {
    renderWithProviders(<JsonTreeViewer items={[]} emptyLabel="No data yet" />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });
});
