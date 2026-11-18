/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './checkpoint-rony.html',
    './js/**/*.js'
  ],
  theme: {
    extend: {
      colors: {
        'surface-container-low': '#091126',
        'surface-container-high': '#16274f',
        'secondary-container': '#fbbf24',
        'on-surface-variant': '#94A3B8',
        'on-primary-container': '#ffedd5',
        'on-tertiary-container': '#E2E8F0',
        'surface-bright': '#1e3a5f',
        'tertiary-container': '#0c1733',
        'surface-tint': '#38bdf8',
        'on-error': '#FFFFFF',
        'on-error-container': '#FEE2E2',
        'tertiary-fixed-dim': '#94A3B8',
        'on-surface': '#FFFFFF',
        'outline-variant': '#1e293b',
        'background': '#070d1f',
        'secondary-fixed-dim': '#f59e0b',
        'secondary-fixed': '#fbbf24',
        'on-secondary-fixed': '#0f172a',
        'primary-fixed-dim': '#fdba74',
        'tertiary-fixed': '#CBD5E1',
        'on-secondary': '#0f172a',
        'inverse-surface': '#F1F5F9',
        'outline': '#38bdf8',
        'tertiary': '#2dd4bf',
        'error': '#e11d48',
        'surface-container': '#111e3d',
        'on-secondary-container': '#78350F',
        'secondary': '#fbbf24',
        'primary-fixed': '#ffedd5',
        'surface-container-highest': '#1e293b',
        'on-primary': '#FFFFFF',
        'on-tertiary-fixed': '#0F172A',
        'inverse-primary': '#ff6b2b',
        'on-tertiary': '#1E293B',
        'on-secondary-fixed-variant': '#92400E',
        'on-tertiary-fixed-variant': '#334155',
        'surface-container-lowest': '#070d1f',
        'primary': '#ff6b2b',
        'primary-light': '#f87171',
        'accent-gold': '#fbbf24',
        'cyan-neon': '#38bdf8',
        'teal-accent': '#2dd4bf',
        'peach': '#CBD5E1',
        'surface': '#0c1733',
        'inverse-on-surface': '#1E293B',
        'on-primary-fixed-variant': '#c2410c',
        'surface-dim': '#070d1f',
        'on-background': '#FFFFFF',
        'primary-container': '#ff6b2b',
        'error-container': '#9f1239',
        'on-primary-fixed': '#7c2d12',
        'surface-variant': '#111e3d'
      },
      fontFamily: {
        headline: ['Space Grotesk', 'Outfit', 'sans-serif'],
        body: ['Manrope', 'sans-serif'],
        label: ['Space Grotesk', 'sans-serif']
      }
    }
  },
  plugins: []
};
