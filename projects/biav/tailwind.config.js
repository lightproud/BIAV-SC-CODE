/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        biav: {
          bg: '#0a0b10',
          'card': '#1e1a10',
          'card-hover': '#241f14',
          'border': '#2a2515',
          'deco': '#3a3520',
          'gold': '#c5a356',
          'gold-bright': '#e2c97e',
          'gold-dark': '#8a7a48',
          'text': '#d4c9a8',
          'text-dim': '#6b6040',
          'text-dimmer': '#5a5540',
          'safe': '#7aad5a',
          'risk': '#c25a4a',
          'insight': '#5a8aad',
        },
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', 'serif'],
        sans: ['"Noto Sans SC"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
