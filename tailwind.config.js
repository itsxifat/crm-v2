/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors')

// Semantic colours are HSL triplets in globals.css so opacity modifiers work
// (e.g. `bg-primary/90`, `ring-ring/30`).
const token = (name) => `hsl(var(--${name}) / <alpha-value>)`

module.exports = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './app/**/*.{js,jsx}',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // The whole app is written against `gray-*`; map it onto zinc for a
        // neutral, shadcn-style palette.
        gray: colors.zinc,
        primary: {
          ...colors.zinc,
          DEFAULT:    token('primary'),
          foreground: token('primary-foreground'),
        },
        brand: {
          50:  '#eef3fe',
          100: '#dbe5fd',
          200: '#bccffb',
          300: '#8eaff7',
          400: '#5a86f0',
          500: '#3767e8',
          600: '#2157e0',
          700: '#1b45bd',
          800: '#1c3b98',
          900: '#1d3678',
          DEFAULT: '#2157e0',
        },
        sidebar: {
          DEFAULT:    token('sidebar'),
          foreground: token('sidebar-foreground'),
          accent:     token('sidebar-accent'),
          border:     token('sidebar-border'),
        },
        border:     token('border'),
        input:      token('input'),
        ring:       token('ring'),
        background: token('background'),
        foreground: token('foreground'),
        secondary: {
          DEFAULT:    token('secondary'),
          foreground: token('secondary-foreground'),
        },
        destructive: {
          DEFAULT:    token('destructive'),
          foreground: token('destructive-foreground'),
        },
        muted: {
          DEFAULT:    token('muted'),
          foreground: token('muted-foreground'),
        },
        accent: {
          DEFAULT:    token('accent'),
          foreground: token('accent-foreground'),
        },
        popover: {
          DEFAULT:    token('popover'),
          foreground: token('popover-foreground'),
        },
        card: {
          DEFAULT:    token('card'),
          foreground: token('card-foreground'),
        },
        success: {
          50:  '#ecfdf5',
          100: '#d1fae5',
          500: '#10b981',
          600: '#059669',
          DEFAULT: '#10b981',
        },
        warning: {
          50:  '#fffbeb',
          100: '#fef3c7',
          500: '#f59e0b',
          600: '#d97706',
          DEFAULT: '#f59e0b',
        },
        danger: {
          50:  '#fef2f2',
          100: '#fee2e2',
          500: '#ef4444',
          600: '#dc2626',
          DEFAULT: '#ef4444',
        },
      },
      borderRadius: {
        DEFAULT: 'calc(var(--radius) - 4px)',
        sm:   'calc(var(--radius) - 4px)',
        md:   'calc(var(--radius) - 2px)',
        lg:   'var(--radius)',
        xl:   'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      fontFamily: {
        // Inter for Latin; Anek Bangla picks up ৳ and Bangla (its face only covers Bengali code points).
        sans: ['var(--font-sans)', 'var(--font-bengali)', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'var(--font-bengali)', 'monospace'],
      },
      boxShadow: {
        xs:   '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        sm:   '0 1px 2px 0 rgb(0 0 0 / 0.05), 0 1px 3px 0 rgb(0 0 0 / 0.03)',
        DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        md:   '0 4px 12px -2px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
        lg:   '0 12px 28px -6px rgb(0 0 0 / 0.10), 0 4px 10px -4px rgb(0 0 0 / 0.05)',
        xl:   '0 20px 40px -12px rgb(0 0 0 / 0.14), 0 8px 16px -8px rgb(0 0 0 / 0.06)',
        '2xl': '0 32px 64px -16px rgb(0 0 0 / 0.22)',
        card: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        'card-hover': '0 4px 12px -2px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
        sidebar: 'none',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to:   { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to:   { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to:   { transform: 'translateX(0)' },
        },
        'slide-in-left': {
          from: { transform: 'translateX(-100%)' },
          to:   { transform: 'translateX(0)' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'accordion-down':  'accordion-down 0.2s ease-out',
        'accordion-up':    'accordion-up 0.2s ease-out',
        'fade-in':         'fade-in 0.2s ease-out',
        'slide-in-right':  'slide-in-right 0.3s ease-out',
        'slide-in-left':   'slide-in-left 0.3s ease-out',
        'spin-slow':       'spin-slow 3s linear infinite',
        shimmer:           'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('tailwindcss-animate'),
  ],
}
