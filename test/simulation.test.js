// Offline tests for simulation/harness.js, simulation/metrics.js and the DRAFT labelled sets.
// Harness tests use a tiny made-up set and a fake parser. The label tests only check
// that each hand-written label is consistent with the deterministic rules (scorer and
// ambiguity detector) run on the label's OWN gt_intent/gt_slots; they never run a policy and
// never call the parser, so they do not touch the pre-registered results.
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var h = require('./helpers');
var scorer = require('../src/scorer');
var ambiguity = require('../src/ambiguity');
var actions = require('../src/actions');
var policies = require('../src/policies');
var harness = require('../simulation/harness');

var parsed = h.parsed;

// ---- harness + metrics on a made-up set ----

var FIXTURE = { reference_date: '2026-11-23', appointments: h.CAL };
var TABLE = {
  c1: parsed('cancel', { date: '2026-11-24', time: '10:00', person: 'Sam' }),
  a1: parsed('cancel', { time: '15:00' }),
  a2: parsed('create', { date: '2026-11-27', time: 'afternoon' }),
  c2: parsed('create', { date: '2026-11-27', time: '14:00', person: 'Sam' }),
  c3: parsed('cancel', { date: '2026-11-24', time: '15:00', person: 'Sam' }), // parser error: label says 10:00
  m: parsed('create', { date: '2026-11-27' }),
  n: parsed('cancel', { date: '2030-01-01' }),
};
function req(id, text, intent, amb, types, target, slots) {
  return { id: id, text: text, gt_intent: intent, gt_slots: slots || TABLE[text] && TABLE[text].slots, gt_ambiguous: amb, gt_types: types, gt_target: target };
}
var REQUESTS = [
  req('r1', 'c1', 'cancel', false, [], { id: 'a' }),
  req('r2', 'a1', 'cancel', true, ['MULTI_MATCH'], null),
  req('r3', 'a2', 'create', true, ['TIME_EXPR'], null),
  req('r4', 'c2', 'create', false, [], { date: '2026-11-27', time: '14:00' }),
  req('r5', 'c3', 'cancel', false, [], { id: 'a' }, h.slots({ date: '2026-11-24', time: '10:00', person: 'Sam' })),
  req('r6', 'zzz', 'cancel', false, [], { id: 'a' }, h.slots({})),
  req('r7', 'm', 'create', true, ['MISSING_SLOT'], null),
  req('r8', 'n', 'cancel', false, [], { id: 'a' }, h.slots({ date: '2030-01-01' })),
];
var PARSER = {
  parseRequest: async function (text) {
    if (!(text in TABLE)) return { ok: false, parsed: null, error: 'invalid_json' };
    return { ok: true, parsed: TABLE[text], cached: true, meta: {} };
  },
};
function run(policyName) {
  return harness.runSet({ requests: REQUESTS, fixture: FIXTURE, parser: PARSER, policy: policies.createPolicy(policyName) });
}
function byId(run_, id) { return run_.results.filter(function (r) { return r.id === id; })[0]; }

test('harness, Policy K: decisions, correctness and counts', async function () {
  var r = await run('K');
  var s = r.summary;
  assert.equal(s.requests, 8);
  assert.equal(s.parse_failures, 1);
  assert.equal(s.parsed, 7);
  assert.equal(s.not_found, 1);
  assert.equal(s.asks, 3);
  assert.equal(s.acts, 3);
  assert.equal(s.asks_by_precheck, 1);
  assert.deepEqual(s.confusion, { tp: 3, fp: 0, fn: 0, tn: 3 });
  assert.equal(s.precision, 1);
  assert.equal(s.recall, 1);
  assert.equal(s.f1, 1);
  assert.equal(s.wrong_actions, 1); // r5: the parser got the time wrong, so K cancelled the wrong meeting
  assert.equal(s.wrong_action_rate, 1 / 3);
  assert.equal(byId(r, 'r1').wrong_action, false);
  assert.equal(byId(r, 'r5').wrong_action, true);
  assert.equal(byId(r, 'r5').parse_correct.slots, false);
  assert.equal(byId(r, 'r5').parse_correct.intent, true);
  assert.equal(byId(r, 'r2').question, 'Which one do you mean: 15:00 on Tue 24 Nov with Sam or 15:00 on Wed 25 Nov with Alex?');
});

test('harness, Policy T: misses the vague time (it acts) and counts that as a wrong action', async function () {
  var r = await run('T');
  var s = r.summary;
  assert.equal(s.asks, 2);
  assert.equal(s.acts, 4);
  assert.deepEqual(s.confusion, { tp: 2, fp: 0, fn: 1, tn: 3 });
  assert.equal(s.precision, 1);
  assert.equal(s.recall, 2 / 3);
  assert.equal(s.wrong_actions, 2);
  assert.equal(s.wrong_actions_on_ambiguous, 1); // r3
  assert.equal(s.wrong_actions_on_clear, 1); // r5
  assert.deepEqual(s.ambiguous_by_type, { MULTI_MATCH: { n: 1, asked: 1 }, TIME_EXPR: { n: 1, asked: 0 }, MISSING_SLOT: { n: 1, asked: 1 } });
  assert.equal(byId(r, 'r3').decision, 'act');
  assert.equal(byId(r, 'r3').action.plan.appointment.start_time, '14:00');
});

test('parse failures are excluded from policy counts and reported separately', async function () {
  var r = await run('K');
  var f = byId(r, 'r6');
  assert.equal(f.parse_ok, false);
  assert.equal(f.decision, null);
  assert.equal(f.parse_error, 'invalid_json');
  assert.equal(r.summary.parser.slots_checked, 7);
  assert.equal(r.summary.parser.slots_exact, 6);
  assert.equal(r.summary.parser.intent_checked, 7);
  assert.equal(r.summary.parser.intent_correct, 7);
});

test('the harness never executes anything: a record carries a plan, not a database write', async function () {
  var r = await run('K');
  var acted = byId(r, 'r1');
  assert.deepEqual(acted.action.plan, { type: 'cancel', appointment_id: 'a' });
  assert.deepEqual(acted.action.target, { id: 'a' });
});

test('summary handles an empty or all-failed run without dividing by zero', function () {
  var metrics = require('../simulation/metrics');
  var s = metrics.summarise([]);
  assert.equal(s.precision, null);
  assert.equal(s.f1, null);
  assert.equal(s.wrong_action_rate, null);
  assert.equal(s.clarification_rate, null);
});

// ---- the DRAFT labelled sets (labels vs the deterministic rules) ----

var DIR = path.join(__dirname, '..', 'simulation');
var fixture = JSON.parse(fs.readFileSync(path.join(DIR, 'fixture.json'), 'utf8'));
var SETS = ['dev', 'test'].map(function (n) { return JSON.parse(fs.readFileSync(path.join(DIR, n, 'requests.json'), 'utf8')); });

test('fixture: reference date is a Monday and every appointment is well-formed', function () {
  assert.equal(new Date(fixture.reference_date + 'T00:00:00Z').getUTCDay(), 1);
  assert.equal(fixture.appointments.length, 10);
  var ids = {};
  fixture.appointments.forEach(function (a) {
    assert.ok(!ids[a.id], 'duplicate fixture id ' + a.id);
    ids[a.id] = true;
    assert.match(a.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(a.start_time, /^\d{2}:\d{2}:\d{2}$/);
    assert.ok(Number.isInteger(a.duration_minutes) && a.duration_minutes > 0);
  });
});

SETS.forEach(function (set) {
  test(set.name + ' set: 30 requests, 15 clear + 15 ambiguous in the planned mix, unique ids', function () {
    var rs = set.requests;
    assert.equal(rs.length, 30);
    assert.equal(new Set(rs.map(function (r) { return r.id; })).size, 30);
    assert.equal(new Set(rs.map(function (r) { return r.text; })).size, 30);
    var clear = rs.filter(function (r) { return !r.gt_ambiguous; });
    assert.equal(clear.length, 15);
    ['create', 'cancel', 'reschedule'].forEach(function (i) {
      assert.equal(clear.filter(function (r) { return r.gt_intent === i; }).length, 5, i);
    });
    var count = function (t) { return rs.filter(function (r) { return r.gt_ambiguous && r.gt_types[0] === t; }).length; };
    assert.equal(count('MULTI_MATCH'), 5);
    assert.equal(count('MISSING_SLOT'), 3);
    assert.equal(count('TIME_EXPR'), 4);
    assert.equal(count('INTENT'), 2);
    assert.equal(rs.filter(function (r) { return r.gt_ambiguous && r.gt_types.length === 0; }).length, 1); // UNDETECTABLE
    rs.forEach(function (r) {
      assert.equal(typeof r.gt_ambiguous, 'boolean');
      assert.equal(r.gt_target === null, r.gt_ambiguous, r.id + ': gt_target is null exactly when ambiguous');
      assert.deepEqual(Object.keys(r.gt_slots).sort(), ['date', 'duration', 'new_date', 'new_time', 'person', 'time']);
    });
  });

  test(set.name + ' set: each label agrees with the scorer + ambiguity rules run on its own gt parse', function () {
    set.requests.forEach(function (r) {
      var intent = r.gt_intent === null ? 'cancel' : r.gt_intent; // intent-less cases are checked as a parser "cancel"
      var p = { intent: intent, slots: r.gt_slots };
      var sc = scorer.scoreHypotheses(p, fixture.appointments);
      var a = ambiguity.detectAmbiguity(p, sc);
      if (!r.gt_ambiguous) {
        assert.deepEqual(a.fired, [], r.id + ' is labelled clear but fires ' + a.fired.join(','));
        assert.equal(a.no_match, false, r.id + ' matches nothing');
        if (intent !== 'create') {
          assert.ok(sc.hypotheses[0].score > sc.hypotheses[1 < sc.hypotheses.length ? 1 : 0].score || sc.hypotheses.length === 1, r.id + ' has no unique top match');
        }
        var plan = actions.planAction(p, sc);
        var target = actions.resultingTarget(plan, fixture.appointments);
        Object.keys(r.gt_target).forEach(function (k) { assert.equal(target[k], r.gt_target[k], r.id + ' target.' + k); });
      } else {
        assert.deepEqual(a.fired.slice().sort(), r.gt_types.slice().sort(), r.id + ' fires ' + a.fired.join(',') + ' but is labelled ' + r.gt_types.join(','));
        assert.equal(a.no_match, false, r.id);
      }
    });
  });

  test(set.name + ' set: is still a draft until the student marks it reviewed', function () {
    assert.equal(typeof set.reviewed_by_student, 'boolean');
  });
});

test('dev and test sets share no request text and no id', function () {
  var seen = {};
  SETS[0].requests.forEach(function (r) { seen[r.text] = true; seen[r.id] = true; });
  SETS[1].requests.forEach(function (r) {
    assert.ok(!seen[r.text], 'text shared: ' + r.text);
    assert.ok(!seen[r.id], 'id shared: ' + r.id);
  });
});
