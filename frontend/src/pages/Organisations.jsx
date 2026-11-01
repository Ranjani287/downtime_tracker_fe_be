import { useState } from 'react';
import { api } from '../api.js';
import Badge from '../components/Badge.jsx';
import CrudSection from '../components/CrudSection.jsx';
import DataTable from '../components/DataTable.jsx';
import { DataState } from '../components/DataState.jsx';
import Modal from '../components/Modal.jsx';
import { useAsync } from '../hooks/useAsync.js';

const createFields = [
  { name: 'name', label: 'Organisation name', required: true },
  { name: 'adminName', label: 'Admin name', required: true },
  { name: 'adminEmail', label: 'Admin email', type: 'email', required: true },
  { name: 'adminPassword', label: 'Temporary password', type: 'password', required: true, minLength: 8, hint: 'Min. 8 characters' },
];

function OrganisationUsers({ org, onClose }) {
  const users = useAsync(() => api(`/platform/organisations/${org.id}/users`), [org.id]);
  const rows = users.data?.data ?? [];
  return (
    <Modal title={`${org.name}: users`} onClose={onClose}>
      <DataState loading={users.loading && !users.data} error={users.error} onRetry={users.reload} isEmpty={rows.length === 0} emptyText="No users.">
        <DataTable
          rows={rows}
          columns={[
            { key: 'name', header: 'Name' },
            { key: 'email', header: 'Email' },
            { key: 'role', header: 'Role', render: (u) => <Badge>{u.role}</Badge> },
            { key: 'active', header: 'Status', render: (u) => (u.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>) },
          ]}
        />
      </DataState>
    </Modal>
  );
}

/** Super admin screen: create organisations (with their first admin) and suspend/reactivate them. */
export default function Organisations() {
  const [viewing, setViewing] = useState(null);
  return (
    <>
      <CrudSection
        title="Organisations" path="/platform/organisations" createLabel="Create organisation"
        createFields={createFields} editFields={[{ name: 'name', label: 'Name', required: true }]}
        toCreatePayload={({ name, adminName, adminEmail, adminPassword }) => ({
          name, admin: { name: adminName, email: adminEmail, password: adminPassword },
        })}
        columns={[
          { key: 'name', header: 'Organisation' },
          { key: 'user_count', header: 'Users' },
          { key: 'admin_count', header: 'Admins' },
        ]}
        toggleLabels={['Suspend', 'Reactivate']} canDelete={() => false}
        rowActions={(org) => <button className="btn small secondary" onClick={() => setViewing(org)}>Users</button>}
        emptyText="No organisations yet. Create the first one above."
      />
      {viewing && <OrganisationUsers org={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
