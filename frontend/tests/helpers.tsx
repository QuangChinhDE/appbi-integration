import * as React from 'react';
import { render, type RenderOptions } from '@testing-library/react';

import { LanguageProvider } from '@/providers/LanguageProvider';
import type { Credential, FieldSpec, NodeDefinition } from '@/lib/types';

/**
 * Render inside the providers a component actually runs in.
 *
 * `useI18n` degrades outside its provider rather than throwing, so a test
 * without it would pass while exercising the fallback path instead of the real
 * one.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, {
    wrapper: ({ children }) => <LanguageProvider>{children}</LanguageProvider>,
    ...options,
  });
}

export function nodeDefinition(overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    node_key: 'http_request',
    display_name: 'HTTP Request',
    category: 'ACTION',
    description: 'Call an HTTP API.',
    icon: 'globe',
    certification: 'SUPPORTED',
    status: 'ACTIVE',
    product_schema_version: 1,
    config_schema: { fields: [] },
    capability: {
      input_ports: [{ key: 'main' }],
      output_ports: [{ key: 'main' }],
      supports_expression: true,
      credential_types: ['BEARER'],
    },
    credential_types: ['BEARER'],
    security_profile: {},
    docs_ref: null,
    spec_hash: 'hash',
    last_certified_at: null,
    known_issues: null,
    ...overrides,
  };
}

export function credential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: 'cred-1',
    name: 'CRM API',
    credential_type: 'BEARER',
    status: 'ACTIVE',
    public_metadata: {},
    secret: { configured: true, masked_hint: '••••••••3xQ', rotated_at: null },
    last_test_at: null,
    last_test_ok: null,
    last_test_message: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export const FIELDS: FieldSpec[] = [
  {
    key: 'method', label: 'Method', type: 'enum', required: true, default: 'GET',
    options: [
      { value: 'GET', label: 'GET' },
      { value: 'POST', label: 'POST' },
    ],
  },
  { key: 'url', label: 'URL', type: 'string', required: true, expression_supported: true },
  {
    key: 'credential_id', label: 'Credential', type: 'credential',
    credential_types: ['BEARER'],
  },
  {
    key: 'body_mode', label: 'Body', type: 'enum', default: 'NONE',
    options: [
      { value: 'NONE', label: 'None' },
      { value: 'JSON', label: 'JSON' },
    ],
  },
  {
    key: 'json_body', label: 'JSON body', type: 'json', required: true,
    condition: { field: 'body_mode', equals: 'JSON' },
  },
  {
    key: 'headers', label: 'Headers', type: 'collection',
    item_fields: [
      { key: 'name', label: 'Name', type: 'string', required: true },
      { key: 'value', label: 'Value', type: 'string', expression_supported: true },
    ],
  },
  { key: 'timeout_ms', label: 'Timeout', type: 'number', advanced: true, default: 30000 },
];
