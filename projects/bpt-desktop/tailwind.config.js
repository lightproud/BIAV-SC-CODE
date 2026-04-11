/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './quick-entry.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bpt: {
          bg: 'var(--bpt-bg)',
          surface: 'var(--bpt-surface)',
          border: 'var(--bpt-border)',
          text: 'var(--bpt-text)',
          muted: 'var(--bpt-muted)',
          gold: '#c5a356',
          'gold-bright': '#e2c97e',
          'gold-dim': '#8a7a40',
          danger: '#c45050',
          success: '#50a060',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
        serif: ['"Noto Serif SC"', 'serif'],
      },
    },
  },
  plugins: [],
}
