import bcrypt from 'bcryptjs';
import './useDirectConnection.js'; // must stay the first import
import { databaseHost, isLocalDatabase } from '../src/config.js';
import { sequelize } from '../src/db.js';
import { DowntimeEvent, DowntimeReason, Machine, ProductionLine, RevokedToken, Tenant, User } from '../src/models/index.js';

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

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// `--if-empty` (used by docker-compose) makes the seed a no-op when data already exists, so restarts keep your data.
const ifEmpty = process.argv.includes('--if-empty');
if (ifEmpty && (await Tenant.count())) {
  console.log('Database already has data, skipping seed.');
  await sequelize.close();
  process.exit(0);
}

// A full reseed truncates tenants/users, so never do it to a remote database by accident.
// (With --if-empty we only get here when the database is empty, so there is nothing to wipe.)
if (!ifEmpty && !isLocalDatabase && process.env.ALLOW_REMOTE_RESET !== 'true') {
  throw new Error(`Refusing to wipe and reseed a remote database (${databaseHost}). Use --if-empty to seed only an empty database, or set ALLOW_REMOTE_RESET=true.`);
}

await sequelize.transaction(async (transaction) => {
  // Idempotent reseed: wipe and recreate demo data (CASCADE clears everything that references these tables).
  for (const Model of [Tenant, User, RevokedToken]) await Model.truncate({ cascade: true, restartIdentity: true, transaction });

  // Platform super admin: belongs to no organisation (tenant_id NULL).
  await User.create(
    { tenant_id: null, email: 'superadmin@platform.com', name: 'Platform Super Admin', role: 'super_admin', password_hash: hash },
    { transaction },
  );

  for (const t of tenants) {
    const tenant = await Tenant.create({ name: t.name }, { transaction });
    const owned = { tenant_id: tenant.id };

    const users = {};
    for (const [key, role] of [['admin', 'admin'], ['operator', 'operator'], ['operator2', 'operator']]) {
      users[key] = await User.create(
        { ...owned, email: `${key}@${t.slug}.com`, name: `${t.name.split(' ')[0]} ${key}`, role, password_hash: hash },
        { transaction },
      );
    }

    const machines = [];
    for (const [lineName, machineNames] of Object.entries(t.lines)) {
      const line = await ProductionLine.create({ ...owned, name: lineName }, { transaction });
      for (const name of machineNames) machines.push(await Machine.create({ ...owned, line_id: line.id, name }, { transaction }));
    }

    const reasonRows = await DowntimeReason.bulkCreate(
      reasons.map(([name, category]) => ({ ...owned, name, category })),
      { transaction },
    );

    // One closed event per machine per day for the last 14 days (never overlapping), with deterministic variation.
    const now = Date.now();
    const events = [];
    let n = 0;
    for (const machine of machines) {
      for (let day = 14; day >= 1; day--) {
        n++;
        const start = now - day * DAY + ((n * 37) % 600) * MINUTE;
        const durationMin = 10 + ((n * 53) % 110);
        events.push({
          ...owned,
          machine_id: machine.id,
          reason_id: reasonRows[n % reasonRows.length].id,
          started_at: new Date(start),
          ended_at: new Date(start + durationMin * MINUTE),
          note: 'Seeded event',
          created_by: (n % 2 ? users.operator : users.operator2).id,
        });
      }
    }
    // One machine is down right now.
    events.push({
      ...owned,
      machine_id: machines[2].id,
      reason_id: reasonRows[3].id,
      started_at: new Date(now - 25 * MINUTE),
      note: 'Currently down',
      created_by: users.operator.id,
    });
    await DowntimeEvent.bulkCreate(events, { transaction });
  }
});

console.log(`Seeded ${tenants.length} tenants. All users share password: ${PASSWORD}`);
await sequelize.close();
