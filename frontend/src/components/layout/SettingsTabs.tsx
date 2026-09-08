'use client';

/**
 * The settings sub-navigation.
 *
 * Engine & compatibility is admin-only: it exposes runtime versions and
 * certification state, which is operational information rather than something
 * a workspace member acts on (SRS 35.9).
 */

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { Tabs } from '@/components/ui/Tabs';
import { usePermissions } from '@/hooks/use-permissions';
import { useI18n } from '@/providers/LanguageProvider';

export function SettingsTabs() {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const { can } = usePermissions();

  const items = [
    { id: '/settings/workspace', label: t('settings.workspace') },
    ...(can('members', 'view')
      ? [{ id: '/settings/access', label: t('settings.access') }]
      : []),
    ...(can('settings', 'view')
      ? [{ id: '/settings/engine', label: t('settings.engine') }]
      : []),
  ];

  const active = items.find((item) => pathname.startsWith(item.id))?.id ?? items[0]?.id;

  return (
    <Tabs
      items={items}
      value={active ?? ''}
      onChange={(next) => router.push(next)}
    />
  );
}
