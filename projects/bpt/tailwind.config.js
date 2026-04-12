/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // BIAV dark-gold theme
        'bpt-bg': '#0a0a0f',
        'bpt-surface': '#12121a',
        'bpt-border': '#1e1e2e',
        'bpt-gold': '#c9a84c',
        'bpt-gold-dim': '#8a7535',
        'bpt-text': '#e0e0e0',
        'bpt-text-dim': '#808090',
        'bpt-accent': '#4a9eff',
        'bpt-error': '#ff4a4a',
        'bpt-success': '#4aff8a',
        'bpt-warning': '#ffaa4a',
      },
    },
  },
  plugins: [],
};
