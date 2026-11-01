import Badge from '../components/Badge.jsx';
import CrudSection from '../components/CrudSection.jsx';
import { DataState } from '../components/DataState.jsx';
import { useLookups } from '../hooks/useLookups.js';

const lineName = { name: 'name', label: 'Name', required: true };

/** Admin screen: production lines, the machines on them, and the downtime reasons operators choose from. */
export default function PlantSetup() {
  const lookups = useLookups(); // supplies the line dropdown for machines; reloaded when lines change
  const lineOptions = (lookups.data?.lines ?? []).filter((l) => l.active).map((l) => ({ value: l.id, label: l.name }));
  const machineFields = [
    { name: 'line_id', label: 'Line', type: 'select', options: lineOptions, required: true, number: true },
    { name: 'name', label: 'Name', required: true },
  ];

  return (
    <DataState loading={lookups.loading && !lookups.data} error={lookups.error} onRetry={lookups.reload}>
      <CrudSection
        title="Production lines" path="/lines" onChanged={lookups.reload}
        columns={[{ key: 'name', header: 'Name' }, { key: 'machine_count', header: 'Machines' }]}
        createFields={[lineName]} emptyText="No production lines yet. Add your first line above."
      />
      <CrudSection
        title="Machines" path="/machines" onChanged={lookups.reload}
        columns={[
          { key: 'line_name', header: 'Line' },
          { key: 'name', header: 'Machine' },
          { key: 'is_down', header: 'State', render: (m) => (m.is_down ? <Badge tone="red">Down</Badge> : <Badge tone="green">Running</Badge>) },
        ]}
        createFields={machineFields} emptyText="No machines yet. Add a line first, then its machines."
      />
      <CrudSection
        title="Downtime reasons" path="/reasons" onChanged={lookups.reload}
        columns={[{ key: 'name', header: 'Reason' }, { key: 'category', header: 'Category' }]}
        createFields={[lineName, { name: 'category', label: 'Category', required: true, hint: 'e.g. Breakdown, Changeover, Material' }]}
        emptyText="No reasons yet. Add the reasons operators can choose from."
      />
    </DataState>
  );
}
