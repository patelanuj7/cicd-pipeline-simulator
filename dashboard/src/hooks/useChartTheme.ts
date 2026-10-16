import { useEffect, useState } from 'react';

export interface ChartTheme {
  pass: string;
  fail: string;
  grid: string;
  axis: string;
  text: string;
  muted: string;
  surface: string;
}

const TOKENS: Record<keyof ChartTheme, string> = {
  pass: '--chart-pass',
  fail: '--chart-fail',
  grid: '--chart-grid',
  axis: '--chart-axis',
  text: '--text',
  muted: '--muted',
  surface: '--surface',
};

function read(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const entries = Object.entries(TOKENS).map(([key, prop]) => [key, style.getPropertyValue(prop).trim()]);
  return Object.fromEntries(entries) as ChartTheme;
}

/**
 * Chart colors from the CSS custom properties in styles.css. SVG presentation
 * attributes can't use var(), so we resolve them in JS and re-read when the
 * OS switches between light and dark.
 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setTheme(read());
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return theme;
}
