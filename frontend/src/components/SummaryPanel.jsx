import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtMinutes } from '../utils/format.js';
import DataTable from './DataTable.jsx';
import { EmptyState } from './DataState.jsx';

/** Bar chart + table of downtime minutes, one row per line or per reason. */
export default function SummaryPanel({ title, rows, labelKey }) {
  const total = rows.reduce((sum, r) => sum + r.total_minutes, 0);
  const chartData = rows.map((r) => ({ name: r[labelKey], minutes: r.total_minutes }));
  const columns = [
    { key: labelKey, header: title.replace(/^Downtime by /i, '').replace(/^./, (c) => c.toUpperCase()) },
    { key: 'events', header: 'Events' },
    { key: 'total_minutes', header: 'Downtime', render: (r) => fmtMinutes(r.total_minutes) },
    { key: 'share', header: 'Share', render: (r) => (total ? `${Math.round((r.total_minutes / total) * 100)}%` : '—') },
  ];

  return (
    <div className="card summary-panel">
      <h3>{title}</h3>
      {rows.length === 0 ? <EmptyState>No downtime in this range.</EmptyState> : (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={70} fontSize={12} />
              <YAxis fontSize={12} unit="m" />
              <Tooltip formatter={(v) => [fmtMinutes(v), 'Downtime']} />
              <Bar dataKey="minutes" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <DataTable columns={columns} rows={rows} rowKey={labelKey} />
        </>
      )}
    </div>
  );
}
