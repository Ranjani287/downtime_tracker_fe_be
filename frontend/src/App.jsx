import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Spinner } from './components/DataState.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Events from './pages/Events.jsx';
import Login from './pages/Login.jsx';
import Organisations from './pages/Organisations.jsx';
import PlantSetup from './pages/PlantSetup.jsx';
import Users from './pages/Users.jsx';

// Where each role lands, and which links it sees. (UI convenience only: the API enforces authorization.)
const HOME = { super_admin: '/organisations', admin: '/dashboard', operator: '/events' };
const NAV = [
  { to: '/organisations', label: 'Organisations', roles: ['super_admin'] },
  { to: '/dashboard', label: 'Dashboard', roles: ['admin'] },
  { to: '/events', label: 'Downtime events', roles: ['admin', 'operator'] },
  { to: '/setup', label: 'Lines & machines', roles: ['admin'] },
  { to: '/users', label: 'Users', roles: ['admin'] },
];

// Route guard: must be signed in, and (optionally) have one of the given roles.
function Protected({ roles }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />;
  return <Outlet />;
}

function Layout() {
  const { user, logout } = useAuth();
  return (
    <>
      <header className="topbar">
        <strong>Downtime Tracker</strong>
        <nav>
          {NAV.filter((n) => n.roles.includes(user.role)).map((n) => <NavLink key={n.to} to={n.to}>{n.label}</NavLink>)}
        </nav>
        <span className="spacer" />
        <span className="muted small">{user.tenant_name || 'Platform'} · {user.name} ({user.role.replace('_', ' ')})</span>
        <ThemeToggle />
        <button className="btn secondary" onClick={logout}>Log out</button>
      </header>
      <main className="container"><Outlet /></main>
    </>
  );
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={HOME[user.role]} replace />;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={HOME[user.role]} replace /> : <Login />} />
      <Route element={<Protected />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route element={<Protected roles={['admin', 'operator']} />}>
            <Route path="/events" element={<Events />} />
          </Route>
          <Route element={<Protected roles={['admin']} />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/setup" element={<PlantSetup />} />
            <Route path="/users" element={<Users />} />
          </Route>
          <Route element={<Protected roles={['super_admin']} />}>
            <Route path="/organisations" element={<Organisations />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
