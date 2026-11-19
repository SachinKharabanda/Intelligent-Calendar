// Ambiguity detection (pipeline box 3). Used by BOTH policies (K reads the occurrence
// vector as a decision feature; both policies pick the template clarifying question
// from the fired types). Deterministic, no LLM, no I/O: the caller passes in the
// parsed request (src/parser.js) and the scorer output (src/scorer.js).
//
// Four types adapted from Kim et al.'s five (SNR dropped: no audio):
//   INTENT        (<- IC)    the slots contradict the intent: a destination
//                            (new_date / new_time) was given but the intent is not
//                            "reschedule" (e.g. "cancel my 3pm, move it to Friday").
//   MULTI_MATCH   (<- HC)    cancel/reschedule: two or more appointments tie for the
//                            best score, so more than one fits the request.
//   MISSING_SLOT  (<- TRUNC) a slot needed to act is absent (see REQUIRED below).
//   TIME_EXPR     (<- ASR)   the time to book is a vague word ("afternoon") that must
//                            be made concrete: `time` for create, `new_time` for reschedule.
//
// Rules and why (agent's reading of the student's design; student to confirm):
//  - A vague `time` that only IDENTIFIES an existing appointment (cancel, or the
//    "from" side of a reschedule) does NOT fire TIME_EXPR: the scorer already matches it
//    by part of day, and if it fits several appointments MULTI_MATCH fires instead.
//  - Reschedule with no destination fires MISSING_SLOT (student's decision 2026-11-19);
//    a destination is "given" if new_date OR new_time is present (a bare new_time keeps
//    the day).
//  - A vague time counts as GIVEN for MISSING_SLOT (it is TIME_EXPR, not missing).
//  - INTENT is detected from the slots only: the parser returns one intent and no
//    confidence, so a cancel/reschedule mix-up with no destination slot is not detectable.
//
// Each fired type contributes one "best alternative" next to the top hypothesis.

var scorer = require('./scorer');

var TYPES = ['INTENT', 'MULTI_MATCH', 'MISSING_SLOT', 'TIME_EXPR'];
var INTENTS = ['create', 'cancel', 'reschedule'];

// Slots a create needs before it can be acted on. person and duration are optional.
var REQUIRED = { create: ['date', 'time'] };

function isGiven(v) {
  return v !== null && v !== undefined;
}

function isVague(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(scorer.PART_OF_DAY, v);
}

// detectAmbiguity(parsed, scored) ->
//   { intent,
//     vector: { INTENT, MULTI_MATCH, MISSING_SLOT, TIME_EXPR }   each 0 or 1
//     occurrence: [0|1, ...]  the same vector in TYPES order (for w . f)
//     fired: [type names],
//     alternatives: [{ type, ... }]   one best alternative per fired type
//     missing: [slot or role names]   what MISSING_SLOT is about ('appointment' = which
//                                     appointment, 'destination' = new_date/new_time)
//     no_match: true when cancel/reschedule gave at least one slot but no appointment
//               matches any of them (not an ambiguity type: nothing can be acted on) }
// parsed = parseRequest().parsed; scored = scoreHypotheses(parsed, appointments).
function detectAmbiguity(parsed, scored) {
  if (!parsed || INTENTS.indexOf(parsed.intent) === -1 || !parsed.slots || typeof parsed.slots !== 'object') {
    throw new TypeError('detectAmbiguity needs a parsed request {intent, slots}');
  }
  if (!scored || scored.intent !== parsed.intent || !Array.isArray(scored.hypotheses) || !Array.isArray(scored.specified)) {
    throw new TypeError('detectAmbiguity needs the scoreHypotheses result for the same request');
  }
  var intent = parsed.intent;
  var slots = parsed.slots;
  var hyps = scored.hypotheses;
  var existing = intent !== 'create';
  var alternatives = [];
  var missing = [];
  var fired = {};

  // INTENT
  if (intent !== 'reschedule') {
    var dest = ['new_date', 'new_time'].filter(function (k) { return isGiven(slots[k]); });
    if (dest.length > 0) {
      fired.INTENT = { type: 'INTENT', intent: 'reschedule', because: dest };
    }
  }

  // MULTI_MATCH: two or more appointments tie for the best score.
  if (existing && hyps.length >= 2 && hyps[0].score === hyps[1].score) {
    var top = hyps[0].score;
    fired.MULTI_MATCH = {
      type: 'MULTI_MATCH',
      appointment_id: hyps[1].appointment_id,
      candidates: hyps.filter(function (h) { return h.score === top; }).map(function (h) { return h.appointment_id; }),
    };
  }

  // MISSING_SLOT
  if (intent === 'create') {
    missing = REQUIRED.create.filter(function (k) { return !isGiven(slots[k]); });
  } else {
    if (scored.specified.length === 0) missing.push('appointment');
    if (intent === 'reschedule' && !isGiven(slots.new_date) && !isGiven(slots.new_time)) missing.push('destination');
  }
  if (missing.length > 0) {
    fired.MISSING_SLOT = { type: 'MISSING_SLOT', missing: missing.slice() };
  }

  // TIME_EXPR: the time to book is vague.
  var timeSlot = intent === 'create' ? 'time' : intent === 'reschedule' ? 'new_time' : null;
  if (timeSlot && isVague(slots[timeSlot])) {
    fired.TIME_EXPR = { type: 'TIME_EXPR', slot: timeSlot, value: slots[timeSlot] };
  }

  var vector = {};
  var occurrence = [];
  var firedTypes = [];
  TYPES.forEach(function (t) {
    var on = fired[t] ? 1 : 0;
    vector[t] = on;
    occurrence.push(on);
    if (on) {
      firedTypes.push(t);
      alternatives.push(fired[t]);
    }
  });

  return {
    intent: intent,
    vector: vector,
    occurrence: occurrence,
    fired: firedTypes,
    alternatives: alternatives,
    missing: missing,
    no_match: existing && scored.specified.length > 0 && hyps.length === 0,
  };
}

module.exports = {
  detectAmbiguity: detectAmbiguity,
  TYPES: TYPES,
  REQUIRED: REQUIRED,
};
