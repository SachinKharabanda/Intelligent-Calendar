// Template clarifying questions (one per ambiguity type), shared by K and T.
// Student's decisions (2026-11-19, docs/decision-options.md D4-Q, D4-M): ask ONE
// question per turn, for the highest-priority fired type
//   INTENT > MISSING_SLOT > MULTI_MATCH > TIME_EXPR,
// then loop. Pure; no LLM. The wording is the draft from the options file.
//
// buildQuestion(parsed, ambiguity, scored, appointments) -> { type, focus, text }
//   type  = the ambiguity type asked about, or 'GENERIC' when the policy asked but no
//           type fired (e.g. K's score crossed theta on low margin alone)
//   focus = what the reply should fill (used by src/replies.js):
//           'date' | 'time' | 'date+time' | 'appointment' | 'destination'
//           | 'new_time' | 'intent' | 'which' | 'detail'

var fmt = require('./format');

var PRIORITY = ['INTENT', 'MISSING_SLOT', 'MULTI_MATCH', 'TIME_EXPR'];
var MAX_LISTED = 3;

function byId(appointments) {
  var m = {};
  appointments.forEach(function (a) { m[a.id] = a; });
  return m;
}

function destinationText(slots) {
  var parts = [];
  if (slots.new_date) parts.push(fmt.fmtDate(slots.new_date));
  if (slots.new_time) parts.push((slots.new_date ? 'at ' : '') + slots.new_time);
  return parts.join(' ');
}

function listOr(items) {
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(', ') + ' or ' + items[items.length - 1];
}

function whichText(ids, lookup) {
  var appts = ids.map(function (id) { return lookup[id]; }).filter(Boolean);
  if (appts.length >= 2 && appts.length <= MAX_LISTED) {
    return 'Which one do you mean: ' + listOr(appts.map(fmt.describe)) + '?';
  }
  return 'I found ' + ids.length + ' matching appointments; which one do you mean?';
}

function missingQuestion(alt) {
  var m = alt.missing;
  if (m.indexOf('appointment') !== -1) return { focus: 'appointment', text: 'Which appointment do you mean?' };
  if (m.indexOf('destination') !== -1) return { focus: 'destination', text: 'When should I move it to?' };
  if (m.indexOf('date') !== -1 && m.indexOf('time') !== -1) return { focus: 'date+time', text: 'What date and time should I book it?' };
  if (m.indexOf('date') !== -1) return { focus: 'date', text: 'What date should I book it for?' };
  return { focus: 'time', text: 'What time should I book it?' };
}

function buildQuestion(parsed, ambiguity, scored, appointments) {
  var lookup = byId(appointments);
  var alts = {};
  ambiguity.alternatives.forEach(function (a) { alts[a.type] = a; });

  for (var i = 0; i < PRIORITY.length; i++) {
    var t = PRIORITY[i];
    if (!alts[t]) continue;
    var a = alts[t];
    if (t === 'INTENT') {
      var dest = destinationText(parsed.slots);
      var move = dest ? 'move it to ' + dest : 'move it';
      var first = parsed.intent === 'create' ? 'book a new appointment' : 'cancel it';
      return { type: t, focus: 'intent', text: 'Do you want to ' + first + ', or ' + move + '?' };
    }
    if (t === 'MISSING_SLOT') {
      var q = missingQuestion(a);
      return { type: t, focus: q.focus, text: q.text };
    }
    if (t === 'MULTI_MATCH') {
      return { type: t, focus: 'which', text: whichText(a.candidates, lookup) };
    }
    if (t === 'TIME_EXPR') {
      return { type: t, focus: a.slot === 'time' ? 'time' : 'new_time', text: 'What time in the ' + a.value + '?' };
    }
  }

  // The policy asked but no type fired: ask which of the top two, else for more detail.
  var h = scored.hypotheses;
  if (h.length >= 2 && h[0].appointment_id && h[1].appointment_id) {
    return { type: 'GENERIC', focus: 'which', text: whichText([h[0].appointment_id, h[1].appointment_id], lookup) };
  }
  return { type: 'GENERIC', focus: 'detail', text: 'Could you tell me a bit more about what you would like to do?' };
}

module.exports = { buildQuestion: buildQuestion, PRIORITY: PRIORITY };
