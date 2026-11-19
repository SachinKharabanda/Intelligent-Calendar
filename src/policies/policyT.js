// Policy T (simplified re-implementation of Testoni & Fernandez): ASK if the entropy
// of the softmax over the hypothesis scores >= theta, else ACT.
//
// Student's decisions (2026-11-19, docs/decision-options.md D3): raw natural-log
// entropy (nats), softmax scale fixed at 1, starting theta 0.5 (tuned once on the dev
// set), T reads ONLY the hypothesis scores (not the box-3 ambiguity types).
// Caveat for the report: the entropy is over OUR scoring function, not the LLM's own
// uncertainty. Two tied candidates give ln 2 = 0.69; a single hypothesis gives 0.

var DEFAULT_PARAMS = { theta: 0.5 };

// entropy(scores) -> H in nats of softmax(scores), scale 1. Empty or one score -> 0.
function entropy(scores) {
  if (scores.length < 2) return 0;
  var max = Math.max.apply(null, scores); // subtract the max for numerical stability
  var exps = scores.map(function (s) { return Math.exp(s - max); });
  var z = exps.reduce(function (a, b) { return a + b; }, 0);
  var h = 0;
  exps.forEach(function (e) {
    var p = e / z;
    if (p > 0) h -= p * Math.log(p);
  });
  return h;
}

// createPolicyT(params?) -> { name, params, decide(ctx) }
// ctx = { parsed, scored, ambiguity }. decide -> { decision:'ask'|'act', entropy, theta }
function createPolicyT(params) {
  var theta = params && params.theta !== undefined ? params.theta : DEFAULT_PARAMS.theta;
  if (typeof theta !== 'number' || !isFinite(theta) || theta < 0) {
    throw new RangeError('Policy T: theta must be a number >= 0.');
  }
  return {
    name: 'T',
    params: { theta: theta },
    decide: function (ctx) {
      var h = entropy(ctx.scored.hypotheses.map(function (x) { return x.score; }));
      return { decision: h >= theta ? 'ask' : 'act', entropy: h, theta: theta };
    },
  };
}

module.exports = { createPolicyT: createPolicyT, entropy: entropy, DEFAULT_PARAMS: DEFAULT_PARAMS };
