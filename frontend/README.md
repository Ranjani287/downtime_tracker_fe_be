# PlantNxt Production Line Downtime Tracker — Frontend

React single-page app for the multi-tenant Production Line Downtime Tracker. **React 19 (Vite), React Router, Recharts**, plain JavaScript. It talks to the REST API in [`../backend`](../backend), which must be running (its README also holds the database setup, schema, API documentation and seeded logins).

## Install and run

Prerequisites: Node 20+ and the backend running on http://localhost:4000.

```bash
npm install
npm run dev        # http://localhost:5173
```

In development the app calls the relative path `/api` and the Vite dev server proxies it to the backend, so the browser sees one origin (that is what lets the SameSite refresh cookie work). No configuration is needed if the backend is on port 4000.

Other scripts: `npm run build` (output in `dist/`), `npm run preview`.

### Configuration (optional, `.env`)

| Variable | Purpose |
|---|---|
| `VITE_DEV_PROXY_TARGET` | Where the dev server forwards `/api` (default `http://localhost:4000`) |
| `VITE_API_URL` | Full API base URL (e.g. `https://api.example.com/api`) when the API is hosted separately. Leave unset for relative `/api` |

If the API is on a different site, the backend needs `COOKIE_SAMESITE=none` + HTTPS and `CORS_ORIGIN` set to this app's origin. For same-origin hosting, serve `dist/` and `/api` behind one reverse proxy and fall back to `index.html` for unknown paths.

## Demo logins

Password for all: `Password123!`. The login page has one-click buttons for these.

| Email | Role | Lands on / sees |
|---|---|---|
| admin@acme.com, admin@globex.com | admin | Dashboard, Downtime events, Lines & machines (also reasons), Users |
| operator@acme.com, operator@globex.com | operator | **Only the Downtime events list** (start/close events) |
| superadmin@platform.com | super_admin | Organisations (create tenants and their first admin) |

## Theme

A **Light / Dark toggle** is in the top bar (and on the login page). The choice is saved in the browser (`localStorage`) and, until you choose, follows the operating-system setting; an inline script in `index.html` applies it before first paint so there is no flash. All colours are CSS variables in `src/styles.css`, including the charts, so both themes are fully styled. The accent colour is **violet**; to rebrand (for example to orange) change the `--primary`, `--primary-hover`, `--primary-soft`, `--accent-text` and `--chart` variables in the two theme blocks at the top of that file.

Forms use fixed control heights and top alignment, so hint text under a field (such as "Min. 8 characters") never shifts neighbouring fields or buttons out of line.

## Screens

| Route | Roles | What it does |
|---|---|---|
| `/login` | public | Sign in |
| `/events` | admin, operator | Start an event (machine, reason, start time, optional note); event list with filters (line, machine, reason, status open/closed, date range) and pagination; close an open event (pick the end time); admins can delete |
| `/dashboard` | admin | Date range picker (with Today / 7 / 30 day presets) → KPI cards, plus downtime **by line** and **by reason** as bar charts and tables (data comes from the SQL summary endpoint) |
| `/setup` | admin | CRUD for production lines, machines (belong to a line) and downtime reasons |
| `/users` | admin | Add users, change roles, reset passwords, deactivate |
| `/organisations` | super_admin | Create an organisation with its first admin, rename, suspend/reactivate, view users |

Routes are also guarded in the UI by role, but that is only a convenience: the API enforces authorization and tenant isolation.

Every data screen has **loading, empty and error states** (with a Retry button for failed loads); forms show validation and server errors inline; buttons are disabled while a request is running.

## Structure: reusable hooks and components

```
src/
  api.js                  fetch wrapper: in-memory access token, refresh-and-retry on 401, single-flight refresh
  auth.jsx                AuthProvider / useAuth (session restore, login, logout, hasRole)
  theme.jsx               ThemeProvider / useTheme (light/dark, saved in localStorage)
  App.jsx                 routes, role guards, role-based navigation
  hooks/
    useAsync.js           load data: { data, loading, error, reload }; ignores stale responses
    useMutation.js        write actions: { run, loading, error }; run() resolves { ok, data | error }
    useLookups.js         lines + machines + reasons for forms and filters
  components/
    DataState.jsx         Spinner / ErrorMessage / EmptyState / <DataState> used by every screen
    DataTable.jsx, Pagination.jsx, Modal.jsx, Badge.jsx, Field.jsx (Field + grouped Select), ThemeToggle.jsx
    DateRangePicker.jsx   shared by the event filters and the dashboard
    EntityForm.jsx        form generated from a field list
    CrudSection.jsx       list + create + edit dialog + (de)activate + delete for one REST resource
    StartEventForm.jsx, CloseEventModal.jsx, SummaryPanel.jsx
  pages/                  Login, Events, Dashboard, PlantSetup, Users, Organisations
  utils/format.js         date/duration formatting helpers
```

`CrudSection` is configured per resource, so lines, machines, reasons, users and organisations share one implementation instead of five copies. `DataState`, `DataTable`, `DateRangePicker` and `Field` are reused across pages.

## How authentication works in the client

- The short-lived **access token is kept in memory only**, never in `localStorage`/`sessionStorage`.
- The long-lived **refresh token is an httpOnly cookie** that JavaScript cannot read; the browser sends it to `/api/auth/*`.
- **On page load** the app calls `POST /auth/refresh` to restore the session from the cookie.
- **On a `401`** the API wrapper refreshes once and replays the request. Concurrent 401s share one refresh call (refresh tokens rotate, so parallel refreshes would race). If refreshing fails, state is cleared and the user is sent to the login page. A `409` from refresh (another tab rotated the token a moment earlier) is retried once.
- Requests carry `X-Requested-With: XMLHttpRequest` (required by the API on cookie endpoints as CSRF defence) and `credentials: 'include'`.
- **Logout** calls `POST /auth/logout` (revokes the session server-side), then clears local state.

## Assumptions

- Operators see only the event list, as the brief says; admins can also start and close events from the same screen.
- Date pickers select whole days in the browser's timezone; the API stores UTC (`timestamptz`) and the UI shows local time.
- Event times cannot be in the future (the form limits the pickers; the API validates too).

## What I would improve with another day

- Automated frontend tests (React Testing Library for the forms and `CrudSection`, Playwright for the operator and admin flows).
- Keep filters in the URL query string so views can be bookmarked and shared; auto-refresh of open events.
- A Pareto chart and per-machine drill-down on the dashboard; CSV export.
- Code-splitting (the Recharts bundle makes the main chunk > 500 kB) and accessibility audit (focus trapping in the modal).
- Shop-floor ideas (not built): large touch-friendly "machine stopped" buttons, offline queueing, and alerts for machines down beyond a threshold.
