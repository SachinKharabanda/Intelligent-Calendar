// Offline tests for src/ambiguity.js. Run: npm test
// Pure function tests: no DeepSeek, no Supabase, no key needed. They check the
// detection rules as written; they say nothing about how well the detector separates
// ambiguous from clear requests on real data (that is the experiment).
var test = require('node:test');
var assert = require('node:assert/strict');
var scorer = require('../src/scorer');
var ambiguity = require('../src/ambiguity');
var detectAmbiguity = ambiguity.detectAmbiguity;

function slots(over) {
  return Object.assign({ date: null, time: null, new_date: null, new_time: null, person: null, duration: null }, over);
}
function parsed(intent, over) {
  return { intent: intent, slots: slots(over) };
}
function appt(id, date, start, person, dur) {
  return { id: id, title: 't', date: date, start_time: start, person: person, duration_minutes: dur === undefined ? 60 : dur };
}

var CAL = [
  appt('a', '2026-03-04', '10:00:00', 'Sam'),
  appt('b', '2026-03-04', '15:00:00', 'Sam'),
  appt('c', '2026-03-05', '15:00:00', 'Alex'),
];

function run(p, cal) {
  return detectAmbiguity(p, scorer.scoreHypotheses(p, cal === undefined ? CAL : cal));
}

test('types and order are fixed: INTENT, MULTI_MATCH, MISSING_SLOT, TIME_EXPR', function () {
  assert.deepEqual(ambiguity.TYPES, ['INTENT', 'MULTI_MATCH', 'MISSING_SLOT', 'TIME_EXPR']);
});

test('clear create fires nothing', function () {
  var r = run(parsed('create', { date: '2026-03-07', time: '14:00', person: 'Sam' }));
  assert.deepEqual(r.fired, []);
  assert.deepEqual(r.occurrence, [0, 0, 0, 0]);
  assert.deepEqual(r.alternatives, []);
  assert.deepEqual(r.missing, []);
  assert.equal(r.no_match, false);
});

test('clear cancel (one exact match) fires nothing', function () {
  var r = run(parsed('cancel', { date: '2026-03-04', time: '10:00', person: 'Sam' }));
  assert.deepEqual(r.fired, []);
  assert.equal(r.no_match, false);
});

test('clear reschedule (one match, destination given) fires nothing', function () {
  var r = run(parsed('reschedule', { date: '2026-03-04', time: '10:00', new_date: '2026-03-06', new_time: '14:00' }));
  assert.deepEqual(r.fired, []);
});

test('MULTI_MATCH: two appointments tie for the best score', function () {
  var r = run(parsed('cancel', { time: '15:00' }));
  assert.deepEqual(r.fired, ['MULTI_MATCH']);
  assert.deepEqual(r.vector, { INTENT: 0, MULTI_MATCH: 1, MISSING_SLOT: 0, TIME_EXPR: 0 });
  assert.deepEqual(r.alternatives, [{ type: 'MULTI_MATCH', appointment_id: 'c', candidates: ['b', 'c'] }]);
});

test('MULTI_MATCH does not fire when the top match is strictly better', function () {
  // b = date+time+person (11); a = date+person (7); c = time (4)
  var r = run(parsed('cancel', { date: '2026-03-04', time: '15:00', person: 'Sam' }));
  assert.deepEqual(r.fired, []);
});

test('MULTI_MATCH lists every appointment tied at the top, alternative is rank 2', function () {
  var cal = [appt('x', '2026-03-03', '15:00:00', 'Sam'), appt('y', '2026-03-04', '15:00:00', 'Sam'), appt('z', '2026-03-05', '15:00:00', 'Sam')];
  var r = run(parsed('cancel', { time: '15:00' }), cal);
  assert.deepEqual(r.alternatives[0].candidates, ['x', 'y', 'z']);
  assert.equal(r.alternatives[0].appointment_id, 'y');
});

test('MULTI_MATCH never fires for create', function () {
  var r = run(parsed('create', { date: '2026-03-04', time: '15:00' }));
  assert.equal(r.vector.MULTI_MATCH, 0);
});

test('a vague time that only identifies an appointment fires MULTI_MATCH when it fits several, not TIME_EXPR', function () {
  var r = run(parsed('cancel', { time: 'afternoon' }));
  assert.deepEqual(r.fired, ['MULTI_MATCH']);
  var one = run(parsed('cancel', { time: 'morning' }));
  assert.deepEqual(one.fired, []);
});

test('MISSING_SLOT for create: date and/or time absent', function () {
  var noTime = run(parsed('create', { date: '2026-03-07', person: 'Sam' }));
  assert.deepEqual(noTime.fired, ['MISSING_SLOT']);
  assert.deepEqual(noTime.missing, ['time']);
  var nothing = run(parsed('create', {}));
  assert.deepEqual(nothing.missing, ['date', 'time']);
  assert.deepEqual(nothing.alternatives, [{ type: 'MISSING_SLOT', missing: ['date', 'time'] }]);
  // person and duration are optional for create
  assert.deepEqual(run(parsed('create', { date: '2026-03-07', time: '14:00' })).fired, []);
});

test('MISSING_SLOT for cancel/reschedule: no slot says which appointment', function () {
  assert.deepEqual(run(parsed('cancel', {})).missing, ['appointment']);
  var r = run(parsed('reschedule', { new_date: '2026-03-06', new_time: '14:00' }));
  assert.deepEqual(r.missing, ['appointment']);
});

test('MISSING_SLOT for reschedule: no destination (student decision)', function () {
  var r = run(parsed('reschedule', { date: '2026-03-04', time: '10:00' }));
  assert.deepEqual(r.fired, ['MISSING_SLOT']);
  assert.deepEqual(r.missing, ['destination']);
});

test('a bare new_time or a bare new_date counts as a destination', function () {
  assert.deepEqual(run(parsed('reschedule', { date: '2026-03-04', time: '10:00', new_time: '14:00' })).fired, []);
  assert.deepEqual(run(parsed('reschedule', { date: '2026-03-04', time: '10:00', new_date: '2026-03-06' })).fired, []);
});

test('reschedule missing both the appointment and the destination reports both', function () {
  var r = run(parsed('reschedule', {}));
  assert.deepEqual(r.missing, ['appointment', 'destination']);
});

test('TIME_EXPR: vague time on create is TIME_EXPR, not MISSING_SLOT', function () {
  var r = run(parsed('create', { date: '2026-03-07', time: 'afternoon' }));
  assert.deepEqual(r.fired, ['TIME_EXPR']);
  assert.deepEqual(r.alternatives, [{ type: 'TIME_EXPR', slot: 'time', value: 'afternoon' }]);
  assert.deepEqual(r.missing, []);
});

test('TIME_EXPR: vague new_time on reschedule', function () {
  var r = run(parsed('reschedule', { date: '2026-03-04', time: '10:00', new_time: 'evening' }));
  assert.deepEqual(r.fired, ['TIME_EXPR']);
  assert.deepEqual(r.alternatives, [{ type: 'TIME_EXPR', slot: 'new_time', value: 'evening' }]);
});

test('INTENT: a destination slot on a cancel or create points to reschedule', function () {
  var c = run(parsed('cancel', { date: '2026-03-04', time: '10:00', new_date: '2026-03-06' }));
  assert.deepEqual(c.fired, ['INTENT']);
  assert.deepEqual(c.alternatives, [{ type: 'INTENT', intent: 'reschedule', because: ['new_date'] }]);
  var cr = run(parsed('create', { date: '2026-03-07', time: '14:00', new_time: '16:00' }));
  assert.deepEqual(cr.fired, ['INTENT']);
});

test('INTENT never fires for reschedule, and a plain cancel does not fire it', function () {
  assert.equal(run(parsed('reschedule', { date: '2026-03-04', time: '10:00', new_time: '14:00' })).vector.INTENT, 0);
  assert.equal(run(parsed('cancel', { date: '2026-03-04', time: '10:00' })).vector.INTENT, 0);
});

test('several types can fire together; alternatives follow TYPES order and match the vector', function () {
  var r = run(parsed('cancel', { time: '15:00', new_time: 'morning' }));
  assert.deepEqual(r.fired, ['INTENT', 'MULTI_MATCH']);
  assert.deepEqual(r.occurrence, [1, 1, 0, 0]);
  assert.deepEqual(r.alternatives.map(function (a) { return a.type; }), r.fired);
  var all = run(parsed('create', { time: 'afternoon', new_date: '2026-03-06' }));
  assert.deepEqual(all.fired, ['INTENT', 'MISSING_SLOT', 'TIME_EXPR']);
  assert.deepEqual(all.occurrence, [1, 0, 1, 1]);
});

test('no_match: cancel/reschedule slots given but no appointment fits (not an ambiguity type)', function () {
  var r = run(parsed('cancel', { date: '2030-01-01' }));
  assert.equal(r.no_match, true);
  assert.deepEqual(r.fired, []);
  // nothing given at all is MISSING_SLOT, not no_match
  var none = run(parsed('cancel', {}));
  assert.equal(none.no_match, false);
  assert.deepEqual(none.fired, ['MISSING_SLOT']);
  // create never has no_match
  assert.equal(run(parsed('create', { date: '2030-01-01', time: '10:00' })).no_match, false);
});

test('same input gives identical output (deterministic) and inputs are not mutated', function () {
  var p = parsed('cancel', { time: '15:00' });
  var s = scorer.scoreHypotheses(p, CAL);
  var pCopy = JSON.stringify(p);
  var sCopy = JSON.stringify(s);
  assert.deepEqual(detectAmbiguity(p, s), detectAmbiguity(p, s));
  assert.equal(JSON.stringify(p), pCopy);
  assert.equal(JSON.stringify(s), sCopy);
});

test('bad input throws a TypeError', function () {
  var p = parsed('cancel', { time: '15:00' });
  var s = scorer.scoreHypotheses(p, CAL);
  assert.throws(function () { detectAmbiguity(null, s); }, TypeError);
  assert.throws(function () { detectAmbiguity({ intent: 'hello', slots: {} }, s); }, TypeError);
  assert.throws(function () { detectAmbiguity(p, null); }, TypeError);
  assert.throws(function () { detectAmbiguity(p, { intent: 'cancel' }); }, TypeError);
  // scorer output for a different intent
  assert.throws(function () { detectAmbiguity(p, scorer.scoreHypotheses(parsed('create', {}), CAL)); }, TypeError);
});
