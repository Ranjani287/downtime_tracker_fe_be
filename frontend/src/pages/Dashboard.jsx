import { useState } from 'react';
import { api } from '../api.js';
import { DataState } from '../components/DataState.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import SummaryPanel from '../components/SummaryPanel.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { dayEndIso, dayStartIso, daysAgo, fmtMinutes, toDateInput } from '../utils/format.js';

function Kpi({ label, value }) {
  return <div className="card"><div className="muted small">{label}</div><div className="big">{value}</div></div>;
}

/** Admin dashboard: where is downtime coming from in the selected period? */
export default function Dashboard() {
  const [range, setRange] = useState({ from: daysAgo(6), to: toDateInput() });
  const summary = useAsync(
    () => api('/reports/summary', { params: { from: dayStartIso(range.from), to: dayEndIso(range.to) } }),
    [range.from, range.to],
  );
  const data = summary.data;

  return (
    <>
      <div className="row wrap">
        <h2>Downtime dashboard</h2>
        <span className="spacer" />
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} presets />
      </div>

      <DataState
        loading={summary.loading && !data} error={summary.error} onRetry={summary.reload}
        isEmpty={data?.totals.events === 0} emptyText="No downtime recorded in this date range."
      >
        {data && (
          <div className={summary.loading ? 'busy' : ''}>
            <div className="grid stats">
              <Kpi label="Total downtime" value={fmtMinutes(data.totals.total_minutes)} />
              <Kpi label="Events" value={data.totals.events} />
              <Kpi label="Still open" value={data.totals.open_events} />
              <Kpi label="Avg. per closed event" value={fmtMinutes(data.totals.avg_minutes_per_closed_event)} />
            </div>
            <div className="grid charts">
              <SummaryPanel title="Downtime by line" rows={data.by_line} labelKey="line_name" />
              <SummaryPanel title="Downtime by reason" rows={data.by_reason} labelKey="reason_name" />
            </div>
          </div>
        )}
      </DataState>
    </>
  );
}
