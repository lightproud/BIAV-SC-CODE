/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // All colors reference CSS custom properties (set in index.css).
        // This enables light/dark mode switching by toggling the .dark class.
        // The <alpha-value> placeholder allows Tailwind opacity modifiers
        // like bg-bpt-gold/20 to work correctly.
        'bpt-bg': 'rgb(var(--bpt-bg) / <alpha-value>)',
        'bpt-surface': 'rgb(var(--bpt-surface) / <alpha-value>)',
        'bpt-border': 'rgb(var(--bpt-border) / <alpha-value>)',
        'bpt-gold': 'rgb(var(--bpt-gold) / <alpha-value>)',
        'bpt-gold-bright': 'rgb(var(--bpt-gold-bright) / <alpha-value>)',
        'bpt-gold-dim': 'rgb(var(--bpt-gold-dim) / <alpha-value>)',
        'bpt-text': 'rgb(var(--bpt-text) / <alpha-value>)',
        'bpt-text-dim': 'rgb(var(--bpt-text-dim) / <alpha-value>)',
        'bpt-accent': 'rgb(var(--bpt-accent) / <alpha-value>)',
        'bpt-error': 'rgb(var(--bpt-error) / <alpha-value>)',
        'bpt-success': 'rgb(var(--bpt-success) / <alpha-value>)',
        'bpt-warning': 'rgb(var(--bpt-warning) / <alpha-value>)',
      },
      animation: {
        'fade-slide-in': 'fadeSlideIn 300ms ease-out both',
        'slide-in-right': 'slideInRight 200ms ease-out both',
        'cursor-blink': 'cursorBlink 1s step-end infinite',
      },
      keyframes: {
        fadeSlideIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        cursorBlink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
