// Simulation harness core: replays a labelled request set against ONE policy.
// Simulated users are SCRIPTED (hand-written requests, labels fixed by construction):
// they are not participants. Turn 1 only (student's decision D4-F): the harness logs
// whether the policy would ASK or ACT and whether that was right; after an ASK the
// resolution is assumed to succeed. Nothing is written to the database: ACT is planned
// and compared with gt_target, never executed.
//
// Dependencies are injected (parser, policy, fixture) so the harness is testable offline.
// The CLI wrapper is simulation/run.js.

var pipeline = require('../src/pipeline');
var questions = require('../src/questions');
var actions = require('../src/actions');
var metrics = require('./metrics');

var SLOT_KEYS = ['date', 'time', 'new_date', 'new_time', 'person', 'duration'];

function slotsEqual(parsedSlots, gtSlots) {
  return SLOT_KEYS.every(function (k) {
    var a = parsedSlots[k] === undefined ? null : parsedSlots[k];
    var b = gtSlots && gtSlots[k] !== undefined ? gtSlots[k] : null;
    return a === b;
  });
}

function targetMatches(actual, gt) {
  if (!gt) return false;
  return Object.keys(gt).every(function (k) { return actual[k] === gt[k]; });
}

// runRequest({request, fixture, parser, policy}) -> per-request record
async function runRequest(args) {
  var req = args.request;
  var rec = {
    id: req.id,
    text: req.text,
    gt_ambiguous: req.gt_ambiguous,
    gt_types: req.gt_types || [],
    gt_intent: req.gt_intent === undefined ? null : req.gt_intent,
    parse_ok: false,
    parsed: null,
    parse_correct: { intent: null, slots: null },
    decision: null,
    by: null,
    fired: [],
    policy_result: null,
    question: null,
    action: null,
    clarify_correct: null,
    wrong_action: null,
  };

  var r = await args.parser.parseRequest(req.text);
  if (!r.ok) {
    rec.parse_error = r.error;
    return rec;
  }
  rec.parse_ok = true;
  rec.parsed = r.parsed;
  rec.parse_correct = {
    intent: rec.gt_intent === null ? null : r.parsed.intent === rec.gt_intent,
    slots: slotsEqual(r.parsed.slots, req.gt_slots),
  };

  var appointments = args.fixture.appointments;
  var d = pipeline.decide(r.parsed, appointments, args.policy);
  rec.decision = d.decision;
  rec.by = d.by;
  rec.fired = d.ambiguity.fired;
  rec.policy_result = d.policy_result;

  if (d.decision === 'ask') {
    rec.question = questions.buildQuestion(r.parsed, d.ambiguity, d.scored, appointments).text;
    rec.clarify_correct = req.gt_ambiguous === true;
  } else if (d.decision === 'act') {
    var plan = actions.planAction(r.parsed, d.scored, { source: 'simulation' });
    var target = actions.resultingTarget(plan, appointments);
    rec.action = { plan: plan, target: target };
    rec.clarify_correct = req.gt_ambiguous === false;
    // Wrong = acted on an ambiguous request (the right move was to ask), or the action
    // is of the wrong type / on the wrong target.
    rec.wrong_action = req.gt_ambiguous === true || plan.type !== rec.gt_intent || !targetMatches(target, req.gt_target);
  }
  return rec;
}

// runSet({requests, fixture, parser, policy}) -> { results, summary }  (sequential, in order)
async function runSet(args) {
  var results = [];
  for (var i = 0; i < args.requests.length; i++) {
    results.push(await runRequest({ request: args.requests[i], fixture: args.fixture, parser: args.parser, policy: args.policy }));
  }
  return { results: results, summary: metrics.summarise(results) };
}

module.exports = { runSet: runSet, runRequest: runRequest };
