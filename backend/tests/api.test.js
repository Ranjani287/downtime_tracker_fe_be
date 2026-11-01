// Integration tests. Require a migrated + seeded database (`npm run setup`) and DATABASE_URL/JWT_SECRET in .env.
process.env.NODE_ENV = 'test';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

const { app } = await import('../src/app.js');
const { pool } = await import('../src/db.js');

const PASSWORD = 'Password123!';
const api = request(app);
const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

const tokens = {};
const createdOrgIds = [];

async function loginWithCookie(email, password = PASSWORD) {
  const res = await api.post('/api/auth/login').send({ email, password });
  assert.equal(res.status, 200, `login failed for ${email}`);
  const header = res.headers['set-cookie'].find((c) => c.startsWith('refresh_token='));
  return { token: res.body.token, header, cookie: header.split(';')[0] };
}
const login = async (email, password) => (await loginWithCookie(email, password)).token;
const refresh = (cookie) => api.post('/api/auth/refresh').set(XHR).set('Cookie', cookie ?? '');
const cookieOf = (res) => res.headers['set-cookie'].find((c) => c.startsWith('refresh_token=')).split(';')[0];

// A brand-new organisation (empty workspace) created through the super admin, removed again after the run.
async function newOrg(label) {
  const stamp = `${label}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `admin.${stamp}@test.com`;
  const res = await api.post('/api/platform/organisations').set(auth(tokens.super))
    .send({ name: `Org ${stamp}`, admin: { name: 'Org Admin', email, password: 'Sup3rSecret!' } });
  assert.equal(res.status, 201);
  createdOrgIds.push(res.body.id);
  const admin = auth(await login(email, 'Sup3rSecret!'));
  return { id: res.body.id, email, admin };
}

before(async () => {
  tokens.super = await login('superadmin@platform.com');
  tokens.acmeAdmin = await login('admin@acme.com');
  tokens.acmeOp = await login('operator@acme.com');
  tokens.globexAdmin = await login('admin@globex.com');
});
after(async () => {
  if (createdOrgIds.length) await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [createdOrgIds]);
  await pool.end();
});

// ------------------------------------------------------------------ authentication

test('rejects bad credentials and missing/invalid tokens', async () => {
  assert.equal((await api.post('/api/auth/login').send({ email: 'admin@acme.com', password: 'nope' })).status, 401);
  assert.equal((await api.post('/api/auth/login').send({ email: 'not-an-email' })).status, 400);
  assert.equal((await api.get('/api/lines')).status, 401);
  assert.equal((await api.get('/api/lines').set({ Authorization: 'Bearer garbage' })).status, 401);
});

test('passwords are stored hashed', async () => {
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE email = 'admin@acme.com'");
  assert.match(rows[0].password_hash, /^\$2[aby]\$/);
});

test('logout revokes the access token and the refresh token', async () => {
  const { token, cookie } = await loginWithCookie('operator@acme.com');
  assert.equal((await api.get('/api/auth/me').set(auth(token))).status, 200);
  assert.equal((await api.post('/api/auth/logout').set(auth(token)).set(XHR).set('Cookie', cookie)).status, 200);
  const after = await api.get('/api/auth/me').set(auth(token));
  assert.equal(after.status, 401);
  assert.match(after.body.error, /revoked/i);
  assert.equal((await refresh(cookie)).status, 401);
  assert.equal((await api.post('/api/auth/logout').set('Cookie', cookie)).status, 403); // CSRF header required
});

test('login sets a hardened httpOnly refresh cookie', async () => {
  const { header } = await loginWithCookie('operator@acme.com');
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Strict/i);
  assert.match(header, /Path=\/api\/auth/i);
});

test('refresh rotates the token; missing cookie / CSRF header are rejected', async () => {
  const first = await loginWithCookie('operator@acme.com');
  const res = await refresh(first.cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'operator@acme.com');
  const rotated = cookieOf(res);
  assert.notEqual(rotated, first.cookie);
  assert.equal((await api.get('/api/auth/me').set(auth(res.body.token))).status, 200);
  assert.equal((await refresh(rotated)).status, 200);

  assert.equal((await refresh('')).status, 401);
  assert.equal((await refresh('refresh_token=garbage')).status, 401);
  assert.equal((await api.post('/api/auth/refresh').set('Cookie', first.cookie)).status, 403);
});

test('refresh: reusing an old token revokes the whole session family', async () => {
  const first = await loginWithCookie('operator2@acme.com');
  const second = await refresh(first.cookie);
  const newCookie = cookieOf(second);
  assert.equal((await refresh(first.cookie)).status, 409); // inside the grace window: benign race
  await pool.query("UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute' WHERE revoked_at IS NOT NULL AND replaced_by IS NOT NULL");
  assert.equal((await refresh(first.cookie)).status, 401); // theft detected
  assert.equal((await refresh(newCookie)).status, 401);    // legitimate newest token is dead too
});

// ------------------------------------------------------------------ authorization

test('roles: operators are read-only on plant structure and cannot see reports', async () => {
  const op = auth(tokens.acmeOp);
  assert.equal((await api.get('/api/lines').set(op)).status, 200);
  assert.equal((await api.get('/api/machines').set(op)).status, 200);
  assert.equal((await api.get('/api/reasons').set(op)).status, 200);
  assert.equal((await api.post('/api/lines').set(op).send({ name: 'Nope' })).status, 403);
  assert.equal((await api.post('/api/machines').set(op).send({ line_id: 1, name: 'Nope' })).status, 403);
  assert.equal((await api.post('/api/reasons').set(op).send({ name: 'Nope', category: 'X' })).status, 403);
  assert.equal((await api.get('/api/reports/summary').set(op)).status, 403);
  assert.equal((await api.get('/api/users').set(op)).status, 403);
  assert.equal((await api.delete('/api/downtime/1').set(op)).status, 403);
  assert.equal((await api.get('/api/reports/summary').set(auth(tokens.acmeAdmin))).status, 200);
});

test('super admin has no access to organisation data; org roles have no access to platform', async () => {
  const sa = auth(tokens.super);
  assert.equal((await api.get('/api/downtime').set(sa)).status, 403);
  assert.equal((await api.get('/api/lines').set(sa)).status, 403);
  assert.equal((await api.get('/api/platform/organisations').set(auth(tokens.acmeAdmin))).status, 403);
  assert.equal((await api.get('/api/platform/organisations').set(auth(tokens.acmeOp))).status, 403);
  const orgs = await api.get('/api/platform/organisations').set(sa);
  assert.equal(orgs.status, 200);
  assert.ok(orgs.body.data.length >= 2);
});

// ------------------------------------------------------------------ tenant isolation

test('tenant isolation: lists only contain the caller\'s own data', async () => {
  for (const [path, expected] of [['lines', 'Line 1 - Body Welding'], ['machines', 'Packing Machine'], ['reasons', 'Changeover']]) {
    const acme = (await api.get(`/api/${path}`).set(auth(tokens.acmeAdmin))).body.data.map((r) => r.name);
    const globex = (await api.get(`/api/${path}`).set(auth(tokens.globexAdmin))).body.data.map((r) => r.name);
    if (path !== 'reasons') {
      assert.ok(acme.length > 0 && globex.length > 0);
      assert.ok(acme.every((n) => !globex.includes(n)), `${path} leaked between tenants`);
    }
    assert.ok(acme.includes(expected) || path === 'reasons');
  }
  const acmeEvents = (await api.get('/api/downtime?limit=100').set(auth(tokens.acmeAdmin))).body.data;
  const globexEvents = (await api.get('/api/downtime?limit=100').set(auth(tokens.globexAdmin))).body.data;
  assert.ok(acmeEvents.length > 0 && globexEvents.length > 0);
  const globexIds = new Set(globexEvents.map((e) => e.id));
  assert.ok(acmeEvents.every((e) => !globexIds.has(e.id)));
});

test('tenant isolation: guessing another tenant\'s IDs reads or changes nothing', async () => {
  const acme = auth(tokens.acmeAdmin);
  const globexEvent = (await api.get('/api/downtime?limit=1').set(auth(tokens.globexAdmin))).body.data[0];
  const globexOpen = (await api.get('/api/downtime?status=open').set(auth(tokens.globexAdmin))).body.data[0];
  const globexLine = (await api.get('/api/lines').set(auth(tokens.globexAdmin))).body.data[0];
  const globexMachine = (await api.get('/api/machines').set(auth(tokens.globexAdmin))).body.data[0];
  const globexReason = (await api.get('/api/reasons').set(auth(tokens.globexAdmin))).body.data[0];
  const acmeMachine = (await api.get('/api/machines').set(acme)).body.data[0];
  const acmeReason = (await api.get('/api/reasons').set(acme)).body.data[0];

  // reads / writes by id -> 404
  assert.equal((await api.get(`/api/downtime/${globexEvent.id}`).set(acme)).status, 404);
  assert.equal((await api.put(`/api/downtime/${globexEvent.id}`).set(acme).send({ note: 'hacked' })).status, 404);
  assert.equal((await api.delete(`/api/downtime/${globexEvent.id}`).set(acme)).status, 404);
  assert.equal((await api.patch(`/api/downtime/${globexOpen.id}/close`).set(acme).send({})).status, 404);
  assert.equal((await api.patch(`/api/lines/${globexLine.id}`).set(acme).send({ name: 'hacked' })).status, 404);
  assert.equal((await api.patch(`/api/machines/${globexMachine.id}`).set(acme).send({ name: 'hacked' })).status, 404);
  assert.equal((await api.delete(`/api/reasons/${globexReason.id}`).set(acme)).status, 404);

  // referencing another tenant's records in a body -> 400
  assert.equal((await api.post('/api/downtime').set(acme).send({ machine_id: globexMachine.id, reason_id: acmeReason.id })).status, 400);
  assert.equal((await api.post('/api/downtime').set(acme).send({ machine_id: acmeMachine.id, reason_id: globexReason.id })).status, 400);
  assert.equal((await api.post('/api/machines').set(acme).send({ line_id: globexLine.id, name: 'Sneaky' })).status, 400);

  // filters on foreign ids simply match nothing
  const filtered = await api.get(`/api/downtime?machine_id=${globexMachine.id}`).set(acme);
  assert.equal(filtered.body.total, 0);

  // and nothing was changed
  const still = await api.get(`/api/downtime/${globexEvent.id}`).set(auth(tokens.globexAdmin));
  assert.notEqual(still.body.note, 'hacked');
});

// ------------------------------------------------------------------ plant structure CRUD

test('lines / machines / reasons CRUD with uniqueness and referential rules', async () => {
  const { admin } = await newOrg('crud');
  const line = await api.post('/api/lines').set(admin).send({ name: 'Line A' });
  assert.equal(line.status, 201);
  assert.equal((await api.post('/api/lines').set(admin).send({ name: 'Line A' })).status, 409); // unique per tenant
  assert.equal((await api.post('/api/lines').set(admin).send({ name: '' })).status, 400);

  const machine = await api.post('/api/machines').set(admin).send({ line_id: line.body.id, name: 'M1' });
  assert.equal(machine.status, 201);
  assert.equal(machine.body.line_name, 'Line A');
  assert.equal((await api.post('/api/machines').set(admin).send({ line_id: line.body.id, name: 'M1' })).status, 409);
  assert.equal((await api.delete(`/api/lines/${line.body.id}`).set(admin)).status, 409); // still has machines

  const reason = await api.post('/api/reasons').set(admin).send({ name: 'Breakdown', category: 'Breakdown' });
  assert.equal(reason.status, 201);
  const ev = await api.post('/api/downtime').set(admin).send({ machine_id: machine.body.id, reason_id: reason.body.id });
  assert.equal(ev.status, 201);
  assert.equal((await api.delete(`/api/machines/${machine.body.id}`).set(admin)).status, 409); // has history
  assert.equal((await api.delete(`/api/reasons/${reason.body.id}`).set(admin)).status, 409);

  // deactivated machines can't take new events
  assert.equal((await api.patch(`/api/downtime/${ev.body.id}/close`).set(admin).send({})).status, 200);
  assert.equal((await api.patch(`/api/machines/${machine.body.id}`).set(admin).send({ active: false })).status, 200);
  assert.equal((await api.post('/api/downtime').set(admin).send({ machine_id: machine.body.id, reason_id: reason.body.id })).status, 400);
});

// ------------------------------------------------------------------ downtime events

test('events: start, no second open event per machine, close, no double close', async () => {
  const { admin } = await newOrg('life');
  const line = (await api.post('/api/lines').set(admin).send({ name: 'L' })).body;
  const m1 = (await api.post('/api/machines').set(admin).send({ line_id: line.id, name: 'M1' })).body;
  const m2 = (await api.post('/api/machines').set(admin).send({ line_id: line.id, name: 'M2' })).body;
  const reason = (await api.post('/api/reasons').set(admin).send({ name: 'Jam', category: 'Breakdown' })).body;

  const start = await api.post('/api/downtime').set(admin).send({ machine_id: m1.id, reason_id: reason.id, note: 'belt jammed' });
  assert.equal(start.status, 201);
  assert.equal(start.body.ended_at, null);
  assert.equal(start.body.note, 'belt jammed');

  const second = await api.post('/api/downtime').set(admin).send({ machine_id: m1.id, reason_id: reason.id });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /open downtime/i);
  // a different machine is unaffected
  assert.equal((await api.post('/api/downtime').set(admin).send({ machine_id: m2.id, reason_id: reason.id })).status, 201);

  const closed = await api.patch(`/api/downtime/${start.body.id}/close`).set(admin).send({});
  assert.equal(closed.status, 200);
  assert.ok(closed.body.ended_at);
  assert.equal((await api.patch(`/api/downtime/${start.body.id}/close`).set(admin).send({})).status, 409);
  // once closed, the machine can be stopped again
  assert.equal((await api.post('/api/downtime').set(admin).send({ machine_id: m1.id, reason_id: reason.id })).status, 201);
});

test('events: concurrent starts for one machine -> exactly one succeeds', async () => {
  const { admin } = await newOrg('race');
  const line = (await api.post('/api/lines').set(admin).send({ name: 'L' })).body;
  const m = (await api.post('/api/machines').set(admin).send({ line_id: line.id, name: 'M' })).body;
  const reason = (await api.post('/api/reasons').set(admin).send({ name: 'R', category: 'Other' })).body;
  const results = await Promise.all(Array.from({ length: 5 }, () =>
    api.post('/api/downtime').set(admin).send({ machine_id: m.id, reason_id: reason.id })));
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409, 409]);
});

test('events: overlapping closed events and bad times are rejected', async () => {
  const { admin } = await newOrg('val');
  const line = (await api.post('/api/lines').set(admin).send({ name: 'L' })).body;
  const m = (await api.post('/api/machines').set(admin).send({ line_id: line.id, name: 'M' })).body;
  const reason = (await api.post('/api/reasons').set(admin).send({ name: 'R', category: 'Other' })).body;
  const base = { machine_id: m.id, reason_id: reason.id };

  assert.equal((await api.post('/api/downtime').set(admin).send({ ...base, started_at: minutesAgo(120), ended_at: minutesAgo(60) })).status, 201);
  const overlap = await api.post('/api/downtime').set(admin).send({ ...base, started_at: minutesAgo(90), ended_at: minutesAgo(30) });
  assert.equal(overlap.status, 409);
  const reversed = await api.post('/api/downtime').set(admin).send({ ...base, started_at: minutesAgo(10), ended_at: minutesAgo(20) });
  assert.equal(reversed.status, 400);
  const future = await api.post('/api/downtime').set(admin).send({ ...base, started_at: new Date(Date.now() + 3_600_000).toISOString() });
  assert.equal(future.status, 400);
  assert.equal((await api.post('/api/downtime').set(admin).send({ machine_id: 'abc', reason_id: reason.id })).status, 400);
  assert.equal((await api.post('/api/downtime').set(admin).send({ ...base, note: 'x'.repeat(1001) })).status, 400);

  // closing before the start time is rejected
  const open = await api.post('/api/downtime').set(admin).send({ ...base, started_at: minutesAgo(10) });
  assert.equal(open.status, 201);
  const badClose = await api.patch(`/api/downtime/${open.body.id}/close`).set(admin).send({ ended_at: minutesAgo(20) });
  assert.equal(badClose.status, 400);
});

test('events: list pagination and filters (line, machine, reason, status, date range)', async () => {
  const { admin } = await newOrg('list');
  const l1 = (await api.post('/api/lines').set(admin).send({ name: 'L1' })).body;
  const l2 = (await api.post('/api/lines').set(admin).send({ name: 'L2' })).body;
  const m1 = (await api.post('/api/machines').set(admin).send({ line_id: l1.id, name: 'M1' })).body;
  const m2 = (await api.post('/api/machines').set(admin).send({ line_id: l2.id, name: 'M2' })).body;
  const r1 = (await api.post('/api/reasons').set(admin).send({ name: 'R1', category: 'Breakdown' })).body;
  const r2 = (await api.post('/api/reasons').set(admin).send({ name: 'R2', category: 'Material' })).body;
  const mk = (machine, reason, from, to) => api.post('/api/downtime').set(admin)
    .send({ machine_id: machine.id, reason_id: reason.id, started_at: minutesAgo(from), ...(to != null && { ended_at: minutesAgo(to) }) });

  // m1: 3 closed events (R1), m2: 1 closed (R2) + 1 open (R1)
  for (const [f, t] of [[300, 280], [200, 180], [100, 80]]) assert.equal((await mk(m1, r1, f, t)).status, 201);
  assert.equal((await mk(m2, r2, 150, 140)).status, 201);
  assert.equal((await mk(m2, r1, 30)).status, 201);

  const get = (qs) => api.get(`/api/downtime?${qs}`).set(admin);
  assert.equal((await get('')).body.total, 5);
  const page1 = (await get('limit=2&page=1')).body;
  const page3 = (await get('limit=2&page=3')).body;
  assert.equal(page1.data.length, 2);
  assert.equal(page3.data.length, 1);
  assert.equal(page1.total, 5);
  assert.ok(new Date(page1.data[0].started_at) >= new Date(page1.data[1].started_at)); // newest first

  assert.equal((await get(`machine_id=${m1.id}`)).body.total, 3);
  assert.equal((await get(`line_id=${l2.id}`)).body.total, 2);
  assert.equal((await get(`reason_id=${r1.id}`)).body.total, 4);
  assert.equal((await get('status=open')).body.total, 1);
  assert.equal((await get('status=closed')).body.total, 4);
  assert.equal((await get(`line_id=${l2.id}&status=open&reason_id=${r1.id}`)).body.total, 1);
  assert.equal((await get(`from=${encodeURIComponent(minutesAgo(170))}&to=${encodeURIComponent(minutesAgo(60))}`)).body.total, 2);
  assert.equal((await get('limit=1000')).status, 400);
  assert.equal((await get('status=weird')).status, 400);
  assert.equal((await get(`from=${encodeURIComponent(minutesAgo(10))}&to=${encodeURIComponent(minutesAgo(50))}`)).status, 400);
});

// ------------------------------------------------------------------ summary (SQL aggregates)

test('summary: totals by line and by reason are computed correctly, clipped to the date range', async () => {
  const { admin } = await newOrg('sum');
  const l1 = (await api.post('/api/lines').set(admin).send({ name: 'L1' })).body;
  const l2 = (await api.post('/api/lines').set(admin).send({ name: 'L2' })).body;
  const m1 = (await api.post('/api/machines').set(admin).send({ line_id: l1.id, name: 'M1' })).body;
  const m1b = (await api.post('/api/machines').set(admin).send({ line_id: l1.id, name: 'M1b' })).body;
  const m2 = (await api.post('/api/machines').set(admin).send({ line_id: l2.id, name: 'M2' })).body;
  const ra = (await api.post('/api/reasons').set(admin).send({ name: 'A', category: 'Breakdown' })).body;
  const rb = (await api.post('/api/reasons').set(admin).send({ name: 'B', category: 'Material' })).body;
  const mk = (machine, reason, from, to) => api.post('/api/downtime').set(admin)
    .send({ machine_id: machine.id, reason_id: reason.id, started_at: minutesAgo(from), ended_at: minutesAgo(to) });

  assert.equal((await mk(m1, ra, 180, 120)).status, 201);  // 60 min, starts before the range
  assert.equal((await mk(m1b, rb, 100, 70)).status, 201);  // 30 min
  assert.equal((await mk(m2, rb, 60, 40)).status, 201);    // 20 min
  assert.equal((await mk(m2, ra, 500, 400)).status, 201);  // entirely outside the range

  const from = encodeURIComponent(minutesAgo(150));
  const to = encodeURIComponent(minutesAgo(0));
  const res = await api.get(`/api/reports/summary?from=${from}&to=${to}`).set(admin);
  assert.equal(res.status, 200);

  // event 1 is clipped to the 30 minutes inside the range; the 500-400 event is excluded
  assert.equal(res.body.totals.total_minutes, 80);
  assert.equal(res.body.totals.events, 3);
  assert.equal(res.body.totals.open_events, 0);
  const byLine = Object.fromEntries(res.body.by_line.map((r) => [r.line_name, r.total_minutes]));
  assert.deepEqual(byLine, { L1: 60, L2: 20 });
  const byReason = Object.fromEntries(res.body.by_reason.map((r) => [r.reason_name, r.total_minutes]));
  assert.deepEqual(byReason, { A: 30, B: 50 });
  assert.equal(res.body.by_line[0].line_name, 'L1'); // sorted by downtime, highest first

  // widening the range includes the old event, unclipped
  const wide = await api.get(`/api/reports/summary?from=${encodeURIComponent(minutesAgo(600))}&to=${to}`).set(admin);
  assert.equal(wide.body.totals.total_minutes, 60 + 30 + 20 + 100);

  assert.equal((await api.get(`/api/reports/summary?from=${to}&to=${from}`).set(admin)).status, 400);
  assert.equal((await api.get('/api/reports/summary?from=garbage').set(admin)).status, 400);
  assert.equal((await api.get('/api/reports/summary').set(admin)).status, 200); // defaults to the last 7 days
});

test('summary only counts the caller\'s tenant', async () => {
  const { admin } = await newOrg('empty');
  const res = await api.get('/api/reports/summary').set(admin);
  assert.equal(res.body.totals.total_minutes, 0);
  assert.deepEqual(res.body.by_line, []);
  const acme = await api.get('/api/reports/summary').set(auth(tokens.acmeAdmin));
  assert.ok(acme.body.totals.total_minutes > 0);
});

// ------------------------------------------------------------------ onboarding (super admin) & user management

test('super admin onboards an organisation; its admin manages users; suspension locks everyone out', async () => {
  const sa = auth(tokens.super);
  const stamp = Date.now();
  const email = `boss${stamp}@newco.com`;
  const created = await api.post('/api/platform/organisations').set(sa)
    .send({ name: `NewCo ${stamp}`, admin: { name: 'New Boss', email, password: 'Sup3rSecret!' } });
  assert.equal(created.status, 201);
  createdOrgIds.push(created.body.id);
  assert.equal(created.body.admin.role, 'admin');

  const dup = await api.post('/api/platform/organisations').set(sa)
    .send({ name: `Other ${stamp}`, admin: { name: 'X', email, password: 'Sup3rSecret!' } });
  assert.equal(dup.status, 409);
  const weak = await api.post('/api/platform/organisations').set(sa)
    .send({ name: `Weak ${stamp}`, admin: { name: 'X', email: `w${stamp}@x.com`, password: 'short' } });
  assert.equal(weak.status, 400);

  const admin = auth(await login(email, 'Sup3rSecret!'));
  assert.deepEqual((await api.get('/api/lines').set(admin)).body.data, []);

  const opEmail = `op${stamp}@newco.com`;
  assert.equal((await api.post('/api/users').set(admin).send({ name: 'Op', email: opEmail, password: 'OperatorPass1', role: 'operator' })).status, 201);
  assert.equal((await api.post('/api/users').set(admin).send({ name: 'Bad', email: `b${stamp}@newco.com`, password: 'OperatorPass1', role: 'supervisor' })).status, 400);
  const users = (await api.get('/api/users').set(admin)).body.data;
  assert.ok(users.length === 2 && users.every((u) => u.email.endsWith('@newco.com')));

  assert.equal((await api.patch(`/api/platform/organisations/${created.body.id}`).set(sa).send({ active: false })).status, 200);
  assert.equal((await api.get('/api/lines').set(admin)).status, 401);
  assert.equal((await api.post('/api/auth/login').send({ email, password: 'Sup3rSecret!' })).status, 401);
});

test('deactivating a user ends their session and blocks refresh; admins cannot lock themselves out', async () => {
  const { admin, email } = await newOrg('deact');
  const op = await api.post('/api/users').set(admin)
    .send({ name: 'Temp', email: `temp${Date.now()}@test.com`, password: 'TempPass123', role: 'operator' });
  assert.equal(op.status, 201);
  const { cookie } = await loginWithCookie(op.body.email, 'TempPass123');
  assert.equal((await api.patch(`/api/users/${op.body.id}`).set(admin).send({ active: false })).status, 200);
  assert.equal((await refresh(cookie)).status, 401);

  const me = (await api.get('/api/auth/me').set(admin)).body.user;
  assert.equal(me.email, email);
  assert.equal((await api.patch(`/api/users/${me.id}`).set(admin).send({ active: false })).status, 400);
  assert.equal((await api.patch(`/api/users/${me.id}`).set(admin).send({ role: 'operator' })).status, 400);
});
