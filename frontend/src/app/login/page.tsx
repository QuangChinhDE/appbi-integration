'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Zap } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label } from '@/components/ui/Input';
import { ApiError, authApi } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useI18n } from '@/providers/LanguageProvider';

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');

  const login = useMutation({
    // The reason is rendered under the fields; a toast would say it twice.
    meta: { errorHandledInline: true },
    mutationFn: () => authApi.login(email.trim(), password),
    onSuccess: (user) => {
      queryClient.setQueryData(qk.me(), user);
      router.replace(user.password_change_required ? '/change-password' : '/overview');
    },
  });

  const message = login.error instanceof ApiError
    ? login.error.message
    : login.error
      ? String(login.error)
      : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-text-inverse">
            <Zap className="h-4 w-4" />
          </span>
          <div>
            <p className="text-small font-strong text-text-primary">{t('app.name')}</p>
            <p className="text-tiny text-text-tertiary">{t('app.tagline')}</p>
          </div>
        </div>

        <form
          className="space-y-3.5 rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5 shadow-linear"
          onSubmit={(event) => {
            event.preventDefault();
            login.mutate();
          }}
        >
          <div>
            <Label htmlFor="email" required>{t('auth.email')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              invalid={Boolean(message)}
            />
          </div>
          <div>
            <Label htmlFor="password" required>{t('auth.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              invalid={Boolean(message)}
            />
            {/* One message for both wrong-email and wrong-password: telling
                them apart turns this form into an account-enumeration tool. */}
            <FieldError>{message}</FieldError>
          </div>
          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={login.isPending}
            disabled={!email.trim() || !password}
          >
            {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </form>
      </div>
    </main>
  );
}
