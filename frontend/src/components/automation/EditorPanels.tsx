'use client';

/**
 * The editor's two side panels.
 *
 * The workflow editor used to be a canvas with two modals over it: one to add
 * a step, one to configure the selected step below `xl`. Both cost the thing
 * the screen is for -- you cannot see the graph you are editing while a dialog
 * covers it, and every add-then-configure round trip meant open, pick, close,
 * click, open, edit, close.
 *
 * So the palette becomes a rail on the left and the inspector a resizable
 * column on the right, both collapsible, and the modals survive only where
 * three columns genuinely do not fit -- a phone.
 */

import * as React from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import { IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/** Where a panel's size and collapsed state are remembered, per panel. */
function readStored(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    // Private windows and "block site data" both throw here rather than
    // returning null. A remembered panel width is a convenience; losing it
    // must not take the editor down with it.
    return fallback;
  }
}

function write(key: string, value: number | boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(Number(value)));
  } catch { /* see readStored */ }
}

/**
 * A drag handle that resizes the panel to its right.
 *
 * Pointer events rather than mouse events, so a trackpad, a pen and a touch
 * drag all work, and `setPointerCapture` so the drag survives the pointer
 * leaving the 5px handle -- which it does immediately, every time.
 */
function ResizeHandle({
  onResize, ariaLabel,
}: {
  onResize: (deltaX: number) => void;
  ariaLabel: string;
}) {
  const last = React.useRef<number | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={(event) => {
        last.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (last.current === null) return;
        const delta = event.clientX - last.current;
        last.current = event.clientX;
        onResize(delta);
      }}
      onPointerUp={(event) => {
        last.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      // Keyboard resize, because a separator that only responds to dragging is
      // not reachable for anyone using the keyboard.
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') onResize(-24);
        if (event.key === 'ArrowRight') onResize(24);
      }}
      className={cn(
        'group relative w-1 shrink-0 cursor-col-resize bg-[rgb(var(--border-line))]',
        'transition-colors hover:bg-brand focus-visible:bg-brand focus-visible:outline-none',
      )}
    >
      {/* A 1px handle is a 1px target. This widens the hit area without
          widening the line people see. */}
      <span className="absolute -left-1.5 top-0 h-full w-4" />
    </div>
  );
}

const PALETTE_KEY = 'appbi.editor.paletteOpen';

/**
 * Remember the rail's state from outside the rail.
 *
 * The editor opens the palette from its own "add step" button, which exists
 * precisely because the rail is collapsed and therefore cannot offer a labelled
 * control itself. Without this the rail would open and be forgotten -- shut
 * again on the next visit, and on any resize across `xl` that unmounts it --
 * for exactly the first-time user the button was added for.
 */
export function rememberPaletteOpen(open: boolean): void {
  write(PALETTE_KEY, open);
}
const PALETTE_WIDTH_KEY = 'appbi.editor.paletteWidth';
const PALETTE_MIN = 180;
const PALETTE_MAX = 320;

/**
 * The step palette, as a rail rather than a dialog.
 *
 * Collapsed it is a 44px strip with one button, which is both the affordance
 * and the whole point: adding a step should be one click away from the canvas,
 * not one click plus a dialog plus a close.
 *
 * **Closed by default.** Open it was 224px of a 1280px window standing
 * permanently between the sidebar and the graph, and a person spends far more
 * of their time looking at the canvas than picking from a list of eight. It
 * remembers being opened, so anyone assembling a long chain pays the click
 * once. `11-appearance.spec.ts` asserts the canvas width this protects.
 *
 * It reports that state through `onOpenChange`, because the editor renders the
 * labelled "Add step" button only while this rail is shut. Collapsed, the rail
 * is a bare `+`, and a first-time user with one trigger node and an empty
 * canvas had no legible way to add their second step: the button was rendered
 * only below `xl`, on the reasoning that above it "the palette is already on
 * screen" — which was false exactly when it mattered. Telling the editor
 * whether it is open fixes that without taking the canvas width back.
 */
export function PaletteRail({
  children, label, expandLabel, collapseLabel, open, onOpenChange,
}: {
  children: React.ReactNode;
  label: string;
  expandLabel: string;
  collapseLabel: string;
  /** Controlled by the editor, which renders the labelled "add step" button
      while this is false and therefore has to know. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [width, setWidth] = React.useState(224);

  const report = React.useRef(onOpenChange);
  report.current = onOpenChange;

  // Read after mount, not during render: `localStorage` on the server is
  // undefined and reading it during the first client render would make the
  // markup disagree with the server's.
  React.useEffect(() => {
    report.current(readStored(PALETTE_KEY, 0) === 1);
    setWidth(Math.min(PALETTE_MAX,
      Math.max(PALETTE_MIN, readStored(PALETTE_WIDTH_KEY, 224))));
  }, []);

  const toggle = () => {
    write(PALETTE_KEY, !open);
    report.current(!open);
  };

  if (!open) {
    return (
      <div
        data-palette="collapsed"
        className="flex w-11 shrink-0 flex-col items-center border-r border-[rgb(var(--border-line))] bg-surface-1 py-2"
      >
        {/* One button. Two controls carrying the same accessible name is two
            ways to do one thing and one of them is a lie to a screen reader.
            `title` as well as `aria-label`: collapsed, this rail is a bare `+`
            and a first-time user has no way to guess it is the step library. */}
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={expandLabel}
          title={expandLabel}
          onClick={toggle}
        >
          <Plus className="h-4 w-4" />
        </IconButton>
      </div>
    );
  }

  return (
    <>
      <aside
        // Addressed by attribute, not by class or by position: the palette has
        // moved once already (dialog to rail) and the tests should survive it
        // moving again.
        data-palette="rail"
        style={{ width }}
        className="flex shrink-0 flex-col border-r border-[rgb(var(--border-line))] bg-surface-1"
      >
        <div className="flex items-center justify-between border-b border-[rgb(var(--border-line))] px-3 py-2">
          <span className="text-tiny uppercase tracking-wide text-text-tertiary">
            {label}
          </span>
          <IconButton size="xs" variant="ghost" aria-label={collapseLabel} onClick={toggle}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </aside>
      <ResizeHandle
        ariaLabel={label}
        onResize={(delta) => setWidth((current) => {
          const next = Math.min(PALETTE_MAX, Math.max(PALETTE_MIN, current + delta));
          write(PALETTE_WIDTH_KEY, next);
          return next;
        })}
      />
    </>
  );
}

const INSPECTOR_KEY = 'appbi.editor.inspectorOpen';
const INSPECTOR_WIDTH_KEY = 'appbi.editor.inspectorWidth';
const INSPECTOR_MIN = 320;
const INSPECTOR_MAX = 560;

/**
 * The step inspector: resizable, collapsible, and on the right where it was.
 *
 * 380px was a fixed number chosen once. An HTTP step with a long URL and four
 * headers wants more; a Merge step wants far less and was paying 380px of a
 * 1280px window for two fields.
 *
 * The caller mounts this only while a step is selected. It used to be always
 * present, so a person who had selected nothing was giving up 380px to a
 * sentence telling them to select something -- and on a 1280px window that
 * sentence cost more than a third of the canvas.
 */
export function InspectorAside({
  children, label, expandLabel, collapseLabel, resizeLabel,
}: {
  children: React.ReactNode;
  /** Names the panel, not the step in it -- the step's own name is inside. */
  label: string;
  expandLabel: string;
  collapseLabel: string;
  resizeLabel: string;
}) {
  const [open, setOpen] = React.useState(true);
  const [width, setWidth] = React.useState(380);

  React.useEffect(() => {
    setOpen(readStored(INSPECTOR_KEY, 1) === 1);
    setWidth(Math.min(INSPECTOR_MAX,
      Math.max(INSPECTOR_MIN, readStored(INSPECTOR_WIDTH_KEY, 380))));
  }, []);

  const toggle = () => {
    setOpen((value) => {
      write(INSPECTOR_KEY, !value);
      return !value;
    });
  };

  if (!open) {
    return (
      <div className="flex w-11 shrink-0 flex-col items-center border-l border-[rgb(var(--border-line))] bg-surface-1 py-2">
        <IconButton size="sm" variant="ghost" aria-label={expandLabel} onClick={toggle}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
      </div>
    );
  }

  return (
    <>
      <ResizeHandle
        ariaLabel={resizeLabel}
        // Dragging the left edge of a right-hand panel makes it wider when the
        // pointer moves left, so the delta is inverted here. Getting this
        // backwards is the classic bug in a resizable right rail.
        onResize={(delta) => setWidth((current) => {
          const next = Math.min(INSPECTOR_MAX,
            Math.max(INSPECTOR_MIN, current - delta));
          write(INSPECTOR_WIDTH_KEY, next);
          return next;
        })}
      />
      <aside
        style={{ width }}
        className="flex shrink-0 flex-col border-l border-[rgb(var(--border-line))] bg-surface-1"
      >
        {/* Labelled, and laid out like the palette rail's header on the other
            side of the canvas. A bar holding nothing but a chevron is 28px of
            panel spent looking unfinished. */}
        <div className="flex items-center justify-between border-b border-[rgb(var(--border-line))] px-3 py-2">
          <span className="text-tiny uppercase tracking-wide text-text-tertiary">
            {label}
          </span>
          <IconButton size="xs" variant="ghost" aria-label={collapseLabel} onClick={toggle}>
            <ChevronRight className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </>
  );
}
