import { useState } from 'react';
import { api } from '../api.js';
import { useMutation } from '../hooks/useMutation.js';
import { fmtDateTime, localInputToIso, toLocalInput } from '../utils/format.js';
import { ErrorMessage } from './DataState.jsx';
import { Field } from './Field.jsx';
import Modal from './Modal.jsx';

/** Closes an open event: the operator confirms (or adjusts) the time the machine came back up. */
export default function CloseEventModal({ event, onClose, onClosed }) {
  const [endedAt, setEndedAt] = useState(toLocalInput());
  const [edited, setEdited] = useState(false);
  const [note, setNote] = useState(event.note ?? '');

  // The picker only has minute precision, so its default ("now" rounded down) can be earlier than an event that
  // started a few seconds ago. Unless the user picks a time themselves, send none and let the server use the exact now.
  const close = useMutation(() => api(`/downtime/${event.id}/close`, {
    method: 'PATCH',
    body: { ended_at: edited ? localInputToIso(endedAt) : undefined, note: note.trim() || undefined },
  }));

  const submit = async (e) => {
    e.preventDefault();
    if ((await close.run()).ok) onClosed();
  };

  return (
    <Modal title={`Close downtime: ${event.machine_name}`} onClose={onClose}>
      <p className="muted small">{event.line_name} · {event.reason_name} · started {fmtDateTime(event.started_at)}</p>
      <form className="stack" onSubmit={submit}>
        <Field label="Machine running again at">
          <input
            type="datetime-local" required value={endedAt} onChange={(e) => { setEndedAt(e.target.value); setEdited(true); }}
            min={toLocalInput(new Date(event.started_at))} max={toLocalInput()}
          />
        </Field>
        <Field label="Note (optional)">
          <input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorMessage error={close.error} />
        <button className="btn" disabled={close.loading}>{close.loading ? 'Closing…' : 'Close event'}</button>
      </form>
    </Modal>
  );
}
