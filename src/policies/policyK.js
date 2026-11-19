// Policy K (simplified re-implementation of Kim et al.): ASK if w . f >= theta, else ACT.
// f = decision features (src/features.js, box 4); w and theta are set BY HAND, not
// trained. The starting values below are the student's choice (D2-W, 2026-11-19, taken
// from docs/decision-options.md); they are tuned ONCE on the dev set, then fixed.
// This is a linear threshold rule, not a neural model.

var features = require('../features');

var DEFAULT_PARAMS = {
  w: {
    low_top: 2,
    low_margin: 3,
    INTENT: 3,
    MULTI_MATCH: 4,
    MISSING_SLOT: 5,
    TIME_EXPR: 3,
    incompleteness: 2,
    risk: 1,
  },
  theta: 4,
};

function resolveParams(params) {
  var w = Object.assign({}, DEFAULT_PARAMS.w, params && params.w);
  var theta = params && params.theta !== undefined ? params.theta : DEFAULT_PARAMS.theta;
  Object.keys(w).forEach(function (k) {
    if (features.FEATURE_NAMES.indexOf(k) === -1) throw new RangeError('Policy K: unknown weight "' + k + '".');
  });
  features.FEATURE_NAMES.forEach(function (k) {
    if (typeof w[k] !== 'number' || !isFinite(w[k]) || w[k] < 0) {
      throw new RangeError('Policy K: weight "' + k + '" must be a number >= 0.');
    }
  });
  if (typeof theta !== 'number' || !isFinite(theta)) throw new RangeError('Policy K: theta must be a number.');
  return { w: w, theta: theta };
}

// REVISED K ("K2"): the ONE revision allowed after the first dev run (student's decision,
// 2026-11-19, option B). Dev run 1 showed two vague-time requests (D24, D25) scoring 3.92,
// just under theta 4, while a clear request (D08) scored 4.08, so theta alone could not
// separate them. Change: the TIME_EXPR weight goes from 3 to 4. Nothing else changes, and
// the original K above (DEFAULT_PARAMS) is left untouched so both can be evaluated on the
// held-out test set.
var REVISED_CHANGES = { w: { TIME_EXPR: 4 } };

// createPolicyK(params?, name?) -> { name, params, decide(ctx) }
// ctx = { parsed, scored, ambiguity }. decide -> { decision:'ask'|'act', score, theta, features }
function createPolicyK(params, name) {
  var p = resolveParams(params);
  return {
    name: name || 'K',
    params: p,
    decide: function (ctx) {
      var f = features.computeFeatures(ctx.parsed, ctx.scored, ctx.ambiguity);
      var score = features.FEATURE_NAMES.reduce(function (sum, k) { return sum + p.w[k] * f[k]; }, 0);
      return { decision: score >= p.theta ? 'ask' : 'act', score: score, theta: p.theta, features: f };
    },
  };
}

// createPolicyKRevised(params?) -> policy named 'K2': K with the revision applied
// (explicit params still win, e.g. for a theta check).
function createPolicyKRevised(params) {
  var merged = {
    w: Object.assign({}, REVISED_CHANGES.w, params && params.w),
    theta: params && params.theta !== undefined ? params.theta : DEFAULT_PARAMS.theta,
  };
  return createPolicyK(merged, 'K2');
}

module.exports = {
  createPolicyK: createPolicyK,
  createPolicyKRevised: createPolicyKRevised,
  DEFAULT_PARAMS: DEFAULT_PARAMS,
  REVISED_CHANGES: REVISED_CHANGES,
};
