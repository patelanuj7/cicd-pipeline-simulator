import type { ReactNode } from 'react';

export interface LegendItem {
  label: string;
  color: string;
  /** Mirror the mark: a square for bars, a short line for lines, a dot for points. */
  shape: 'square' | 'line' | 'dot';
}

interface Props {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  /** The same data as a plain table: every value reachable without hovering. */
  table: ReactNode;
  children: ReactNode;
  className?: string;
}

export function ChartCard({ title, subtitle, legend, table, children, className = '' }: Props) {
  return (
    <section className={`card chart-card ${className}`}>
      <header className="chart-card__header">
        <div>
          <h2 className="chart-card__title">{title}</h2>
          {subtitle && <p className="chart-card__subtitle">{subtitle}</p>}
        </div>
        {legend && legend.length > 0 && (
          <ul className="legend">
            {legend.map((item) => (
              <li key={item.label} className="legend__item">
                <span className={`legend__key legend__key--${item.shape}`} style={{ background: item.color }} />
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </header>
      <div className="chart-card__plot">{children}</div>
      <details className="chart-table">
        <summary>View as table</summary>
        {table}
      </details>
    </section>
  );
}

export function EmptyChart({ message }: { message: string }) {
  return <div className="chart-empty">{message}</div>;
}
