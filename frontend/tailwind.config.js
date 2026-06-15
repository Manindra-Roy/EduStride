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
          800: '#353a67',
          900: '#2e3155',
          950: '#1b1c31', // Deep dark backdrop
        },
        primary: {
          50: '#f4f5ff',
          100: '#ebeeff',
          200: '#dbe0ff',
          300: '#bfcbff',
          400: '#9baaff',
          500: '#6366f1', // Indigo Accent
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          950: '#1e1b4b',
        }
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
