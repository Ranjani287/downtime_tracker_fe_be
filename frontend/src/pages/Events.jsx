import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Badge from '../components/Badge.jsx';
import CloseEventModal from '../components/CloseEventModal.jsx';
import DataTable from '../components/DataTable.jsx';
import { DataState, ErrorMessage } from '../components/DataState.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import { Field, Select } from '../components/Field.jsx';
import Pagination from '../components/Pagination.jsx';
import StartEventForm from '../components/StartEventForm.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useLookups } from '../hooks/useLookups.js';
import { useMutation } from '../hooks/useMutation.js';
import { dayEndIso, dayStartIso, fmtDateTime, fmtMinutes } from '../utils/format.js';

const PAGE_SIZE = 15;
const NO_FILTERS = { line_id: '', machine_id: '', reason_id: '', status: '', from: '', to: '' };
const STATUS_OPTIONS = [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }];
const byName = (rows) => rows.map((r) => ({ value: r.id, label: r.name }));

export default function Events() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const lookups = useLookups();
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [closing, setClosing] = useState(null);

  const events = useAsync(() => api('/downtime', {
    params: { ...filters, from: dayStartIso(filters.from), to: dayEndIso(filters.to), page, limit: PAGE_SIZE },
  }), [filters, page]);

  const refreshAll = () => { events.reload(); lookups.reload(); };
  const remove = useMutation(async (id) => { await api(`/downtime/${id}`, { method: 'DELETE' }); refreshAll(); });

  const changeFilters = (patch) => {
    setFilters((f) => ({ ...f, ...patch, ...(patch.line_id !== undefined && { machine_id: '' }) })); // machine list depends on line
    setPage(1);
  };
  const filtered = Object.values(filters).some(Boolean);

  const columns = [
    { key: 'machine', header: 'Machine', render: (e) => <><strong>{e.machine_name}</strong><div className="muted small">{e.line_name}</div></> },
    { key: 'reason', header: 'Reason', render: (e) => <>{e.reason_name} <Badge>{e.reason_category}</Badge></> },
    { key: 'started_at', header: 'Started', render: (e) => fmtDateTime(e.started_at) },
    { key: 'ended_at', header: 'Ended', render: (e) => (e.ended_at ? fmtDateTime(e.ended_at) : <Badge tone="red">Open</Badge>) },
    { key: 'duration', header: 'Duration', render: (e) => fmtMinutes(e.duration_minutes) },
    { key: 'created_by_name', header: 'Logged by' },
    { key: 'note', header: 'Note', className: 'wrap' },
    {
      key: 'actions', header: '', className: 'actions',
      render: (e) => (
        <>
          {!e.ended_at && <button className="btn small" onClick={() => setClosing(e)}>Close</button>}
          {isAdmin && (
            <button className="btn small danger" disabled={remove.loading}
              onClick={() => window.confirm('Delete this downtime event?') && remove.run(e.id)}>Delete</button>
          )}
        </>
      ),
    },
  ];

  const lookupData = lookups.data;
  const machineOptions = lookupData
    ? byName(lookupData.machines.filter((m) => !filters.line_id || String(m.line_id) === filters.line_id))
    : [];

  return (
    <>
      <h2>Log downtime</h2>
      <DataState loading={lookups.loading && !lookupData} error={lookups.error} onRetry={lookups.reload}>
        {lookupData && <StartEventForm lookups={lookupData} onStarted={refreshAll} />}
      </DataState>

      <h2>Downtime events</h2>
      <div className="card form-row">
        <Field label="Line"><Select value={filters.line_id} options={byName(lookupData?.lines ?? [])} placeholder="All lines" onChange={(e) => changeFilters({ line_id: e.target.value })} /></Field>
        <Field label="Machine"><Select value={filters.machine_id} options={machineOptions} placeholder="All machines" onChange={(e) => changeFilters({ machine_id: e.target.value })} /></Field>
        <Field label="Reason"><Select value={filters.reason_id} options={byName(lookupData?.reasons ?? [])} placeholder="All reasons" onChange={(e) => changeFilters({ reason_id: e.target.value })} /></Field>
        <Field label="Status"><Select value={filters.status} options={STATUS_OPTIONS} placeholder="Open and closed" onChange={(e) => changeFilters({ status: e.target.value })} /></Field>
        <DateRangePicker from={filters.from} to={filters.to} onChange={changeFilters} presets />
        {filtered && <button type="button" className="btn secondary" onClick={() => changeFilters(NO_FILTERS)}>Clear filters</button>}
      </div>

      <ErrorMessage error={remove.error} />
      <DataState
        loading={events.loading && !events.data} error={events.error} onRetry={events.reload}
        isEmpty={events.data?.data.length === 0}
        emptyText={filtered ? 'No events match these filters.' : 'No downtime events logged yet.'}
      >
        {events.data && (
          <>
            <DataTable columns={columns} rows={events.data.data} busy={events.loading} />
            <Pagination page={page} pageSize={PAGE_SIZE} total={events.data.total} onPage={setPage} />
          </>
        )}
      </DataState>

      {closing && <CloseEventModal event={closing} onClose={() => setClosing(null)} onClosed={() => { setClosing(null); refreshAll(); }} />}
    </>
  );
}
