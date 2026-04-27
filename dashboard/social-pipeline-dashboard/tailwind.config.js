/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Themed tokens — resolve to CSS variables defined in src/index.css.
        // Switching themes is a single class flip on <html>; nothing here
        // changes per theme. Add new semantic tokens by adding both a CSS
        // variable AND a Tailwind alias here.
        background: 'var(--bg-app)',
        app: 'var(--bg-app)',
        card: 'var(--bg-card)',
        elevated: 'var(--bg-elevated)',
        input: 'var(--bg-input)',
        accent: 'var(--accent)',
        primary: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        border: 'var(--border-default)',
        'border-strong': 'var(--border-strong)',
        muted: 'var(--text-muted)',
        faint: 'var(--text-faint)',
        primaryText: 'var(--text-primary)',
        secondaryText: 'var(--text-secondary)',
        // Surface overlays for hovers/dividers. Use bg-surface-soft for
        // resting backgrounds, bg-surface-medium for borders/hovers.
        'surface-faint': 'var(--surface-faint)',
        'surface-soft': 'var(--surface-soft)',
        'surface-medium': 'var(--surface-medium)',
        // Brand palette pulled from the logo gradient (cyan → purple → pink).
        // Literal hex on purpose — the brand identity shouldn't shift across
        // themes. Use as `bg-brand-purple`, `text-brand-cyan`, etc.
        brand: {
          cyan: '#7DD3F0',
          blue: '#6F8FD4',
          purple: '#9270C8',
          pink: '#DC8DCC',
        },
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
