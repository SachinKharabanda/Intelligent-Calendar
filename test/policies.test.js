// Offline tests for src/features.js, src/policies/*.js and src/pipeline.js.
// They check the rules as written, on hand-made requests. They say nothing about how
// well K or T perform on real requests (that is the experiment).
var test = require('node:test');
var assert = require('node:assert/strict');
var h = require('./helpers');
var features = require('../src/features');
var policies = require('../src/policies');
var policyK = require('../src/policies/policyK');
var policyT = require('../src/policies/policyT');
var pipeline = require('../src/pipeline');

var parsed = h.parsed;
var ctx = h.ctx;
function close(a, b) { assert.ok(Math.abs(a - b) < 1e-9, a + ' != ' + b); }
function feats(p, cal) { var c = ctx(p, cal); return features.computeFeatures(c.parsed, c.scored, c.ambiguity); }

// ---- features (box 4) ----

test('feature names are fixed and the repeated-request flag is dropped', function () {
  assert.deepEqual(features.FEATURE_NAMES, ['low_top', 'low_margin', 'INTENT', 'MULTI_MATCH', 'MISSING_SLOT', 'TIME_EXPR', 'incompleteness', 'risk']);
});

test('clear create: high top score, no ambiguity, no risk', function () {
  var f = feats(parsed('create', { date: '2026-11-27', time: '14:00', person: 'Sam' }));
  close(f.low_top, 1 - 11 / 12);
  close(f.low_margin, 1 - 11 / 12); // single hypothesis: s2 = 0
  assert.equal(f.MULTI_MATCH, 0);
  assert.equal(f.incompleteness, 0);
  assert.equal(f.risk, 0);
});

test('cancel by "3pm" ties: margin feature is maximal, multi-match fires, cancel risk is 1', function () {
  var f = feats(parsed('cancel', { time: '15:00' }));
  close(f.low_top, 1 - 4 / 12);
  assert.equal(f.low_margin, 1);
  assert.equal(f.MULTI_MATCH, 1);
  assert.equal(f.incompleteness, 0);
  assert.equal(f.risk, 1);
});

test('incompleteness: vague = 0.5, missing = 0, mean over required slots', function () {
  close(feats(parsed('create', { date: '2026-11-27', time: 'afternoon' })).incompleteness, 0.25); // [1, .5]
  close(feats(parsed('create', { date: '2026-11-27' })).incompleteness, 0.5); // [1, 0]
  close(feats(parsed('reschedule', { date: '2026-11-26', time: '09:00' })).incompleteness, 0.5); // [1, 0]
  close(feats(parsed('reschedule', { date: '2026-11-26', time: '09:00', new_time: 'evening' })).incompleteness, 0.25); // [1, .5]
  close(feats(parsed('cancel', {})).incompleteness, 1);
});

test('risk ordering: cancel > reschedule > create', function () {
  var c = feats(parsed('cancel', { date: '2026-11-24', time: '10:00' })).risk;
  var r = feats(parsed('reschedule', { date: '2026-11-24', time: '10:00', new_time: '11:00' })).risk;
  var n = feats(parsed('create', { date: '2026-11-24', time: '10:00' })).risk;
  assert.ok(c > r && r > n);
});

test('computeFeatures rejects bad input', function () {
  var c = ctx(parsed('cancel', { time: '15:00' }));
  assert.throws(function () { features.computeFeatures(null, c.scored, c.ambiguity); }, TypeError);
  assert.throws(function () { features.computeFeatures(c.parsed, null, c.ambiguity); }, TypeError);
  assert.throws(function () { features.computeFeatures(c.parsed, c.scored, null); }, TypeError);
});

// ---- Policy K ----

test('K defaults are the chosen starting values', function () {
  assert.deepEqual(policyK.DEFAULT_PARAMS, {
    w: { low_top: 2, low_margin: 3, INTENT: 3, MULTI_MATCH: 4, MISSING_SLOT: 5, TIME_EXPR: 3, incompleteness: 2, risk: 1 },
    theta: 4,
  });
});

test('K acts on clear requests and asks on ambiguous ones (hand-made requests)', function () {
  var k = policies.createPolicy('K');
  var clearCreate = k.decide(ctx(parsed('create', { date: '2026-11-27', time: '14:00', person: 'Sam' })));
  assert.equal(clearCreate.decision, 'act');
  close(clearCreate.score, 2 * (1 / 12) + 3 * (1 / 12)); // low_top + low_margin only
  var clearCancel = k.decide(ctx(parsed('cancel', { date: '2026-11-24', time: '10:00', person: 'Sam' })));
  assert.equal(clearCancel.decision, 'act');
  assert.ok(clearCancel.score < 4);
  var multi = k.decide(ctx(parsed('cancel', { time: '15:00' })));
  assert.equal(multi.decision, 'ask');
  assert.ok(multi.score >= multi.theta);
  var vague = k.decide(ctx(parsed('create', { date: '2026-11-27', time: 'afternoon' })));
  assert.equal(vague.decision, 'ask'); // K sees TIME_EXPR; T does not (see below)
});

test('K weights and theta can be overridden; bad parameters throw', function () {
  var always = policyK.createPolicyK({ theta: 0 });
  assert.equal(always.decide(ctx(parsed('create', { date: '2026-11-27', time: '14:00' }))).decision, 'ask');
  var never = policyK.createPolicyK({ theta: 1000 });
  assert.equal(never.decide(ctx(parsed('cancel', { time: '15:00' }))).decision, 'act');
  assert.throws(function () { policyK.createPolicyK({ w: { risk: -1 } }); }, RangeError);
  assert.throws(function () { policyK.createPolicyK({ w: { bogus: 1 } }); }, RangeError);
  assert.throws(function () { policyK.createPolicyK({ theta: 'x' }); }, RangeError);
});

test('K result carries its score, threshold and features', function () {
  var r = policies.createPolicy('K').decide(ctx(parsed('cancel', { time: '15:00' })));
  assert.equal(r.theta, 4);
  assert.equal(Object.keys(r.features).length, features.FEATURE_NAMES.length);
});

// ---- Policy T ----

test('entropy: none or one score is 0; a two-way tie is ln 2; large scores stay stable', function () {
  assert.equal(policyT.entropy([]), 0);
  assert.equal(policyT.entropy([7]), 0);
  close(policyT.entropy([4, 4]), Math.LN2);
  close(policyT.entropy([1000, 1000]), Math.LN2);
  assert.ok(Math.abs(policyT.entropy([11, 7]) - 0.0904) < 0.001); // gap 4
  assert.ok(Math.abs(policyT.entropy([5, 4]) - 0.5822) < 0.001); // gap 1
});

test('T asks on a tie and acts on clear requests; theta defaults to 0.5', function () {
  var t = policies.createPolicy('T');
  assert.equal(t.params.theta, 0.5);
  assert.equal(t.decide(ctx(parsed('cancel', { time: '15:00' }))).decision, 'ask');
  assert.equal(t.decide(ctx(parsed('cancel', { date: '2026-11-24', time: '10:00', person: 'Sam' }))).decision, 'act');
  assert.equal(t.decide(ctx(parsed('create', { date: '2026-11-27', time: '14:00' }))).decision, 'act');
});

test('T reads only the scores: it acts on a vague time that K asks about (the structural difference)', function () {
  var c = ctx(parsed('create', { date: '2026-11-27', time: 'afternoon' }));
  var r = policies.createPolicy('T').decide(c);
  assert.equal(r.decision, 'act');
  assert.equal(r.entropy, 0);
});

test('T theta can be overridden; bad theta throws', function () {
  assert.equal(policyT.createPolicyT({ theta: 0 }).decide(ctx(parsed('create', { date: '2026-11-27', time: '14:00' }))).decision, 'ask');
  assert.throws(function () { policyT.createPolicyT({ theta: -1 }); }, RangeError);
  assert.throws(function () { policyT.createPolicyT({ theta: NaN }); }, RangeError);
});

// ---- policy selection ----

test('createPolicy picks K or T and rejects anything else', function () {
  assert.equal(policies.createPolicy('K').name, 'K');
  assert.equal(policies.createPolicy('T').name, 'T');
  assert.throws(function () { policies.createPolicy('X'); }, RangeError);
});

test('policyFromEnv reads CLARIFICATION_POLICY (no default)', function () {
  assert.throws(function () { policies.policyFromEnv({}); }, /CLARIFICATION_POLICY/);
  assert.equal(policies.policyFromEnv({ CLARIFICATION_POLICY: 'k' }).name, 'K');
  assert.equal(policies.policyFromEnv({ CLARIFICATION_POLICY: ' T ' }).name, 'T');
  assert.throws(function () { policies.policyFromEnv({ CLARIFICATION_POLICY: 'Z' }); }, RangeError);
});

// ---- pipeline: pre-check, not_found, policy ----

test('pre-check: a missing required slot ALWAYS asks, for K and T (decision D1)', function () {
  var p = parsed('create', { date: '2026-11-27', person: 'Sam' }); // no time
  ['K', 'T'].forEach(function (name) {
    var d = pipeline.decide(p, h.CAL, policies.createPolicy(name));
    assert.equal(d.decision, 'ask');
    assert.equal(d.by, 'precheck');
    assert.equal(d.policy_result, null);
  });
  var noDest = pipeline.decide(parsed('reschedule', { date: '2026-11-26', time: '09:00' }), h.CAL, policies.createPolicy('T'));
  assert.equal(noDest.by, 'precheck');
});

test('nothing on the calendar matches -> not_found (neither ask nor act)', function () {
  var d = pipeline.decide(parsed('cancel', { date: '2030-01-01' }), h.CAL, policies.createPolicy('K'));
  assert.equal(d.decision, 'not_found');
  assert.equal(d.by, 'no_match');
});

test('otherwise the policy decides, and the two policies can differ', function () {
  var p = parsed('create', { date: '2026-11-27', time: 'afternoon' });
  var k = pipeline.decide(p, h.CAL, policies.createPolicy('K'));
  var t = pipeline.decide(p, h.CAL, policies.createPolicy('T'));
  assert.equal(k.by, 'policy');
  assert.equal(k.decision, 'ask');
  assert.equal(t.decision, 'act');
  assert.deepEqual(k.scored, t.scored); // shared boxes 1-3: identical input to both
  assert.deepEqual(k.ambiguity, t.ambiguity);
});

test('pipeline output is deterministic', function () {
  var p = parsed('cancel', { time: '15:00' });
  assert.deepEqual(pipeline.decide(p, h.CAL, policies.createPolicy('K')), pipeline.decide(p, h.CAL, policies.createPolicy('K')));
});

// ---- Revised K (K2): the single post-dev revision ----

test('K2 is K with only the TIME_EXPR weight raised 3 -> 4; original K is unchanged', function () {
  var k = policies.createPolicy('K');
  var k2 = policies.createPolicy('K2');
  assert.equal(k2.name, 'K2');
  assert.equal(k.params.w.TIME_EXPR, 3);
  assert.equal(k2.params.w.TIME_EXPR, 4);
  assert.equal(k2.params.theta, k.params.theta);
  Object.keys(k.params.w).forEach(function (name) {
    if (name !== 'TIME_EXPR') assert.equal(k2.params.w[name], k.params.w[name], name);
  });
  assert.deepEqual(policyK.REVISED_CHANGES, { w: { TIME_EXPR: 4 } });
  assert.equal(policyK.DEFAULT_PARAMS.w.TIME_EXPR, 3);
});

test('K2 scores exactly 1 higher than K when TIME_EXPR fires, and the same otherwise', function () {
  var k = policies.createPolicy('K');
  var k2 = policies.createPolicy('K2');
  var vague = ctx(parsed('create', { date: '2026-11-27', time: 'afternoon' }));
  close(k2.decide(vague).score - k.decide(vague).score, 1);
  var plain = ctx(parsed('cancel', { time: '15:00' }));
  close(k2.decide(plain).score, k.decide(plain).score);
  var clear = ctx(parsed('cancel', { date: '2026-11-24', time: '10:00', person: 'Sam' }));
  close(k2.decide(clear).score, k.decide(clear).score);
});

test('K2 can be selected by name and by CLARIFICATION_POLICY', function () {
  assert.deepEqual(policies.NAMES, ['K', 'K2', 'T', 'ALWAYS', 'NEVER']);
  assert.equal(policies.policyFromEnv({ CLARIFICATION_POLICY: 'k2' }).name, 'K2');
});

// ---- Control policies (ALWAYS / NEVER) ----

test('ALWAYS asks and NEVER acts on requests the pre-check lets through', function () {
  var always = policies.createPolicy('ALWAYS');
  var never = policies.createPolicy('NEVER');
  var clear = parsed('cancel', { date: '2026-11-24', time: '10:00', person: 'Sam' });
  var ambiguous = parsed('cancel', { time: '15:00' });
  [clear, ambiguous].forEach(function (p) {
    assert.equal(pipeline.decide(p, h.CAL, always).decision, 'ask');
    assert.equal(pipeline.decide(p, h.CAL, never).decision, 'act');
  });
  assert.equal(always.name, 'ALWAYS');
  assert.equal(never.name, 'NEVER');
});

test('the pre-check still applies to the controls: missing slot asks, nothing matched is not_found', function () {
  var never = policies.createPolicy('NEVER');
  var missing = pipeline.decide(parsed('create', { date: '2026-11-27' }), h.CAL, never);
  assert.equal(missing.decision, 'ask');
  assert.equal(missing.by, 'precheck');
  assert.equal(pipeline.decide(parsed('cancel', { date: '2030-01-01' }), h.CAL, policies.createPolicy('ALWAYS')).decision, 'not_found');
});

test('the controls are experiment-only: the app cannot select them by environment variable', function () {
  assert.throws(function () { policies.policyFromEnv({ CLARIFICATION_POLICY: 'always' }); }, /experiment control/);
  assert.throws(function () { policies.policyFromEnv({ CLARIFICATION_POLICY: 'NEVER' }); }, /experiment control/);
});
