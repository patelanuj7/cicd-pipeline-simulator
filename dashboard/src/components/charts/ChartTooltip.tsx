export interface TooltipRow {
  label: string;
  value: string;
  color: string;
}

/** Values lead, labels follow; each row keyed by a short line in the series color. */
export function ChartTooltip({ heading, rows, note }: { heading: string; rows: TooltipRow[]; note?: string }) {
  return (
    <div className="tooltip">
      <div className="tooltip__heading">{heading}</div>
      {rows.map((row) => (
        <div key={row.label} className="tooltip__row">
          <span className="tooltip__key" style={{ background: row.color }} />
          <strong className="tooltip__value">{row.value}</strong>
          <span className="tooltip__label">{row.label}</span>
        </div>
      ))}
      {note && <div className="tooltip__note">{note}</div>}
    </div>
  );
}
