/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          canvas: 'rgb(var(--bg-canvas) / <alpha-value>)',
          subtle: 'rgb(var(--bg-subtle) / <alpha-value>)',
          muted: 'rgb(var(--bg-muted) / <alpha-value>)',
          sunken: 'rgb(var(--bg-sunken) / <alpha-value>)',
          hover: 'rgb(var(--bg-hover) / <alpha-value>)',
          active: 'rgb(var(--bg-active) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
          subtle: 'rgb(var(--line-subtle) / <alpha-value>)',
        },
        ink: {
          1: 'rgb(var(--ink-1) / <alpha-value>)',
          2: 'rgb(var(--ink-2) / <alpha-value>)',
          3: 'rgb(var(--ink-3) / <alpha-value>)',
          4: 'rgb(var(--ink-4) / <alpha-value>)',
          5: 'rgb(var(--ink-5) / <alpha-value>)',
        },
        accent: {
          DEFAULT: '#FF6C37',
          hover: '#E85A28',
          active: '#D14F1F',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          ring: 'rgba(255, 108, 55, 0.25)',
        },
        method: {
          get: '#0CBB52',
          post: '#E5A21F',
          put: '#087BDB',
          patch: '#784ABC',
          delete: '#D64045',
          head: 'rgb(var(--ink-3) / <alpha-value>)',
          options: 'rgb(var(--ink-3) / <alpha-value>)',
          custom: '#A3168F',
        },
        status: {
          ok: '#0CBB52',
          redirect: '#087BDB',
          clientError: '#E5A21F',
          serverError: '#D64045',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: [
          'Geist Mono',
          'SF Mono',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '14px', letterSpacing: '0.005em' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '18px' }],
        base: ['14px', { lineHeight: '20px' }],
        md: ['15px', { lineHeight: '22px' }],
      },
      borderRadius: {
        DEFAULT: '6px',
        sm: '4px',
        md: '6px',
        lg: '8px',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(15, 15, 20, 0.04)',
        popover: '0 8px 24px rgba(15, 15, 20, 0.12), 0 2px 6px rgba(15, 15, 20, 0.06)',
        focus: '0 0 0 3px rgba(255, 108, 55, 0.25)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-down-fade': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-down-fade': 'slide-down-fade 140ms ease-out',
      },
    },
  },
  plugins: [],
};
