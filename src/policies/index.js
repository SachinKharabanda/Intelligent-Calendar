// Selects the active ClarificationPolicy: ONE codebase, a swappable strategy, so every policy
// differs only in its ask-or-act rule (student's decision, D8). The app picks it with the
// environment variable CLARIFICATION_POLICY (no default: the adopted policy is set
// explicitly); the harness passes --policy.
//   K      Kim et al. adaptation, hand-set linear score, theta 4
//   K2     K after the single post-dev revision (TIME_EXPR weight 3 -> 4)
//   T      Testoni and Fernandez adaptation, softmax entropy, theta 0.5
//   ALWAYS control: ask on every request the shared pre-check lets through
//   NEVER  control: act on every request the shared pre-check lets through

var createPolicyK = require('./policyK').createPolicyK;
var createPolicyKRevised = require('./policyK').createPolicyKRevised;
var createPolicyT = require('./policyT').createPolicyT;
var baselines = require('./baselines');

var NAMES = ['K', 'K2', 'T', 'ALWAYS', 'NEVER'];

// createPolicy(name, params?) -> policy
function createPolicy(name, params) {
  if (name === 'K') return createPolicyK(params);
  if (name === 'K2') return createPolicyKRevised(params);
  if (name === 'T') return createPolicyT(params);
  if (name === 'ALWAYS') return baselines.createPolicyAlways();
  if (name === 'NEVER') return baselines.createPolicyNever();
  throw new RangeError('Unknown policy "' + name + '"; expected one of: ' + NAMES.join(', ') + '.');
}

function policyFromEnv(env) {
  var name = (env || process.env).CLARIFICATION_POLICY;
  if (!name) {
    throw new Error('CLARIFICATION_POLICY is not set (expected K, K2 or T). See .env.example.');
  }
  name = name.trim().toUpperCase();
  // The two controls exist for experiments only; the live app must not run them.
  if (name === 'ALWAYS' || name === 'NEVER') {
    throw new RangeError('CLARIFICATION_POLICY must be K, K2 or T for the app; ' + name + ' is an experiment control.');
  }
  return createPolicy(name);
}

module.exports = { createPolicy: createPolicy, policyFromEnv: policyFromEnv, NAMES: NAMES };
