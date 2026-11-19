// Reply handling after a clarifying question (live app; D4-R option A, 2026-11-19):
// the shared parser is run on the reply ALONE and its non-null slots are merged into the
// earlier parse. Which slots the reply fills depends on what was asked (`focus`, from
// src/questions.js). Pure; no LLM here (the caller runs the parser).
//
// UNVERIFIED: whether the real parser returns usable slots for a bare reply such as
// "3pm" or "Friday" has not been tested live. If a reply parses to nothing, nothing is
// merged and the same question comes back (the turn limit still applies).

var SLOT_KEYS = ['date', 'time', 'new_date', 'new_time', 'person', 'duration'];

function isGiven(v) {
  return v !== null && v !== undefined;
}

function clone(parsed) {
  return { intent: parsed.intent, slots: Object.assign({}, parsed.slots) };
}

// mergeReply(previous, focus, replyParsed) -> new parsed request {intent, slots}
// previous / replyParsed = { intent, slots } as returned by the parser.
function mergeReply(previous, focus, replyParsed) {
  var out = clone(previous);
  var r = replyParsed.slots;

  if (focus === 'intent') {
    // "cancel it or move it?" -> the reply's intent decides.
    out.intent = replyParsed.intent;
    if (out.intent !== 'reschedule') {
      out.slots.new_date = null;
      out.slots.new_time = null;
    }
  }

  if (focus === 'destination' || focus === 'new_time') {
    // The reply is the DESTINATION: "Friday at 2pm" parses as date/time, so remap to new_*.
    var nd = isGiven(r.new_date) ? r.new_date : r.date;
    var nt = isGiven(r.new_time) ? r.new_time : r.time;
    if (isGiven(nd)) out.slots.new_date = nd;
    if (isGiven(nt)) out.slots.new_time = nt;
    return out;
  }

  // Everything else (date, time, appointment, which, detail, intent): overlay non-null slots.
  SLOT_KEYS.forEach(function (k) {
    if (isGiven(r[k])) out.slots[k] = r[k];
  });
  return out;
}

module.exports = { mergeReply: mergeReply };
