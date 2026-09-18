'use client';

import * as React from 'react';
import {
  MutationCache, QueryCache, QueryClient, QueryClientProvider,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            // 401 is handled by the shell (redirect to login); 403/404 belong to
            // the screen that asked. Only surface unexpected failures globally.
            if (error instanceof ApiError && [401, 403, 404].includes(error.status)) return;
            if (error instanceof ApiError && error.status >= 500) {
              toast.error(error.message, { description: `trace: ${error.traceId}` });
            }
          },
        }),
        // A mutation is something the user *did*, so its failure is never
        // ambiguous the way a background refetch's is: if it failed, they need
        // to know, or the control they just pressed looks like it did nothing.
        //
        // This is the floor, not the policy. A mutation with its own `onError`
        // keeps full control -- react-query calls this cache handler first and
        // the local one after, and every screen that wants a specific message,
        // a trace id or an inline field error still writes one. What this
        // removes is the case where somebody forgets and the failure is
        // swallowed in silence, which is how `/alerts` shipped an Acknowledge
        // button that reported neither success nor failure.
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) => {
            // A mutation that handles its own failure keeps full control.
            //
            // Two things to know about this check. It sees the handler passed
            // to `useMutation({...})`, not one passed per call as
            // `mutate(vars, { onError })` -- there are no such call sites
            // today, and one added later would toast twice. And if anybody
            // ever sets `defaultOptions.mutations.onError`, react-query merges
            // it into every mutation's options and this guard becomes
            // unconditionally true, switching the whole floor off in silence.
            // Do not add a default mutation `onError`; put it here instead.
            if (mutation.options.onError) return;

            // Opt-out for a form that renders `mutation.error` in its own
            // markup -- sign-in and the forced password change both put the
            // reason next to the field it belongs to, and a toast saying the
            // same thing again is noise, not safety.
            if (mutation.meta?.errorHandledInline) return;

            // What the shell already handles by navigating: 401 (it redirects
            // to /login) and a pending password change (it redirects to
            // /change-password -- AppShell.tsx:65). Saying that rule on the
            // query path and not here left an expired session toasting an
            // authorization error with a trace id, on a screen that was
            // already going away, for a problem whose only answer is "sign in
            // again".
            //
            // Deliberately *not* a blanket 403. A denied action is something
            // the user did, and silence there is the `/alerts` failure this
            // floor exists to end.
            if (error instanceof ApiError
              && (error.status === 401
                || (error.status === 403 && error.code === 'PASSWORD_CHANGE_REQUIRED'))) {
              return;
            }

            const message = error instanceof Error ? error.message : String(error);
            toast.error(message, {
              description: error instanceof ApiError && error.traceId
                ? `trace: ${error.traceId}`
                : undefined,
            });
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
