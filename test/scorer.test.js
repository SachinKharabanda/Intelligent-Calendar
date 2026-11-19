// Offline tests for src/scorer.js. Run: npm test
// Pure function tests: no DeepSeek, no Supabase, no key needed. They check the
// scoring rules as written; they say nothing about how well the scores separate
// ambiguous from clear requests on real data (that is the experiment).
var test = require('node:test');
var assert = require('node:assert/strict');
var scorer = require('../src/scorer');
var scoreHypotheses = scorer.scoreHypotheses;

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
  appt('d', '2026-03-06', '09:00:00', null, 30),
];

function ids(r) { return r.hypotheses.map(function (h) { return h.appointment_id; }); }

test('weights are fixed integers and MAX_SCORE is their sum (12)', function () {
  assert.deepEqual(scorer.WEIGHTS, { date: 4, time: 4, person: 3, duration: 1 });
  assert.equal(scorer.MAX_SCORE, 12);
});

test('full match scores the sum of the given slots and ranks first', function () {
  var r = scoreHypotheses(parsed('cancel', { date: '2026-03-04', time: '15:00', person: 'Sam' }), CAL);
  assert.equal(r.hypotheses[0].appointment_id, 'b');
  assert.equal(r.hypotheses[0].score, 11);
  assert.deepEqual(r.hypotheses[0].matched, ['date', 'time', 'person']);
  assert.equal(r.hypotheses[0].rank, 1);
  assert.deepEqual(r.specified, ['date', 'time', 'person']);
});

test('mismatched specified slot adds 0 (no penalty), other slots still count', function () {
  var r = scoreHypotheses(parsed('cancel', { date: '2026-03-04', time: '15:00', person: 'Alex' }), CAL);
  var b = r.hypotheses.find(function (h) { return h.appointment_id === 'b'; });
  assert.equal(b.score, 8); // date + time, person mismatch
  var c = r.hypotheses.find(function (h) { return h.appointment_id === 'c'; });
  assert.equal(c.score, 7); // time + person, date mismatch
});

test('equal scores tie: two 3pm meetings on different days are both candidates with the same score', function () {
  var r = scoreHypotheses(parsed('cancel', { time: '15:00' }), CAL);
  assert.deepEqual(ids(r), ['b', 'c']);
  assert.equal(r.hypotheses[0].score, r.hypotheses[1].score);
});

test('tie order is stable: date, then start time, then id', function () {
  var cal = [appt('z', '2026-03-04', '15:00:00', 'Sam'), appt('y', '2026-03-04', '15:00:00', 'Sam'), appt('x', '2026-03-03', '15:00:00', 'Sam')];
  var r = scoreHypotheses(parsed('cancel', { person: 'Sam' }), cal);
  assert.deepEqual(ids(r), ['x', 'y', 'z']);
  assert.deepEqual(r.hypotheses.map(function (h) { return h.rank; }), [1, 2, 3]);
});

test('person match ignores case and surrounding spaces; null person never matches', function () {
  var r = scoreHypotheses(parsed('cancel', { person: ' sAm ' }), CAL);
  assert.deepEqual(ids(r), ['a', 'b']);
  var none = scoreHypotheses(parsed('cancel', { person: 'dentist' }), CAL);
  assert.deepEqual(none.hypotheses, []);
});

test('duration slot matches duration_minutes', function () {
  var r = scoreHypotheses(parsed('cancel', { duration: 30 }), CAL);
  assert.deepEqual(ids(r), ['d']);
  assert.equal(r.hypotheses[0].score, 1);
});

test('time accepts "HH:MM:SS" from the database', function () {
  var r = scoreHypotheses(parsed('cancel', { time: '10:00' }), CAL);
  assert.deepEqual(ids(r), ['a']);
});

test('vague times match by part of day (morning <12, afternoon 12-16:59, evening >=17)', function () {
  var cal = [
    appt('m', '2026-03-04', '11:59:00', null),
    appt('n', '2026-03-04', '12:00:00', null),
    appt('o', '2026-03-04', '16:59:00', null),
    appt('p', '2026-03-04', '17:00:00', null),
  ];
  assert.deepEqual(ids(scoreHypotheses(parsed('cancel', { time: 'morning' }), cal)), ['m']);
  assert.deepEqual(ids(scoreHypotheses(parsed('cancel', { time: 'afternoon' }), cal)), ['n', 'o']);
  assert.deepEqual(ids(scoreHypotheses(parsed('cancel', { time: 'evening' }), cal)), ['p']);
});

test('only appointments matching at least one given slot are candidates', function () {
  var r = scoreHypotheses(parsed('cancel', { date: '2026-03-05' }), CAL);
  assert.deepEqual(ids(r), ['c']);
});

test('nothing matches or nothing given -> empty hypotheses (later boxes decide what to do)', function () {
  assert.deepEqual(scoreHypotheses(parsed('cancel', { date: '2030-01-01' }), CAL).hypotheses, []);
  var noSlots = scoreHypotheses(parsed('cancel', {}), CAL);
  assert.deepEqual(noSlots.hypotheses, []);
  assert.deepEqual(noSlots.specified, []);
  assert.deepEqual(scoreHypotheses(parsed('cancel', { date: '2026-03-04' }), []).hypotheses, []);
});

test('new_date and new_time are never read: they change neither scores nor ranking', function () {
  var base = scoreHypotheses(parsed('reschedule', { date: '2026-03-04', time: '15:00' }), CAL);
  var withNew = scoreHypotheses(parsed('reschedule', { date: '2026-03-04', time: '15:00', new_date: '2026-03-05', new_time: '10:00' }), CAL);
  assert.deepEqual(withNew, base);
  // even a destination that equals another appointment's date/time must not match it
  var lure = scoreHypotheses(parsed('reschedule', { person: 'Alex', new_date: '2026-03-04', new_time: '10:00' }), CAL);
  assert.deepEqual(ids(lure), ['c']);
  assert.deepEqual(lure.specified, ['person']);
});

test('reschedule with only new_* given has no candidates', function () {
  var r = scoreHypotheses(parsed('reschedule', { new_date: '2026-03-04', new_time: '15:00' }), CAL);
  assert.deepEqual(r.hypotheses, []);
  assert.deepEqual(r.specified, []);
});

test('create has exactly one hypothesis scored by the weights of the given slots', function () {
  var r = scoreHypotheses(parsed('create', { date: '2026-03-07', time: '14:00', person: 'Sam' }), CAL);
  assert.equal(r.hypotheses.length, 1);
  assert.equal(r.hypotheses[0].intent, 'create');
  assert.equal(r.hypotheses[0].appointment_id, null);
  assert.equal(r.hypotheses[0].score, 11);
  var vague = scoreHypotheses(parsed('create', { time: 'afternoon' }), CAL);
  assert.equal(vague.hypotheses[0].score, 4);
  var empty = scoreHypotheses(parsed('create', {}), CAL);
  assert.equal(empty.hypotheses[0].score, 0);
  // existing appointments never change a create hypothesis
  assert.deepEqual(scoreHypotheses(parsed('create', { time: 'afternoon' }), []), vague);
});

test('same input gives identical output (deterministic) and inputs are not mutated', function () {
  var p = parsed('cancel', { time: '15:00' });
  var calCopy = JSON.stringify(CAL);
  var pCopy = JSON.stringify(p);
  assert.deepEqual(scoreHypotheses(p, CAL), scoreHypotheses(p, CAL));
  assert.equal(JSON.stringify(CAL), calCopy);
  assert.equal(JSON.stringify(p), pCopy);
});

test('score never exceeds MAX_SCORE', function () {
  var r = scoreHypotheses(parsed('cancel', { date: '2026-03-04', time: '10:00', person: 'Sam', duration: 60 }), CAL);
  assert.equal(r.hypotheses[0].score, scorer.MAX_SCORE);
});

test('bad input throws a TypeError', function () {
  assert.throws(function () { scoreHypotheses(null, CAL); }, TypeError);
  assert.throws(function () { scoreHypotheses({ intent: 'hello', slots: {} }, CAL); }, TypeError);
  assert.throws(function () { scoreHypotheses({ intent: 'cancel' }, CAL); }, TypeError);
  assert.throws(function () { scoreHypotheses(parsed('cancel', {}), null); }, TypeError);
});
