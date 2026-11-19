// Decision features (pipeline box 4). Used by Policy K only (Policy T reads the
// hypothesis scores directly). Pure and deterministic: no LLM, no I/O.
//
// Student's decisions (2026-11-19, docs/decision-options.md D2): every feature is
// oriented so that HIGHER = MORE REASON TO ASK, so all Policy K weights are >= 0.
// The "repeated request" flag is DROPPED (always 0 in single-turn simulations).
//
//   low_top         1 - s1/MAX_SCORE               top hypothesis score is low
//   low_margin      1 - (s1 - s2)/MAX_SCORE        runner-up is close (s2 = 0 if none)
//   INTENT, MULTI_MATCH, MISSING_SLOT, TIME_EXPR   the occurrence vector from box 3
//   incompleteness  1 - mean(required slots)       present = 1, vague = 0.5, missing = 0
//   risk            cancel 1.0, reschedule 0.5, create 0.0   (student's booking-specific addition)
//
// Required slots (same as box 3): create = date, time; cancel = a slot that identifies
// the appointment; reschedule = identifying slot + destination (new_date or new_time).

var scorer = require('./scorer');

var RISK = { cancel: 1, reschedule: 0.5, create: 0 };
var FEATURE_NAMES = ['low_top', 'low_margin', 'INTENT', 'MULTI_MATCH', 'MISSING_SLOT', 'TIME_EXPR', 'incompleteness', 'risk'];

function isGiven(v) {
  return v !== null && v !== undefined;
}

function timeValue(v) {
  if (!isGiven(v)) return 0;
  return Object.prototype.hasOwnProperty.call(scorer.PART_OF_DAY, v) ? 0.5 : 1;
}

function incompleteness(parsed, scored) {
  var s = parsed.slots;
  var parts;
  if (parsed.intent === 'create') {
    parts = [isGiven(s.date) ? 1 : 0, timeValue(s.time)];
  } else {
    parts = [scored.specified.length > 0 ? 1 : 0];
    if (parsed.intent === 'reschedule') {
      parts.push(Math.max(isGiven(s.new_date) ? 1 : 0, timeValue(s.new_time)));
    }
  }
  var mean = parts.reduce(function (a, b) { return a + b; }, 0) / parts.length;
  return 1 - mean;
}

// computeFeatures(parsed, scored, ambiguity) -> { low_top, low_margin, ... } (all numbers)
function computeFeatures(parsed, scored, ambiguity) {
  if (!parsed || !RISK.hasOwnProperty(parsed.intent) || !parsed.slots) {
    throw new TypeError('computeFeatures needs a parsed request {intent, slots}');
  }
  if (!scored || !Array.isArray(scored.hypotheses) || !Array.isArray(scored.specified)) {
    throw new TypeError('computeFeatures needs the scoreHypotheses result');
  }
  if (!ambiguity || !ambiguity.vector) {
    throw new TypeError('computeFeatures needs the detectAmbiguity result');
  }
  var h = scored.hypotheses;
  var s1 = h.length > 0 ? h[0].score : 0;
  var s2 = h.length > 1 ? h[1].score : 0;
  var M = scorer.MAX_SCORE;
  return {
    low_top: 1 - s1 / M,
    low_margin: 1 - (s1 - s2) / M,
    INTENT: ambiguity.vector.INTENT,
    MULTI_MATCH: ambiguity.vector.MULTI_MATCH,
    MISSING_SLOT: ambiguity.vector.MISSING_SLOT,
    TIME_EXPR: ambiguity.vector.TIME_EXPR,
    incompleteness: incompleteness(parsed, scored),
    risk: RISK[parsed.intent],
  };
}

module.exports = {
  computeFeatures: computeFeatures,
  FEATURE_NAMES: FEATURE_NAMES,
  RISK: RISK,
};
