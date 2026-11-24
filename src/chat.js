// The chat flow behind /api/chat: parse -> score -> detect -> pre-check/policy -> ask or act.
// Dependencies are injected so the whole flow is testable offline:
//   parser   { parseRequest(text) -> {ok, parsed, error?, cached, meta} }   (src/parser.js)
//   calendar { list() -> appointments[], execute(plan) -> Promise }          (src/calendar.js)
//   policy   { name, decide(ctx) }                                           (src/policies)
//
// The server is stateless (Vercel): after an ASK the client gets an opaque `state` object
// and must send it back with the reply. State is validated, not trusted; it holds only
// the parsed request, what was asked and how many questions have been asked.
// Student's decisions (D4, 2026-11-19): one question per turn, at most MAX_QUESTIONS
// clarifications, then give up; nothing matched -> say so (no ask, no act).
//
// Result statuses: 'done' (acted), 'ask', 'not_found', 'gave_up', 'parse_error'.
// Every result carries `trace` ({policy, by, fired, ...}) so a UI can show why.

var pipeline = require('./pipeline');
var questions = require('./questions');
var actions = require('./actions');
var replies = require('./replies');
var parserModule = require('./parser');

var MAX_QUESTIONS = 2;
var FOCUSES = ['date', 'time', 'date+time', 'appointment', 'destination', 'new_time', 'intent', 'which', 'detail'];

// Returns a sanitised copy of a client-supplied state, or null if it is not valid.
function cleanState(state) {
  if (!state || typeof state !== 'object') return null;
  var check = parserModule.validateParsed(state.parsed);
  if (!check || check.ok === false) return null;
  if (!state.asked || FOCUSES.indexOf(state.asked.focus) === -1) return null;
  if (!Number.isInteger(state.asks) || state.asks < 1 || state.asks > MAX_QUESTIONS) return null;
  return { parsed: check.parsed, asked: { type: String(state.asked.type), focus: state.asked.focus }, asks: state.asks };
}

function createChatService(deps) {
  var parser = deps.parser;
  var calendar = deps.calendar;
  var policy = deps.policy;
  var source = deps.source || 'app';

  function trace(d) {
    var t = { policy: policy.name, by: d.by, fired: d.ambiguity.fired };
    if (d.policy_result) {
      t.score = d.policy_result.score !== undefined ? d.policy_result.score : d.policy_result.entropy;
      t.theta = d.policy_result.theta;
    }
    return t;
  }

  async function handle(parsed, asks, sessionId) {
    var appointments = await calendar.list(sessionId);
    var d = pipeline.decide(parsed, appointments, policy);

    if (d.decision === 'not_found') {
      return { status: 'not_found', message: "I can't find an appointment that matches that.", trace: trace(d) };
    }
    if (d.decision === 'ask') {
      if (asks >= MAX_QUESTIONS) {
        return { status: 'gave_up', message: "I couldn't work out what you meant. Please try again with more detail.", trace: trace(d) };
      }
      var q = questions.buildQuestion(parsed, d.ambiguity, d.scored, appointments);
      return {
        status: 'ask',
        question: q.text,
        state: { parsed: parsed, asked: { type: q.type, focus: q.focus }, asks: asks + 1 },
        trace: Object.assign(trace(d), { asked: q.type }),
      };
    }
    var plan = actions.planAction(parsed, d.scored, { source: source });
    await calendar.execute(plan, sessionId);
    return { status: 'done', message: actions.confirmationText(plan, appointments), action: plan, trace: trace(d) };
  }

  function parseFailure(r) {
    return { status: 'parse_error', message: "Sorry, I couldn't understand that request. Please rephrase it.", error: r.error };
  }

  return {
    // start(text) -> result
    start: async function (text, sessionId) {
      var r = await parser.parseRequest(text);
      if (!r.ok) return parseFailure(r);
      return handle(r.parsed, 0, sessionId);
    },
    // reply(state, text) -> result; throws TypeError on an invalid state
    reply: async function (state, text, sessionId) {
      var st = cleanState(state);
      if (!st) throw new TypeError('Invalid conversation state.');
      var r = await parser.parseRequest(text);
      if (!r.ok) return parseFailure(r);
      var merged = replies.mergeReply(st.parsed, st.asked.focus, r.parsed);
      return handle(merged, st.asks, sessionId);
    },
  };
}

module.exports = { createChatService: createChatService, MAX_QUESTIONS: MAX_QUESTIONS, cleanState: cleanState };
