// Small text helpers shared by the question templates and confirmations.
// Pure; no I/O.

var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "HH:MM:SS" (Supabase) or "HH:MM" -> "HH:MM"
function hhmm(t) {
  return typeof t === 'string' ? t.slice(0, 5) : null;
}

// "2026-11-24" -> "Tue 24 Nov" (no timezone maths: parsed as UTC and read back as UTC)
function fmtDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return String(iso);
  var d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return iso;
  return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

// An existing appointment as it appears in a question: "10:00 on Tue 24 Nov with Sam".
function describe(appt) {
  var s = hhmm(appt.start_time) + ' on ' + fmtDate(appt.date);
  if (appt.person) s += ' with ' + appt.person;
  else if (appt.title) s += ' (' + appt.title + ')';
  return s;
}

module.exports = { hhmm: hhmm, fmtDate: fmtDate, describe: describe };
