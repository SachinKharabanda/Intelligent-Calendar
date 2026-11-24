// Calendar data access for the live app: list appointments and execute an action plan
// (src/actions.js). Server-side only, through the Supabase service client.
// STATUS: Implemented. Offline tests against an in-memory fake (test/calendar.test.js), and
// run once live against the Supabase project on 2026-11-20 (list, create, cancel, reschedule
// through the chat flow, each scenario run once).
//
// Errors are rethrown with a generic message so database details never reach the client.

var COLUMNS = 'id, title, person, date, start_time, duration_minutes, source, created_at';

function fail(what) {
  return new Error('Calendar ' + what + ' failed.');
}

// createCalendar(supabase) -> { list(sessionId), execute(plan, sessionId) }
// Every read and write is scoped to the visitor's session_id (src/session.js).
function createCalendar(supabase) {
  return {
    list: async function (sessionId) {
      var r = await supabase
        .from('appointments')
        .select(COLUMNS)
        .eq('session_id', sessionId)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true });
      if (r.error) throw fail('read');
      return r.data || [];
    },
    execute: async function (plan, sessionId) {
      var r;
      if (plan.type === 'create') {
        r = await supabase.from('appointments').insert(Object.assign({}, plan.appointment, { session_id: sessionId })).select(COLUMNS).single();
      } else if (plan.type === 'cancel') {
        r = await supabase.from('appointments').delete().eq('id', plan.appointment_id).eq('session_id', sessionId);
      } else if (plan.type === 'reschedule') {
        r = await supabase.from('appointments').update(plan.changes).eq('id', plan.appointment_id).eq('session_id', sessionId);
      } else {
        throw new TypeError('Unknown action type.');
      }
      if (r.error) throw fail(plan.type);
      return r.data || null;
    },
  };
}

module.exports = { createCalendar: createCalendar };
