/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          50: '#f6f6f9',
          100: '#eef0f6',
          200: '#d7dbec',
          300: '#b1b9dc',
          400: '#838ec6',
          500: '#626eb1',
          600: '#4c5597',
          700: '#3d447c',
          750: '#2c3154',
          800: '#23263b',
          805: '#1e2133',
          850: '#1a1c29',
          900: '#12131b',
          950: '#07080a', // Deep dark backdrop matching main canvas
          955: '#050608',
        },
        slate: {
          350: '#cbd5e1',
          450: '#94a3b8',
          455: '#8fa0b5',
          555: '#64748b',
        },
        primary: {
          50: 'var(--color-primary-50)',
          100: 'var(--color-primary-100)',
          200: 'var(--color-primary-200)',
          300: 'var(--color-primary-300)',
          400: 'var(--color-primary-400)',
          450: 'var(--color-primary-400)',
          455: 'var(--color-primary-400)',
          500: 'var(--color-primary-500)',
          550: 'var(--color-primary-600)',
          600: 'var(--color-primary-600)',
          650: 'var(--color-primary-700)',
          700: 'var(--color-primary-700)',
          800: 'var(--color-primary-800)',
          950: 'var(--color-primary-950)',
        },
        emerald: {
          450: '#34d399',
          555: '#10b981',
        },
        rose: {
          350: '#fda4af',
          450: '#f43f5e',
          455: '#e11d48',
        },
        amber: {
          455: '#f59e0b',
          555: '#d97706',
        },
        indigo: {
          350: '#a78bfa',
          550: '#7c3aed',
          650: '#6d28d9',
        }
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'sans-serif'],
        outfit: ['Outfit', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
