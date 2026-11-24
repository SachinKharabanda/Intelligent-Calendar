// Offline tests for src/questions.js, src/actions.js, src/replies.js, src/chat.js,
// src/calendar.js and routes/api/chat.js. All dependencies are fakes: no DeepSeek,
// no Supabase, no keys. They check the flow as written, not the real services.
var test = require('node:test');
var assert = require('node:assert/strict');
var http = require('node:http');
var express = require('express');
var h = require('./helpers');
var questions = require('../src/questions');
var actions = require('../src/actions');
var replies = require('../src/replies');
var chat = require('../src/chat');
var calendarModule = require('../src/calendar');
var policies = require('../src/policies');
var chatRoute = require('../routes/api/chat');

var parsed = h.parsed;
var ctx = h.ctx;

// ---- questions ----

function q(p, cal) {
  var c = ctx(p, cal || h.CAL);
  return questions.buildQuestion(p, c.ambiguity, c.scored, cal || h.CAL);
}

test('MULTI_MATCH question lists up to three candidates', function () {
  var r = q(parsed('cancel', { time: '15:00' }));
  assert.equal(r.type, 'MULTI_MATCH');
  assert.equal(r.focus, 'which');
  assert.equal(r.text, 'Which one do you mean: 15:00 on Tue 24 Nov with Sam or 15:00 on Wed 25 Nov with Alex?');
});

test('MULTI_MATCH with more than three candidates asks with a count', function () {
  var cal = ['1', '2', '3', '4'].map(function (i) { return h.appt(i, '2026-11-2' + i, '15:00:00', 'Sam'); });
  assert.equal(q(parsed('cancel', { time: '15:00' }), cal).text, 'I found 4 matching appointments; which one do you mean?');
});

test('MISSING_SLOT questions by what is missing', function () {
  assert.equal(q(parsed('create', {})).text, 'What date and time should I book it?');
  assert.equal(q(parsed('create', { time: '10:00' })).text, 'What date should I book it for?');
  var t = q(parsed('create', { date: '2026-11-27' }));
  assert.equal(t.text, 'What time should I book it?');
  assert.equal(t.focus, 'time');
  assert.equal(q(parsed('cancel', {})).text, 'Which appointment do you mean?');
  var d = q(parsed('reschedule', { date: '2026-11-26', time: '09:00' }));
  assert.equal(d.text, 'When should I move it to?');
  assert.equal(d.focus, 'destination');
});

test('TIME_EXPR question names the vague word', function () {
  var r = q(parsed('create', { date: '2026-11-27', time: 'afternoon' }));
  assert.equal(r.text, 'What time in the afternoon?');
  assert.equal(r.focus, 'time');
  var m = q(parsed('reschedule', { date: '2026-11-26', time: '09:00', new_time: 'evening' }));
  assert.equal(m.focus, 'new_time');
});

test('INTENT question offers cancel or move, with the destination', function () {
  var r = q(parsed('cancel', { date: '2026-11-26', time: '09:00', new_date: '2026-11-27', new_time: '14:00' }));
  assert.equal(r.type, 'INTENT');
  assert.equal(r.text, 'Do you want to cancel it, or move it to Fri 27 Nov at 14:00?');
  var c = q(parsed('create', { date: '2026-11-27', time: '14:00', new_time: '16:00' }));
  assert.equal(c.text, 'Do you want to book a new appointment, or move it to 16:00?');
});

test('one question per turn, by priority INTENT > MISSING_SLOT > MULTI_MATCH > TIME_EXPR', function () {
  assert.deepEqual(questions.PRIORITY, ['INTENT', 'MISSING_SLOT', 'MULTI_MATCH', 'TIME_EXPR']);
  // create: INTENT + MISSING_SLOT + TIME_EXPR all fire -> INTENT first
  assert.equal(q(parsed('create', { time: 'afternoon', new_date: '2026-11-27' })).type, 'INTENT');
  // cancel with a 3pm tie and a vague... MULTI_MATCH is asked before TIME_EXPR would be
  assert.equal(q(parsed('cancel', { time: '15:00' })).type, 'MULTI_MATCH');
});

test('GENERIC fallback when the policy asked but no type fired', function () {
  var p = parsed('cancel', { date: '2026-11-24', time: '10:00', person: 'Sam' });
  var c = ctx(p);
  var r = questions.buildQuestion(p, c.ambiguity, c.scored, h.CAL);
  assert.equal(r.type, 'GENERIC');
  assert.equal(r.focus, 'which'); // top two hypotheses exist
  var single = ctx(parsed('create', { date: '2026-11-27', time: '14:00' }));
  var g = questions.buildQuestion(single.parsed, single.ambiguity, single.scored, h.CAL);
  assert.equal(g.focus, 'detail');
});

// ---- actions ----

test('create plan: title from person, duration only when given, source passed', function () {
  var p = parsed('create', { date: '2026-11-27', time: '14:00', person: 'Sam', duration: 30 });
  var plan = actions.planAction(p, ctx(p).scored, { source: 'simulation' });
  assert.deepEqual(plan, { type: 'create', appointment: { title: 'Meeting with Sam', person: 'Sam', date: '2026-11-27', start_time: '14:00', source: 'simulation', duration_minutes: 30 } });
  var q2 = parsed('create', { date: '2026-11-27', time: '14:00' });
  var plan2 = actions.planAction(q2, ctx(q2).scored);
  assert.equal(plan2.appointment.title, 'Appointment');
  assert.equal(plan2.appointment.person, null);
  assert.equal('duration_minutes' in plan2.appointment, false);
  assert.equal(plan2.appointment.source, 'app');
});

test('a vague time that is acted on is booked at the representative time', function () {
  var p = parsed('create', { date: '2026-11-27', time: 'afternoon' });
  assert.equal(actions.planAction(p, ctx(p).scored).appointment.start_time, '14:00');
  assert.deepEqual(actions.VAGUE_TIME_DEFAULT, { morning: '09:00', afternoon: '14:00', evening: '18:00' });
});

test('create without date and time cannot be planned', function () {
  var p = parsed('create', { date: '2026-11-27' });
  assert.throws(function () { actions.planAction(p, ctx(p).scored); }, /date and a time/);
});

test('cancel and reschedule plans use the top hypothesis; bare new_time keeps the day', function () {
  var c = parsed('cancel', { date: '2026-11-24', time: '10:00', person: 'Sam' });
  assert.deepEqual(actions.planAction(c, ctx(c).scored), { type: 'cancel', appointment_id: 'a' });
  var r = parsed('reschedule', { date: '2026-11-24', time: '10:00', person: 'Sam', new_time: '11:30' });
  var plan = actions.planAction(r, ctx(r).scored);
  assert.deepEqual(plan, { type: 'reschedule', appointment_id: 'a', changes: { start_time: '11:30' } });
  assert.deepEqual(actions.resultingTarget(plan, h.CAL), { id: 'a', date: '2026-11-24', time: '11:30' });
  var r2 = parsed('reschedule', { date: '2026-11-24', time: '10:00', person: 'Sam', new_date: '2026-11-30' });
  var plan2 = actions.planAction(r2, ctx(r2).scored);
  assert.deepEqual(actions.resultingTarget(plan2, h.CAL), { id: 'a', date: '2026-11-30', time: '10:00' });
});

test('reschedule without a destination or with no candidate cannot be planned', function () {
  var r = parsed('reschedule', { date: '2026-11-24', time: '10:00' });
  assert.throws(function () { actions.planAction(r, ctx(r).scored); }, /new date or time/);
  var c = parsed('cancel', { date: '2030-01-01' });
  assert.throws(function () { actions.planAction(c, ctx(c).scored); }, /No appointment/);
});

test('resultingTarget for create; confirmation texts', function () {
  var p = parsed('create', { date: '2026-11-27', time: '14:00', person: 'Sam' });
  var plan = actions.planAction(p, ctx(p).scored);
  assert.deepEqual(actions.resultingTarget(plan, h.CAL), { date: '2026-11-27', time: '14:00' });
  assert.equal(actions.confirmationText(plan, h.CAL), 'Booked: Meeting with Sam on Fri 27 Nov at 14:00.');
  var c = parsed('cancel', { date: '2026-11-24', time: '10:00', person: 'Sam' });
  assert.equal(actions.confirmationText(actions.planAction(c, ctx(c).scored), h.CAL), 'Cancelled: Project sync on Tue 24 Nov at 10:00.');
  var r = parsed('reschedule', { date: '2026-11-24', time: '10:00', person: 'Sam', new_time: '11:30' });
  assert.equal(actions.confirmationText(actions.planAction(r, ctx(r).scored), h.CAL), 'Moved Project sync to Tue 24 Nov at 11:30.');
});

// ---- replies ----

test('reply to a destination question remaps date/time to new_date/new_time', function () {
  var prev = parsed('reschedule', { date: '2026-11-24', time: '10:00' });
  var m = replies.mergeReply(prev, 'destination', parsed('create', { date: '2026-11-27', time: '14:00' }));
  assert.equal(m.intent, 'reschedule');
  assert.equal(m.slots.new_date, '2026-11-27');
  assert.equal(m.slots.new_time, '14:00');
  assert.equal(m.slots.date, '2026-11-24'); // the reference is untouched
  assert.equal(m.slots.time, '10:00');
});

test('reply to a vague-new_time question replaces new_time only', function () {
  var prev = parsed('reschedule', { date: '2026-11-24', time: '10:00', new_date: '2026-11-27', new_time: 'evening' });
  var m = replies.mergeReply(prev, 'new_time', parsed('create', { time: '18:30' }));
  assert.equal(m.slots.new_time, '18:30');
  assert.equal(m.slots.new_date, '2026-11-27');
});

test('reply to a which/time/date question overlays non-null slots and keeps the intent', function () {
  var prev = parsed('cancel', { time: '15:00' });
  var m = replies.mergeReply(prev, 'which', parsed('create', { date: '2026-11-24' }));
  assert.equal(m.intent, 'cancel');
  assert.equal(m.slots.date, '2026-11-24');
  assert.equal(m.slots.time, '15:00');
  var t = replies.mergeReply(parsed('create', { date: '2026-11-27' }), 'time', parsed('create', { time: '10:00' }));
  assert.equal(t.slots.time, '10:00');
  assert.equal(t.slots.date, '2026-11-27');
});

test('reply to an intent question adopts the reply intent; cancel drops the destination', function () {
  var prev = parsed('cancel', { date: '2026-11-26', time: '09:00', new_date: '2026-11-27' });
  var c = replies.mergeReply(prev, 'intent', parsed('cancel', {}));
  assert.equal(c.intent, 'cancel');
  assert.equal(c.slots.new_date, null);
  var r = replies.mergeReply(prev, 'intent', parsed('reschedule', {}));
  assert.equal(r.intent, 'reschedule');
  assert.equal(r.slots.new_date, '2026-11-27');
});

test('an empty reply changes nothing; merge does not mutate its inputs', function () {
  var prev = parsed('cancel', { time: '15:00' });
  var copy = JSON.stringify(prev);
  var m = replies.mergeReply(prev, 'which', parsed('create', {}));
  assert.deepEqual(m, prev);
  assert.equal(JSON.stringify(prev), copy);
  assert.notEqual(m, prev);
});

// ---- chat service (fake parser + fake calendar) ----

function fakeParser(table) {
  return {
    parseRequest: async function (text) {
      if (!(text in table)) return { ok: false, parsed: null, error: 'invalid_json' };
      return { ok: true, parsed: table[text], cached: true, meta: {} };
    },
  };
}
function fakeCalendar(rows) {
  var executed = [];
  return { executed: executed, list: async function () { return rows; }, execute: async function (plan) { executed.push(plan); } };
}
function service(table, policyName, rows) {
  var cal = fakeCalendar(rows || h.CAL);
  return { svc: chat.createChatService({ parser: fakeParser(table), calendar: cal, policy: policies.createPolicy(policyName || 'K') }), cal: cal };
}

test('clear request: acts, executes once, confirms, carries a trace', async function () {
  var s = service({ go: parsed('cancel', { date: '2026-11-24', time: '10:00', person: 'Sam' }) });
  var r = await s.svc.start('go');
  assert.equal(r.status, 'done');
  assert.equal(r.message, 'Cancelled: Project sync on Tue 24 Nov at 10:00.');
  assert.deepEqual(s.cal.executed, [{ type: 'cancel', appointment_id: 'a' }]);
  assert.equal(r.trace.policy, 'K');
  assert.equal(r.trace.by, 'policy');
});

test('ambiguous request: asks, executes nothing, returns state; the reply resolves it', async function () {
  var s = service({
    'cancel 3pm': parsed('cancel', { time: '15:00' }),
    tuesday: parsed('create', { date: '2026-11-24' }),
  });
  var r = await s.svc.start('cancel 3pm');
  assert.equal(r.status, 'ask');
  assert.equal(r.trace.asked, 'MULTI_MATCH');
  assert.equal(r.state.asks, 1);
  assert.equal(s.cal.executed.length, 0);
  var r2 = await s.svc.reply(r.state, 'tuesday');
  assert.equal(r2.status, 'done');
  assert.deepEqual(s.cal.executed, [{ type: 'cancel', appointment_id: 'b' }]);
});

test('missing slot asks even under Policy T (pre-check), with the trace saying so', async function () {
  var s = service({ x: parsed('create', { date: '2026-11-27', person: 'Sam' }) }, 'T');
  var r = await s.svc.start('x');
  assert.equal(r.status, 'ask');
  assert.equal(r.question, 'What time should I book it?');
  assert.equal(r.trace.by, 'precheck');
  assert.equal(s.cal.executed.length, 0);
});

test('gives up after two clarifying questions', async function () {
  var s = service({ a: parsed('cancel', { time: '15:00' }), nothing: parsed('create', {}) });
  var r1 = await s.svc.start('a');
  assert.equal(r1.state.asks, 1);
  var r2 = await s.svc.reply(r1.state, 'nothing');
  assert.equal(r2.status, 'ask');
  assert.equal(r2.state.asks, 2);
  var r3 = await s.svc.reply(r2.state, 'nothing');
  assert.equal(r3.status, 'gave_up');
  assert.equal(s.cal.executed.length, 0);
});

test('nothing matches: not_found, no ask, no action', async function () {
  var s = service({ x: parsed('cancel', { date: '2030-01-01' }) });
  var r = await s.svc.start('x');
  assert.equal(r.status, 'not_found');
  assert.equal(s.cal.executed.length, 0);
});

test('parse failure is reported, never turned into an action', async function () {
  var s = service({});
  var r = await s.svc.start('hello');
  assert.equal(r.status, 'parse_error');
  assert.equal(r.error, 'invalid_json');
  assert.equal(s.cal.executed.length, 0);
});

test('reply state is validated and sanitised', async function () {
  var s = service({ r: parsed('create', { time: '10:00' }) });
  var bad = [null, {}, { parsed: parsed('cancel', {}), asked: { focus: 'which' }, asks: 0 },
    { parsed: parsed('cancel', {}), asked: { focus: 'bogus' }, asks: 1 },
    { parsed: { intent: 'drop', slots: {} }, asked: { focus: 'which' }, asks: 1 },
    { parsed: parsed('cancel', {}), asked: { focus: 'which' }, asks: 99 }];
  for (var i = 0; i < bad.length; i++) {
    await assert.rejects(function () { return s.svc.reply(bad[i], 'r'); }, TypeError);
  }
  assert.ok(chat.cleanState({ parsed: parsed('cancel', { time: '15:00' }), asked: { type: 'MULTI_MATCH', focus: 'which' }, asks: 1 }));
});

// ---- calendar (fake supabase) ----

function fakeSupabase(handler) {
  return {
    from: function (table) {
      var b = { table: table, ops: [] };
      ['select', 'order', 'insert', 'delete', 'update', 'eq', 'single'].forEach(function (m) {
        b[m] = function () { b.ops.push([m].concat([].slice.call(arguments))); return b; };
      });
      b.then = function (res, rej) { return Promise.resolve(handler(b)).then(res, rej); };
      return b;
    },
  };
}
function opNames(b) { return b.ops.map(function (o) { return o[0]; }); }

test('calendar.list orders by date then time; every read and write is scoped to the session', async function () {
  var seen = [];
  var cal = calendarModule.createCalendar(fakeSupabase(function (b) { seen.push(b); return { data: [{ id: 'x' }], error: null }; }));
  assert.deepEqual(await cal.list('S1'), [{ id: 'x' }]);
  assert.deepEqual(opNames(seen[0]), ['select', 'eq', 'order', 'order']);
  assert.deepEqual(seen[0].ops[1], ['eq', 'session_id', 'S1']);

  await cal.execute({ type: 'create', appointment: { title: 'T', date: '2026-11-27', start_time: '14:00', source: 'app' } }, 'S1');
  assert.deepEqual(opNames(seen[1]), ['insert', 'select', 'single']);
  assert.equal(seen[1].ops[0][1].session_id, 'S1');
  await cal.execute({ type: 'cancel', appointment_id: 'a' }, 'S1');
  assert.deepEqual(seen[2].ops, [['delete'], ['eq', 'id', 'a'], ['eq', 'session_id', 'S1']]);
  await cal.execute({ type: 'reschedule', appointment_id: 'a', changes: { start_time: '11:30' } }, 'S1');
  assert.deepEqual(seen[3].ops, [['update', { start_time: '11:30' }], ['eq', 'id', 'a'], ['eq', 'session_id', 'S1']]);
});

test('session middleware: issues a UUID cookie once, reuses a valid one, replaces a bad one', async function () {
  var session = require('../src/session');
  function run(cookie) {
    var req = { cookies: cookie === undefined ? {} : { ic_session: cookie } }, set = null;
    session.middleware(req, { cookie: function (n, v, o) { set = { n: n, v: v, o: o }; } }, function () {});
    return { id: req.sessionId, set: set };
  }
  var fresh = run();
  assert.match(fresh.id, /^[0-9a-f-]{36}$/);
  assert.equal(fresh.set.n, 'ic_session');
  assert.equal(fresh.set.o.httpOnly, true);
  assert.equal(fresh.set.o.sameSite, 'lax');
  var again = run(fresh.id);
  assert.equal(again.id, fresh.id);
  assert.equal(again.set, null);
  var bad = run('not-a-uuid');
  assert.notEqual(bad.id, 'not-a-uuid');
  assert.ok(bad.set);
});

test('calendar errors are generic (no database detail leaks); unknown plan throws', async function () {
  var cal = calendarModule.createCalendar(fakeSupabase(function () { return { data: null, error: { message: 'secret relation detail', code: '42501' } }; }));
  await assert.rejects(function () { return cal.list(); }, function (e) { return e.message === 'Calendar read failed.'; });
  await assert.rejects(function () { return cal.execute({ type: 'cancel', appointment_id: 'a' }); }, function (e) { return !/secret/.test(e.message); });
  await assert.rejects(function () { return cal.execute({ type: 'bogus' }); }, TypeError);
});

// ---- route (fake service, real express) ----

function withServer(svc, fn) {
  var app = express();
  app.use('/api/chat', chatRoute.createChatRouter(function () { return svc; }));
  return new Promise(function (resolve, reject) {
    var server = app.listen(0, function () {
      var base = 'http://127.0.0.1:' + server.address().port + '/api/chat';
      Promise.resolve(fn(base)).then(function () { server.close(resolve); }, function (e) { server.close(function () { reject(e); }); });
    });
  });
}
function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
}

test('route: validates text, passes it to the service, hides internal errors', async function () {
  var calls = [];
  var svc = {
    start: async function (t) { calls.push(['start', t]); if (t === 'boom') throw new Error('db password leaked'); return { status: 'done', message: 'ok' }; },
    reply: async function (s, t) { calls.push(['reply', t]); if (!s) throw new TypeError('Invalid conversation state.'); return { status: 'done', message: 'ok2' }; },
  };
  await withServer(svc, async function (base) {
    assert.deepEqual(await post(base, { text: '  hi  ' }), { status: 200, body: { status: 'done', message: 'ok' } });
    assert.deepEqual(calls[0], ['start', 'hi']);
    assert.equal((await post(base, {})).status, 400);
    assert.equal((await post(base, { text: '   ' })).status, 400);
    assert.equal((await post(base, { text: 'x'.repeat(501) })).status, 400);
    var boom = await post(base, { text: 'boom' });
    assert.equal(boom.status, 500);
    assert.ok(!/password/.test(JSON.stringify(boom.body)));
    assert.equal((await post(base + '/reply', { text: 'r' })).status, 400); // invalid state -> 400
    assert.equal((await post(base + '/reply', { text: 'r', state: { x: 1 } })).status, 200);
  });
});

test('route: a missing service configuration is a generic 500, not a crash', async function () {
  var app = express();
  app.use('/api/chat', chatRoute.createChatRouter(function () { throw new Error('CLARIFICATION_POLICY is not set'); }));
  await new Promise(function (resolve, reject) {
    var server = app.listen(0, function () {
      post('http://127.0.0.1:' + server.address().port + '/api/chat', { text: 'hi' }).then(function (r) {
        try { assert.equal(r.status, 500); assert.ok(!/CLARIFICATION/.test(JSON.stringify(r.body))); } catch (e) { return server.close(function () { reject(e); }); }
        server.close(resolve);
      }, reject);
    });
  });
});
