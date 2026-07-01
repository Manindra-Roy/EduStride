export const themes = {
  indigo: {
    name: 'Indigo Classy',
    colors: {
      50: '#f4f5ff',
      100: '#ebeeff',
      200: '#dbe0ff',
      300: '#bfcbff',
      400: '#9baaff',
      500: '#6366f1',
      600: '#4f46e5',
      700: '#4338ca',
      800: '#3730a3',
      950: '#1e1b4b',
    }
  },
  emerald: {
    name: 'Emerald Garden',
    colors: {
      50: '#ecfdf5',
      100: '#d1fae5',
      200: '#a7f3d0',
      300: '#6ee7b7',
      400: '#34d399',
      500: '#10b981',
      600: '#059669',
      700: '#047857',
      800: '#065f46',
      950: '#064e3b',
    }
  },
  amber: {
    name: 'Warm Amber',
    colors: {
      50: '#fffbeb',
      100: '#fef3c7',
      200: '#fde68a',
      300: '#fcd34d',
      400: '#fbbf24',
      500: '#f59e0b',
      600: '#d97706',
      700: '#b45309',
      800: '#92400e',
      950: '#78350f',
    }
  },
  rose: {
    name: 'Crimson Rose',
    colors: {
      50: '#fff1f2',
      100: '#ffe4e6',
      200: '#fecdd3',
      300: '#fda4af',
      400: '#fb7185',
      500: '#f43f5e',
      600: '#e11d48',
      700: '#be123c',
      800: '#9f1239',
      950: '#881337',
    }
  },
  violet: {
    name: 'Mystic Violet',
    colors: {
      50: '#f5f3ff',
      100: '#ede9fe',
      200: '#ddd6fe',
      300: '#c4b5fd',
      400: '#a78bfa',
      500: '#8b5cf6',
      600: '#7c3aed',
      700: '#6d28d9',
      800: '#5b21b6',
      950: '#4c1d95',
    }
  },
  cyan: {
    name: 'Ocean Cyan',
    colors: {
      50: '#ecfeff',
      100: '#cffafe',
      200: '#a5f3fc',
      300: '#67e8f9',
      400: '#22d3ee',
      500: '#06b6d4',
      600: '#0891b2',
      700: '#0e7490',
      800: '#155e75',
      950: '#164e63',
    }
  }
};

export const applyThemeAccent = (colorKey) => {
  const root = document.documentElement;
  const theme = themes[colorKey] || themes.indigo;
  Object.keys(theme.colors).forEach(key => {
    root.style.setProperty(`--color-primary-${key}`, theme.colors[key]);
  });
  localStorage.setItem('edustride_theme_color', colorKey);
};

export const getSavedThemeAccent = () => {
  return localStorage.getItem('edustride_theme_color') || 'indigo';
};
