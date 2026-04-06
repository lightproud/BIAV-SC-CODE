/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './quick-entry.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        biav: {
          bg: 'var(--biav-bg)',
          surface: 'var(--biav-surface)',
          border: 'var(--biav-border)',
          text: 'var(--biav-text)',
          muted: 'var(--biav-muted)',
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
