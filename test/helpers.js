// Shared fixtures for the offline tests (not a test file itself: no tests inside).
var scorer = require('../src/scorer');
var ambiguity = require('../src/ambiguity');

function slots(over) {
  return Object.assign({ date: null, time: null, new_date: null, new_time: null, person: null, duration: null }, over);
}
function parsed(intent, over) {
  return { intent: intent, slots: slots(over) };
}
function appt(id, date, start, person, dur, title) {
  return { id: id, title: title || 'Meeting', date: date, start_time: start, person: person, duration_minutes: dur === undefined ? 60 : dur };
}

// a, b: Sam on Tue 24 Nov (10:00, 15:00); c: Alex Wed 25 Nov 15:00; d: Priya Thu 26 Nov 09:00 (30 min)
var CAL = [
  appt('a', '2026-11-24', '10:00:00', 'Sam', 60, 'Project sync'),
  appt('b', '2026-11-24', '15:00:00', 'Sam', 60, 'Design review'),
  appt('c', '2026-11-25', '15:00:00', 'Alex', 60, 'Budget check-in'),
  appt('d', '2026-11-26', '09:00:00', 'Priya', 30, 'Standup'),
];

function ctx(p, cal) {
  var scored = scorer.scoreHypotheses(p, cal || CAL);
  return { parsed: p, scored: scored, ambiguity: ambiguity.detectAmbiguity(p, scored) };
}

module.exports = { slots: slots, parsed: parsed, appt: appt, CAL: CAL, ctx: ctx };
