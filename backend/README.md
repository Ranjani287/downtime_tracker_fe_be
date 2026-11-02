# PlantNxt Production Line Downtime Tracker — Backend (API)

Multi-tenant REST API for logging and analysing production line downtime. **Node 20+, Express, PostgreSQL**, data access through **Sequelize models** mapped onto tables that are owned by plain SQL migration files, JWT auth, Zod validation.

The React app lives in [`../frontend`](../frontend) (same repository). The API also works on its own with any HTTP client. See the [root README](../README.md) for the quick start of the whole project.

## Install and run

Prerequisites: Node 20+, PostgreSQL 14+ (the `btree_gist` extension ships with standard installs).

```bash
psql -U postgres -c "CREATE DATABASE downtime_tracker"
cp .env.example .env          # set DATABASE_URL (your password) and JWT_SECRET
npm install
npm run setup                 # runs the SQL migrations and seeds two demo tenants
npm run dev                   # http://localhost:4000   (npm start for production)
```

| Command | What it does |
|---|---|
| `npm run setup` | migrate + seed (the seed **wipes existing data**) |
| `npm run migrate` / `npm run seed` | run one step |
| `npm run db:reset` | drop the schema, migrate and seed (development only) |

**Docker (optional):** `docker compose up --build` starts PostgreSQL and the API (migrations and seed run automatically on first start). *Note: I wrote this without Docker installed on my laptop, so it is untested.*

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | Postgres connection string (with Neon: the **pooled** one) |
| `DATABASE_URL_UNPOOLED` | none | Neon's direct connection; migrations and seeding use it when present |
| `JWT_SECRET` | required | Signs access tokens |
| `PORT` | 4000 | HTTP port |
| `JWT_EXPIRES_IN` | 15m | Access token lifetime |
| `REFRESH_TOKEN_DAYS` | 7 | Refresh cookie lifetime |
| `CORS_ORIGIN` | http://localhost:5173 | Exact frontend origin allowed (with credentials) |
| `COOKIE_SAMESITE` | strict | `strict` if frontend and API share a site; `none` if on different sites (HTTPS required) |
| `NODE_ENV` | – | `production` makes cookies `Secure` |

## Using Neon (hosted PostgreSQL)

The app runs unchanged on Neon (it is plain PostgreSQL with the `btree_gist` extension). `neon.ts` at the repository root declares the project; `neon deploy` links it and writes `.env.local` at the repository root with:

- `DATABASE_URL`: the **pooled** connection (host contains `-pooler`). The running API uses this one, as Neon recommends for application traffic.
- `DATABASE_URL_UNPOOLED`: the **direct** connection. `npm run migrate` and the seed script use it when it is present (Neon's guidance for schema changes), via `scripts/useDirectConnection.js`.

The backend loads `../.env.local` automatically and it takes precedence over `backend/.env`, so with that file present the app talks to Neon; delete or rename it to return to the local database. TLS is enabled automatically for `sslmode=require` URLs, with certificate verification on. The API prints the database host (never credentials) at startup so you can see which database it is using.

```bash
cd backend
npm run migrate                    # creates the tables on Neon (direct connection); safe to re-run
node scripts/seed.js --if-empty    # optional demo data, only if the database is empty
npm start
```

**Safety:** `npm run db:reset` (drops the schema) and a plain `npm run seed` (truncates tenants/users) refuse to run against a non-local database unless you set `ALLOW_REMOTE_RESET=true`. `seed.js --if-empty` is always allowed because it never wipes anything.

## Seeded logins

All passwords: `Password123!`

| Tenant | Email | Role |
|---|---|---|
| Acme Automotive | admin@acme.com | admin |
| Acme Automotive | operator@acme.com | operator |
| Acme Automotive | operator2@acme.com | operator |
| Globex Packaging | admin@globex.com | admin |
| Globex Packaging | operator@globex.com | operator |
| Globex Packaging | operator2@globex.com | operator |
| *(none — platform level)* | superadmin@platform.com | super_admin |

Each tenant has 3 lines, 6 machines, 6 downtime reasons and 85 events over the last 14 days; one machine is currently down (Acme: *Line 2 - Packing / Packing Machine*).

**Quick tenant-isolation check:** log in as `admin@acme.com` and as `admin@globex.com`; each sees only its own lines, machines, events and totals. Using an Acme token to request a Globex event id (e.g. `GET /api/downtime/<globex id>`) returns `404`.

## Roles

| Capability | operator | admin | super_admin |
|---|:-:|:-:|:-:|
| List lines, machines, reasons (read-only, needed for forms) | ✅ | ✅ | ❌ |
| Start and close downtime events, view the event list | ✅ | ✅ | ❌ |
| Create/update/delete lines, machines, reasons | ❌ | ✅ | ❌ |
| Edit/delete downtime events | ❌ | ✅ | ❌ |
| Summary endpoint (dashboard) | ❌ | ✅ | ❌ |
| Manage users of own tenant | ❌ | ✅ | ❌ |
| Create/suspend tenants, create their first admin | ❌ | ❌ | ✅ |

`super_admin` is an addition to the brief (platform operator who onboards tenants). It belongs to no tenant and cannot touch any tenant's data.

## Code structure and data access

```
src/
  db.js               the Sequelize connection (DB_LOG=1 prints every SQL statement)
  models/             one file per table: Tenant, User, ProductionLine, Machine, DowntimeReason,
                      DowntimeEvent, RefreshToken, RevokedToken; index.js declares the associations
  services/           business rules + model calls, one file per area: authService, lineService, machineService,
                      reasonService, downtimeService, reportService, userService, organisationService
  serializers.js      model -> JSON response shapes (and the reusable `include` trees)
  utils/tenant.js     inTenant() / findOwned(): the tenant filter every query goes through
  routes/             thin Express handlers, HTTP only: Zod validation + role guards -> call a service -> send JSON
  middleware/         auth (JWT, roles), validation, error mapping
db/migrations/        the schema: plain SQL, applied by scripts/migrate.js
```

**Layering: routes → services → models → PostgreSQL.** A route reads the request, validates it with Zod, checks the role and calls one service function; it never imports a model. A service owns the business rules (for example "a machine can't have two open events", "an admin can't deactivate themselves", token rotation and reuse detection) and talks to the models; it knows nothing about `req`/`res` (cookies stay in the auth route). Services return ready-to-send DTOs and throw `HttpError`s that the central error handler turns into responses. This keeps handlers trivial, and a service function can be called from a test or a script without HTTP.

**Models map, migrations own the schema.** The models describe existing tables and relations (`Machine.belongsTo(ProductionLine)`, `DowntimeEvent.belongsTo(Machine)`, ...), but `sequelize.sync()` is never called: tables, composite foreign keys, the exclusion constraint and the partial unique index all come from the SQL migrations. Neither routes nor services contain SQL strings; services use model calls such as `Machine.findAll({ where: inTenant(tenantId), include: [...] })`.

- **Tenant isolation in the data layer:** every tenant-owned query builds its `where` with `inTenant(req.user.tenant_id, ...)`, and `findOwned()` turns "not in my tenant" into a 404.
- **Secrets stay out of responses:** `User` has a default scope that excludes `password_hash`; only login opts in with `User.unscoped()`. Routes return DTOs from `serializers.js`, never raw model instances.
- **Aggregates still run in SQL:** the summary uses `COUNT`/`SUM`/`AVG` with joins and `GROUP BY` expressed through the models ([`reports.js`](src/routes/reports.js)). Run the API with `DB_LOG=1` to see the generated statements.
- **Derived values** such as an event's `duration_minutes` are model getters; `is_down` comes from an association scoped to `ended_at IS NULL`.
- The only raw SQL left is in the migration/reset/seed scripts (running the `.sql` files, dropping the schema, `TRUNCATE`).

## Database schema

Migrations: [`db/migrations/001_init.sql`](db/migrations/001_init.sql) (domain) and [`002_auth_tokens.sql`](db/migrations/002_auth_tokens.sql) (sessions). A small runner ([`scripts/migrate.js`](scripts/migrate.js)) applies them in order inside transactions and records them in `schema_migrations`.

```
tenants            id, name UNIQUE, active
users              id, tenant_id → tenants (NULL only for super_admin), email UNIQUE (case-insensitive),
                   name, password_hash, role ('super_admin'|'admin'|'operator'), active
                   CHECK (role = 'super_admin') = (tenant_id IS NULL)
production_lines   id, tenant_id, name, active                 UNIQUE (tenant_id, name)
machines           id, tenant_id, line_id, name, active        UNIQUE (line_id, name)
downtime_reasons   id, tenant_id, name, category, active       UNIQUE (tenant_id, name)
downtime_events    id, tenant_id, machine_id, reason_id, started_at, ended_at NULL, note, created_by
revoked_tokens     jti, expires_at                              -- logged-out access tokens
refresh_tokens     id, user_id, family_id, token_hash UNIQUE, expires_at, revoked_at, replaced_by
```

Integrity rules enforced **by the database**, not only by code:

- **Composite foreign keys** `(tenant_id, machine_id) → machines(tenant_id, id)` (same for lines, reasons, users): an event can never point at another tenant's machine, reason or user.
- `CHECK (ended_at IS NULL OR ended_at > started_at)`.
- **One open event per machine:** partial unique index `uq_events_one_open_per_machine ON downtime_events (machine_id) WHERE ended_at IS NULL`.
- **No overlapping downtime on a machine:** GiST exclusion constraint on `(machine_id, tstzrange(started_at, ended_at))`.

Indexes for the list/filter endpoints: `(tenant_id, started_at DESC)` for the default newest-first list, `(tenant_id, machine_id, started_at DESC)` for machine/line filters, `(tenant_id, reason_id)`, and the partial open-event index. Line filtering joins `machines`, which has `(tenant_id, line_id)`.

## API

Base path `/api`. All endpoints except `health`, `auth/login`, `auth/refresh` and `auth/logout` need `Authorization: Bearer <access token>`. JSON in and out. Every error has the same shape: `{ "error": "message", "details"?: [{ "path", "message" }] }`.

| Status | Meaning |
|---|---|
| 400 | Validation failed (`details` lists the fields) or a referenced record does not exist for your tenant |
| 401 | Missing, invalid, expired or revoked token / inactive user or tenant |
| 403 | Authenticated but the role is not allowed |
| 404 | Not found, **including records that belong to another tenant** |
| 409 | Conflict: duplicate name, machine already has an open event, overlapping event, still referenced |

### Authentication

| Method & path | Who | Description |
|---|---|---|
| `POST /auth/login` | public | `{email, password}` → `{token, user}`; sets the httpOnly `refresh_token` cookie. Rate limited |
| `POST /auth/refresh` | cookie | New access token + rotated refresh cookie. Requires header `X-Requested-With: XMLHttpRequest` |
| `GET /auth/me` | any | Current user |
| `POST /auth/logout` | cookie | Revokes the session (refresh family + access token), clears the cookie. Requires the `X-Requested-With` header |

### Plant structure

| Method & path | Who | Description |
|---|---|---|
| `GET /lines` | any tenant user | List with `machine_count` |
| `POST /lines` | admin | `{name}` |
| `PATCH /lines/:id` | admin | `{name?, active?}` |
| `DELETE /lines/:id` | admin | 409 while machines still belong to the line (deactivate instead) |
| `GET /machines?line_id=` | any tenant user | List with `line_name` and `is_down` |
| `POST /machines` | admin | `{line_id, name}` |
| `PATCH /machines/:id` | admin | `{name?, line_id?, active?}` |
| `DELETE /machines/:id` | admin | 409 if the machine has downtime history |
| `GET /reasons` | any tenant user | List |
| `POST /reasons` | admin | `{name, category}` |
| `PATCH /reasons/:id` / `DELETE /reasons/:id` | admin | Update (`name?, category?, active?`) / delete (409 if used) |

### Downtime events

| Method & path | Who | Description |
|---|---|---|
| `GET /downtime` | any tenant user | Query: `line_id, machine_id, reason_id, status=open\|closed, from, to, page=1, limit=20 (max 100)` → `{data, total, page, limit}`, newest first |
| `GET /downtime/:id` | any tenant user | One event |
| `POST /downtime` | any tenant user | **Start** an event: `{machine_id, reason_id, started_at?, note?}` (`started_at` defaults to now; optional `ended_at` back-fills a finished event) |
| `PATCH /downtime/:id/close` | any tenant user | **Close**: `{ended_at?, note?}` (`ended_at` defaults to now; 409 if already closed) |
| `PUT /downtime/:id` | admin | Correct `reason_id, started_at, ended_at, note` |
| `DELETE /downtime/:id` | admin | Delete |

Event objects include `machine_name`, `line_id`, `line_name`, `reason_name`, `reason_category`, `created_by_name` and `duration_minutes` (open events count up to now).

Validation: ids must be positive integers; `note` ≤ 1000 chars; `ended_at` after `started_at`; times cannot be in the future (5 minutes of clock skew allowed); `from` ≤ `to`; machine/reason must belong to the tenant and be active.

### Summary (admin)

`GET /reports/summary?from=&to=` (ISO timestamps; defaults to the last 7 days) →

```json
{ "from": "...", "to": "...",
  "totals":   { "events": 44, "open_events": 1, "total_minutes": 2635, "avg_minutes_per_closed_event": 60.6 },
  "by_line":  [{ "line_id": 3, "line_name": "Line 3 - Paint Shop", "events": 14, "total_minutes": 928 }],
  "by_reason":[{ "reason_id": 3, "reason_name": "Changeover", "category": "Changeover", "events": 9, "total_minutes": 610 }] }
```

Computed entirely in SQL ([`src/routes/reports.js`](src/routes/reports.js)), built with Sequelize aggregates: each query selects the tenant's events overlapping the range and clips each duration to the range (`LEAST(ended_at, to) - GREATEST(started_at, from)`; open events run until now), then `INNER JOIN`s `machines → production_lines` (or `downtime_reasons`) and uses `GROUP BY` with `SUM`/`COUNT`. An event that started before the range only contributes the minutes inside it.

### Users and platform

| Method & path | Who | Description |
|---|---|---|
| `GET/POST /users`, `PATCH /users/:id` | admin | Manage users of your tenant (`role` is `admin` or `operator`; password min 8; an admin cannot deactivate/demote themselves) |
| `GET /platform/organisations` | super_admin | All tenants with user counts |
| `POST /platform/organisations` | super_admin | `{name, admin:{name,email,password}}` creates the tenant and its first admin atomically |
| `PATCH /platform/organisations/:id` | super_admin | Rename, or `active:false` to suspend (locks out all its users immediately) |
| `GET /platform/organisations/:id/users`, `POST .../admins` | super_admin | List users / add another admin |

## How tenant isolation is enforced

1. **The tenant never comes from the request.** After the JWT is verified, the user (and their tenant) is re-loaded from the database on every request; `req.user.tenant_id` is the only tenant any query uses.
2. **Every query is scoped:** `WHERE tenant_id = $1` on reads and writes, including `UPDATE`/`DELETE` by id, so a guessed id from another tenant matches no row and returns **404** (no information leak about whether it exists). Ids in request bodies (machine, reason, line) are checked against the tenant and return 400 if foreign.
3. **The database backs it up:** composite foreign keys make cross-tenant references impossible even if a query forgot its filter.
4. The super admin has no tenant, so a `requireTenant` guard blocks it from every tenant-data route.

## Authentication details

- Passwords are hashed with bcrypt. Unknown emails take the same time as wrong passwords (dummy hash compare). Login and refresh are rate limited.
- **Access token:** 15-minute JWT (HS256, with a `jti`). **Refresh token:** 48 random bytes in an `httpOnly`, `SameSite=Strict`, path-scoped cookie; only its SHA-256 hash is stored.
- **Rotation + reuse detection:** every refresh revokes the used token and issues a new one in the same *family*. Presenting an already-used token revokes the whole family (assumed theft). A 10-second grace window turns a two-tab race into a retryable 409.
- **Logout** revokes the refresh family and denylists the access token's `jti`. Deactivating a user, resetting their password, or suspending their tenant ends their sessions.
- **CSRF:** the cookie-authenticated endpoints require a custom `X-Requested-With` header (plus `SameSite`); everything else uses the Bearer header.

## Design decisions and assumptions

- **Shared schema, `tenant_id` on every table** (simplest to operate for a small SaaS; discussed above). Row-level security would be the next hardening step.
- **Constraints in Postgres, friendly messages in the API:** the explicit "machine already has an open event" check gives a clear error, while the partial unique index and exclusion constraint are the real guarantee under concurrency. Constraint names are mapped to messages in [`src/middleware/error.js`](src/middleware/error.js).
- **Date ranges mean "overlaps the range"** in both the list filter and the summary, so an event spanning midnight appears on both days.
- **Deactivate vs delete:** lines, machines and reasons with history cannot be deleted (foreign keys → 409); deactivating hides them from new events but keeps history and reports.
- **Reason `category`** is free text (the brief's examples mix names and categories), e.g. Breakdown, Changeover, Material.
- **Operators may read lines/machines/reasons** because the start-event form needs them; "Admin only" is applied to changing them. Admins may also log and close events.
- **Layering:** routes (HTTP + validation) → services (business rules) → Sequelize models → PostgreSQL. The ORM only maps; it never creates or changes tables (the brief forbids auto-created schemas), so the schema stays explicit and reviewable in SQL migrations. Sequelize parameterizes all values (the few `sequelize.escape`d dates in the summary are already Zod-validated).
- **Pagination** is `LIMIT/OFFSET` (simple, supports "page N of M"); `limit` is capped at 100.

### If a query gets slow

Find the statement with `pg_stat_statements` or slow-query logs, then `EXPLAIN (ANALYZE, BUFFERS)` it. For the event list the indexes above should give an index scan on `(tenant_id, started_at DESC)`; deep `OFFSET` pages get slow, so switch to **keyset pagination** (`WHERE (started_at, id) < ($last_started, $last_id)`). For the summary, `(tenant_id, started_at)` narrows the range first; if the data grows large, pre-aggregate into a daily rollup table (per tenant, machine, reason) refreshed by a job, and query that instead.

## What I would improve with another day

- Row-level security as a second isolation layer; keyset pagination; CSV export of the event list.
- A `closed_by` column and an audit trail for edits/deletes; soft delete for events.
- Machine-level dashboards (Pareto chart, MTBF/MTTR per machine) and shifts/plant (site) entities between tenant and line.
- Automated API integration tests (auth and token rotation, tenant isolation, the one-open-event rule under concurrent requests, the summary maths) and load tests on the list endpoint.
- Password reset by email, tenant self sign-up, and per-user login throttling in addition to per-IP.
- OpenAPI/Swagger documentation generated from the Zod schemas.

### Ideas for a real shop floor (not built)

Tablet-friendly one-tap "machine stopped" with a short list of frequent reasons; offline mode that queues events and syncs; automatic stop detection from PLC/SCADA (OPC UA / MQTT) so operators only confirm the reason; push/SMS alerts when a machine is down longer than a threshold; shift handover notes; planned vs unplanned downtime split with OEE availability figures.

## Deploying with a separately hosted frontend

- **Same site** (one reverse proxy, or subdomains of one registrable domain): keep `COOKIE_SAMESITE=strict`.
- **Different sites:** set `COOKIE_SAMESITE=none` (forces `Secure`, needs HTTPS), `CORS_ORIGIN` to the exact frontend origin, and build the frontend with `VITE_API_URL` pointing at this API.

## Known limitations

- No tenant self sign-up and no "forgot password" email flow (admins reset passwords).
- No automated tests are included; the behaviour above was checked manually against the seeded data.
- Docker files are untested (see above).
