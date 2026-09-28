// Isolated route tests: no server socket, credentials, or real database is used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const safety = require('./safety');

function harness(steps = []) {
  const routes = new Map();
  const calls = [];
  const notifications = [];
  let queryAssertion;
  const db = {
    async query(sql, params) {
      const text = sql.replace(/\s+/g, ' ').trim();
      calls.push({ text, params });
      if ((['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text) || text.includes('pg_advisory_xact_lock')) && !steps[0]?.transaction) return { rows: [] };
      const step = steps.shift();
      try {
        assert.ok(step, `Unexpected query: ${text}`);
        assert.match(text, step.match);
        if (step.params) assert.deepEqual(Array.from(params), step.params);
        step.inspect?.(text, params);
      } catch (error) {
        queryAssertion = error;
        throw error;
      }
      if (step.error) throw step.error;
      return { rows: step.rows || [] };
    },
    async connect() { return db; },
    release() { calls.push({ text: 'RELEASE' }); },
  };
  const app = { use() {}, listen() {} };
  for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
    app[method] = (route, ...handlers) => routes.set(`${method} ${route}`, handlers);
  }
  const express = () => app;
  express.json = () => () => {};
  const modules = {
    dotenv: { config() {} }, express, cors: () => () => {}, './db': db, './safety': safety,
    './admin': require('./admin'),
    './notifications': { notificationService: () => ({ createNotification: (...args) => notifications.push(args), registerRoutes() {} }) },
    bcryptjs: {}, jsonwebtoken: { verify(token) { if (token !== 'valid') throw Error(); return { id: '1' }; } },
    './google-auth': { createGoogleAuthHandler: () => () => {} },
    './profile-photos': { registerPhotoRoutes() {} }, resend: { Resend: class {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'), {
    require(name) { assert.ok(name in modules, name); return modules[name]; },
    process: { env: { JWT_SECRET: 'test-only' } }, console: { log() {}, error() {} },
  });
  return {
    calls, notifications, routes,
    async request(method, route, { params = {}, body = {}, query = {}, authenticated = true } = {}) {
      const req = { params, body, query, headers: authenticated ? { authorization: 'Bearer valid' } : {} };
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
      const handlers = routes.get(`${method} ${route}`);
      assert.ok(handlers, route);
      for (const handler of handlers) {
        let allowed = false;
        await handler(req, res, () => { allowed = true; });
        if (!allowed) break;
      }
      assert.equal(steps.length, 0, 'All expected queries must run');
      // Query assertions inside route catch blocks must never be mistaken for a successful test.
      if (queryAssertion) throw queryAssertion;
      return res;
    },
  };
}

const userTarget = { match: /SELECT id FROM users/, rows: [{ id: '2' }] };
const jobTarget = { match: /SELECT id, posted_by_id FROM jobs/, rows: [{ id: '9', posted_by_id: '2' }] };
const relation = blocked => ({ match: /SELECT EXISTS .*blocker_id = \$1 AND blocked_user_id = \$2.*blocker_id = \$2 AND blocked_user_id = \$1/, rows: [{ blocked }] });
const application = status => ({ match: /FROM applications/, rows: [{ id: '8', applicant_id: '1', posted_by_id: '2', status }] });

test('own profile returns the database admin flag using only authenticated identity', async () => {
  for (const is_admin of [true, false]) {
    const h = harness([{
      match: /^SELECT id, name, email, phone, location, skills, profile_picture_url, is_admin FROM users WHERE id = \$1$/,
      params: ['1'], rows: [{ id: '1', name: 'Member', is_admin }],
    }]);
    const result = await h.request('get', '/api/profile', { query: { userId: '24' } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.data.is_admin, is_admin);
  }
});

test('own profile rejects anonymous users', async () => {
  const h = harness();
  assert.equal((await h.request('get', '/api/profile', { authenticated: false })).statusCode, 401);
  assert.equal(h.calls.length, 0);
});

test('public profiles neither select nor expose admin status', async () => {
  const h = harness([
    { match: /FROM users WHERE id = \$1/, params: ['2'], inspect(sql) { assert.doesNotMatch(sql, /is_admin/); }, rows: [{ id: '2', name: 'Member', is_admin: true }] },
    relation(false), { match: /SELECT 1 FROM user_blocks/, rows: [] },
  ]);
  const result = await h.request('get', '/api/users/:id/profile', { params: { id: '2' } });
  assert.equal(result.statusCode, 200);
  assert.equal(Object.hasOwn(result.data, 'is_admin'), false);
});

test('every safety route rejects unauthenticated requests', async () => {
  for (const [method, route] of [['post', '/api/reports/users/:targetId'], ['post', '/api/reports/jobs/:targetId'], ['get', '/api/blocks'], ['post', '/api/blocks/:userId'], ['delete', '/api/blocks/:userId']]) {
    const h = harness();
    assert.equal((await h.request(method, route, { authenticated: false })).statusCode, 401);
    assert.equal(h.calls.length, 0);
  }
});

const adminCheck = rows => ({ match: /^SELECT is_admin FROM users WHERE id = \$1$/, params: ['1'], rows });
const adminRoute = '/api/admin/reports';
const statusRoute = `${adminRoute}/:reportId/status`;
const removeRoute = `${adminRoute}/:reportId/remove-job`;
const asAdmin = () => adminCheck([{ is_admin: true }]);
const lockedReport = rows => ({ match: /^SELECT id, report_type, reported_job_id FROM reports WHERE id = \$1 FOR UPDATE$/, params: ['10'], rows });
const jobReport = () => lockedReport([{ id: '10', report_type: 'job', reported_job_id: '9' }]);
const lockedJob = (moderation_status = 'active') => ({ match: /^SELECT id, moderation_status FROM jobs WHERE id = \$1 FOR UPDATE$/, params: ['9'], rows: [{ id: '9', moderation_status }] });
const removeJob = () => ({ match: /^UPDATE jobs SET moderation_status = 'removed' WHERE id = \$1$/, params: ['9'] });
const actionReport = () => ({ match: /^UPDATE reports SET status = 'actioned' WHERE id = \$1$/, params: ['10'] });

test('admin mutations reject anonymous users and normal users before any write', async () => {
  for (const route of [statusRoute, removeRoute]) {
    const anonymous = harness();
    assert.equal((await anonymous.request('patch', route, { authenticated: false })).statusCode, 401);
    assert.equal(anonymous.calls.length, 0);
    const normal = harness([adminCheck([{ is_admin: false }])]);
    assert.equal((await normal.request('patch', route, { params: { reportId: '10' }, body: { status: 'reviewed', is_admin: true, userId: '24' } })).statusCode, 403);
    assert.equal(normal.calls.length, 1);
  }
});

for (const status of ['reviewed', 'dismissed']) {
  test(`admin can mark a report ${status} with an atomic transition guard`, async () => {
    const h = harness([asAdmin(), {
      match: /^UPDATE reports SET status = \$1 WHERE id = \$2 AND \(status = 'pending' OR \(status = 'reviewed' AND \$1 = 'dismissed'\)\) RETURNING id, status$/,
      params: [status, '10'], rows: [{ id: '10', status }],
    }]);
    const result = await h.request('patch', statusRoute, { params: { reportId: '10' }, body: { status } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.data.reportStatus, status);
  });
}

test('report status rejects unsupported values including direct actioned requests', async () => {
  for (const status of ['pending', 'actioned', 'invalid', '', null, undefined, ['reviewed']]) {
    const h = harness([asAdmin()]);
    assert.equal((await h.request('patch', statusRoute, { params: { reportId: '10' }, body: { status } })).statusCode, 400);
    assert.equal(h.calls.length, 1);
  }
});

test('both admin mutations validate report IDs', async () => {
  for (const route of [statusRoute, removeRoute]) {
    for (const reportId of ['0', '-1', 'invalid', '9223372036854775808']) {
      assert.equal((await harness([asAdmin()]).request('patch', route, { params: { reportId }, body: { status: 'reviewed' } })).statusCode, 400);
    }
  }
});

test('status update distinguishes missing reports from forbidden transitions', async () => {
  for (const exists of [false, true]) {
    const h = harness([asAdmin(), { match: /UPDATE reports/, rows: [] }, { match: /^SELECT id FROM reports WHERE id = \$1$/, params: ['10'], rows: exists ? [{ id: '10' }] : [] }]);
    const result = await h.request('patch', statusRoute, { params: { reportId: '10' }, body: { status: 'dismissed' } });
    assert.equal(result.statusCode, exists ? 409 : 404);
    if (!exists) assert.equal(result.data.error, 'Report not found');
  }
});

test('removal rejects missing reports, user reports, null targets, and missing jobs', async () => {
  const cases = [
    { steps: [lockedReport([])], code: 404, error: 'Report not found' },
    { steps: [lockedReport([{ id: '10', report_type: 'user', reported_job_id: '9' }])], code: 400 },
    { steps: [lockedReport([{ id: '10', report_type: 'job', reported_job_id: null }])], code: 400 },
    { steps: [jobReport(), { ...lockedJob(), rows: [] }], code: 404 },
  ];
  for (const entry of cases) {
    const h = harness([asAdmin(), ...entry.steps]);
    const result = await h.request('patch', removeRoute, { params: { reportId: '10' } });
    assert.equal(result.statusCode, entry.code);
    if (entry.error) assert.equal(result.data.error, entry.error);
    assert.deepEqual(h.calls.slice(-2).map(c => c.text), ['ROLLBACK', 'RELEASE']);
    assert.ok(!h.calls.some(c => /^(UPDATE|DELETE|COMMIT)\b/.test(c.text)));
  }
});

for (const state of ['active', 'removed']) {
  test(`removal of ${state} job commits both statuses and preserves other records`, async () => {
    const h = harness([asAdmin(), jobReport(), lockedJob(state), removeJob(), actionReport()]);
    const result = await h.request('patch', removeRoute, { params: { reportId: '10' } });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.data, {
      message: state === 'removed' ? 'Work is already removed' : 'Work removed successfully',
      reportId: '10', jobId: '9', reportStatus: 'actioned', moderationStatus: 'removed',
    });
    assert.equal(h.calls[1].text, 'BEGIN');
    assert.deepEqual(h.calls.slice(-2).map(c => c.text), ['COMMIT', 'RELEASE']);
    assert.ok(!h.calls.some(c => /DELETE/.test(c.text)));
    assert.equal(h.notifications.length, 0);
  });
}

test('removal rolls back failures at every transaction stage and hides database errors', async () => {
  const stages = [jobReport(), lockedJob(), removeJob(), actionReport(), { match: /^COMMIT$/, transaction: true }];
  for (let i = 0; i < stages.length; i++) {
    const steps = stages.slice(0, i).concat({ ...stages[i], error: Error('private SQL detail') });
    const h = harness([asAdmin(), ...steps]);
    const result = await h.request('patch', removeRoute, { params: { reportId: '10' } });
    assert.equal(result.statusCode, 500);
    assert.equal(result.data.error, 'Could not remove work');
    assert.deepEqual(h.calls.slice(-2).map(c => c.text), ['ROLLBACK', 'RELEASE']);
  }
});

test('removed work cannot be applied to and creates no application or notification', async () => {
  const h = harness([{ match: /SELECT \* FROM jobs WHERE id = \$1 FOR UPDATE/, params: ['9'], rows: [{ id: '9', posted_by_id: '2', moderation_status: 'removed' }] }]);
  const result = await h.request('post', '/api/jobs/:id/apply', { params: { id: '9' } });
  assert.equal(result.statusCode, 403);
  assert.equal(result.data.message, 'This work is no longer available.');
  assert.ok(!h.calls.some(c => /INSERT/.test(c.text)));
  assert.deepEqual(h.calls.slice(-2).map(c => c.text), ['ROLLBACK', 'RELEASE']);
  assert.equal(h.notifications.length, 0);
});

test('public jobs exclude removed work and preserve existing availability filters', async () => {
  const h = harness([{
    match: /SELECT jobs.\* FROM jobs/,
    inspect(sql) {
      assert.match(sql, /jobs.moderation_status <> 'removed'/);
      assert.match(sql, /jobs.cancelled = FALSE/);
      assert.match(sql, /jobs.work_date >= CURRENT_DATE/);
      assert.match(sql, /NOT EXISTS .*applications.job_id = jobs.id AND applications.status IN \('accepted', 'completed'\)/);
    },
    rows: [],
  }]);
  const result = await h.request('get', '/api/jobs', { authenticated: false });
  assert.equal(result.statusCode, 200);
  assert.equal(result.data.length, 0);
});

test('public details hide removed work but continue to return active work', async () => {
  for (const moderation_status of ['removed', 'active']) {
    const h = harness([{ match: /SELECT \* FROM jobs WHERE id = \$1/, params: ['9'], rows: [{ id: '9', title: 'Work', moderation_status }] }]);
    const result = await h.request('get', '/api/jobs/:id', { authenticated: false, params: { id: '9' } });
    assert.equal(result.statusCode, moderation_status === 'removed' ? 404 : 200);
    if (moderation_status === 'removed') assert.equal(result.data.error, 'Work not available');
    else assert.equal(result.data.title, 'Work');
  }
});

test('My Posted Jobs preserves removed work history and moderation status', async () => {
  const h = harness([{
    match: /SELECT jobs.\*.*WHERE jobs.posted_by_id = \$1::text/,
    params: ['1'],
    inspect(sql) { assert.doesNotMatch(sql, /moderation_status/); },
    rows: [{ id: '9', moderation_status: 'removed' }],
  }]);
  const result = await h.request('get', '/api/my-jobs');
  assert.equal(result.statusCode, 200);
  assert.equal(result.data[0].moderation_status, 'removed');
});

test('admin reports reject anonymous requests before querying the database', async () => {
  const h = harness();
  assert.equal((await h.request('get', adminRoute, { authenticated: false })).statusCode, 401);
  assert.equal(h.calls.length, 0);
});

test('admin reports require a true database flag and an existing user', async () => {
  for (const rows of [[], [{ is_admin: false }], [{ is_admin: null }], [{ is_admin: 'true' }]]) {
    const h = harness([adminCheck(rows)]);
    const result = await h.request('get', adminRoute);
    assert.equal(result.statusCode, 403);
    assert.equal(result.data.error, 'Admin access required');
    assert.equal(h.calls.length, 1);
  }
});

test('admin reports accept admins, project safe fields, and handle missing targets', async () => {
  const base = { id: '10', reason: 'other', details: null, status: 'pending', created_at: '2026-09-28', reporter_id: '1', reporter_name: 'Reporter' };
  const h = harness([adminCheck([{ is_admin: true }]), {
    match: /FROM reports.*LEFT JOIN users reporter.*LEFT JOIN users reported_user.*LEFT JOIN jobs reported_job.*ORDER BY reports.created_at DESC/,
    params: [],
    rows: [
      { ...base, report_type: 'user', reported_user_id: '2', reported_user_name: 'Member', profile_picture_url: null, password: 'secret', email: 'private' },
      { ...base, id: '11', report_type: 'job', reported_job_id: '9', title: 'Work', category: 'Delivery', payment: 500, posted_by_id: '2', moderation_status: 'active' },
      { ...base, id: '12', report_type: 'user', reporter_id: null, reported_user_id: null },
      { ...base, id: '13', report_type: 'job', reported_job_id: null },
    ],
  }]);
  const result = await h.request('get', adminRoute);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.data[0], {
    id: '10', report_type: 'user', reason: 'other', details: null, status: 'pending', created_at: '2026-09-28',
    reporter: { id: '1', name: 'Reporter' },
    reported_user: { id: '2', name: 'Member', profile_picture_url: null }, reported_job: null,
  });
  assert.deepEqual(result.data[1].reported_job, { id: '9', title: 'Work', category: 'Delivery', payment: 500, posted_by_id: '2', moderation_status: 'active' });
  assert.equal(result.data[1].reported_user, null);
  assert.equal(result.data[2].reporter, null);
  assert.equal(result.data[2].reported_user, null);
  assert.equal(result.data[3].reported_job, null);
  assert.doesNotMatch(h.calls[1].text, /WHERE|SELECT \*|password|email|phone|google|token/i);
});

test('admin reports allow only the four supported status filters', async () => {
  for (const status of ['pending', 'reviewed', 'dismissed', 'actioned']) {
    const h = harness([adminCheck([{ is_admin: true }]), {
      match: /WHERE reports.status = \$1 ORDER BY reports.created_at DESC/, params: [status], rows: [],
    }]);
    const result = await h.request('get', adminRoute, { query: { status } });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.data, []);
  }
  for (const status of ['', 'invalid', 'PENDING', "pending' OR 1=1 --", ['pending'], { value: 'pending' }]) {
    const h = harness([adminCheck([{ is_admin: true }])]);
    assert.equal((await h.request('get', adminRoute, { query: { status } })).statusCode, 400);
    assert.equal(h.calls.length, 1);
  }
});

test('admin database errors fail closed without exposing database details', async () => {
  for (const steps of [
    [{ ...adminCheck([]), error: Error('private database detail') }],
    [adminCheck([{ is_admin: true }]), { match: /FROM reports/, error: Error('private database detail') }],
  ]) {
    const result = await harness(steps).request('get', adminRoute);
    assert.equal(result.statusCode, 500);
    assert.doesNotMatch(result.data.error, /private database/);
  }
});

test('requireAdmin ignores claimed roles and emails', async () => {
  const { createRequireAdmin } = require('./admin');
  let nextCalled = false;
  const requireAdmin = createRequireAdmin({ async query(sql, params) {
    assert.deepEqual(params, ['5']);
    return { rows: [{ is_admin: false }] };
  } });
  const res = { status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; } };
  await requireAdmin({ user: { id: '5', is_admin: true, role: 'admin', email: 'admin@example.test' } }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

for (const type of ['user', 'job']) {
  const route = `/api/reports/${type}s/:targetId`;
  const reason = type === 'user' ? 'harassment' : 'unsafe_work';
  const target = type === 'user' ? userTarget : jobTarget;
  test(`report ${type} uses authenticated identity and does not notify`, async () => {
    const h = harness([target, { match: /INSERT INTO reports.*ON CONFLICT DO NOTHING/, params: ['1', type, type === 'user' ? '2' : null, type === 'job' ? '2' : null, reason, 'Details'], rows: [{ id: '10' }] }]);
    const result = await h.request('post', route, { params: { targetId: '2' }, body: { reason, details: ' Details ', reporter_id: '999' } });
    assert.equal(result.statusCode, 201);
    assert.equal(h.notifications.length, 0);
  });
  test(`duplicate ${type} report is friendly`, async () => {
    const h = harness([target, { match: /INSERT INTO reports/, rows: [] }]);
    const result = await h.request('post', route, { params: { targetId: '2' }, body: { reason } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.data.alreadyReported, true);
    assert.match(result.data.message, /already reported/);
  });
  test(`cannot report own ${type}`, async () => {
    const h = harness([{ ...target, rows: [{ id: '1', posted_by_id: '1' }] }]);
    assert.equal((await h.request('post', route, { params: { targetId: '1' }, body: { reason } })).statusCode, 400);
  });
  test(`${type} report validates target, reason, details and missing records`, async () => {
    for (const [targetId, body] of [['invalid', { reason }], ['2', { reason: 'invalid' }], ['2', { reason, details: 'x'.repeat(501) }], ['2', { reason, details: {} }]]) {
      assert.equal((await harness().request('post', route, { params: { targetId }, body })).statusCode, 400);
    }
    assert.equal((await harness([{ ...target, rows: [] }]).request('post', route, { params: { targetId: '2' }, body: { reason } })).statusCode, 404);
  });
}

test('block is atomic, scoped to both directions and pending applications only', async () => {
  const h = harness([userTarget, { match: /INSERT INTO user_blocks.*ON CONFLICT DO NOTHING/, params: ['1', '2'], rows: [{ id: '1' }] }, {
    match: /UPDATE applications a SET status = 'rejected'/, params: ['1', '2'],
    inspect(sql) {
      assert.match(sql, /a.status = 'pending'/);
      assert.match(sql, /a.applicant_id = \$1::bigint AND j.posted_by_id = \$2::bigint::text/);
      assert.match(sql, /a.applicant_id = \$2::bigint AND j.posted_by_id = \$1::bigint::text/);
    },
  }]);
  const result = await h.request('post', '/api/blocks/:userId', { params: { userId: '2' }, body: { blocker_id: '999' } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(h.calls.slice(0, 2).map(call => call.text), ['BEGIN', 'SELECT pg_advisory_xact_lock(73190421)']);
  assert.deepEqual(h.calls.slice(-2).map(call => call.text), ['COMMIT', 'RELEASE']);
  assert.equal(h.notifications.length, 0);
});

test('duplicate block is graceful', async () => {
  const h = harness([userTarget, { match: /INSERT INTO user_blocks/ }, { match: /UPDATE applications/ }]);
  assert.match((await h.request('post', '/api/blocks/:userId', { params: { userId: '2' } })).data.message, /already blocked/);
});

test('failed pending rejection rolls back block and hides database error', async () => {
  const h = harness([userTarget, { match: /INSERT INTO user_blocks/, rows: [{ id: '1' }] }, { match: /UPDATE applications/, error: Error('private database detail') }]);
  const result = await h.request('post', '/api/blocks/:userId', { params: { userId: '2' } });
  assert.equal(result.statusCode, 500);
  assert.doesNotMatch(result.data.message, /private database/);
  assert.deepEqual(h.calls.slice(-2).map(call => call.text), ['ROLLBACK', 'RELEASE']);
});

test('self block and invalid/missing target are rejected', async () => {
  for (const userId of ['1', '-2', '9223372036854775808']) {
    assert.equal((await harness().request('post', '/api/blocks/:userId', { params: { userId } })).statusCode, 400);
  }
  assert.equal((await harness([{ ...userTarget, rows: [] }]).request('post', '/api/blocks/:userId', { params: { userId: '2' } })).statusCode, 404);
});

test('unblock deletes only caller-owned block and never restores applications', async () => {
  const h = harness([userTarget, { match: /^DELETE FROM user_blocks WHERE blocker_id = \$1 AND blocked_user_id = \$2$/, params: ['1', '2'] }]);
  assert.equal((await h.request('delete', '/api/blocks/:userId', { params: { userId: '2' } })).data.message, 'User unblocked.');
  assert.equal(h.notifications.length, 0);
});

test('blocked list projects safe fields and only caller-owned blocks', async () => {
  const h = harness([{ match: /^SELECT u.id AS user_id, u.name, u.profile_picture_url, b.created_at .*WHERE b.blocker_id = \$1/, params: ['1'], rows: [{ user_id: '2', name: 'Member' }] }]);
  const result = await h.request('get', '/api/blocks');
  assert.equal(result.statusCode, 200);
  assert.doesNotMatch(h.calls[0].text, /email|phone/);
});

test('apply across a block is denied before insert', async () => {
  const h = harness([{ match: /SELECT \* FROM jobs.*FOR UPDATE/, rows: [{ id: '9', posted_by_id: '2' }] }, relation(true)]);
  const result = await h.request('post', '/api/jobs/:id/apply', { params: { id: '9' } });
  assert.equal(result.statusCode, 403);
  assert.equal(result.data.message, 'This work is not available for interaction.');
  assert.ok(h.calls.some(call => call.text === 'ROLLBACK'));
});

for (const status of ['accepted', 'completed']) {
  test(`${status} history stays readable while new messages are denied`, async () => {
    const h = harness([application(status), relation(true)]);
    const result = await h.request('post', '/api/applications/:id/messages', { params: { id: '8' }, body: { message: 'Hello' } });
    assert.equal(result.statusCode, 403);
    assert.equal(result.data.message, 'Messaging is unavailable for this conversation.');
    assert.equal(h.notifications.length, 0);
    const history = harness([application(status), { match: /FROM messages/, rows: [{ id: '4', message: 'Historical message' }] }]);
    const read = await history.request('get', '/api/applications/:id/messages', { params: { id: '8' } });
    assert.equal(read.statusCode, 200);
    assert.equal(read.data[0].message, 'Historical message');
  });
  test(`${status} contact is hidden on public profile across either block direction`, async () => {
    const h = harness([
      { match: /FROM users/, rows: [{ id: '2', name: 'Member', email: 'private@example.test', phone: 'private' }] },
      { match: /FROM applications/, rows: [{ status, posted_by_id: '1' }] }, relation(true),
      { match: /SELECT 1 FROM user_blocks WHERE blocker_id = \$1/, rows: [] },
    ]);
    const result = await h.request('get', '/api/users/:id/profile', { params: { id: '2' }, query: { jobId: '9' } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.data.email, null);
    assert.equal(result.data.phone, null);
    assert.equal(result.data.canViewContact, false);
    assert.equal(result.data.blockedByMe, false);
  });
}

test('blocked application cannot be accepted through status endpoint', async () => {
  const h = harness([
    { match: /FOR UPDATE OF jobs/, rows: [{ id: '9', posted_by_id: '1' }] },
    { match: /FROM applications/, rows: [{ id: '8', applicant_id: '2', posted_by_id: '1', status: 'rejected' }] }, relation(true),
  ]);
  assert.equal((await h.request('patch', '/api/applications/:id/status', { params: { id: '8' }, body: { status: 'accepted' } })).statusCode, 403);
});

test('applicants and my applications mask contacts in the SQL projection', async () => {
  const h = harness([
    { match: /SELECT \* FROM jobs/, rows: [{ posted_by_id: '1' }] },
    { match: /AND NOT EXISTS .*b.blocker_id = \$2 AND b.blocked_user_id = users.id.*b.blocker_id = users.id AND b.blocked_user_id = \$2/, params: ['9', '1'] },
  ]);
  assert.equal((await h.request('get', '/api/jobs/:id/applicants', { params: { id: '9' } })).statusCode, 200);
  const mine = harness([{ match: /AND NOT EXISTS .*THEN poster.email.*AND NOT EXISTS .*THEN poster.phone/, params: ['1'] }]);
  assert.equal((await mine.request('get', '/api/my-applications')).statusCode, 200);
});

test('unblocked participants can still apply and send messages', async () => {
  const apply = harness([
    { match: /SELECT \* FROM jobs.*FOR UPDATE/, rows: [{ id: '9', posted_by_id: '2', title: 'Work' }] },
    relation(false), { match: /FROM applications.*status IN/ }, { match: /FROM applications.*applicant_id/ },
    { match: /INSERT INTO applications/, rows: [{ id: '8', status: 'pending' }] },
  ]);
  assert.equal((await apply.request('post', '/api/jobs/:id/apply', { params: { id: '9' } })).statusCode, 201);
  const chat = harness([application('accepted'), relation(false), { match: /INSERT INTO messages/, rows: [{ id: '5', message: 'Hello' }] }]);
  assert.equal((await chat.request('post', '/api/applications/:id/messages', { params: { id: '8' }, body: { message: 'Hello' } })).statusCode, 201);
  assert.ok(chat.calls.some(call => call.text === 'COMMIT'));
});

test('a stranger cannot read historical messages', async () => {
  const h = harness([{ match: /FROM applications/, rows: [{ id: '8', applicant_id: '3', posted_by_id: '2', status: 'accepted' }] }]);
  assert.equal((await h.request('get', '/api/applications/:id/messages', { params: { id: '8' } })).statusCode, 403);
});

test('existing accepted work can still be completed after blocking', async () => {
  const h = harness([
    { match: /FOR UPDATE OF jobs/, rows: [{ id: '9', posted_by_id: '1' }] },
    { match: /FROM applications/, rows: [{ id: '8', applicant_id: '2', posted_by_id: '1', status: 'accepted' }] },
    { match: /UPDATE applications/, params: ['completed', '8'], rows: [{ id: '8', status: 'completed' }] },
  ]);
  assert.equal((await h.request('patch', '/api/applications/:id/status', { params: { id: '8' }, body: { status: 'completed' } })).statusCode, 200);
});

test('contact remains available for accepted work when neither user has blocked', async () => {
  const h = harness([
    { match: /FROM users/, rows: [{ id: '2', email: 'member@example.test', phone: '123' }] },
    { match: /FROM applications/, rows: [{ status: 'accepted', posted_by_id: '1' }] }, relation(false),
    { match: /SELECT 1 FROM user_blocks/, rows: [] },
  ]);
  const result = await h.request('get', '/api/users/:id/profile', { params: { id: '2' }, query: { jobId: '9' } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.data.canViewContact, true);
  assert.equal(result.data.email, 'member@example.test');
});
