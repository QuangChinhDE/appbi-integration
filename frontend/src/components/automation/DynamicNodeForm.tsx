'use client';

/**
 * The node configuration form (SRS 54).
 *
 * Rendered from the product's normalized `config_schema`, never from an engine
 * node description. Four behaviours the schema drives:
 *
 * * **conditions** — a field only appears when the field it depends on holds
 *   the right value, so a GET request does not ask for a JSON body;
 * * **advanced** — collapsed by default, because the basic case should fit on
 *   one screen;
 * * **expression toggle** — a field that supports mapping can hold either a
 *   literal or an expression, and the two are visibly different states;
 * * **collections** — repeatable rows for headers, query parameters and field
 *   assignments.
 */

import * as React from 'react';
import { Braces, Plus, Trash2, Wand2 } from 'lucide-react';

import { Button, IconButton } from '@/components/ui/Button';
import {
  Checkbox, FieldError, FieldHelp, Input, Label, Select, Textarea, Toggle,
} from '@/components/ui/Input';
import { Disclosure } from '@/components/ui/Disclosure';
import { cn } from '@/lib/utils';
import type { Credential, FieldSpec, ValidationIssue } from '@/lib/types';
import { useI18n } from '@/providers/LanguageProvider';

/** n8n's convention, adopted as the product's (ADR-008). */
const EXPRESSION_PREFIX = '=';

export const isExpression = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith(EXPRESSION_PREFIX);

export const toExpression = (value: unknown): string =>
  isExpression(value) ? String(value) : `${EXPRESSION_PREFIX}{{ ${''} }}`;

export const expressionBody = (value: unknown): string =>
  isExpression(value) ? String(value).slice(1) : '';

type Config = Record<string, unknown>;

function visible(spec: FieldSpec, config: Config): boolean {
  if (!spec.condition) return true;
  return config[spec.condition.field] === spec.condition.equals;
}

/** A common timezone list. Enough for the schedule editor without a dependency. */
const TIMEZONES = [
  'Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Asia/Singapore', 'Asia/Tokyo',
  'Asia/Kolkata', 'Europe/London', 'Europe/Berlin', 'America/New_York',
  'America/Los_Angeles', 'UTC',
];

interface FieldProps {
  /** The id the label points at. Passed down so every control is associated. */
  controlId?: string;
  spec: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  credentials: Credential[];
  issues: ValidationIssue[];
  /** Opens the data picker for this field. */
  onRequestPicker?: (fieldPath: string) => void;
  path: string;
}

function ExpressionInput({
  value, onChange, placeholder, onRequestPicker, path,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  placeholder?: string;
  onRequestPicker?: (fieldPath: string) => void;
  path: string;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-brand/40 bg-brand-soft/40 p-1.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-tiny font-emphasis text-brand">
          <Braces className="h-3 w-3" />
          {t('editor.expression')}
        </span>
        {onRequestPicker && (
          <button
            type="button"
            onClick={() => onRequestPicker(path)}
            className="text-tiny text-brand hover:underline"
          >
            {t('editor.dataPicker')}
          </button>
        )}
      </div>
      <Textarea
        rows={2}
        value={expressionBody(value)}
        onChange={(event) => onChange(`${EXPRESSION_PREFIX}${event.target.value}`)}
        placeholder={placeholder ?? '{{ $json.field }}'}
        className="border-transparent bg-surface-1 font-mono text-tiny"
        spellCheck={false}
      />
    </div>
  );
}

function CollectionField({
  spec, value, onChange, credentials, issues, onRequestPicker, path,
}: FieldProps) {
  const { t } = useI18n();
  const rows = Array.isArray(value) ? (value as Config[]) : [];
  const itemFields = spec.item_fields ?? [];

  const update = (index: number, key: string, next: unknown) => {
    const copy = rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [key]: next } : row);
    onChange(copy);
  };

  const blankRow = () => {
    const row: Config = {};
    for (const field of itemFields) {
      row[field.key] = field.default ?? (field.type === 'boolean' ? false : '');
    }
    return row;
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-tiny text-text-quaternary">{t('editor.collectionEmpty')}</p>
      )}
      {rows.map((row, index) => (
        <div
          key={index}
          className="rounded-md border border-[rgb(var(--border-line))] bg-surface-2/50 p-2"
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-tiny uppercase tracking-[0.08em] text-text-quaternary">
              {index + 1}
            </span>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t('common.remove')}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-3 w-3" />
            </IconButton>
          </div>
          <div className="space-y-2">
            {itemFields.map((field) => (
              <FieldRenderer
                key={field.key}
                spec={field}
                value={row[field.key]}
                onChange={(next) => update(index, field.key, next)}
                credentials={credentials}
                issues={issues}
                onRequestPicker={onRequestPicker}
                path={`${path}[${index}].${field.key}`}
              />
            ))}
          </div>
        </div>
      ))}
      <Button
        size="xs"
        variant="subtle"
        leadingIcon={<Plus className="h-3 w-3" />}
        disabled={Boolean(spec.max_items && rows.length >= spec.max_items)}
        onClick={() => onChange([...rows, blankRow()])}
      >
        {t('common.add')}
      </Button>
    </div>
  );
}

function CredentialField({ spec, value, onChange, credentials, controlId }: FieldProps) {
  const { t } = useI18n();
  const allowed = spec.credential_types ?? [];
  const options = credentials.filter(
    (credential) => allowed.length === 0 || allowed.includes(credential.credential_type));
  const selected = options.find((credential) => credential.id === value);

  return (
    <div className="space-y-1">
      <Select
        id={controlId}
        size="sm"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value || null)}
        invalid={Boolean(selected && selected.status !== 'ACTIVE')}
      >
        <option value="">{t('editor.credentialNone')}</option>
        {options.map((credential) => (
          <option key={credential.id} value={credential.id}>
            {credential.name}
            {credential.status !== 'ACTIVE' ? ` · ${t('credentials.statusInvalid')}` : ''}
          </option>
        ))}
      </Select>
      {options.length === 0 && (
        <FieldHelp>{t('editor.credentialCreate')}</FieldHelp>
      )}
      {selected && selected.status !== 'ACTIVE' && (
        <FieldError>{t('credentials.statusInvalid')}</FieldError>
      )}
    </div>
  );
}

function JsonField({ spec, value, onChange, onRequestPicker, path, controlId }: FieldProps) {
  const { t } = useI18n();
  const [text, setText] = React.useState(() => {
    if (typeof value === 'string') return value;
    return value === undefined || value === null ? '' : JSON.stringify(value, null, 2);
  });
  const [invalid, setInvalid] = React.useState(false);

  // Only re-seed from props when the field is switched to a different node,
  // otherwise every keystroke would fight the parent's state.
  React.useEffect(() => {
    setText(typeof value === 'string'
      ? value
      : value === undefined || value === null ? '' : JSON.stringify(value, null, 2));
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (isExpression(value)) {
    return (
      <ExpressionInput
        value={value}
        onChange={onChange}
        onRequestPicker={onRequestPicker}
        path={path}
      />
    );
  }

  return (
    <div className="space-y-1">
      <Textarea
        id={controlId}
        rows={5}
        value={text}
        spellCheck={false}
        className="font-mono text-tiny"
        placeholder={spec.placeholder ?? '{}'}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (!next.trim()) {
            setInvalid(false);
            onChange(null);
            return;
          }
          try {
            onChange(JSON.parse(next));
            setInvalid(false);
          } catch {
            // Kept as text rather than discarded: a half-typed object is a
            // normal intermediate state, and throwing it away on every
            // keystroke would make the field unusable.
            setInvalid(true);
            onChange(next);
          }
        }}
        invalid={invalid}
      />
      {invalid && <FieldError>{t('editor.jsonInvalid')}</FieldError>}
    </div>
  );
}

function FieldRenderer(props: FieldProps) {
  const { spec, value, onChange, issues, onRequestPicker, path } = props;
  const { t } = useI18n();
  // One id per rendered field, derived from its path so a collection's rows do
  // not collide. `useId` keeps it unique across two forms on one screen.
  const uid = React.useId();
  const controlId = `${uid}-${path.replace(/[^\w-]/g, '_')}`;
  const fieldIssues = issues.filter(
    (issue) => issue.field === spec.key || issue.field === path);
  const error = fieldIssues.find((issue) => issue.severity === 'ERROR');
  const errorId = error ? `${controlId}-error` : undefined;

  const expressionCapable = Boolean(spec.expression_supported);
  const usingExpression = isExpression(value);

  const control = (() => {
    if (usingExpression && expressionCapable) {
      return (
        <ExpressionInput
          value={value}
          onChange={onChange}
          placeholder={spec.placeholder}
          onRequestPicker={onRequestPicker}
          path={path}
        />
      );
    }

    switch (spec.type) {
      case 'enum':
        return (
          <Select
            id={controlId}
            aria-describedby={errorId}
            size="sm"
            value={typeof value === 'string' ? value : String(spec.default ?? '')}
            onChange={(event) => onChange(event.target.value)}
            invalid={Boolean(error)}
          >
            {!spec.required && <option value="">{t('common.selectPlaceholder')}</option>}
            {(spec.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        );
      case 'timezone':
        return (
          <Select
            id={controlId}
            size="sm"
            value={typeof value === 'string' ? value : String(spec.default ?? 'Asia/Bangkok')}
            onChange={(event) => onChange(event.target.value)}
          >
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </Select>
        );
      case 'boolean':
        return (
          <Checkbox
            checked={Boolean(value ?? spec.default)}
            onChange={onChange}
            label={spec.description ?? spec.label}
          />
        );
      case 'number':
        return (
          <Input
            id={controlId}
            aria-describedby={errorId}
            size="sm"
            type="number"
            min={spec.min}
            max={spec.max}
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(event) =>
              onChange(event.target.value === '' ? null : Number(event.target.value))}
            invalid={Boolean(error)}
          />
        );
      case 'time':
        return (
          <Input
            id={controlId}
            size="sm"
            type="time"
            value={typeof value === 'string' ? value : String(spec.default ?? '02:00')}
            onChange={(event) => onChange(event.target.value)}
            invalid={Boolean(error)}
          />
        );
      case 'json':
        return <JsonField {...props} controlId={controlId} />;
      case 'collection':
        return <CollectionField {...props} />;
      case 'credential':
        return <CredentialField {...props} controlId={controlId} />;
      default:
        return (
          <Input
            id={controlId}
            aria-describedby={errorId}
            size="sm"
            value={typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)}
            onChange={(event) => onChange(event.target.value)}
            placeholder={spec.placeholder}
            invalid={Boolean(error)}
          />
        );
    }
  })();

  const showToggle = expressionCapable && spec.type !== 'collection';

  return (
    <div>
      {spec.type !== 'boolean' && (
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={controlId} required={spec.required}>{spec.label}</Label>
          {showToggle && (
            <button
              type="button"
              onClick={() =>
                onChange(usingExpression
                  ? ''
                  : `${EXPRESSION_PREFIX}{{ $json.${''} }}`)}
              className="mb-1 inline-flex items-center gap-1 text-tiny text-text-tertiary hover:text-brand"
            >
              <Wand2 className="h-3 w-3" />
              {usingExpression ? t('editor.useFixed') : t('editor.useExpression')}
            </button>
          )}
        </div>
      )}
      {control}
      {spec.description && spec.type !== 'boolean' && (
        <FieldHelp>{spec.description}</FieldHelp>
      )}
      {error && <FieldError id={errorId}>{error.message}</FieldError>}
    </div>
  );
}

export function DynamicNodeForm({
  fields, config, onChange, credentials, issues, onRequestPicker,
}: {
  fields: FieldSpec[];
  config: Config;
  onChange: (config: Config) => void;
  credentials: Credential[];
  issues: ValidationIssue[];
  onRequestPicker?: (fieldPath: string) => void;
}) {
  const { t } = useI18n();

  const setField = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  const basic = fields.filter((spec) => !spec.advanced && visible(spec, config));
  const advanced = fields.filter((spec) => spec.advanced && visible(spec, config));

  return (
    <div className="space-y-3.5">
      {basic.map((spec) => (
        <FieldRenderer
          key={spec.key}
          spec={spec}
          value={config[spec.key]}
          onChange={(value) => setField(spec.key, value)}
          credentials={credentials}
          issues={issues}
          onRequestPicker={onRequestPicker}
          path={spec.key}
        />
      ))}

      {advanced.length > 0 && (
        <Disclosure label={t('common.advanced', { n: advanced.length })}>
          <div className="space-y-3.5 pt-1">
            {advanced.map((spec) => (
              <FieldRenderer
                key={spec.key}
                spec={spec}
                value={config[spec.key]}
                onChange={(value) => setField(spec.key, value)}
                credentials={credentials}
                issues={issues}
                onRequestPicker={onRequestPicker}
                path={spec.key}
              />
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  );
}
