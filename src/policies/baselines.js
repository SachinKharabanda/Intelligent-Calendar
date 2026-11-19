// Control policies (student's decision C1, 2026-11-19): two deliberately dumb baselines that
// give K, K2 and T something to be compared with.
//   ALWAYS ("always ask"): ASK on every request the pre-check lets through.
//   NEVER  ("never ask"):  ACT on every request the pre-check lets through.
// They replace ONLY the ask-or-act rule. The shared pre-check (src/pipeline.js) still runs
// first, for every policy: a request with a missing required slot is asked about (it cannot
// be executed), and a request matching nothing is "not found". So NEVER is "never ask beyond
// the pre-check", not "never ask at all"; say so in the report.

function createPolicyAlways() {
  return {
    name: 'ALWAYS',
    params: {},
    decide: function () {
      return { decision: 'ask', theta: null };
    },
  };
}

function createPolicyNever() {
  return {
    name: 'NEVER',
    params: {},
    decide: function () {
      return { decision: 'act', theta: null };
    },
  };
}

module.exports = { createPolicyAlways: createPolicyAlways, createPolicyNever: createPolicyNever };
