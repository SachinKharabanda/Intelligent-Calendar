// Boxes 2-5 glued together: score -> detect ambiguity -> (pre-check) -> policy.
// Pure and deterministic given the policy; no LLM, no I/O.
//
// Student's decision D1 (2026-11-19): a shared executability pre-check runs BEFORE
// either policy. A request that lacks a required slot (box 3's MISSING_SLOT) always
// ASKs, for K and T alike, because it cannot be executed anyway. The policies only
// decide the remaining requests. Nothing matched on the calendar -> 'not_found'
// (D4-N: say so, neither ask nor act).

var scorer = require('./scorer');
var ambiguity = require('./ambiguity');

// decide(parsed, appointments, policy) ->
//   { decision: 'ask'|'act'|'not_found', by: 'precheck'|'policy'|'no_match',
//     scored, ambiguity, policy_result|null }
function decide(parsed, appointments, policy) {
  var scored = scorer.scoreHypotheses(parsed, appointments);
  var amb = ambiguity.detectAmbiguity(parsed, scored);
  var out = { decision: null, by: null, scored: scored, ambiguity: amb, policy_result: null };

  if (amb.no_match) {
    out.decision = 'not_found';
    out.by = 'no_match';
    return out;
  }
  if (amb.vector.MISSING_SLOT) {
    out.decision = 'ask';
    out.by = 'precheck';
    return out;
  }
  var r = policy.decide({ parsed: parsed, scored: scored, ambiguity: amb });
  out.decision = r.decision;
  out.by = 'policy';
  out.policy_result = r;
  return out;
}

module.exports = { decide: decide };
