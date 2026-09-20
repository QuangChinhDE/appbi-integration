'use client';

/**
 * An error the user can act on (SRS 34).
 *
 * The backend's job is to name a code and a remediation; this component's job
 * is to turn that remediation into one button. A card without an action is a
 * dead end, so when the envelope carries no remediation the card says so
 * plainly rather than offering a fake "OK".
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronDown, Copy } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useI18n } from '@/providers/LanguageProvider';

export interface RemediationTarget {
  label: string;
  href?: string;
  onClick?: () => void;
}

/**
 * Where each remediation action goes.
 *
 * Kept as a table rather than a chain of ifs in each screen: the same code can
 * surface on the editor, the execution page and a toast, and they must all
 * offer the same next step.
 */
export function resolveRemediation(
  action: string | undefined,
  context: { workflowId?: string; executionId?: string; credentialId?: string },
  handlers: { onReload?: () => void; onRetry?: () => void; onInspect?: () => void } = {},
): RemediationTarget | null {
  if (!action) return null;
  switch (action) {
    case 'UPDATE_CREDENTIAL':
    case 'CHOOSE_CREDENTIAL':
      return {
        label: action,
        href: context.credentialId ? `/credentials/${context.credentialId}` : '/credentials',
      };
    case 'VIEW_EXECUTION':
    case 'INSPECT_EXECUTION':
      return context.executionId
        ? { label: action, href: `/executions/${context.executionId}` }
        : { label: action, href: '/executions' };
    case 'OPEN_WORKFLOW':
    case 'PUBLISH_WORKFLOW':
    case 'DEACTIVATE':
    case 'EDIT_SCHEDULE':
    case 'EDIT_NODE':
    case 'SHOW_INVALID_NODES':
    // Everything below lands in the editor too, and did not used to land
    // anywhere (Wave 0A). They are not exotic codes: NODE_TIMEOUT and
    // NODE_NETWORK_UNREACHABLE are two of the three most common ways a real
    // integration fails, and both offered a message with no way forward while
    // the fix -- the URL -- was one click away.
    case 'CHECK_ENDPOINT':
    case 'RETRY_OR_CHECK_ENDPOINT':
    case 'OPEN_FIELD':
    case 'REPLACE_NODE':
    case 'CHECK_WEBHOOK_SECRET':
      return context.workflowId
        ? { label: action, href: `/workflows/${context.workflowId}` }
        : null;
    case 'RELOAD_DRAFT':
      return handlers.onReload ? { label: action, onClick: handlers.onReload } : null;
    case 'RETRY_EXECUTION':
      return handlers.onRetry ? { label: action, onClick: handlers.onRetry } : null;
    case 'INSPECT_INPUT':
    case 'INSPECT_NODE':
      return handlers.onInspect ? { label: action, onClick: handlers.onInspect } : null;
    case 'VIEW_DEPENDENCIES':
      return context.credentialId
        ? { label: action, href: `/credentials/${context.credentialId}` }
        : null;
    default:
      // RETRY_LATER and CONTACT_ADMIN have no destination, and that is correct:
      // waiting and asking someone are not places the product can navigate to.
      // Returning null makes the card show the message alone rather than a
      // button that does nothing.
      //
      // Anything else reaching this branch is a gap, not a decision — a code
      // whose remediation goes nowhere. `stabilization.test.tsx` walks the
      // backend's own matrix and fails when a new one appears.
      return null;
  }
}

export function ErrorRemediationCard({
  title, code, message, category, traceId, technicalMessage, remediation, className,
}: {
  title?: string;
  code?: string | null;
  message: string;
  category?: string | null;
  traceId?: string;
  technicalMessage?: string | null;
  remediation?: RemediationTarget | null;
  className?: string;
}) {
  const { t, tf } = useI18n();
  const router = useRouter();
  const [showTechnical, setShowTechnical] = React.useState(false);

  const supportBlock = [
    code ? `code: ${code}` : null,
    category ? `category: ${category}` : null,
    traceId ? `trace: ${traceId}` : null,
    technicalMessage ? `technical: ${technicalMessage}` : null,
  ].filter(Boolean).join('\n');

  return (
    <div
      className={cn(
        'rounded-lg border border-danger/30 bg-danger/5 p-3.5',
        className,
      )}
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          {title && (
            <p className="text-caption font-strong text-text-primary">{title}</p>
          )}
          <p className="mt-0.5 text-caption leading-relaxed text-text-secondary">{message}</p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {/* One button either way. A `Link` nested inside a `button` is
                invalid markup, so navigation goes through the router rather
                than through an anchor the button would swallow. */}
            {remediation && (
              <Button
                size="xs"
                variant="primary"
                onClick={() => {
                  if (remediation.onClick) remediation.onClick();
                  else if (remediation.href) router.push(remediation.href);
                }}
              >
                {tf([`remediation.${remediation.label}`], remediation.label)}
              </Button>
            )}
            {supportBlock && (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setShowTechnical((value) => !value)}
                  trailingIcon={
                    <ChevronDown
                      className={cn('h-3 w-3 transition-transform',
                        showTechnical && 'rotate-180')}
                    />
                  }
                >
                  {t('common.technicalDetails')}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  leadingIcon={<Copy className="h-3 w-3" />}
                  onClick={() => {
                    void navigator.clipboard?.writeText(supportBlock);
                  }}
                >
                  {t('common.copyId')}
                </Button>
              </>
            )}
          </div>

          {showTechnical && supportBlock && (
            <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 p-2 font-mono text-tiny leading-relaxed text-text-tertiary">
              {supportBlock}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/** Convenience wrapper for an `ApiError`. */
export function ApiErrorCard({
  error, title, context, handlers, className,
}: {
  error: unknown;
  title?: string;
  context?: { workflowId?: string; executionId?: string; credentialId?: string };
  handlers?: { onReload?: () => void; onRetry?: () => void; onInspect?: () => void };
  className?: string;
}) {
  const { t } = useI18n();
  if (!(error instanceof ApiError)) {
    return (
      <ErrorRemediationCard
        title={title ?? t('common.errorTitle')}
        message={error instanceof Error ? error.message : String(error)}
        className={className}
      />
    );
  }
  const remediation = resolveRemediation(
    error.remediation?.action,
    {
      ...context,
      credentialId: error.remediation?.resource_id ?? context?.credentialId,
    },
    handlers,
  );
  return (
    <ErrorRemediationCard
      title={title ?? t('common.errorTitle')}
      code={error.code}
      message={error.message}
      category={error.category}
      traceId={error.traceId}
      technicalMessage={error.technicalMessage}
      remediation={remediation}
      className={className}
    />
  );
}
