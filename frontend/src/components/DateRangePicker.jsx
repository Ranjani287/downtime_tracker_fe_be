import { Field } from './Field.jsx';
import { daysAgo, toDateInput } from '../utils/format.js';

const PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Last 7 days', days: 6 },
  { label: 'Last 30 days', days: 29 },
];

/** Controlled day-range picker. `from` / `to` are "YYYY-MM-DD" strings (empty = open-ended). */
export default function DateRangePicker({ from, to, onChange, presets = false }) {
  const today = toDateInput();
  // Keep the range valid: moving one end past the other drags the other end along.
  const setFrom = (v) => onChange({ from: v, to: to && v > to ? v : to });
  const setTo = (v) => onChange({ from: from && v < from ? v : from, to: v });

  return (
    <div className="range">
      <Field label="From">
        <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field label="To">
        <input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
      </Field>
      {presets && (
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="chip" onClick={() => onChange({ from: daysAgo(p.days), to: today })}>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
