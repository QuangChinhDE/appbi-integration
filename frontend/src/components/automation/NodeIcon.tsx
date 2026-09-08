'use client';

/**
 * Node icons, resolved from the product's own icon token (SRS 11.3).
 *
 * The registry stores a name like `globe`, not an image URL from an engine
 * package — so the palette renders identically whatever the runtime is, and a
 * node whose icon is missing still gets a legible placeholder rather than a
 * broken image.
 */

import * as React from 'react';
import {
  Blocks, Clock, GitBranch, GitMerge, Globe, MousePointerClick, PencilRuler,
  Split, Webhook,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { NodeCategory } from '@/lib/types';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'mouse-pointer-click': MousePointerClick,
  webhook: Webhook,
  clock: Clock,
  globe: Globe,
  'pencil-ruler': PencilRuler,
  'git-branch': GitBranch,
  'git-merge': GitMerge,
  split: Split,
};

/** Category tints. Muted on purpose: the canvas should read as one system. */
const CATEGORY_TONE: Record<NodeCategory, string> = {
  TRIGGER: 'bg-brand/10 text-brand',
  ACTION: 'bg-info/10 text-info',
  LOGIC: 'bg-warning/10 text-warning',
  DATA: 'bg-success/10 text-success',
  APP: 'bg-surface-3 text-text-secondary',
};

export function NodeIcon({
  icon, category, size = 'md', className,
}: {
  icon?: string | null;
  category?: NodeCategory;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const Glyph = (icon && ICONS[icon]) || Blocks;
  const box = size === 'sm' ? 'h-6 w-6' : size === 'lg' ? 'h-10 w-10' : 'h-8 w-8';
  const glyph = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';

  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center rounded-md',
        box,
        CATEGORY_TONE[category ?? 'APP'],
        className,
      )}
      aria-hidden
    >
      <Glyph className={glyph} />
    </span>
  );
}
