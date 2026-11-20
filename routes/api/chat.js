var express = require('express');

// POST /api/chat        { "text": "..." }                  -> result
// POST /api/chat/reply  { "text": "...", "state": {...} }  -> result
// `result` is defined in src/chat.js: { status: 'done'|'ask'|'not_found'|'gave_up'|'parse_error',
// message | question, state (on 'ask'), action (on 'done'), trace }. The client keeps `state`
// between an ASK and the reply (the server is stateless). Status: Implemented; offline tests
// with fakes, and run live against DeepSeek / Supabase on 2026-11-20 (create, cancel,
// reschedule, ask/reply, vague time, not-found, give-up; each scenario run once).

var MAX_TEXT = 500;

function cleanText(v) {
  if (typeof v !== 'string') return null;
  var t = v.trim();
  return t.length > 0 && t.length <= MAX_TEXT ? t : null;
}

// createChatRouter(getService): getService() builds (or returns) the chat service. It is
// called per request so a missing key gives a clean 500 instead of crashing at startup.
function createChatRouter(getService) {
  var router = express.Router();
  router.use(express.json({ limit: '10kb' }));

  function run(res, work) {
    Promise.resolve()
      .then(work)
      .then(function (result) { res.json(result); })
      .catch(function (err) {
        if (err instanceof TypeError && /state/i.test(err.message)) {
          return res.status(400).json({ error: 'Invalid conversation state.' });
        }
        console.error('chat error:', err && err.message);
        res.status(500).json({ error: 'The assistant is not available right now.' });
      });
  }

  router.post('/', function (req, res) {
    var text = cleanText(req.body && req.body.text);
    if (!text) return res.status(400).json({ error: 'text must be a non-empty string of at most ' + MAX_TEXT + ' characters.' });
    run(res, function () { return getService().start(text); });
  });

  router.post('/reply', function (req, res) {
    var text = cleanText(req.body && req.body.text);
    if (!text) return res.status(400).json({ error: 'text must be a non-empty string of at most ' + MAX_TEXT + ' characters.' });
    run(res, function () { return getService().reply(req.body.state, text); });
  });

  return router;
}

// Default service, built lazily from the environment (needs DEEPSEEK_*, SUPABASE_*,
// CLARIFICATION_POLICY). Required here, not at the top, so tests and the health route
// work without keys.
var service = null;
function defaultService() {
  if (!service) {
    var chat = require('../../src/chat');
    service = chat.createChatService({
      parser: { parseRequest: require('../../src/parser').parseRequest },
      calendar: require('../../src/calendar').createCalendar(require('../../src/supabase')),
      policy: require('../../src/policies').policyFromEnv(process.env),
    });
  }
  return service;
}

module.exports = createChatRouter(defaultService);
module.exports.createChatRouter = createChatRouter;
