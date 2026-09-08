'use client';

/**
 * The step palette (SRS 14.2).
 *
 * Grouped by category and searchable. Trigger nodes are filtered out once the
 * workflow has one, because V1 allows exactly one start (SRS 17.1) and offering
 * a second is offering an error.
 */

import * as React from 'react';
import { Search } from 'lucide-react';

import { NodeIcon } from './NodeIcon';
import { CertificationBadge } from './StatusBadges';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import type { NodeCategory, NodeDefinition } from '@/lib/types';
import { useI18n } from '@/providers/LanguageProvider';

const ORDER: NodeCategory[] = ['TRIGGER', 'ACTION', 'LOGIC', 'DATA', 'APP'];

export function NodePalette({
  nodes, onPick, hideTriggers, className, autoFocus,
}: {
  nodes: NodeDefinition[];
  onPick: (node: NodeDefinition) => void;
  hideTriggers?: boolean;
  className?: string;
  autoFocus?: boolean;
}) {
  const { t, tf } = useI18n();
  const [query, setQuery] = React.useState('');

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return nodes.filter((node) => {
      if (hideTriggers && node.capability?.is_trigger) return false;
      if (node.status === 'DISABLED' || node.certification === 'BLOCKED') return false;
      if (!needle) return true;
      return (
        node.display_name.toLowerCase().includes(needle)
        || (node.description ?? '').toLowerCase().includes(needle)
        || node.node_key.includes(needle)
      );
    });
  }, [hideTriggers, nodes, query]);

  const grouped = React.useMemo(() => {
    const buckets = new Map<NodeCategory, NodeDefinition[]>();
    for (const node of visible) {
      const list = buckets.get(node.category) ?? [];
      list.push(node);
      buckets.set(node.category, list);
    }
    return ORDER
      .map((category) => ({ category, items: buckets.get(category) ?? [] }))
      .filter((group) => group.items.length > 0);
  }, [visible]);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="p-2">
        <Input
          size="sm"
          autoFocus={autoFocus}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('editor.paletteSearch')}
          aria-label={t('editor.paletteSearch')}
          leadingIcon={<Search />}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {grouped.length === 0 && (
          <p className="px-1 py-4 text-caption text-text-tertiary">
            {t('common.noResults')}
          </p>
        )}
        {grouped.map((group) => (
          <div key={group.category} className="mb-3">
            <p className="px-1 pb-1 text-tiny font-emphasis uppercase tracking-[0.1em] text-text-tertiary">
              {tf([`category.${group.category}`], group.category)}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((node) => (
                <li key={node.node_key}>
                  <button
                    type="button"
                    onClick={() => onPick(node)}
                    className="flex w-full items-start gap-2 rounded-md p-1.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <NodeIcon icon={node.icon} category={node.category} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-caption font-emphasis text-text-primary">
                          {node.display_name}
                        </span>
                        {node.certification !== 'SUPPORTED' && (
                          <CertificationBadge certification={node.certification} />
                        )}
                      </span>
                      {node.description && (
                        <span className="mt-0.5 block line-clamp-2 text-tiny leading-relaxed text-text-tertiary">
                          {node.description}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
