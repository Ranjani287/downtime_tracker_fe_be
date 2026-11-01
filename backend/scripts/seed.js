import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';

const PASSWORD = 'Password123!';
const hash = bcrypt.hashSync(PASSWORD, 10);

const tenants = [
  {
    name: 'Acme Automotive',
    slug: 'acme',
    lines: {
      'Line 1 - Body Welding': ['Welding Robot A', 'Welding Robot B'],
      'Line 2 - Packing': ['Packing Machine', 'Labeller'],
      'Line 3 - Paint Shop': ['Spray Booth', 'Curing Oven'],
    },
  },
  {
    name: 'Globex Packaging',
    slug: 'globex',
    lines: {
      'Bottling Line': ['Filler', 'Capper'],
      'Cartoning Line': ['Carton Erector', 'Case Packer'],
      'Palletizing Line': ['Stretch Wrapper', 'Palletizer'],
    },
  },
];

const reasons = [
  ['Mechanical breakdown', 'Breakdown'], ['Electrical fault', 'Breakdown'],
  ['Changeover', 'Changeover'], ['Material shortage', 'Material'],
  ['Quality hold', 'Quality'], ['Planned maintenance', 'Planned'],
];

// `--if-empty` (used by docker-compose) makes the seed a no-op when data already exists, so restarts keep your data.
if (process.argv.includes('--if-empty') && (await pool.query('SELECT 1 FROM tenants LIMIT 1')).rowCount) {
  console.log('Database already has data, skipping seed.');
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  // Idempotent reseed: wipe and recreate demo data.
  await client.query('TRUNCATE tenants, users, revoked_tokens RESTART IDENTITY CASCADE');

  // Platform super admin: belongs to no organisation (tenant_id NULL).
  await client.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES (NULL, $1, 'Platform Super Admin', $2, 'super_admin')`,
    ['superadmin@platform.com', hash]
  );

  for (const t of tenants) {
    const tenantId = (await client.query('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [t.name])).rows[0].id;

    const users = {};
    for (const [key, role] of [['admin', 'admin'], ['operator', 'operator'], ['operator2', 'operator']]) {
      users[key] = (await client.query(
        'INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [tenantId, `${key}@${t.slug}.com`, `${t.name.split(' ')[0]} ${key}`, hash, role]
      )).rows[0].id;
    }

    const machineIds = [];
    for (const [lineName, machines] of Object.entries(t.lines)) {
      const lineId = (await client.query(
        'INSERT INTO production_lines (tenant_id, name) VALUES ($1,$2) RETURNING id', [tenantId, lineName]
      )).rows[0].id;
      for (const m of machines) {
        machineIds.push((await client.query(
          'INSERT INTO machines (tenant_id, line_id, name) VALUES ($1,$2,$3) RETURNING id', [tenantId, lineId, m]
        )).rows[0].id);
      }
    }

    const reasonIds = [];
    for (const [name, category] of reasons) {
      reasonIds.push((await client.query(
        'INSERT INTO downtime_reasons (tenant_id, name, category) VALUES ($1,$2,$3) RETURNING id', [tenantId, name, category]
      )).rows[0].id);
    }

    // One closed event per machine per day for the last 14 days (never overlapping), with deterministic variation.
    let n = 0;
    for (const machineId of machineIds) {
      for (let day = 14; day >= 1; day--) {
        n++;
        const startMin = (n * 37) % 600;
        const durMin = 10 + ((n * 53) % 110);
        await client.query(
          `INSERT INTO downtime_events (tenant_id, machine_id, reason_id, started_at, ended_at, note, created_by)
           VALUES ($1,$2,$3,
                   now() - make_interval(days => $5) + make_interval(mins => $6),
                   now() - make_interval(days => $5) + make_interval(mins => $6 + $7),
                   'Seeded event', $4)`,
          [tenantId, machineId, reasonIds[n % reasonIds.length], n % 2 ? users.operator : users.operator2, day, startMin, durMin]
        );
      }
    }
    // One machine is down right now.
    await client.query(
      `INSERT INTO downtime_events (tenant_id, machine_id, reason_id, started_at, note, created_by)
       VALUES ($1,$2,$3, now() - interval '25 minutes', 'Currently down', $4)`,
      [tenantId, machineIds[2], reasonIds[3], users.operator]
    );
  }
  await client.query('COMMIT');
  console.log(`Seeded ${tenants.length} tenants. All users share password: ${PASSWORD}`);
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
  await pool.end();
}
