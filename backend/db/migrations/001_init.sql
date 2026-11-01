CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------- tenants & users
CREATE TABLE tenants (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tenant_id is NULL only for the platform-level super admin (enforced by the CHECK below).
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  tenant_id     INT REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'operator')),
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((role = 'super_admin') = (tenant_id IS NULL))
);
CREATE UNIQUE INDEX uq_users_email ON users (lower(email));

-- ---------------------------------------------------------------- plant structure
-- Every child table carries tenant_id and is referenced through (tenant_id, id) composite keys,
-- so a row can never point at another tenant's parent, even if application code had a bug.
CREATE TABLE production_lines (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE machines (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  line_id    INT NOT NULL,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (line_id, name),
  FOREIGN KEY (tenant_id, line_id) REFERENCES production_lines (tenant_id, id)
);
CREATE INDEX idx_machines_line ON machines (tenant_id, line_id);

CREATE TABLE downtime_reasons (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

-- ---------------------------------------------------------------- downtime events
CREATE TABLE downtime_events (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  machine_id INT NOT NULL,
  reason_id  INT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ,            -- NULL while the event is open
  note       TEXT,
  created_by INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, machine_id) REFERENCES machines (tenant_id, id),
  FOREIGN KEY (tenant_id, reason_id)  REFERENCES downtime_reasons (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id),
  CONSTRAINT chk_event_times CHECK (ended_at IS NULL OR ended_at > started_at),
  -- a machine cannot be down twice at the same time (an open event counts as unbounded)
  CONSTRAINT ex_event_no_overlap EXCLUDE USING gist (machine_id WITH =, tstzrange(started_at, ended_at) WITH &&)
);

-- at most one open event per machine (also makes "is this machine down?" lookups cheap)
CREATE UNIQUE INDEX uq_events_one_open_per_machine ON downtime_events (machine_id) WHERE ended_at IS NULL;

-- list endpoint: newest first within a tenant, optionally narrowed by machine / reason
CREATE INDEX idx_events_tenant_started ON downtime_events (tenant_id, started_at DESC);
CREATE INDEX idx_events_machine        ON downtime_events (tenant_id, machine_id, started_at DESC);
CREATE INDEX idx_events_reason         ON downtime_events (tenant_id, reason_id);
