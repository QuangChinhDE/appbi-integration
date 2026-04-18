/**
 * Linear Design System UI primitives — matches appbi-ai for cross-app consistency.
 * Uses semantic tokens from the shared design system.
 */
import React from 'react'
import { Loader2, X, AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react'
import { cn } from '../../lib/utils'
import { addNotification } from '@modules/identity/frontend/lib/notifications'

// ─── Button ─────────────────────────────────────────────────────────────────

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 font-emphasis whitespace-nowrap rounded-md transition-[background-color,box-shadow,border-color,color] duration-150 ease-out select-none disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:shadow-focus-brand'

const BTN_SIZES = {
  xs: 'h-7 px-2.5 text-label gap-1',
  sm: 'h-8 px-3 text-caption',
  md: 'h-9 px-3.5 text-caption',
  lg: 'h-10 px-4 text-small',
}

const BTN_VARIANTS = {
  primary:   'bg-brand text-text-inverse hover:bg-brand-hover active:bg-brand-active shadow-linear-sm',
  secondary: 'bg-surface-1 text-text-primary border border-[rgb(var(--border-strong))] hover:bg-surface-2',
  ghost:     'bg-transparent text-text-secondary hover:bg-surface-2 hover:text-text-primary',
  subtle:    'bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary',
  outline:   'bg-transparent text-text-primary border border-[rgb(var(--border-strong))] hover:bg-surface-2',
  danger:    'bg-danger text-text-inverse hover:opacity-90 shadow-linear-sm',
  link:      'bg-transparent text-brand hover:text-brand-hover underline-offset-4 hover:underline px-1 h-auto',
}

export const Button = React.forwardRef(({
  className,
  variant = 'secondary',
  size = 'md',
  leadingIcon,
  trailingIcon,
  loading,
  disabled,
  fullWidth,
  children,
  type = 'button',
  ...props
}, ref) => {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        BTN_BASE,
        BTN_SIZES[size],
        BTN_VARIANTS[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        leadingIcon
      )}
      {children}
      {!loading && trailingIcon}
    </button>
  )
})
Button.displayName = 'Button'

export const IconButton = React.forwardRef(({ className, size = 'md', children, ...props }, ref) => {
  const square = { xs: 'h-7 w-7 p-0', sm: 'h-8 w-8 p-0', md: 'h-9 w-9 p-0', lg: 'h-10 w-10 p-0' }
  return (
    <Button ref={ref} size={size} className={cn(square[size], className)} {...props}>
      {children}
    </Button>
  )
})
IconButton.displayName = 'IconButton'

// ─── Input / Textarea / Select / Label / FieldGroup ─────────────────────────

const INPUT_SIZES = {
  sm: 'h-8 text-caption',
  md: 'h-9 text-caption',
  lg: 'h-10 text-small',
}

export const Input = React.forwardRef(({
  className, leadingIcon, trailingIcon, size = 'md', invalid, ...props
}, ref) => {
  const hasLeading = !!leadingIcon
  const hasTrailing = !!trailingIcon
  const input = (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-md bg-surface-1 text-text-primary placeholder:text-text-quaternary',
        'border transition-[border-color,box-shadow] duration-150 outline-none',
        invalid
          ? 'border-danger/60 focus:shadow-[0_0_0_3px_rgb(220_38_38/0.15)]'
          : 'border-[rgb(var(--border-strong))] focus:border-brand focus:shadow-focus-brand',
        INPUT_SIZES[size],
        hasLeading ? 'pl-9' : 'pl-3',
        hasTrailing ? 'pr-9' : 'pr-3',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-2',
        className,
      )}
      {...props}
    />
  )
  if (!hasLeading && !hasTrailing) return input
  return (
    <div className="relative flex items-center">
      {hasLeading && (
        <span className="pointer-events-none absolute left-3 text-text-tertiary [&_svg]:h-4 [&_svg]:w-4">
          {leadingIcon}
        </span>
      )}
      {input}
      {hasTrailing && (
        <span className="absolute right-3 text-text-tertiary [&_svg]:h-4 [&_svg]:w-4">
          {trailingIcon}
        </span>
      )}
    </div>
  )
})
Input.displayName = 'Input'

export const Textarea = React.forwardRef(({ className, invalid, rows = 4, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full rounded-md bg-surface-1 text-text-primary placeholder:text-text-quaternary',
        'border transition-[border-color,box-shadow] duration-150 outline-none',
        'px-3 py-2 text-caption leading-relaxed resize-y',
        invalid
          ? 'border-danger/60 focus:shadow-[0_0_0_3px_rgb(220_38_38/0.15)]'
          : 'border-[rgb(var(--border-strong))] focus:border-brand focus:shadow-focus-brand',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-2',
        className,
      )}
      {...props}
    />
  )
})
Textarea.displayName = 'Textarea'

export const Select = React.forwardRef(({ className, size = 'md', invalid, children, ...props }, ref) => {
  return (
    <select
      ref={ref}
      className={cn(
        'w-full rounded-md bg-surface-1 text-text-primary',
        'border transition-[border-color,box-shadow] duration-150 outline-none',
        'px-3 pr-8 appearance-none',
        "bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238a8f98' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")]",
        'bg-no-repeat bg-[right_0.625rem_center]',
        invalid
          ? 'border-danger/60 focus:shadow-[0_0_0_3px_rgb(220_38_38/0.15)]'
          : 'border-[rgb(var(--border-strong))] focus:border-brand focus:shadow-focus-brand',
        INPUT_SIZES[size],
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-2',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
})
Select.displayName = 'Select'

export const Label = React.forwardRef(({ className, required, children, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('text-label text-text-secondary font-emphasis', className)}
    {...props}
  >
    {children}
    {required && <span className="ml-0.5 text-danger">*</span>}
  </label>
))
Label.displayName = 'Label'

export const FieldGroup = ({ label, required, description, error, htmlFor, className, children }) => {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {description && !error && (
        <p className="text-caption text-text-tertiary">{description}</p>
      )}
      {error && <p className="text-caption text-danger">{error}</p>}
    </div>
  )
}

// ─── Badge / Tag ────────────────────────────────────────────────────────────

const BADGE_SIZES = {
  xs: 'text-tiny px-1.5 h-4 gap-1',
  sm: 'text-micro px-2 h-5 gap-1',
  md: 'text-label px-2.5 h-6 gap-1.5',
}

const BADGE_VARIANTS = {
  neutral:  'bg-surface-2 text-text-secondary border border-[rgb(var(--border-line))]',
  subtle:   'bg-surface-2 text-text-tertiary',
  brand:    'bg-brand/10 text-brand',
  success:  'bg-success-soft/12 text-success',
  warning:  'bg-warning/10 text-warning',
  danger:   'bg-danger/10 text-danger',
  info:     'bg-info/10 text-info',
  outline:  'bg-transparent text-text-secondary border border-[rgb(var(--border-strong))]',
  // Legacy color map aliases
  default:  'bg-surface-2 text-text-secondary border border-[rgb(var(--border-line))]',
  blue:     'bg-info/10 text-info',
  green:    'bg-success-soft/12 text-success',
  red:      'bg-danger/10 text-danger',
  orange:   'bg-warning/10 text-warning',
  gold:     'bg-warning/10 text-warning',
  purple:   'bg-brand/10 text-brand',
  cyan:     'bg-info/10 text-info',
  processing: 'bg-info/10 text-info animate-pulse',
  error:    'bg-danger/10 text-danger',
}

const DOT_COLORS = {
  neutral: 'bg-text-quaternary',
  subtle: 'bg-text-quaternary',
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  outline: 'bg-text-quaternary',
  default: 'bg-text-quaternary',
}

export const Badge = ({
  className,
  variant = 'neutral',
  size = 'sm',
  pill = true,
  dot,
  children,
  ...props
}) => {
  return (
    <span
      className={cn(
        'inline-flex items-center font-emphasis whitespace-nowrap',
        pill ? 'rounded-full' : 'rounded-sm',
        BADGE_SIZES[size],
        BADGE_VARIANTS[variant] || BADGE_VARIANTS.neutral,
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn('inline-block h-1.5 w-1.5 rounded-full', DOT_COLORS[variant] || DOT_COLORS.neutral)}
          aria-hidden
        />
      )}
      {children}
    </span>
  )
}

/** Legacy Tag — maps to Badge */
export const Tag = ({ color = 'default', children, className = '' }) => (
  <Badge variant={color} size="sm" className={className}>{children}</Badge>
)

// ─── FilterTag — aligned with appbi-ai (h-5 pill, clickable) ────────────────
const FILTER_TAG_BASE =
  'inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-tiny font-emphasis leading-none whitespace-nowrap appearance-none transition-[background-color,border-color,color,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-50'

const FILTER_TAG_TONE = {
  neutral: 'border-[rgb(var(--border-line))] bg-surface-2 text-text-secondary hover:border-[rgb(var(--border-strong))] hover:bg-surface-3',
  brand:   'border-brand/20 bg-brand/10 text-brand hover:border-brand/35 hover:bg-brand/15',
  success: 'border-success/20 bg-success/10 text-success hover:border-success/35 hover:bg-success/15',
  warning: 'border-warning/20 bg-warning/10 text-warning hover:border-warning/35 hover:bg-warning/15',
  danger:  'border-danger/20 bg-danger/10 text-danger hover:border-danger/35 hover:bg-danger/15',
  info:    'border-info/20 bg-info/10 text-info hover:border-info/35 hover:bg-info/15',
}

const FILTER_TAG_ACTIVE = {
  neutral: 'border-brand/30 bg-brand/10 text-brand shadow-linear-sm',
  brand:   'border-brand/35 bg-brand/15 text-brand shadow-linear-sm',
  success: 'border-success/35 bg-success/15 text-success shadow-linear-sm',
  warning: 'border-warning/35 bg-warning/15 text-warning shadow-linear-sm',
  danger:  'border-danger/35 bg-danger/15 text-danger shadow-linear-sm',
  info:    'border-info/35 bg-info/15 text-info shadow-linear-sm',
}

export const FilterTag = React.forwardRef(
  ({ className, tone = 'neutral', active = false, type = 'button', as, children, ...props }, ref) => {
    const Component = as || 'button'
    const interactive = Component === 'button'
    return (
      <Component
        ref={ref}
        {...(interactive ? { type, 'aria-pressed': active } : {})}
        className={cn(
          FILTER_TAG_BASE,
          active ? FILTER_TAG_ACTIVE[tone] : FILTER_TAG_TONE[tone],
          className,
        )}
        {...props}
      >
        {children}
      </Component>
    )
  },
)
FilterTag.displayName = 'FilterTag'

export const StatusDot = ({ variant = 'neutral', className, ...props }) => (
  <span
    className={cn('inline-block h-2 w-2 rounded-full', DOT_COLORS[variant] || DOT_COLORS.neutral, className)}
    {...props}
  />
)

// ─── Alert ───────────────────────────────────────────────────────────────────
const ALERT_STYLES = {
  info:    { wrap: 'bg-info/6 border-[rgb(var(--border-strong))]',    text: 'text-text-primary',   icon: Info,          iconCls: 'text-info' },
  success: { wrap: 'bg-success/6 border-[rgb(var(--border-strong))]', text: 'text-text-primary',  icon: CheckCircle,   iconCls: 'text-success' },
  warning: { wrap: 'bg-warning/6 border-[rgb(var(--border-strong))]', text: 'text-text-primary',  icon: AlertTriangle, iconCls: 'text-warning' },
  error:   { wrap: 'bg-danger/6 border-[rgb(var(--border-strong))]',  text: 'text-text-primary',  icon: AlertCircle,   iconCls: 'text-danger' },
}

export const Alert = ({ type = 'info', message, description, className = '' }) => {
  const s = ALERT_STYLES[type] ?? ALERT_STYLES.info
  const Icon = s.icon
  return (
    <div className={cn('flex gap-3 p-3 rounded-lg border', s.wrap, className)}>
      <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', s.iconCls)} />
      <div>
        {message && <p className={cn('text-caption font-emphasis', s.text)}>{message}</p>}
        {description && <p className={cn('text-caption mt-0.5 text-text-tertiary')}>{description}</p>}
      </div>
    </div>
  )
}

// ─── Spinner ─────────────────────────────────────────────────────────────────
export const Spinner = ({ className = '' }) => (
  <Loader2 className={cn('animate-spin', className || 'w-5 h-5 text-brand')} />
)

export const SpinCenter = ({ text = 'Loading…' }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-12">
    <Loader2 className="mx-auto h-7 w-7 animate-spin text-brand" />
    {text && <p className="text-caption text-text-tertiary">{text}</p>}
  </div>
)

// ─── Progress bar ─────────────────────────────────────────────────────────────
const PROGRESS_COLORS = {
  normal:    'bg-brand',
  active:    'bg-brand animate-pulse',
  success:   'bg-success',
  exception: 'bg-danger',
}

export const Progress = ({ percent = 0, status = 'normal', size = 'default' }) => {
  const h = size === 'small' ? 'h-1.5' : 'h-2'
  return (
    <div className={cn('w-full bg-surface-2 rounded-full overflow-hidden', h)}>
      <div
        className={cn(h, 'rounded-full transition-all duration-300', PROGRESS_COLORS[status] ?? PROGRESS_COLORS.normal)}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export const Modal = ({ open, onCancel, title, children, footer, width = 520, size, className = '' }) => {
  if (!open) return null
  const sizeMap = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', '2xl': 'max-w-6xl', full: 'max-w-[96rem]' }
  const maxW = sizeMap[size] || undefined
  const heightClass = size === 'full' ? 'h-[94vh] max-h-[94vh]' : 'max-h-[90vh]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-overlay/84 backdrop-blur-[3px]" onClick={onCancel} />
      <div
        className={cn(
          'relative mx-4 flex w-full flex-col overflow-hidden rounded-xl',
          'bg-surface-1 border border-[rgb(var(--border-strong))] shadow-linear-lg',
          'animate-slide-up',
          maxW,
          heightClass,
          className,
        )}
        style={maxW ? undefined : { maxWidth: width }}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[rgb(var(--border-line))]">
          <h3 className="text-small font-strong text-text-primary">{title}</h3>
          <IconButton aria-label="Close" variant="ghost" size="sm" onClick={onCancel}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[rgb(var(--border-line))] bg-surface-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Drawer ───────────────────────────────────────────────────────────────────
export const Drawer = ({ open, onClose, title, children, extra, width = 880 }) => {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-fade-in">
      <div className="absolute inset-0 bg-overlay/84 backdrop-blur-[3px]" onClick={onClose} />
      <div
        className="relative bg-surface-1 border-l border-[rgb(var(--border-line))] shadow-linear-lg flex flex-col h-full animate-slide-up"
        style={{ width: Math.min(width, window.innerWidth - 32) }}
      >
        {title !== null ? (
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[rgb(var(--border-line))] shrink-0">
            <h2 className="text-small font-strong text-text-primary truncate">{title}</h2>
            <div className="flex items-center gap-2">
              {extra}
              <IconButton aria-label="Close" variant="ghost" size="sm" onClick={onClose}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          </div>
        ) : (
          <IconButton
            aria-label="Close"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="absolute top-4 right-4 z-10"
          >
            <X className="h-4 w-4" />
          </IconButton>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
export const Tabs = ({ activeKey, onChange, items = [], variant = 'underline', size = 'md' }) => {
  if (variant === 'pill') {
    return (
      <div className="mb-4">
        <div role="tablist" className="inline-flex items-center gap-1 p-1 rounded-lg bg-surface-2 border border-[rgb(var(--border-line))]">
          {items.map(item => {
            const active = item.key === activeKey
            return (
              <button
                key={item.key}
                role="tab"
                aria-selected={active}
                onClick={() => onChange(item.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md transition-colors font-emphasis',
                  size === 'sm' ? 'h-7 px-2.5 text-label' : 'h-8 px-3 text-caption',
                  active
                    ? 'bg-surface-1 text-text-primary shadow-linear-sm'
                    : 'text-text-tertiary hover:text-text-primary',
                )}
              >
                {item.label}
              </button>
            )
          })}
        </div>
        {items.find(i => i.key === activeKey)?.children}
      </div>
    )
  }

  return (
    <div className="mb-4">
      <div role="tablist" className="inline-flex items-center gap-1 border-b border-[rgb(var(--border-line))]">
        {items.map(item => {
          const active = item.key === activeKey
          return (
            <button
              key={item.key}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(item.key)}
              className={cn(
                'inline-flex items-center gap-1.5 relative transition-colors font-emphasis',
                size === 'sm' ? 'h-8 px-2.5 text-label' : 'h-9 px-3 text-caption',
                active
                  ? 'text-text-primary'
                  : 'text-text-tertiary hover:text-text-primary',
              )}
            >
              {item.label}
              <span
                className={cn(
                  'absolute left-0 right-0 -bottom-px h-0.5 bg-brand transition-opacity',
                  active ? 'opacity-100' : 'opacity-0',
                )}
              />
            </button>
          )
        })}
      </div>
      {items.find(i => i.key === activeKey)?.children}
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let _toastContainer = null

const showToast = (msg, type = 'info') => {
  if (!_toastContainer) {
    _toastContainer = document.createElement('div')
    _toastContainer.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;flex-direction:column-reverse;gap:8px;max-width:360px;'
    document.body.appendChild(_toastContainer)
  }
  const el = document.createElement('div')
  const colors = {
    success: 'background:rgb(var(--surface-1));color:rgb(var(--text-primary));border-left:3px solid rgb(39,166,68)',
    error:   'background:rgb(var(--surface-1));color:rgb(var(--text-primary));border-left:3px solid rgb(220,38,38)',
    warning: 'background:rgb(var(--surface-1));color:rgb(var(--text-primary));border-left:3px solid rgb(217,119,6)',
    info:    'background:rgb(var(--surface-1));color:rgb(var(--text-primary));border-left:3px solid rgb(94,106,210)',
  }
  el.style.cssText = `${colors[type] || colors.info};padding:10px 14px;border-radius:8px;font-size:13px;font-weight:510;box-shadow:0 8px 24px rgb(8 9 10/0.08),0 2px 6px rgb(8 9 10/0.04);border:1px solid rgb(var(--border-line));transition:opacity .3s;`
  el.textContent = msg
  _toastContainer.appendChild(el)
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300) }, 3000)
}

const toastAndLog = (msg, level, persist = true) => {
  const text = typeof msg === 'object' && msg !== null ? msg.content : msg
  const description = typeof msg === 'object' && msg !== null ? msg.description : undefined
  showToast(text, level)
  if (persist && text) {
    addNotification({ level, title: text, description })
  }
}

export const message = {
  success: (msg) => toastAndLog(msg, 'success'),
  error:   (msg) => toastAndLog(msg, 'error'),
  warning: (msg) => toastAndLog(msg, 'warning'),
  info:    (msg) => toastAndLog(msg, 'info'),
  // Loading toasts are transient by design — do not persist them.
  loading: (msg) => toastAndLog(msg, 'info', false),
}

// ─── Empty state ──────────────────────────────────────────────────────────────
export const Empty = ({ description = 'No data', icon: CustomIcon, action }) => (
  <div className="flex flex-col items-center justify-center text-center rounded-lg border border-dashed border-[rgb(var(--border-strong))] bg-surface-1 px-6 py-12">
    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-text-tertiary">
      {CustomIcon ? <CustomIcon className="h-5 w-5" /> : (
        <svg className="h-5 w-5" viewBox="0 0 64 64" fill="currentColor"><path d="M32 4C16.536 4 4 16.536 4 32s12.536 28 28 28 28-12.536 28-28S47.464 4 32 4zm0 4c13.255 0 24 10.745 24 24S45.255 56 32 56 8 45.255 8 32 18.745 8 32 8zm-1 12v14h2V20h-2zm0 18v4h2v-4h-2z"/></svg>
      )}
    </div>
    <h3 className="text-small font-strong text-text-primary">{description}</h3>
    {action && <div className="mt-5">{action}</div>}
  </div>
)

// ─── Card ─────────────────────────────────────────────────────────────────────
export const Card = React.forwardRef(({ className, elevation = 'flat', padded, children, ...props }, ref) => {
  const elevations = {
    flat: 'bg-surface-1 border border-[rgb(var(--border-strong))]',
    raised: 'bg-surface-1 shadow-linear border border-[rgb(var(--border-line))]',
    interactive: 'bg-surface-1 border border-[rgb(var(--border-strong))] transition-[background-color,border-color,box-shadow] hover:bg-surface-2 hover:shadow-linear-sm cursor-pointer',
  }
  return (
    <div
      ref={ref}
      className={cn('rounded-lg overflow-hidden', elevations[elevation], padded && 'p-4', className)}
      {...props}
    >
      {children}
    </div>
  )
})
Card.displayName = 'Card'

export const CardHeader = ({ className, children, ...props }) => (
  <div className={cn('flex items-start justify-between gap-3 px-4 py-3 border-b border-[rgb(var(--border-line))]', className)} {...props}>
    {children}
  </div>
)

export const CardBody = ({ className, children, ...props }) => (
  <div className={cn('p-4', className)} {...props}>{children}</div>
)

export const CardFooter = ({ className, children, ...props }) => (
  <div className={cn('flex items-center justify-end gap-2 px-4 py-3 border-t border-[rgb(var(--border-line))] bg-surface-2', className)} {...props}>
    {children}
  </div>
)

// ─── Skeleton ─────────────────────────────────────────────────────────────────
export const Skeleton = ({ className, ...props }) => (
  <div className={cn('animate-pulse rounded-md bg-surface-2', className)} {...props} />
)
