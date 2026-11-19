// ACT behaviour: turn a parsed request + the top hypothesis into a concrete action plan,
// and describe it back to the user. Pure; planning never touches the database (src/calendar.js
// executes a plan, the simulation harness only compares it with the ground truth).
//
// Student's decisions (2026-11-19, docs/decision-options.md D8): a created appointment's
// title is "Meeting with <person>", else "Appointment" (the parser has no title slot);
// duration is only sent when the user gave one (the database default is 60); a reschedule
// with only new_time keeps the original day.
// Agent's choice, student to confirm (not in the options): a VAGUE time that a policy
// ACTs on (Policy T does) is booked at a representative time, VAGUE_TIME_DEFAULT.

var fmt = require('./format');

var VAGUE_TIME_DEFAULT = { morning: '09:00', afternoon: '14:00', evening: '18:00' };

function concreteTime(t) {
  return Object.prototype.hasOwnProperty.call(VAGUE_TIME_DEFAULT, t) ? VAGUE_TIME_DEFAULT[t] : t;
}

function isGiven(v) {
  return v !== null && v !== undefined;
}

// planAction(parsed, scored, opts?) ->
//   create:     { type:'create', appointment:{title, person, date, start_time, source, [duration_minutes]} }
//   cancel:     { type:'cancel', appointment_id }
//   reschedule: { type:'reschedule', appointment_id, changes:{[date], [start_time]} }
// Throws if the request cannot be executed (the pre-check in src/pipeline.js prevents this).
function planAction(parsed, scored, opts) {
  var source = (opts && opts.source) || 'app';
  var s = parsed.slots;

  if (parsed.intent === 'create') {
    if (!isGiven(s.date) || !isGiven(s.time)) throw new Error('Cannot create an appointment without a date and a time.');
    var appt = {
      title: isGiven(s.person) ? 'Meeting with ' + s.person : 'Appointment',
      person: isGiven(s.person) ? s.person : null,
      date: s.date,
      start_time: concreteTime(s.time),
      source: source,
    };
    if (isGiven(s.duration)) appt.duration_minutes = s.duration;
    return { type: 'create', appointment: appt };
  }

  var top = scored.hypotheses[0];
  if (!top || top.appointment_id === null) throw new Error('No appointment to ' + parsed.intent + '.');

  if (parsed.intent === 'cancel') {
    return { type: 'cancel', appointment_id: top.appointment_id };
  }

  var changes = {};
  if (isGiven(s.new_date)) changes.date = s.new_date;
  if (isGiven(s.new_time)) changes.start_time = concreteTime(s.new_time);
  if (Object.keys(changes).length === 0) throw new Error('Cannot reschedule without a new date or time.');
  return { type: 'reschedule', appointment_id: top.appointment_id, changes: changes };
}

function find(appointments, id) {
  return appointments.filter(function (a) { return a.id === id; })[0];
}

// resultingTarget(plan, appointments) -> comparable summary used by the harness to check
// an action against the pre-registered ground truth.
//   create {date, time} | cancel {id} | reschedule {id, date, time} (date/time after the move)
function resultingTarget(plan, appointments) {
  if (plan.type === 'create') {
    return { date: plan.appointment.date, time: plan.appointment.start_time };
  }
  if (plan.type === 'cancel') return { id: plan.appointment_id };
  var orig = find(appointments, plan.appointment_id);
  return {
    id: plan.appointment_id,
    date: plan.changes.date || orig.date,
    time: plan.changes.start_time || fmt.hhmm(orig.start_time),
  };
}

// confirmationText(plan, appointments) -> the message shown after ACT.
function confirmationText(plan, appointments) {
  if (plan.type === 'create') {
    var a = plan.appointment;
    return 'Booked: ' + a.title + ' on ' + fmt.fmtDate(a.date) + ' at ' + fmt.hhmm(a.start_time) + '.';
  }
  var orig = find(appointments, plan.appointment_id);
  if (plan.type === 'cancel') {
    return 'Cancelled: ' + orig.title + ' on ' + fmt.fmtDate(orig.date) + ' at ' + fmt.hhmm(orig.start_time) + '.';
  }
  var t = resultingTarget(plan, appointments);
  return 'Moved ' + orig.title + ' to ' + fmt.fmtDate(t.date) + ' at ' + t.time + '.';
}

module.exports = {
  planAction: planAction,
  resultingTarget: resultingTarget,
  confirmationText: confirmationText,
  VAGUE_TIME_DEFAULT: VAGUE_TIME_DEFAULT,
};
