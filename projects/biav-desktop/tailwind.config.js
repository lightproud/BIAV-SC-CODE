/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        biav: {
          bg: '#0a0b10',
          surface: '#12131a',
          border: '#1e1f2a',
          text: '#d4c9a8',
          muted: '#8a8070',
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
