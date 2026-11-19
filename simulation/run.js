// Local harness CLI: replay a labelled set against one policy.
//
//   node simulation/run.js --set dev --policy K|K2|T|ALWAYS|NEVER [--theta 4] [--params '{"w":{"risk":2}}']
//
// Needs DEEPSEEK_API_KEY, DEEPSEEK_MODEL, SUPABASE_URL and SUPABASE_SERVICE_KEY in .env
// (the shared parser reads and writes the parse cache in Supabase) and
// PARSER_REFERENCE_DATE equal to the fixture's reference_date. Parses are cached by
// (request text, model), so a second run replays without new DeepSeek calls.
// Writes results/<set>-<policy>-<timestamp>.json. Run it from your own machine: it makes
// real DeepSeek calls (small cost) the first time a request text is seen.
//
// Guards (methodology): refuses to run a set until the student has set
// "reviewed_by_student": true in it, i.e. the labels were checked and fixed BEFORE any
// policy run; refuses if the reference date does not match.

require('dotenv').config();
var fs = require('fs');
var path = require('path');
var policies = require('../src/policies');
var harness = require('./harness');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    if (argv[i].indexOf('--') === 0) out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}

function die(msg) {
  console.error('simulation/run.js: ' + msg);
  process.exit(1);
}

function fmt(x) {
  return x === null ? 'n/a' : Math.round(x * 1000) / 1000;
}

async function main() {
  var args = parseArgs(process.argv);
  if (['dev', 'test'].indexOf(args.set) === -1) die('--set must be dev or test');
  if (policies.NAMES.indexOf(args.policy) === -1) die('--policy must be one of: ' + policies.NAMES.join(', '));

  var fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));
  var set = JSON.parse(fs.readFileSync(path.join(__dirname, args.set, 'requests.json'), 'utf8'));
  if (set.reviewed_by_student !== true) {
    die('the ' + args.set + ' set is not marked "reviewed_by_student": true. Review and fix the labels first, commit the set, then run.');
  }
  if (process.env.PARSER_REFERENCE_DATE !== fixture.reference_date) {
    die('set PARSER_REFERENCE_DATE=' + fixture.reference_date + ' in .env (fixture.json reference_date) so relative dates resolve the same in every run.');
  }

  var params = args.params ? JSON.parse(args.params) : {};
  if (args.theta !== undefined) params.theta = Number(args.theta);
  var policy = policies.createPolicy(args.policy, params);

  var parser = { parseRequest: require('../src/parser').parseRequest };
  var run = await harness.runSet({ requests: set.requests, fixture: fixture, parser: parser, policy: policy });

  var outDir = path.join(__dirname, '..', 'results');
  fs.mkdirSync(outDir, { recursive: true });
  var file = path.join(outDir, args.set + '-' + args.policy + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify({
    set: args.set,
    policy: policy.name,
    params: policy.params,
    model: process.env.DEEPSEEK_MODEL,
    reference_date: fixture.reference_date,
    summary: run.summary,
    results: run.results,
  }, null, 2));

  var s = run.summary;
  console.log('policy ' + policy.name + ' on ' + args.set + ' (' + s.requests + ' requests, ' + s.parse_failures + ' parse failures)');
  console.log('asks ' + s.asks + ', acts ' + s.acts + ', not_found ' + s.not_found + ' | TP ' + s.confusion.tp + ' FP ' + s.confusion.fp + ' FN ' + s.confusion.fn + ' TN ' + s.confusion.tn);
  console.log('precision ' + fmt(s.precision) + ' recall ' + fmt(s.recall) + ' F1 ' + fmt(s.f1) + ' | wrong actions ' + s.wrong_actions + '/' + s.acts);
  console.log('wrote ' + path.relative(process.cwd(), file));
}

main().catch(function (err) {
  console.error('simulation/run.js failed:', err && err.message);
  process.exit(1);
});
