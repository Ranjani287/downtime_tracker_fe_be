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

Open http://localhost:5173. The dev server proxies `/api` to the backend.

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
| Bonus: ideas for a real shop floor | "Ideas for a real shop floor" in the backend README |

## Deployment (free tiers)

The browser should see **one origin**: the frontend host forwards `/api/*` to the API, so the `SameSite=Strict` refresh cookie works and CORS is not involved. Three pieces: **Neon** (PostgreSQL), **Render** (API), **Vercel** (frontend). *These steps and files were written from each provider's documentation and have not been run by the author; the dashboards may differ slightly.*

1. **Database (Neon):** create a project (or run `neon init` / `neon deploy`, see the backend README). You need two connection strings: the **pooled** one (`DATABASE_URL`, host contains `-pooler`) and the **direct** one (`DATABASE_URL_UNPOOLED`). The schema needs the `btree_gist` extension, which Neon allows.
2. **API (Render):** New → Blueprint → select this repo (it reads [`render.yaml`](render.yaml)). When asked, paste `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct) and `CORS_ORIGIN` (you can use a placeholder now and edit it after step 3). `JWT_SECRET` is generated for you. On first start it runs the migrations and seeds the demo data. Check `https://<api>.onrender.com/api/health`.
3. **Frontend (Vercel):** import the repo, set **Root Directory** to `frontend` (framework: Vite). Before deploying, edit [`frontend/vercel.json`](frontend/vercel.json) and replace `REPLACE-WITH-YOUR-RENDER-URL` with the API host from step 2. Leave `VITE_API_URL` unset.
4. Set the API's `CORS_ORIGIN` to the Vercel URL and redeploy it.
5. **Check:** open the Vercel URL, sign in as `admin@acme.com`, confirm a `refresh_token` cookie flagged *HttpOnly* and *Secure*, reload the page and stay signed in.

Notes: free Render instances sleep when idle, so the first request after a pause can take 30 to 60 seconds. `TRUST_PROXY=2` (Vercel + Render) makes the login rate limit see real client IPs; if you remove one of the proxies, change it. The seeded accounts share the password `Password123!`: change them, or remove the super admin seed, if the URL will be public for long.

## Main design decisions (details in the sub-READMEs)

- Shared schema with `tenant_id` everywhere; composite foreign keys make cross-tenant references impossible at the database level.
- Business rules live in Postgres constraints (one open event per machine, no overlaps, valid times) with friendly API error messages on top.
- Short-lived in-memory access token + rotating httpOnly refresh cookie with reuse detection; logout revokes the session server-side.
- Layered backend (routes → services → Sequelize models); the models map onto tables owned by plain SQL migrations (no auto-sync, as the brief requires). A `super_admin` role (beyond the brief) onboards tenants.
