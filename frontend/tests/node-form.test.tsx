/**
 * The node configuration form (SRS 43.5, 54).
 *
 * The four behaviours the config schema is supposed to drive, tested through
 * the rendered form rather than by reading the schema: conditional fields,
 * advanced collapse, the expression toggle, and repeatable collections.
 */

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DynamicNodeForm } from '@/components/automation/DynamicNodeForm';
import { credential, FIELDS, renderWithProviders } from './helpers';

function Harness({
  initial = {}, issues = [],
}: {
  initial?: Record<string, unknown>;
  issues?: any[];
}) {
  const [config, setConfig] = React.useState<Record<string, unknown>>(initial);
  return (
    <>
      <DynamicNodeForm
        fields={FIELDS}
        config={config}
        onChange={setConfig}
        credentials={[credential()]}
        issues={issues}
      />
      <pre data-testid="config">{JSON.stringify(config)}</pre>
    </>
  );
}

const config = () => JSON.parse(screen.getByTestId('config').textContent || '{}');

describe('conditional fields', () => {
  it('hides a field whose condition is not met', () => {
    renderWithProviders(<Harness initial={{ method: 'GET', body_mode: 'NONE' }} />);
    // A GET request must not be asked for a JSON body.
    expect(screen.queryByText('JSON body')).not.toBeInTheDocument();
  });

  it('shows it once the field it depends on changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={{ method: 'POST', body_mode: 'NONE' }} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Body' }), 'JSON');
    expect(await screen.findByText('JSON body')).toBeInTheDocument();
  });
});

describe('advanced fields', () => {
  it('are collapsed until asked for', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    expect(screen.queryByText('Timeout')).not.toBeInTheDocument();
    // The label states how many are hidden, so the section is not a mystery.
    await user.click(screen.getByRole('button', { name: /1/ }));
    expect(await screen.findByText('Timeout')).toBeInTheDocument();
  });
});

describe('the expression toggle', () => {
  it('turns a literal field into an expression and back', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={{ url: 'https://api.example.com' }} />);

    await user.click(screen.getByRole('button', { name: /biểu thức|expression/i }));
    // The stored value carries the `=` marker, which is what the compiler and
    // the engine agree means "this is an expression" (ADR-008).
    await waitFor(() => expect(String(config().url)).toMatch(/^=/));

    await user.click(screen.getByRole('button', { name: /giá trị cố định|fixed value/i }));
    await waitFor(() => expect(config().url).toBe(''));
  });

  it('is not offered on a field that does not support mapping', () => {
    renderWithProviders(<Harness />);
    // `method` is an enum with no expression support; exactly one toggle should
    // exist for `url`.
    const toggles = screen.getAllByRole('button', { name: /biểu thức|expression/i });
    expect(toggles).toHaveLength(1);
  });
});

describe('collections', () => {
  it('adds and removes rows', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await user.click(screen.getByRole('button', { name: /thêm|add/i }));
    await waitFor(() => expect(config().headers).toHaveLength(1));

    // By accessible name, not label text: the required marker is part of the
    // label's textContent but excluded from the accessible name, and querying
    // by role also proves the label is actually associated with the input.
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'X-Trace');
    await waitFor(() => expect(config().headers[0].name).toBe('X-Trace'));

    await user.click(screen.getByRole('button', { name: /bỏ|remove/i }));
    await waitFor(() => expect(config().headers).toHaveLength(0));
  });
});

describe('the credential picker', () => {
  it('offers only credentials of an allowed type', () => {
    renderWithProviders(
      <>
        <DynamicNodeForm
          fields={FIELDS}
          config={{}}
          onChange={vi.fn()}
          credentials={[
            credential({ id: 'ok', name: 'Allowed', credential_type: 'BEARER' }),
            credential({ id: 'no', name: 'Wrong type', credential_type: 'HTTP_BASIC' }),
          ]}
          issues={[]}
        />
      </>,
    );

    expect(screen.getByRole('option', { name: 'Allowed' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Wrong type/ })).not.toBeInTheDocument();
  });

  it('marks a selected credential that is no longer valid', () => {
    renderWithProviders(
      <DynamicNodeForm
        fields={FIELDS}
        config={{ credential_id: 'cred-1' }}
        onChange={vi.fn()}
        credentials={[credential({ status: 'INVALID' })]}
        issues={[]}
      />,
    );

    // The row a user has to act on says so on the field itself, not only in a
    // banner somewhere else on the page. Asserted on the select's invalid state
    // plus the inline error, because the option label carries the same words.
    expect(screen.getByRole('combobox', { name: 'Credential' }))
      .toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getAllByText(/không còn hợp lệ|no longer valid/i).length,
    ).toBeGreaterThan(0);
  });
});

describe('validation issues', () => {
  it('attaches a server issue to the field it names', () => {
    renderWithProviders(
      <Harness
        issues={[{
          code: 'NODE_CONFIGURATION_INVALID',
          message: 'URL is required.',
          node_id: 'http_1',
          field: 'url',
          severity: 'ERROR',
        }]}
      />,
    );

    expect(screen.getByText('URL is required.')).toBeInTheDocument();
  });
});
