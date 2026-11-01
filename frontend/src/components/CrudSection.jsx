import { useState } from 'react';
import { api } from '../api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useMutation } from '../hooks/useMutation.js';
import Badge from './Badge.jsx';
import DataTable from './DataTable.jsx';
import { DataState, ErrorMessage } from './DataState.jsx';
import EntityForm from './EntityForm.jsx';
import Modal from './Modal.jsx';

// Form values -> API payload: drop untouched optional fields, convert numeric selects.
function normalize(fields, values) {
  const out = {};
  for (const f of fields) {
    const v = values[f.name];
    if (v === '' && !f.required) continue;
    out[f.name] = f.number ? Number(v) : v;
  }
  return out;
}

/**
 * List + create form + edit dialog + activate/deactivate + delete for one REST resource.
 * Used for lines, machines, reasons, users and organisations, so none of those screens duplicates this logic.
 *
 * Props: title, path ('/lines'), columns (DataTable columns), createFields / editFields (EntityForm fields),
 * toCreatePayload(values), canToggle(row), canDelete(row), toggleLabels [whenActive, whenInactive],
 * rowActions(row) -> extra buttons, onChanged() -> called after any successful write.
 */
export default function CrudSection({
  title, path, columns, createFields, editFields = createFields, emptyText,
  createLabel = 'Add', toCreatePayload = (v) => v, nameOf = (r) => r.name,
  canToggle = () => true, canDelete = () => true, toggleLabels = ['Deactivate', 'Activate'],
  rowActions, onChanged,
}) {
  const list = useAsync(() => api(path), [path]);
  const rows = list.data?.data ?? [];
  const [editing, setEditing] = useState(null);

  const changed = () => { list.reload(); onChanged?.(); };

  const create = useMutation(async (values) => {
    const result = await api(path, { method: 'POST', body: toCreatePayload(normalize(createFields, values)) });
    changed();
    return result;
  });
  const edit = useMutation(async (values) => {
    const result = await api(`${path}/${editing.id}`, { method: 'PATCH', body: normalize(editFields, values) });
    setEditing(null);
    changed();
    return result;
  });
  const act = useMutation(async (request) => { await request(); changed(); });

  const toggle = (row) => act.run(() => api(`${path}/${row.id}`, { method: 'PATCH', body: { active: !row.active } }));
  const remove = (row) => {
    if (window.confirm(`Delete "${nameOf(row)}"? This cannot be undone.`)) {
      act.run(() => api(`${path}/${row.id}`, { method: 'DELETE' }));
    }
  };

  const allColumns = [
    ...columns,
    { key: 'status', header: 'Status', render: (r) => (r.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>) },
    {
      key: 'actions', header: '', className: 'actions',
      render: (row) => (
        <>
          {rowActions?.(row)}
          {editFields.length > 0 && <button className="btn small secondary" onClick={() => { edit.reset(); setEditing(row); }}>Edit</button>}
          {canToggle(row) && (
            <button className="btn small secondary" disabled={act.loading} onClick={() => toggle(row)}>
              {row.active ? toggleLabels[0] : toggleLabels[1]}
            </button>
          )}
          {canDelete(row) && <button className="btn small danger" disabled={act.loading} onClick={() => remove(row)}>Delete</button>}
        </>
      ),
    },
  ];

  return (
    <section>
      <h2>{title}</h2>
      {createFields.length > 0 && (
        <div className="card">
          <EntityForm
            fields={createFields} submitLabel={createLabel} resetOnSuccess
            onSubmit={create.run} loading={create.loading} error={create.error}
          />
        </div>
      )}
      <ErrorMessage error={act.error} />
      <DataState loading={list.loading && !list.data} error={list.error} isEmpty={rows.length === 0} emptyText={emptyText} onRetry={list.reload}>
        <DataTable columns={allColumns} rows={rows} busy={list.loading} />
      </DataState>

      {editing && (
        <Modal title={`Edit ${nameOf(editing)}`} onClose={() => setEditing(null)}>
          <EntityForm
            fields={editFields} initial={editing} submitLabel="Save"
            onSubmit={edit.run} loading={edit.loading} error={edit.error}
          />
        </Modal>
      )}
    </section>
  );
}
