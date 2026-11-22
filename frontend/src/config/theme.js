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
      900: '#312e81',
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
      900: '#064e3b',
      950: '#022c22',
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
      900: '#78350f',
      950: '#451a03',
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
      900: '#881337',
      950: '#4c0519',
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
      900: '#4c1d95',
      950: '#2e1065',
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
      900: '#164e63',
      950: '#083344',
    }
  }
};

const hexToRgbChannels = (hex) => {
  if (typeof hex !== 'string') return '99 102 241';
  const cleaned = hex.replace('#', '').trim();
  if (cleaned.length !== 6) return '99 102 241';
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return '99 102 241';
  return `${r} ${g} ${b}`;
};

export const applyThemeAccent = (colorKey) => {
  const root = document.documentElement;
  const resolvedKey = themes[colorKey] ? colorKey : 'indigo';
  const theme = themes[resolvedKey];
  Object.keys(theme.colors).forEach(key => {
    root.style.setProperty(`--color-primary-${key}`, hexToRgbChannels(theme.colors[key]));
  });
  localStorage.setItem('edustride_theme_color', resolvedKey);
};

export const getSavedThemeAccent = () => {
  return localStorage.getItem('edustride_theme_color') || 'indigo';
};
