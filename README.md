# PlantNxt Production Line Downtime Tracker

A small **multi-tenant** PERN app (PostgreSQL, Express, React, Node.js) where operators log machine downtime on production lines and admins review which lines and reasons lose the most time. Built for the PlantNxt full stack assignment.

| Folder | What | Detailed docs |
|---|---|---|
| [`backend/`](backend/) | Express REST API, PostgreSQL schema + SQL migrations, seed data | [backend/README.md](backend/README.md): schema, **all API endpoints**, tenant isolation, auth, design decisions |
| [`frontend/`](frontend/) | React (Vite) single-page app | [frontend/README.md](frontend/README.md): screens, reusable hooks/components, client auth |

## Install and run

Prerequisites: Node 20+ and PostgreSQL 14+ (running locally).

```bash
# 1. Database
psql -U postgres -c "CREATE DATABASE downtime_tracker"

# 2. Backend  → http://localhost:4000
cd backend
cp .env.example .env          # set your Postgres password in DATABASE_URL and a JWT_SECRET
npm install
npm run setup                 # SQL migrations + seed two demo tenants
npm run dev

# 3. Frontend (second terminal)  → http://localhost:5173
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` to the backend. An optional `docker-compose.yml` for the database and API is in `backend/` (untested, see its README).

## Seeded logins

All passwords: `Password123!` (the login page has one-click buttons).

| Tenant | Email | Role | Sees |
|---|---|---|---|
| Acme Automotive | admin@acme.com | admin | Dashboard, event list, lines/machines/reasons, users |
| Acme Automotive | operator@acme.com, operator2@acme.com | operator | Event list only (start/close events) |
| Globex Packaging | admin@globex.com | admin | same, for Globex |
| Globex Packaging | operator@globex.com, operator2@globex.com | operator | same, for Globex |
| *(platform)* | superadmin@platform.com | super_admin | Organisations: onboard tenants and their first admin |

**Tenant isolation check:** sign in as `admin@acme.com`, then as `admin@globex.com`: each sees only its own lines, machines, events and totals. Requesting another tenant's record by id returns `404`.

## Requirements coverage

| Brief | Where |
|---|---|
| Email/password login returning a JWT, hashed passwords | `backend/src/routes/auth.js` (bcrypt, 15-min access JWT + rotating httpOnly refresh cookie) |
| Admin and Operator roles | `authorize(...)` middleware; role-based navigation and routes in the UI |
| Two seeded tenants with users | `backend/scripts/seed.js` |
| Tenant isolation, even by guessing an id | tenant taken from the authenticated user, every query scoped, composite foreign keys (see "How tenant isolation is enforced" in the backend README) |
| CRUD for lines, machines, reasons (admin) | `backend/src/routes/{lines,machines,reasons}.js`, UI `/setup` |
| Start/close events; no two open events per machine | `routes/downtime.js` + partial unique index and exclusion constraint in `001_init.sql` |
| List with pagination and filters (line, machine, reason, date range, open/closed) | `GET /api/downtime`, UI `/events` |
| Admin summary by line and by reason, computed in SQL | `routes/reports.js` (CTE + joins + aggregates), UI `/dashboard` |
| Validation and consistent errors | Zod middleware + central error handler |
| Login page, protected routes, role-based screens | `frontend/src/App.jsx` |
| Loading, empty and error states; reusable components and hooks | `frontend/src/hooks`, `frontend/src/components` (`DataState`, `CrudSection`, …) |
| Migrations with foreign keys and indexes; no auto-created schema | `backend/db/migrations/*.sql`; models in `backend/src/models` only map (no `sync()`) |
| Bonus: docker-compose, shop-floor ideas | `backend/docker-compose.yml` (untested), "Ideas for a real shop floor" in the backend README |

## Main design decisions (details in the sub-READMEs)

- Shared schema with `tenant_id` everywhere; composite foreign keys make cross-tenant references impossible at the database level.
- Business rules live in Postgres constraints (one open event per machine, no overlaps, valid times) with friendly API error messages on top.
- Short-lived in-memory access token + rotating httpOnly refresh cookie with reuse detection; logout revokes the session server-side.
- Layered backend (routes → services → Sequelize models); the models map onto tables owned by plain SQL migrations (no auto-sync, as the brief requires). A `super_admin` role (beyond the brief) onboards tenants.

## What I would improve with another day

Row-level security as a second isolation layer, keyset pagination, an audit trail and soft deletes, per-machine dashboards (Pareto, MTTR/MTBF), automated tests (API integration tests; React Testing Library + Playwright for the UI), OpenAPI docs, and filters kept in the URL. See the sub-READMEs for the full lists.
