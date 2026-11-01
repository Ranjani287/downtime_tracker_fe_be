import { useAuth } from '../auth.jsx';
import Badge from '../components/Badge.jsx';
import CrudSection from '../components/CrudSection.jsx';

const ROLE_OPTIONS = [{ value: 'operator', label: 'Operator' }, { value: 'admin', label: 'Admin' }];

const createFields = [
  { name: 'name', label: 'Name', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'password', label: 'Password', type: 'password', required: true, minLength: 8, hint: 'Min. 8 characters' },
  { name: 'role', label: 'Role', type: 'select', options: ROLE_OPTIONS, required: true },
];
const editFields = [
  { name: 'name', label: 'Name', required: true },
  { name: 'role', label: 'Role', type: 'select', options: ROLE_OPTIONS, required: true },
  { name: 'password', label: 'New password', type: 'password', minLength: 8, hint: 'Leave blank to keep the current one' },
];

/** Admin screen: people in this organisation. Deactivating a user or resetting a password ends their sessions. */
export default function Users() {
  const { user: me } = useAuth();
  return (
    <CrudSection
      title="Users" path="/users" createLabel="Add user" createFields={createFields} editFields={editFields}
      columns={[
        { key: 'name', header: 'Name' },
        { key: 'email', header: 'Email' },
        { key: 'role', header: 'Role', render: (u) => <Badge>{u.role}</Badge> },
      ]}
      canToggle={(u) => u.id !== me.id} canDelete={() => false}
    />
  );
}
