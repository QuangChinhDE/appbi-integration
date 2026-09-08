'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { FieldError, FieldHelp, Input, Label } from '@/components/ui/Input';
import { ApiError, authApi } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useI18n } from '@/providers/LanguageProvider';

/**
 * The forced password change.
 *
 * Its own route rather than a modal on the shell: an account in this state can
 * do nothing else, and the backend refuses every other endpoint until it is
 * done (see `request_context`).
 */
export default function ChangePasswordPage() {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');

  const mismatch = confirm.length > 0 && next !== confirm;

  const change = useMutation({
    mutationFn: () => authApi.changePassword(current, next),
    onSuccess: (user) => {
      queryClient.setQueryData(qk.me(), user);
      router.replace('/overview');
    },
  });

  const problems = change.error instanceof ApiError
    ? ((change.error.details?.problems as string[] | undefined) ?? [change.error.message])
    : change.error
      ? [String(change.error)]
      : [];

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-text-inverse">
            <KeyRound className="h-4 w-4" />
          </span>
          <div>
            <p className="text-small font-strong text-text-primary">
              {t('auth.changePasswordTitle')}
            </p>
            <p className="max-w-[320px] text-tiny leading-relaxed text-text-tertiary">
              {t('auth.changePasswordHelp')}
            </p>
          </div>
        </div>

        <form
          className="space-y-3.5 rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5 shadow-linear"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mismatch) change.mutate();
          }}
        >
          <div>
            <Label htmlFor="current" required>{t('auth.currentPassword')}</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="next" required>{t('auth.newPassword')}</Label>
            <Input
              id="next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
            <FieldHelp>{t('settings.initialPasswordHelp')}</FieldHelp>
          </div>
          <div>
            <Label htmlFor="confirm" required>{t('auth.confirmPassword')}</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              invalid={mismatch}
            />
            {mismatch && <FieldError>{t('auth.passwordMismatch')}</FieldError>}
          </div>

          {/* Every reason at once. A rule the user cannot see is a rule they
              retry against blindly. */}
          {problems.length > 0 && (
            <ul className="space-y-1 rounded-md border border-danger/25 bg-danger/[0.05] p-2.5">
              {problems.map((problem) => (
                <li key={problem} className="text-tiny leading-relaxed text-danger">
                  {problem}
                </li>
              ))}
            </ul>
          )}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={change.isPending}
            disabled={!current || !next || mismatch}
          >
            {t('auth.changePassword')}
          </Button>
        </form>
      </div>
    </main>
  );
}
