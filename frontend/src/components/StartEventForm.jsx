import { useState } from 'react';
import { api } from '../api.js';
import { useMutation } from '../hooks/useMutation.js';
import { localInputToIso, toLocalInput } from '../utils/format.js';
import { ErrorMessage } from './DataState.jsx';
import { Field, Select } from './Field.jsx';

const EMPTY = { machine_id: '', reason_id: '', started_at: '', note: '' };

/** Operators log "machine X stopped because of Y". Start time defaults to now. */
export default function StartEventForm({ lookups, onStarted }) {
  const [values, setValues] = useState(EMPTY);
  const set = (name) => (e) => setValues({ ...values, [name]: e.target.value });

  const start = useMutation(() => api('/downtime', {
    method: 'POST',
    body: {
      machine_id: Number(values.machine_id),
      reason_id: Number(values.reason_id),
      started_at: localInputToIso(values.started_at),
      note: values.note.trim() || undefined,
    },
  }));

  // Only active machines/reasons can be used; machines that are already down are shown but not selectable.
  const machines = lookups.machines
    .filter((m) => m.active)
    .map((m) => ({ value: m.id, label: m.is_down ? `${m.name} (already down)` : m.name, group: m.line_name, disabled: m.is_down }));
  const reasons = lookups.reasons.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name, group: r.category }));

  const submit = async (e) => {
    e.preventDefault();
    const result = await start.run();
    if (result.ok) { setValues(EMPTY); onStarted(); }
  };

  return (
    <form className="card form-row" onSubmit={submit}>
      <Field label="Machine">
        <Select required value={values.machine_id} options={machines} placeholder="Select machine…" onChange={set('machine_id')} />
      </Field>
      <Field label="Reason">
        <Select required value={values.reason_id} options={reasons} placeholder="Select reason…" onChange={set('reason_id')} />
      </Field>
      <Field label="Stopped at" hint="Leave empty for now">
        <input type="datetime-local" value={values.started_at} max={toLocalInput()} onChange={set('started_at')} />
      </Field>
      <Field label="Note (optional)" className="grow">
        <input maxLength={1000} value={values.note} onChange={set('note')} />
      </Field>
      <button className="btn" disabled={start.loading}>{start.loading ? 'Starting…' : 'Start downtime'}</button>
      <ErrorMessage error={start.error} />
    </form>
  );
}
