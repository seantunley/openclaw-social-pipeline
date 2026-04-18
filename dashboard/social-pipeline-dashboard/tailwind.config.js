/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#09090b',
        card: '#111113',
        accent: '#6366f1',
        primary: '#6366f1',
        border: '#27272a',
        muted: '#a1a1aa',
      },
      keyframes: {
        'skeleton-pulse': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' },
        },
      },
      animation: {
        'skeleton-pulse': 'skeleton-pulse 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
