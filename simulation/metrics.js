// Metrics for one (set, policy) run. Pure. Student's decisions (D7, 2026-11-19):
//  - positive class = "should clarify" (gt_ambiguous = true);
//  - report COUNTS next to every rate; no significance claims;
//  - wrong-action rate is per ACT (acts that were wrong / acts);
//  - parse failures are excluded from every policy count and reported separately;
//  - 'not_found' requests (nothing on the calendar matched) are neither ask nor act and are
//    left out of the confusion matrix (reported as a count);
//  - turn 1 only: an ASK is assumed to be resolved, so questions per request = asks / parsed.
// "Wrong action" = the policy ACTED and either the request was ambiguous (no single correct
// action exists, so the correct behaviour was to ask) or the action differs from gt_target.

function ratio(n, d) {
  return d === 0 ? null : n / d;
}

function f1(p, r) {
  if (p === null || r === null || p + r === 0) return null;
  return (2 * p * r) / (p + r);
}

// summarise(results) -> counts and rates. `results` = the per-request records from harness.js.
function summarise(results) {
  var parsed = results.filter(function (r) { return r.parse_ok; });
  var decided = parsed.filter(function (r) { return r.decision === 'ask' || r.decision === 'act'; });
  var asks = decided.filter(function (r) { return r.decision === 'ask'; });
  var acts = decided.filter(function (r) { return r.decision === 'act'; });

  var tp = decided.filter(function (r) { return r.decision === 'ask' && r.gt_ambiguous; }).length;
  var fp = decided.filter(function (r) { return r.decision === 'ask' && !r.gt_ambiguous; }).length;
  var fn = decided.filter(function (r) { return r.decision === 'act' && r.gt_ambiguous; }).length;
  var tn = decided.filter(function (r) { return r.decision === 'act' && !r.gt_ambiguous; }).length;
  var precision = ratio(tp, tp + fp);
  var recall = ratio(tp, tp + fn);

  var wrong = acts.filter(function (r) { return r.wrong_action; });
  var byType = {};
  decided.filter(function (r) { return r.gt_ambiguous; }).forEach(function (r) {
    var key = r.gt_types && r.gt_types.length > 0 ? r.gt_types[0] : 'UNDETECTABLE';
    byType[key] = byType[key] || { n: 0, asked: 0 };
    byType[key].n += 1;
    if (r.decision === 'ask') byType[key].asked += 1;
  });

  var withIntent = parsed.filter(function (r) { return r.parse_correct.intent !== null; });

  return {
    requests: results.length,
    parse_failures: results.length - parsed.length,
    parsed: parsed.length,
    not_found: parsed.filter(function (r) { return r.decision === 'not_found'; }).length,
    decided: decided.length,
    asks: asks.length,
    acts: acts.length,
    asks_by_precheck: asks.filter(function (r) { return r.by === 'precheck'; }).length,
    confusion: { tp: tp, fp: fp, fn: fn, tn: tn },
    precision: precision,
    recall: recall,
    f1: f1(precision, recall),
    clarification_rate: ratio(asks.length, decided.length),
    questions_per_request: ratio(asks.length, decided.length), // turn 1 only, so equal to the rate
    wrong_actions: wrong.length,
    wrong_action_rate: ratio(wrong.length, acts.length),
    wrong_actions_on_ambiguous: wrong.filter(function (r) { return r.gt_ambiguous; }).length,
    wrong_actions_on_clear: wrong.filter(function (r) { return !r.gt_ambiguous; }).length,
    ambiguous_by_type: byType,
    parser: {
      intent_correct: withIntent.filter(function (r) { return r.parse_correct.intent; }).length,
      intent_checked: withIntent.length,
      slots_exact: parsed.filter(function (r) { return r.parse_correct.slots; }).length,
      slots_checked: parsed.length,
    },
  };
}

module.exports = { summarise: summarise };
