/**
 * Design tokens carried over from AppBI (appbi-ai/frontend/tailwind.config.js)
 * so this module looks like part of the same product, not a bolt-on.
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'var(--font-sans)', 'SF Pro Display', '-apple-system', 'system-ui',
          'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'monospace'],
      },
      fontWeight: {
        light: '300',
        normal: '400',
        emphasis: '510',
        medium: '510',
        strong: '590',
        semibold: '590',
      },
      // Eight steps with a floor of 12px.
      //
      // It used to have ten, and the bottom three were 12px, 11px and 10px.
      // `tiny` -- 10px, with -0.015em tracking on top -- carried the entire
      // metadata layer of the product: 123 call sites, which is every badge,
      // every table's secondary line, every node's subtitle on the canvas.
      // Ten-pixel text set tighter than normal is the reason the interface
      // read as faint rather than calm.
      //
      // So `tiny` is now 12px and `micro` is gone (it had no call sites at
      // all, which is how a scale grows a step nobody chose). `label` was also
      // 12px, so it is gone too and its two uses moved to `tiny`: two names
      // for one size is how the bottom of a scale drifts in the first place.
      //
      // Negative tracking is kept only on h1/h2/h3, where the type is 20px and
      // up and tightening is what stops a heading looking gappy. Everything at
      // reading size sits at 0.
      fontSize: {
        'h1': ['2rem', { lineHeight: '1.13', letterSpacing: '-0.022em', fontWeight: '400' }],
        'h2': ['1.5rem', { lineHeight: '1.33', letterSpacing: '-0.012em', fontWeight: '400' }],
        'h3': ['1.25rem', { lineHeight: '1.33', letterSpacing: '-0.012em', fontWeight: '590' }],
        'body-lg': ['1.125rem', { lineHeight: '1.6', letterSpacing: '0', fontWeight: '400' }],
        'body': ['1rem', { lineHeight: '1.5', letterSpacing: '0', fontWeight: '400' }],
        'small': ['0.9375rem', { lineHeight: '1.6', letterSpacing: '0', fontWeight: '400' }],
        'caption': ['0.8125rem', { lineHeight: '1.5', letterSpacing: '0', fontWeight: '400' }],
        'tiny': ['0.75rem', { lineHeight: '1.45', letterSpacing: '0', fontWeight: '510' }],
      },
      colors: {
        surface: {
          0: 'rgb(var(--surface-0) / <alpha-value>)',
          1: 'rgb(var(--surface-1) / <alpha-value>)',
          2: 'rgb(var(--surface-2) / <alpha-value>)',
          3: 'rgb(var(--surface-3) / <alpha-value>)',
          inverse: 'rgb(var(--surface-inverse) / <alpha-value>)',
        },
        overlay: 'rgb(var(--overlay) / <alpha-value>)',
        text: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--text-tertiary) / <alpha-value>)',
          quaternary: 'rgb(var(--text-quaternary) / <alpha-value>)',
          inverse: 'rgb(var(--text-on-brand) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          hover: 'rgb(var(--brand-hover) / <alpha-value>)',
          active: 'rgb(var(--brand-active) / <alpha-value>)',
          soft: 'rgb(var(--brand-soft) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--success) / <alpha-value>)',
          soft: 'rgb(var(--success-soft) / <alpha-value>)',
        },
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
      },
      borderRadius: {
        micro: '2px',
        sm: '4px',
        md: '6px',
        DEFAULT: '6px',
        lg: '8px',
        xl: '12px',
        '2xl': '22px',
      },
      spacing: { '4.5': '1.125rem', '7.5': '1.875rem', '11': '2.75rem' },
      boxShadow: {
        'linear-sm': '0 1px 2px rgb(8 9 10 / 0.04), 0 1px 1px rgb(8 9 10 / 0.03)',
        'linear': '0 2px 4px rgb(8 9 10 / 0.04), 0 1px 2px rgb(8 9 10 / 0.03), 0 0 0 1px rgb(8 9 10 / 0.04)',
        'linear-lg': '0 8px 24px rgb(8 9 10 / 0.08), 0 2px 6px rgb(8 9 10 / 0.04), 0 0 0 1px rgb(8 9 10 / 0.06)',
        'popover': '0 0 0 1px rgb(8 9 10 / 0.06), 0 2px 4px rgb(8 9 10 / 0.04), 0 8px 24px rgb(8 9 10 / 0.10)',
        'focus-brand': '0 0 0 3px rgb(94 106 210 / 0.18)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'slide-up': 'slide-up 0.18s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
