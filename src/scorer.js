// Shared hypothesis generation and scoring (pipeline box 2). Used by BOTH policies,
// so K and T differ only in their ask-or-act rule. Deterministic, no LLM, no I/O:
// the caller passes in the parsed request (src/parser.js) and the appointments rows.
//
// Student's decisions (2026-11-19, recorded in docs/ai-log.md):
//  1. new_date / new_time are NEVER read here. They describe where a reschedule
//     should go, not which appointment is meant, so they cannot rank appointments.
//     They are used later: a reschedule with no destination fires MISSING-SLOT and
//     a vague new_time fires TIME-EXPR (box 3), and both lower slot completeness
//     (box 4).
//  2. Each matched slot adds a fixed integer weight; a specified-but-mismatched slot
//     adds 0. The score range is 0..MAX_SCORE (12), wide enough that Policy T's
//     softmax (scale fixed at 1) gives a usable spread. Weights are fixed BEFORE any
//     policy is run; only each policy's threshold is tuned.
//
// Agent's choices, still to be confirmed by the student (see docs/ai-log.md):
//  - cancel/reschedule candidates are only the appointments that match at least one
//    given slot (score > 0); the rest are dropped so they do not dilute T's softmax.
//  - a vague time ("morning" < 12:00, "afternoon" 12:00-16:59, "evening" >= 17:00)
//    counts as a full time match for an appointment starting in that part of the day.
//  - a create has exactly one hypothesis, scored by the weights of the slots given.

var WEIGHTS = { date: 4, time: 4, person: 3, duration: 1 };
var SLOT_ORDER = ['date', 'time', 'person', 'duration'];
var MAX_SCORE = SLOT_ORDER.reduce(function (sum, k) { return sum + WEIGHTS[k]; }, 0);
var INTENTS = ['create', 'cancel', 'reschedule'];

// Start-of-day windows as HH:MM strings (compared as text; zero-padded so this is safe).
var PART_OF_DAY = {
  morning: { from: '00:00', to: '12:00' },
  afternoon: { from: '12:00', to: '17:00' },
  evening: { from: '17:00', to: '24:00' },
};

function hhmm(t) {
  return typeof t === 'string' ? t.slice(0, 5) : null; // Supabase returns "HH:MM:SS"
}

function isGiven(v) {
  return v !== null && v !== undefined;
}

// Which of the four matching slots did the user give?
function specifiedSlots(slots) {
  return SLOT_ORDER.filter(function (k) { return isGiven(slots[k]); });
}

function timeMatches(wanted, startTime) {
  var start = hhmm(startTime);
  if (start === null) return false;
  var part = PART_OF_DAY[wanted];
  if (part) return start >= part.from && start < part.to;
  return start === wanted;
}

function slotMatches(slot, wanted, appt) {
  switch (slot) {
    case 'date': return appt.date === wanted;
    case 'time': return timeMatches(wanted, appt.start_time);
    case 'person':
      return typeof appt.person === 'string' && typeof wanted === 'string' &&
        appt.person.trim().toLowerCase() === wanted.trim().toLowerCase();
    case 'duration': return appt.duration_minutes === wanted;
    default: return false;
  }
}

function scoreAppointment(slots, appt) {
  var matched = specifiedSlots(slots).filter(function (k) { return slotMatches(k, slots[k], appt); });
  var score = matched.reduce(function (sum, k) { return sum + WEIGHTS[k]; }, 0);
  return { score: score, matched: matched };
}

function byScoreThenStableKey(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  var ka = [a.date, a.start_time, a.appointment_id];
  var kb = [b.date, b.start_time, b.appointment_id];
  for (var i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

// scoreHypotheses(parsed, appointments) ->
//   { intent, specified: [slot names the user gave],
//     hypotheses: [{ rank, intent, appointment_id, score, matched }] }   best first
// parsed = the `parsed` object from parseRequest ({intent, slots}); appointments =
// rows with id, date (YYYY-MM-DD), start_time, person, duration_minutes.
// An empty hypotheses list means nothing on the calendar matches any given slot.
function scoreHypotheses(parsed, appointments) {
  if (!parsed || INTENTS.indexOf(parsed.intent) === -1 || !parsed.slots || typeof parsed.slots !== 'object') {
    throw new TypeError('scoreHypotheses needs a parsed request {intent, slots}');
  }
  if (!Array.isArray(appointments)) {
    throw new TypeError('scoreHypotheses needs an array of appointments');
  }
  var slots = parsed.slots;
  var specified = specifiedSlots(slots);
  var hypotheses;

  if (parsed.intent === 'create') {
    var createScore = specified.reduce(function (sum, k) { return sum + WEIGHTS[k]; }, 0);
    hypotheses = [{ intent: 'create', appointment_id: null, score: createScore, matched: specified.slice() }];
  } else {
    hypotheses = appointments
      .map(function (appt) {
        var r = scoreAppointment(slots, appt);
        return {
          intent: parsed.intent,
          appointment_id: appt.id,
          score: r.score,
          matched: r.matched,
          date: appt.date,
          start_time: appt.start_time,
        };
      })
      .filter(function (h) { return h.score > 0; })
      .sort(byScoreThenStableKey)
      .map(function (h) {
        return { intent: h.intent, appointment_id: h.appointment_id, score: h.score, matched: h.matched };
      });
  }

  hypotheses.forEach(function (h, i) { h.rank = i + 1; });
  return { intent: parsed.intent, specified: specified, hypotheses: hypotheses };
}

module.exports = {
  scoreHypotheses: scoreHypotheses,
  WEIGHTS: WEIGHTS,
  MAX_SCORE: MAX_SCORE,
  PART_OF_DAY: PART_OF_DAY,
};
