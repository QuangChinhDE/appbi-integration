'use client';

/**
 * JSON viewer for node payloads (SRS 7.3 execution data panel).
 *
 * Two things it does that a `<pre>{JSON.stringify(...)}</pre>` does not:
 *
 * * it lets a person click a field and get the expression that references it,
 *   which is the difference between reading data and mapping it;
 * * it stays collapsed by default below the first level, so a 200-key object
 *   does not push everything else off the screen.
 *
 * The payload is already redacted and truncated by the backend — this component
 * never sees a raw response body (SRS 21.3).
 */

import * as React from 'react';
import { ChevronDown, ChevronRight, Copy, Search } from 'lucide-react';

import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { useI18n } from '@/providers/LanguageProvider';

type Json = unknown;

function typeOf(value: Json): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function preview(value: Json): string {
  const kind = typeOf(value);
  if (kind === 'array') return `[${(value as unknown[]).length}]`;
  if (kind === 'object') return `{${Object.keys(value as object).length}}`;
  if (kind === 'string') {
    const text = value as string;
    return `"${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`;
  }
  return String(value);
}

const VALUE_TONE: Record<string, string> = {
  string: 'text-success',
  number: 'text-info',
  boolean: 'text-warning',
  null: 'text-text-quaternary',
};

function Row({
  path, label, value, depth, onPick, filter,
}: {
  path: string;
  label: string;
  value: Json;
  depth: number;
  onPick?: (path: string) => void;
  filter: string;
}) {
  const { t } = useI18n();
  const kind = typeOf(value);
  const branch = kind === 'object' || kind === 'array';
  // Only the first level is open by default: deep payloads are common and an
  // expanded tree pushes the rest of the panel out of view.
  const [open, setOpen] = React.useState(depth < 1);

  const matches = React.useMemo(() => {
    if (!filter) return true;
    const needle = filter.toLowerCase();
    if (label.toLowerCase().includes(needle)) return true;
    try {
      return JSON.stringify(value).toLowerCase().includes(needle);
    } catch {
      return false;
    }
  }, [filter, label, value]);

  if (!matches) return null;

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <div className="group flex items-start gap-1 py-0.5">
        {branch ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            // Named for what it does, not for the field it sits beside. Both
            // buttons on this row concern the same key, and two controls with
            // the accessible name "customer" leave a screen reader user unable
            // to tell expanding from inserting.
            aria-label={`${open ? t('common.collapse') : t('common.expand')} ${label}`}
            className="mt-0.5 rounded text-text-quaternary hover:text-text-secondary"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-3" aria-hidden />
        )}

        <button
          type="button"
          onClick={() => onPick?.(path)}
          disabled={!onPick}
          className={cn(
            'text-left font-mono text-tiny',
            onPick
              ? 'rounded px-0.5 text-text-secondary hover:bg-brand-soft hover:text-brand'
              : 'text-text-secondary',
          )}
          title={onPick ? path : undefined}
        >
          {label}
        </button>
        <span className="text-tiny text-text-quaternary">:</span>
        <span className={cn('min-w-0 break-all font-mono text-tiny',
          VALUE_TONE[kind] ?? 'text-text-tertiary')}>
          {preview(value)}
        </span>
      </div>

      {branch && open && (
        <div>
          {kind === 'array'
            ? (value as unknown[]).map((item, index) => (
              <Row
                key={index}
                path={`${path}[${index}]`}
                label={String(index)}
                value={item}
                depth={depth + 1}
                onPick={onPick}
                filter={filter}
              />
            ))
            : Object.entries(value as Record<string, Json>).map(([key, item]) => (
              <Row
                key={key}
                path={`${path}.${key}`}
                label={key}
                value={item}
                depth={depth + 1}
                onPick={onPick}
                filter={filter}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export function JsonTreeViewer({
  items, rootPath = '$json', onPick, emptyLabel, className,
}: {
  items: unknown[];
  /** Prefix for the path handed to `onPick`, so it reads as an expression. */
  rootPath?: string;
  onPick?: (path: string) => void;
  emptyLabel?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = React.useState('');
  const [mode, setMode] = React.useState<'tree' | 'raw'>('tree');

  if (!items || items.length === 0) {
    return (
      <p className="px-1 py-3 text-caption text-text-tertiary">
        {emptyLabel ?? t('common.none')}
      </p>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="mb-2 flex items-center gap-2">
        <div className="max-w-[220px] flex-1">
          <Input
            size="sm"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('common.search')}
            aria-label={t('common.searchLabel')}
            leadingIcon={<Search />}
          />
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-[rgb(var(--border-line))]">
          {(['tree', 'raw'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={cn(
                'px-2 py-1 text-tiny font-emphasis uppercase',
                mode === option
                  ? 'bg-surface-3 text-text-primary'
                  : 'text-text-tertiary hover:text-text-primary',
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(JSON.stringify(items, null, 2));
          }}
          aria-label={t('common.copy')}
          className="rounded-md p-1.5 text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-[rgb(var(--border-line))] bg-surface-1 p-2">
        {mode === 'raw' ? (
          <pre className="overflow-x-auto font-mono text-tiny leading-relaxed text-text-secondary">
            {JSON.stringify(items, null, 2)}
          </pre>
        ) : (
          items.map((item, index) => (
            <div key={index} className={index > 0 ? 'mt-2 border-t border-[rgb(var(--border-line))] pt-2' : ''}>
              {items.length > 1 && (
                <p className="mb-1 text-tiny uppercase tracking-[0.08em] text-text-quaternary">
                  item {index}
                </p>
              )}
              <Row
                path={rootPath}
                label={rootPath}
                value={item}
                depth={0}
                onPick={onPick}
                filter={filter}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
